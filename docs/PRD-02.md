# Agent cards

**Author:** Dan Kim  
**Date:** 2026-07-23  
**Version:** 2.0  
**Status:** Internal review

| Reviewer | Role | Decision |
|---|---|---|
| — | Engineering | — |
| — | Product / Partnerships | — |
| — | Developer Relations | — |

---

## TL;DR

Agent cards is a browser-based reference application that shows how to build a governed AI agent spend product on top of Airwallex Issuing. It runs as a live, interactive demo against the Airwallex sandbox — real API calls, real card controls, no stubbed Airwallex responses.

The app has three parts working together:

**1. A policy and governance layer.** Each agent has a spend policy: approved merchant categories, a per-transaction spending cap, a total budget, and a velocity limit. The policy is enforced before any card is issued. Soft violations (over-budget, velocity, cap breaches) escalate to a human approval queue where the agent waits for a decision. Hard violations (unauthorized merchant category, currency mismatch, frozen agent) are declined immediately with no option to override.

**2. An AI agent that buys things.** A Claude-powered agent receives a task (e.g. "purchase a Vercel Pro plan"), checks its policy, provisions a single-use virtual card constrained by merchant category, amount, and authorization window, completes the transaction at a demo storefront, and returns a receipt — without human involvement at each step.

**3. A human control plane.** A web console lets a human operator observe every governance action in real time, approve or deny escalations, freeze agents instantly, and view spend across all agent identities.

**The key demo moment:** the agent completes a governed purchase end-to-end in ~30 seconds. The MCP traffic log shows every MCP-mediated governance call from external agents and internal routes. Policy breaches surface immediately — either as escalations that wait for human approval, or as hard declines the agent explains to the user.

---

## 1. Why This Matters

Enterprise treasury teams are beginning to explore AI agents for autonomous financial operations — provisioning cards, moving funds, and executing routine purchases without human intervention at each step. The challenge: there is no widely understood reference architecture for how AI agents should interact with financial infrastructure in a controlled, auditable, policy-governed way.

This demo makes that architecture concrete. It demonstrates Airwallex Issuing working end-to-end with an AI agent, using native model tool-calling and an MCP-based control plane for governed financial operations, in a live sandbox environment. A multi-currency scenario (GBP-denominated agent with live FX conversion) extends the primary story for prospects with cross-border spend requirements.

The primary use case is a sales or developer relations demo — a 10-minute walkthrough that answers "how would an AI agent actually buy something, within guardrails, using Airwallex?"

---

## 2. Target Audience

**Primary:** Airwallex enterprise prospects and partners evaluating AI agent use cases  
**Secondary:** Developers building their own agent-powered spend integrations  
**Tertiary:** Airwallex internal teams (product, partnerships) demoing the platform

The demo runner is assumed to be a technical person comfortable with a browser-based app. No deep knowledge of Airwallex APIs is required to run the demo, but understanding the architecture requires familiarity with REST APIs and AI agent tooling.

---

## 3. Demo Scenario

The demo tells a single coherent story:

> A procurement agent autonomously purchases a Vercel Pro monthly plan for $18, within its pre-configured policy limits, using a scoped virtual card provisioned at runtime.

The agent:
1. Checks its spending policy (merchant category, transaction cap, remaining budget)
2. Provisions a single-use virtual card issued for the task — constrained by merchant category, amount, and authorization window
3. Completes the purchase at the demo store
4. Returns a receipt URL

The human observer watches this happen in real time through the chat UI and a live tool-call log.

An extended demo shows the human-in-the-loop flow: an agent exceeds an escalatable budget, velocity, or per-transaction limit; the request enters the approval queue; a human approves it; and the agent resumes automatically to complete the purchase.

---

## 4. Key Features

### 4.1 Authentication

The hosted demo has no login. Anyone who can open the app can use it. The MCP endpoint is also open, so an external agent can connect without a browser session. Agent identity is a string in the tool call, not a verified credential.

### 4.2 Policy and Agent Profile Management

The Policies page is the configuration hub for spend governance.

**Spend policies** define the rules shared across agents:

