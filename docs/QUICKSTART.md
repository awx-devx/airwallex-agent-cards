# Connecting Your Own Agent

This guide is for developers who want to plug a real (or custom) agent into the demo's policy control plane — so the agent actually provisions Airwallex virtual cards, charges them, and shows up in the dashboard — instead of using the built-in chat assistant.

---

## What the demo gives you

A running **MCP control plane** at `/api/mcp` that enforces your spending policies and talks to the Airwallex sandbox. Any agent that can call MCP tools gets:

- Per-agent policy enforcement (budget, per-txn cap, MCC allowlist, velocity)
- Real Airwallex virtual card issuance (sandbox)
- Human-in-the-loop escalation when policy limits are soft-exceeded
- Live spend visibility in the dashboard (`/expenses`, `/agents` (Agent Cards), `/approvals`)

Your agent supplies the decision-making. The control plane handles the money rails.

---

## Fastest path: modify the built-in runner

`agent/runner.mts` is a working TypeScript agent that already connects to the MCP server. It has two modes:

```bash
# Scripted replay — deterministic, no LLM, good for demos
npm run agent -- --agent procurement-agent --replay

# Live autonomous — Claude drives the tool calls
npm run agent -- --agent procurement-agent --live --task "Renew our Vercel Pro plan (~$20)"
```

To use your own logic, swap out the `runReplay` or `runLive` function with your own decision loop. The MCP connection, tool calling, and result parsing boilerplate is already there.

---

## Connecting from scratch (any language)

The control plane is a standard MCP server over Streamable HTTP.

**Endpoint:** `POST http://localhost:3000/api/mcp`  
**Auth:** None in this demo (see [Security](#security))  
**Protocol:** MCP 1.0 — use any MCP client library, or raw HTTP if you prefer

### TypeScript / Node

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL("http://localhost:3000/api/mcp"))
);

// Call any tool
const res = await client.callTool({ name: "get_policy", arguments: { agent_id: "procurement-agent" } });
const policy = JSON.parse(res.content[0].text);
```

### Python

```python
# pip install mcp
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

async with streamablehttp_client("http://localhost:3000/api/mcp") as (read, write, _):
    async with ClientSession(read, write) as session:
        await session.initialize()
        result = await session.call_tool("get_policy", {"agent_id": "procurement-agent"})
        policy = json.loads(result.content[0].text)
```

---

## The happy-path tool sequence

Every agent task follows the same four steps:

### 1. Read your policy
```json
tool: "get_policy"
args: { "agent_id": "procurement-agent" }
```
Returns per-txn cap, total budget, allowed MCCs, velocity limit, and `issuance_mode`.

### 2. Provision a scoped card
```json
tool: "provision_scoped_card"
args: {
  "agent_id": "procurement-agent",
  "task_id": "task-vercel-renewal-001",
  "merchant_category": "5734",
  "amount": 18,
  "currency": "USD",
  "expires_in_minutes": 15
}
```

**Success response:**
```json
{
  "card_id": "crd_abc123",
  "card_limit": 18,
  "currency": "USD",
  "expires_at": "2026-07-14T18:15:00Z"
}
```

**Hard decline** (wrong MCC, frozen agent):
```json
{ "refused": true, "reason": "MCC_NOT_IN_POLICY", "message": "..." }
```
Stop. Do not attempt a charge.

**Escalation** (soft policy breach — over cap, over budget, velocity exceeded, or `human_provisioned` agent):
```json
{ "pending_approval": true, "approval_id": "apr_xyz", "reason": "OVER_CAP", "message": "..." }
```
Tell the user. A human approves at `/approvals`. Once approved, the card is provisioned automatically — call `list_approvals` (no arguments), find the item matching the `approval_id`, and read `card_result.card_id` from it.

### 3. Charge the card at a merchant

The MCP server handles governance (policy, provisioning, approvals, ledger). The charge step is a separate HTTP call — this mirrors production, where the merchant/network processes the authorization independently of your control plane.

**Option A — Demo store** (purchase shows up at `/demo-store`):
```bash
POST http://localhost:3000/api/demo-store/checkout
Content-Type: application/json

