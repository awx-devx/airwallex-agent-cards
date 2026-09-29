# Going to Production
## From the Airwallex Treasury Demo to a Real Deployment

This guide is for developers who have the demo running locally and want to understand what it takes to ship a production version. It is a sequential checklist — work through it top to bottom. Each section identifies what the demo does, what production requires instead, and what decisions you need to make.

Estimated effort to reach a production-ready prototype: **2–4 weeks**, assuming Airwallex onboarding moves quickly.

---

## Step 1: Get a Production Airwallex Account with Issuing Access

**What the demo does:** Uses Airwallex sandbox credentials with Issuing enabled by default.

**What production requires:**

Issuing (virtual cards) is not available on standard Airwallex accounts. You need to:

1. **Apply for an Airwallex account** at [airwallex.com](https://airwallex.com) and complete business onboarding. This includes KYB (Know Your Business) — expect to provide company registration documents, beneficial ownership details, and a description of your use case.

2. **Request Issuing access explicitly.** Even after onboarding, Issuing is gated. Contact your Airwallex account manager or email partnerships@airwallex.com with:
   - Your intended card issuance volume
   - The use case (agentic spend, employee cards, customer-facing, etc.)
   - The countries/currencies you need

3. **Create a Cardholder.** Before provisioning any card, you need at least one verified Cardholder entity on your account. For agentic use cases, a single corporate Cardholder (your company) is typically sufficient — individual agent "cardholders" are modelled via card metadata and policy, not separate Cardholder records.

4. **Switch credentials.** Swap `NEXT_PUBLIC_AIRWALLEX_ENV=demo` → `NEXT_PUBLIC_AIRWALLEX_ENV=prod` and replace sandbox credentials with production ones. The base URL changes from `https://api-demo.airwallex.com` to `https://api.airwallex.com` (set via `AIRWALLEX_BASE_URL`).

> **Decision point:** If you are building this as a product for other businesses (not just your own internal use), each of your customers will need their own Airwallex account and their own Issuing access. Airwallex has a platform/partner programme for this — it is a separate onboarding conversation.

---

## Step 2: Agent Identity and Authorization

**What the demo does:** Any caller can invoke the MCP endpoint. Agent identity is a string passed in the tool call args (`agent_id="procurement-agent"`). There is no verification.

**What production requires:**

This is the most architecturally significant gap. You need a model that answers: *how does an agent prove who it is, and how do you tie that identity to a spend policy?*

There is no industry standard yet. Three viable approaches, in order of increasing robustness:

### Option A: API Key Per Agent (simplest)
Issue each agent a long-lived API key. The agent includes it in a header on every MCP tool call. The MCP server looks up the key → agent_id → policy.

```
Agent → MCP Server (Authorization: Bearer sk-agent-procurement-xxxx)
MCP Server → looks up agent_id from key store → applies policy
```

**Pros:** Simple, stateless, easy to rotate.  
**Cons:** Keys are long-lived credentials. If an agent is compromised or its prompt is injected, the key leaks. No time-bounding without explicit rotation.

**Implementation:** Add a key store (Postgres table or managed secrets store mapping `key → {agent_id, created_at, revoked}`). Add auth middleware to the MCP route that validates the key and injects `agent_id` into the request context. Remove `agent_id` from the tool call arguments entirely — it is now derived from the authenticated identity, not self-reported.

### Option B: Short-Lived JWTs (recommended for most teams)
Your orchestration layer (the service that spawns agents) issues a signed JWT to each agent at task start. The JWT contains `agent_id`, `task_id`, `issued_at`, and an expiry (e.g. 1 hour). The MCP server validates the signature.

```
Orchestrator → signs JWT(agent_id, task_id, exp=+1h) → passes to agent
Agent → MCP Server (Authorization: Bearer <jwt>)
MCP Server → validates signature, extracts claims, enforces expiry
```

**Pros:** Time-bounded (compromised token expires). Task-scoped (one token per task, not per agent globally). No database lookup on every call.  
**Cons:** Requires a signing key (store in a secrets manager, not `.env`). JWT revocation before expiry requires a blocklist.

**Implementation:** Use `jose` or `jsonwebtoken`. The orchestrator signs with your private key; the MCP middleware verifies with the public key. Claims map directly to your existing policy lookup (`agent_id` → `data/store.json` → policy).

### Option C: OAuth 2.0 Client Credentials (most robust, most complex)
Each agent is an OAuth client. It exchanges a client_id/secret for a short-lived access token scoped to specific MCP tools.

**Pros:** Standard protocol. Scopes limit what tools each agent can call, not just spend limits.  
**Cons:** Significant implementation overhead. Overkill unless you are building a multi-tenant platform.

> **Recommendation:** Start with Option B (JWTs). It is a one-afternoon implementation and gives you the security properties that matter: time-bounding and task-scoping. Option A is fine for an internal prototype. Option C is for when you are selling this to enterprises who need their own agent credential management.

---

## Step 3: Harden the MCP Endpoint

**What the demo does:** Single unauthenticated MCP endpoint at `/api/mcp`. In-memory log. No rate limiting.

**What production requires:**

### 3.1 Authentication Middleware
Once you have chosen an identity model (Step 2), add middleware to every MCP tool route that:
- Validates the credential (API key lookup or JWT verification)
- Rejects with `401` if missing or invalid
- Injects the verified `agent_id` and `task_id` into the handler context

Remove `agent_id` from tool call arguments — it should never be self-reported by the caller.

### 3.2 Tool-Level Authorization
Not every agent should be able to call every tool. Add a simple ACL: `agent_id → allowed_tools[]`. For example, a `research-agent` should be able to call `get_balance` but not `provision_scoped_card`.

### 3.3 Rate Limiting
Add rate limiting per `agent_id` at the MCP route. Even within policy, an agent in a loop (e.g. due to a prompt injection or runaway reasoning) should not be able to exhaust your Airwallex API quota or issue dozens of cards in seconds.

A simple token bucket per agent_id (using Upstash Redis or similar) is sufficient.

### 3.4 Persistent Audit Log
Replace the in-memory MCP log with a persistent store. Every tool call — args, result, agent identity, timestamp — should be written to a database. This is your audit trail for:
- Debugging agent behaviour post-hoc
- Disputing unexpected charges
- Compliance if you are in a regulated industry

Minimum fields: `id, ts, agent_id, task_id, tool, args, ok, result_summary, error, latency_ms`.

### 3.5 Deploy Behind a Private Endpoint
The MCP server should not be publicly accessible on the open internet. Options:
- Deploy to a VPC and expose only to your orchestration layer via private networking
- Add IP allowlisting if your agent infrastructure has stable egress IPs
- Use mTLS for service-to-service auth if you have an existing PKI

---

## Step 4: Card Credential Handling (PCI Scope)

**What the demo does:** `get_card_credentials` calls `GET /api/v1/issuing/cards/{id}/details` and returns the raw PAN, CVV, and expiry to the agent via the MCP response. However, the demo's purchase tools (`checkout_at_demo_store`, `simulate_purchase`) operate by `card_id` only — raw credentials never enter the purchase flow. `get_card_credentials` exists as a sandbox inspection tool, not as part of the checkout sequence.

**Why this is a problem in production:**

Passing raw PANs through your server puts your entire backend in PCI DSS scope. That means annual audits, network segmentation requirements, penetration testing, and significant compliance overhead.

**What production requires:**

### Option A: Airwallex Hosted Card Widget (recommended)
Airwallex provides a JavaScript widget that renders card details in an iFrame hosted on Airwallex's domain. Your server never sees the PAN — the browser fetches it directly from Airwallex's servers with a short-lived session token your server generates.

Implementation:
1. Your server calls `POST /api/v1/issuing/cards/{id}/credentials_token` to get a short-lived token (valid ~5 minutes)
2. Your frontend passes the token to the Airwallex.js SDK
3. The SDK renders an iFrame with the card details
4. The PAN never touches your server

For agentic use cases where the agent needs the PAN to make a purchase: the agent should not be passing raw card credentials at all in production. Instead, the purchase should be made server-side via your backend (which calls the merchant API directly) after the card is provisioned, without the PAN transiting through the agent context.

### Option B: Tokenised Checkout
For purchases at known merchants, use the merchant's card-on-file tokenisation instead of raw PAN passing. Provision the Airwallex card, run a single authorised charge server-side, and return only the transaction result to the agent — never the card credentials themselves.

> **The core principle:** In production, the agent should never hold raw card credentials. It should hold a `card_id` (an opaque reference) and the server should use that ID to execute the charge directly.

---

## Step 5: Replace Polling with Webhooks

**What the demo does:** The activity feed and balance views poll Airwallex APIs on page load. The MCP log polls `/api/mcp-log` every 3 seconds.

**What production requires:**

Register Airwallex webhooks for real-time event delivery:

| Event | Use |
|---|---|
| `card.transaction.created` | Real-time spend notification; trigger policy enforcement checks |
| `card.transaction.updated` | Authorization reversals, settlement |
| `card.status_changed` | Card closed, frozen, or expired |
| `transfer.created` | FX conversion initiated |
| `account.balance_updated` | Balance change after settlement |

**Implementation steps:**
1. Create a webhook endpoint in your app (e.g. `POST /api/webhooks/airwallex`)
2. Register it in the Airwallex dashboard under Developer → Webhooks
3. Verify the webhook signature on every inbound event (Airwallex signs payloads with HMAC-SHA256)
4. Fan out to your internal event bus or write directly to your database

**Why this matters for agents:** If an agent provisions a card and a charge is declined in real time, a webhook lets you notify the agent immediately rather than waiting for the next poll cycle. For long-running agentic tasks, this is the difference between responsive behaviour and a 10-second lag.

---

## Step 6: Secrets Management

**What the demo does:** Credentials live in a `.env` file. The Anthropic API key is also in `.env`.

**What production requires:**

**Never put secrets in environment files checked into version control.** In production:

1. **Use a secrets manager.** AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault, or Doppler all work. Your application fetches secrets at startup, not from a file.

2. **Separate credentials by environment.** Sandbox and production Airwallex credentials should be in separate secret namespaces with separate access controls.

3. **Rotate credentials regularly.** Airwallex API keys can be rotated in the dashboard. Rotate on a schedule (e.g. every 90 days) and immediately on any suspected compromise.

4. **Do not inject secrets into agent context.** The Airwallex API key and Anthropic API key should never appear in a prompt, a tool result, or an agent's reasoning context. They belong only in the server environment. The demo's MCP server already keeps these server-side; preserve this boundary.

5. **Audit secret access.** Your secrets manager should log every read. If a compromised agent context exfiltrates a secret, you want to know when it was read and from where.

---

## Step 7: Observability and Incident Response

The demo has a real-time MCP log panel. Production needs more:

**Structured logging:** Every API call to Airwallex (request, response, latency, status) should be logged in a structured format (JSON) and shipped to a log aggregator (Datadog, Grafana, CloudWatch). Include `agent_id` and `task_id` on every log line so you can trace a complete agent task run.

**Alerting:** Set alerts on:
- Airwallex API error rate > threshold (might indicate a bad agent in a loop)
- Card provisioning rate spike (policy enforcement failure)
- Any `provision_scoped_card` call that is declined by policy (worth reviewing)
- Webhook delivery failures (dead-letter queue)

**Runbook for unexpected spend:** Write a runbook before you go live:
1. How to freeze all cards for an agent (`POST /api/v1/issuing/cards/{id}/update` with `card_status: "INACTIVE"`)
2. How to cancel all active cards for a given `agent_id` (query by metadata, batch cancel)
3. Who gets paged when an anomaly fires
4. How long it takes Airwallex support to reverse an erroneous charge (set expectations)

---

## Summary Checklist

| Step | Item | Effort |
|---|---|---|
| 1 | Airwallex KYB + Issuing access approved | 1–2 weeks (external dependency) |
| 1 | Production credentials in place | 1 hour |
| 2 | Agent identity model chosen and implemented | 1–3 days |
| 3 | MCP auth middleware + rate limiting | 1–2 days |
| 3 | Tool-level ACL per agent | 1 day |
| 3 | Persistent audit log (replaces in-memory) | 1 day |
| 3 | MCP endpoint on private network | 1 day |
| 4 | Card credential handling via hosted widget or server-side charge | 2–3 days |
| 5 | Webhook endpoint + signature verification | 1 day |
| 5 | Webhook-driven real-time agent notifications | 1–2 days |
| 6 | Secrets migrated to secrets manager | 1 day |
| 7 | Structured logging + alerting + runbook | 2–3 days |

**Total (excluding Airwallex onboarding wait time): ~2–3 weeks of engineering.**

The Airwallex onboarding timeline is the critical path. Start that process before writing any production code.