| Rule | Description |
|---|---|
| Currency | The policy's operating currency; requests in a different currency are declined |
| Total budget | Maximum cumulative spend across all of an agent's cards |
| Per-transaction spending cap | Maximum amount for any single card charge — enforced both at issuance (by the app) and at authorization (by Airwallex natively on the card) |
| Approved merchant categories | MCC allowlist — enforced both at issuance and at authorization |
| Authorization time window | How long a provisioned card accepts authorizations before expiring (configurable per-policy; scoped task cards default to 15 minutes) |
| Velocity limit | Maximum approved transactions per rolling time window (TBD — currently hourly) |

Some of these rules are enforced in two layers: the app checks them before issuing a card, and Airwallex independently enforces the native card controls configured at issuance (spending cap, MCC allowlist, authorization window) at authorization time. Total-budget and velocity controls remain app-layer checks only.

**Agent profiles** link an agent identity to a policy. Key settings:
- **Issuance mode**: whether an agent can self-serve card provisioning within its policy, or whether all issuance requires human pre-approval regardless of limits
- **Frozen state**: blocks all card issuance immediately when enabled
- **Project grouping**: an arbitrary tag for cost attribution

Multiple agent profiles can share a single policy. Deleting a policy is blocked if any agent profiles still reference it.

### 4.3 Agent Cards

The Agent Cards page shows live virtual cards issued to AI agents, grouped by agent identity. Each card tile shows: status, single-use vs multi-use, spend progress against the card limit, allowed merchant categories, and controls for freeze/unfreeze, cancel, and sandbox card number reveal.

A manual issuance form lets a human admin issue a card directly — selecting an agent profile, card type, limit, currency, merchant categories, and expiry.

### 4.4 Virtual Card Provisioning

Two provisioning paths serve different use cases:

**General-purpose issuance** — a human admin issues a card for an agent. The system checks the agent's frozen state, policy existence, velocity limit, budget, and currency match before proceeding. The card's spending cap defaults to the policy's per-transaction limit.

**Scoped task issuance** — the agent (or a tool call on its behalf) requests a card for a specific task. The card is single-use, constrained to one merchant category, capped at a specified amount, and configured to accept authorizations only within a short time window. Additional governance:
- Agents configured for human-pre-approval always escalate to the approval queue, regardless of whether the request is within policy
- Requests that exceed the budget, velocity, or per-transaction cap escalate to the approval queue (the agent is told to wait)
- Requests for an unauthorized merchant category or mismatched currency are hard-declined (no escalation — the agent is told why)

Card credentials (PAN, CVV, expiry) are hidden by default and can be revealed on demand via the card tile (sandbox shortcut — see §7).

### 4.5 Approval Queue

Two approval types:

**Limit increase**: An agent asks a human to raise a policy limit (e.g., per-transaction cap or total budget). On approval, the policy is updated immediately.

**Card provision**: When a scoped card request is escalated, it appears here. On approval, the card is provisioned and its `card_id` is stored on the approval record so the agent can retrieve it.

The sidebar shows an amber badge when pending approvals exist.

**Auto-resume:** When a card provision approval is resolved, the chat drawer opens automatically and the agent continues the task with the newly provisioned card — no manual re-prompting needed.

### 4.6 Dashboard

The home page provides an at-a-glance view:
- Summary tiles: agent profiles, cards issued, pending approvals, total agent spend — each links to its detail page
- Wallet balances (multi-currency, live from Airwallex)
- Agent spend summary and active approval queue, side by side
- Recent transaction feed

### 4.7 AI Agent Chat Interface

A sliding drawer exposes a Claude chat interface. The system prompt puts the assistant in two modes: **human admin** (default — for balance inquiries, account management, FX, card questions) and **agent task** (when asked to run a procurement task autonomously).

The chat assistant has access to tools covering:
- **Accounts**: wallet balances, Global Account management, FX conversion, deposit simulation
- **Card management**: listing cards, provisioning (general and scoped), credential reveal
- **Agent operations**: listing agents and policies, agent spend reports
- **Purchasing**: demo store checkout, card transaction simulation
- **Governance**: listing and viewing approval queue items

A "Run Agent Task" button fires a pre-written procurement prompt that demonstrates the full governed purchase flow.

> **Note:** The chat assistant uses the AI model's native tool-calling — it invokes tools directly, not through the MCP server. The MCP server is the integration point for external agents (see §4.8). This is an intentional architecture distinction: the chat assistant is part of the app; external agents connect to the app's control plane via MCP.

### 4.8 MCP Control Plane