{ "card_id": "crd_abc123", "product_id": "vercel-pro" }
```
Available products: `vercel-pro` ($18), `github-copilot` ($19), `openai-api` ($50), `notion-plus` ($8).

**Option B — Raw card transaction** (any amount/MCC):
```bash
POST http://localhost:3000/api/cards/transaction
Content-Type: application/json

{ "cardId": "crd_abc123", "amount": 18, "currency": "USD", "merchantCategoryCode": "5734" }
```
Use this when your merchant isn't one of the four demo store products.

Both endpoints call the Airwallex simulation API — card controls (MCC lock, spend cap, single-use) are enforced by Airwallex at authorization time.

### 4. Record the spend
```json
tool: "record_task_spend"
args: {
  "task_id": "task-vercel-renewal-001",
  "agent_id": "procurement-agent",
  "card_id": "crd_abc123",
  "amount": 18,
  "currency": "USD",
  "status": "APPROVED",
  "txn_id": "txn_xyz",
  "merchant": "Vercel",
  "mcc": "5734"
}
```
This is what populates `/expenses` and the agent spend tile on the dashboard.

---

## Pre-seeded agents

Three agents are available after `npm run reset-demo` or clicking **Reset for demo** in the UI:

| Agent ID | Mode | Policy |
|---|---|---|
| `procurement-agent` | `self_serve_within_policy` | $500 budget · $100 cap · MCCs 5734, 7311, 4511 · 10/hr · USD |
| `research-agent` | `human_provisioned` | $20,000 budget · $50 cap · MCCs 5734, 7372 · 5/hr · USD |
| `contractor-agent` | `self_serve_within_policy` | £2,000 budget · £500 cap · MCC 7389 (professional services) · 5/hr · **GBP** |

`self_serve_within_policy` → agent provisions cards autonomously within policy limits.  
`human_provisioned` → every card request escalates to `/approvals` regardless of policy.  
`contractor-agent` is the cross-border agent: issues GBP virtual cards. When run via the built-in chat assistant's "Run Agent Task" button, it converts $200 USD → GBP at task start to demonstrate the live FX rate. External agents connecting via MCP would need to call `convert_currency` (a chat-only tool) or `POST /api/convert` directly.

To add agents or change policies, edit `data/store.json` directly or use the demo controls in the UI.

---

## Handling escalation in an autonomous loop

When `provision_scoped_card` returns `pending_approval: true`, the right pattern is:

```
1. Communicate the approval_id to the user
2. Stop — do not retry, do not proceed
3. After the human approves (via /approvals), resume:
   a. Call list_approvals, find the item by approval_id
   b. Use card_result.card_id from the approved item
   c. Proceed to step 3 (charge the card)
```

The built-in chat assistant implements this pattern — search for `pendingResume` in `src/components/AppShell.tsx` and `ChatProvider.tsx` to see how the UI resumes after approval.

---

## Available MCP tools

Full list from `src/mcp/server.ts`:

| Tool | What it does |
|---|---|
| `get_policy` | Read an agent's policy and issuance mode |
| `set_policy` | Update policy fields |
| `provision_scoped_card` | Issue a single-use, MCC-locked card for one task |
| `provision_card` | Issue a general card (human admin use) |
| `list_agent_cards` | List cards issued to an agent |
| `get_card_credentials` | Get PAN/CVV/expiry (sandbox only) |
| `freeze_agent` | Freeze or cancel all active cards for an agent |
| `get_balances` | Current wallet balances |
| `list_transactions` | List card transactions (all or by card) |
| `list_agents` | List all agents and their policies |
| `list_approvals` | List approval queue items |
| `resolve_approval` | Approve or deny a queued request |
| `request_limit_increase` | Submit a limit-increase request |
| `record_task_spend` | Write a task outcome to the ledger |

---

## Security

The `/api/mcp` endpoint is **unauthenticated** in this demo. Any process that can reach the port can call `provision_card` or `freeze_agent` without credentials. Agent identity (`agent_id`) is trusted by convention.

This is intentional for demo simplicity. A production deployment would require per-agent tokens or mTLS on the MCP endpoint — see `developer-notes.md` §5.