The app exposes an MCP server as the governance integration point for external agents. This is distinct from Airwallex's own hosted Developer MCP — the app's MCP server is purpose-built for this demo's policy layer.

External headless agents connect to this endpoint to:
- Query their policy and issuance permissions
- Provision scoped cards (subject to the same policy enforcement as the chat assistant)
- Record task spend outcomes
- Request limit increases
- List and manage cards, transactions, and approvals

The endpoint is also used internally by the app's card issuance and approval resolution routes.

The endpoint is unauthenticated in this demo (see §7).

### 4.9 MCP Traffic Log

A slide-in panel shows every MCP-mediated governance call in real time: tool name, caller, arguments, result, and timestamp. Covers calls from external agents and internal routes that use the MCP server. (Chat assistant tool calls use the AI model's native tool-calling and are visible in the chat transcript, not the MCP log.)

### 4.10 Demo Store

A lightweight storefront that processes virtual card payments against the Airwallex sandbox. Illustrative product catalog (TBD — final products to be confirmed with demo team):

| Product | Price (USD) |
|---|---|
| Vercel Pro | $18 |
| GitHub Copilot Business | $19 |
| OpenAI API Credits | $50 |
| Notion Plus | $8 |

On checkout: calls Airwallex's sandbox transaction-simulation endpoint, writes the attribution ledger entry, and returns an approved or declined result with a receipt link.

### 4.11 Multi-Currency Accounts

- View wallet balances across available currencies
- View Global Account details — bank account rails (IBAN, routing numbers) for receiving inbound transfers per currency
- Open new Global Accounts for available currencies (USD, HKD, SGD, EUR, GBP, AUD, CAD in the reference configuration; actual availability depends on country and account setup)
- Simulate inbound bank deposits (sandbox only)
- FX conversion between currencies

> **Global Accounts vs. wallet balances:** Global Accounts are the bank account routing details for receiving inbound transfers. The spendable balance is held in the Airwallex wallet. They are distinct objects — opening a Global Account does not create a balance; receiving a deposit into a Global Account credits the wallet.

### 4.12 Activity Feed

A merged ledger of recent transactions — combining Airwallex transaction data with a local task ledger.

The local task ledger carries agent identity, task ID, and cost-attribution metadata that Airwallex transactions do not include. It is the authoritative source for the "who spent what on which task" view. Airwallex remains authoritative for card state, wallet balances, and authorization status.

**Sandbox note:** Simulated authorizations remain in pending status because the demo does not call the sandbox capture endpoint. The demo treats pending as the terminal state for its workflow.

### 4.13 Expenses View

Per-agent spend summary from the task ledger, linked from the Dashboard spend tile.

---

## 5. Technical Architecture

See the architecture sequence diagram for the full system interaction flow covering chat, MCP, external agents, policy enforcement, approval resolution, and Airwallex authorization.

### Stack

- **Frontend/Backend:** Next.js (App Router), TypeScript, Tailwind CSS
- **AI:** Anthropic Claude via the Anthropic SDK
- **Agent protocol:** MCP (server-side, for external agent integration)
- **Payments:** Airwallex REST APIs (sandbox)
- **State:** File-based JSON store for policies, agents, approvals, and the task ledger. Airwallex is the source of truth for card state, balances, and authorization outcomes; the local store handles everything Airwallex doesn't carry (policy config, agent identity, task attribution).

### Key Design Decisions

**Separate policies and agent profiles.** A policy holds spending rules; an agent profile references one policy. Multiple agents can share a policy. This separation lets a human update a cap once and have it apply to every agent on that policy.

**Escalation over hard-decline for soft violations.** When an agent exceeds its budget, velocity limit, or per-transaction cap, the request enters an approval queue rather than being refused outright. This models the real-world pattern where an agent asks for a human exception. Hard declines are reserved for structural mismatches (wrong merchant category, wrong currency, frozen agent) where an override doesn't make sense.

**Dual enforcement — app layer and Airwallex native controls.** The app checks policy before issuing a card. Airwallex independently enforces the native card controls configured at issuance (spending cap, MCC allowlist, single-use, authorization window) at the point of authorization. Total-budget and velocity controls remain app-layer checks only. This defense-in-depth — where it applies — is a key architectural message for the demo.

**Local task ledger for cost attribution.** Airwallex transactions don't carry the app's task or agent identity. Every charge path writes a local ledger entry immediately at purchase time. The activity feed merges and deduplicates this against the Airwallex transaction feed.

**MCP as the external agent control plane.** Agent governance tools are exposed via an MCP server so the architecture represents how a real multi-agent system would integrate. An external headless agent connects to the same endpoint that internal routes use — one control plane, many consumers.

**Caching for sandbox latency.** The Airwallex sandbox is slow (5–10 seconds per Issuing call). Balance and activity data use a short-TTL cache with background revalidation to keep pages responsive without sacrificing freshness.

---

## 6. Demo Setup

### Prerequisites

- Node.js 18+
- Airwallex sandbox account with API credentials
- Anthropic API key

### Configuration

The app requires three sets of credentials:

1. **Airwallex sandbox** — Client ID and API Key from the Airwallex developer console
2. **Anthropic** — API key for Claude
3. **App config** — demo password, session signing key, app URL (all have sensible defaults for local development)

The app targets the Airwallex sandbox by default. See the setup guide for the full environment variable reference.

### Running

Install dependencies, run the reset script (seeds default policies, cancels stale cards, advances the cardholder if needed), and start the dev server. The app runs on localhost:3000.

### Before Each Demo

Two ways to reset to a clean state:

1. **UI button (preferred):** Open the Demo tray (bottom of any page) and click "Reset for demo." Cancels all active agent cards and reseeds the store with default policies, agents, and an empty ledger.

2. **CLI script:** Same cleanup, useful when running headless or scripting a CI test.

For normal back-to-back demo runs neither reset is usually required — Airwallex permits a single-use card to complete only one successful debit transaction. Reset remains available when an interrupted run leaves stale card or approval state.

---

## 7. Out of Scope

- **Production MCP authentication:** The MCP endpoint is unauthenticated. Any process that can reach the app can call governance tools without a credential. Agent identity is trusted by convention. A production deployment would require per-agent tokens, mTLS, or equivalent.

- **PCI-safe card credential delivery:** The credential reveal feature proxies card details through the app server. This is a sandbox shortcut. Production should use Airwallex secure iframes and PAN delegation when avoiding application PCI scope. Direct sensitive-details API access should be limited to eligible integrations with the required PCI controls.

- **Persistent storage:** The local store is a flat JSON file — not concurrency-safe beyond a single process. No database.

- **Multi-tenancy:** Single shared sandbox account. No per-user isolation or org management.

- **Webhook handling:** All Airwallex data is polled, not pushed. Webhook delivery requires a public HTTPS endpoint, which a localhost demo cannot provide.

- **Production Airwallex environment:** All API calls target the sandbox. Switching to production requires a credential swap and removal of sandbox-specific simulation paths.

---

## 8. Success Criteria

### Happy path

The agent provisions a scoped card and completes a demo store checkout without human intervention. The MCP traffic log shows every MCP-mediated governance call from external agents and internal routes. The receipt in chat is clickable and shows the correct product and card.

**Latency target:** at least 9 of 10 clean sandbox runs complete within 60 seconds, measured from task submission to receipt rendering.

### Policy enforcement

| Condition | Expected result |
|---|---|
| Per-transaction cap exceeded | Escalated to approval queue; no card issued until approved |
| Total budget exceeded | Escalated to approval queue; no card issued until approved |
| Velocity limit exceeded | Escalated to approval queue; no card issued until approved |
| Unauthorized merchant category | Hard decline; no approval created; no card |
| Currency mismatch | Hard decline; no approval created; no card |
| Agent frozen | Immediate block; no approval created; no card |
| Approval denied | No card issued; agent task does not resume |
| Approval granted | Exactly one card issued; agent resumes exactly once |

### Approval flow

An over-policy request appears in the approval queue. A human approves. The agent auto-resumes in the chat drawer with the provisioned card and completes the purchase.

### Multi-currency / FX (optional extended demo)

The chat assistant converts a specified amount (e.g. $100 USD → GBP) via the FX conversion tool. After the conversion: the USD wallet balance decreases, the GBP wallet balance increases by the executed conversion amount, and the transaction appears in the activity feed. This scenario is optional — it extends the primary demo for prospects with cross-border spend requirements but is not required for a standard walkthrough.

### Freeze/unfreeze

Freezing an agent blocks all card issuance immediately. Unfreezing restores normal provisioning. The effect is instant — no propagation delay.
