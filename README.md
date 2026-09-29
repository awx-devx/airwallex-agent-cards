# Agent cards

An agent asks for a card. The policy sets the limit and the merchant categories. A charge outside that policy declines.

The decline comes from Airwallex. This demo does not show a merchant accepting an agent, and it does not get a bot through a merchant's own checkout checks.

Sandbox only. No real money. The app issues cards from a policy, tags each card to an agent, and simulates an authorization so you can see an allowed charge clear and a disallowed one decline. An approval queue holds requests that fall outside the policy. An MCP server wraps that layer so an agent can ask for a card without holding your keys.

The architecture the doc describes and what this repo implements:

| Doc concept | Where it lives |
|---|---|
| Per-agent policy store | `src/lib/store.ts` · `data/store.json` |
| Card created from policy, not from agent request | `src/lib/provision.ts` (`provisionCard`, `provisionScopedCard`) |
| `metadata` field for `agent_id` tagging + reconciliation | `src/lib/airwallex.ts` `createCard()` |
| Human approval queue for over-policy requests | `src/lib/store.ts` + `src/mcp/server.ts` (`request_limit_increase`, `resolve_approval`) |
| MCP server wrapping governance layer (`provision_scoped_card` tool) | `src/mcp/server.ts` (14 tools) |
| Per-agent spend grouping via `card_id → agent_id` | `src/lib/airwallex.ts` `getAgentEconomy()` |

Built on the **Airwallex sandbox** (`https://api-demo.airwallex.com`), with a natural-language interface powered by Claude.

### Card ↔ agent model
A card is a disposable spending instrument; the durable identity is the
**agent**. Each card carries `metadata: { agent_id, project_id }` (both
required). Single-use cards are created with `allowed_transaction_count: SINGLE`,
so Airwallex blocks further authorizations after the first successful debit.
An agent may use many cards — spend aggregates to the agent via the `metadata`
field and the local task ledger.

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind CSS · Claude API (`claude-opus-4-8`) · MCP.

---

## Features

| # | Feature | Where |
|---|---------|-------|
| 1 | **Developer login** — signed httpOnly cookie session (Web Crypto HMAC), route-guarding middleware | `/login`, `src/lib/auth.ts`, `src/middleware.ts` |
| 2 | **Global Accounts** — list each currency's real local bank details (account #/IBAN/routing/SWIFT), **open a new currency account** (`POST /api/v1/global_accounts/create`), and **simulate an inbound deposit** (`POST /api/v1/simulation/deposit/create`) | `/accounts` |
| 3 | **Wallet balances** — multi-currency funds held, via `GET /api/v1/balances`; domestic currency derived from the entity (`GET /api/v1/account`) | Dashboard (`/`) |
| 4 | **Top-up (HPP)** — create a PaymentIntent server-side, then Airwallex.js `redirectToCheckout` (`env: 'demo'`) → success/fail callback | Dashboard (`/`), `src/components/TopUpWidget.tsx` |
| 5 | **Policy & agent management** — create/edit spend policies (budget, per-txn cap, MCC allowlist, velocity, expiry) and agent profiles with issuance modes (`self_serve_within_policy`, `human_provisioned`) | `/policies` |
| 6 | **Agent cards & controls** — issue multi-use / single-use cards tagged to an agent+project, with **spend limits**, **expiry** (`active_to` authorization window), and an **MCC allowlist**; **reveal** the card (sandbox test PAN); **simulate a purchase** to show Airwallex controls enforced (over-limit / wrong-category → declined) | `/agents` |
| 7 | **Approval queue** — escalated card requests and limit-increase proposals; approve/deny; auto-resume chat agent on approval | `/approvals` |
| 8 | **AI chat interface** — Claude-powered assistant for balances, accounts, FX, card provisioning, and autonomous agent tasks | Chat drawer (all pages) |
| 9 | **MCP control plane** — 14-tool MCP server for external headless agents; enforces policy, provisions cards, manages approvals | `/api/mcp` |
| 10 | **Demo store** — lightweight storefront that processes virtual card payments (4 products) | `/demo-store` |
| 11 | **Activity feed + expenses** — merged transaction ledger (Airwallex + local) and per-agent spend summary | `/activity`, `/expenses` |

### What exercising the sandbox revealed

Discovered by actually running the flows, not just reading docs:
- **Single-use enforcement is Airwallex-native.** Cards with `allowed_transaction_count: SINGLE` block further authorizations after the first successful debit.
- **Card spend is prefunded from the wallet.** A purchase debits the wallet's **`cash`** balance in the billing currency, even though the card program reports `type: "CREDIT" / GOOD_FUNDS_CREDIT` (a prefunded credit form-factor, not a lent credit line).
- **A Global Account deposit settles into the wallet** in that account's currency — the money-in path distinct from Payments top-ups.
- **Domestic currency is derived from the legal entity** (`/api/v1/account` → US → USD), not a setting.
- **Simulated transactions stay PENDING permanently** in sandbox and never advance to CLEARED or SETTLED. The local task ledger is authoritative for agent spend.
- **billing_currency follows transaction_currency**, not the card's configured currency — wrong-currency routing succeeds silently with no error.
- **Multi-currency GAs anchor to their LOCAL currency** (`required_features[0]` can misleadingly be a SWIFT currency).

All API calls target the **demo** environment.

**Accounts vs. balances (the core model):** a **Global Account** is a real local
bank account (account number / IBAN / routing / SWIFT) used to *receive* money in
a currency; a **wallet balance** is the money you *hold* in a currency. Funds land
in the wallet from a Global Account deposit, a Payments top-up, or an FX
conversion. The dashboard shows balances; the Accounts page shows the accounts.

---

## Getting started

### 1. Install

```bash
npm install
```

### 2. Configure credentials

```bash
cp .env.local.example .env.local
```

Fill in `.env.local`:

| Variable | What it is |
|----------|-----------|
| `AIRWALLEX_CLIENT_ID` | Demo API Client ID — Airwallex demo dashboard → Developer → API keys |
| `AIRWALLEX_API_KEY` | Demo API key (same place) |
| `AIRWALLEX_BASE_URL` | `https://api-demo.airwallex.com` (default) |
| `NEXT_PUBLIC_AIRWALLEX_ENV` | `demo` (Airwallex.js environment) |
| `AIRWALLEX_CARDHOLDER_ID` | *(optional)* cardholder to issue cards to; if empty the app reuses the first cardholder or auto-creates a demo one |
| `ANTHROPIC_API_KEY` | Claude API key — powers the AI assistant |
| `DEMO_PASSWORD` | Shared password for the developer login screen |
| `SESSION_SECRET` | Random string used to sign the session cookie |
| `NEXT_PUBLIC_APP_URL` | Public base URL (used to build receipt URLs) |

### 3. Run

```bash
node scripts/reset-demo.mjs   # seed policies, cancel stale cards, advance cardholder
npm run dev
# http://localhost:3000  →  log in with any username + DEMO_PASSWORD
```

Production build:

```bash
npm run build && npm start
```

Type-check only: `npm run typecheck`.

---

## How the Airwallex integration works

`src/lib/airwallex.ts` is the server-only API client:

- **Auth** — `POST /api/v1/authentication/login` with `x-client-id` + `x-api-key`
  headers → bearer token, cached in-process and refreshed ~1 min before expiry.
- **Balances** — `GET /api/v1/balances/current`.
- **Cardholders** — cards must be issued to a cardholder. The client reuses a
  `READY` cardholder (or auto-creates a `DELEGATE` one — only an `email` is
  required). Override with `AIRWALLEX_CARDHOLDER_ID`.
- **Cards** — `GET /api/v1/issuing/cards`; create via
  `POST /api/v1/issuing/cards/create`. Each card sets `program.purpose` (here
  `COMMERCIAL`) and `authorization_controls.transaction_limits.limits`. Single-use
  sets `allowed_transaction_count = "SINGLE"` with a `PER_TRANSACTION` limit;
  multi-use uses `"MULTIPLE"` with a `MONTHLY` limit.
- **Top-up** — `POST /api/v1/pa/payment_intents/create` returns
  `{ id, client_secret }`, handed to Airwallex.js in the browser for the Hosted
  Payment Page redirect (`env: 'demo'`).

> **Endpoint note:** Airwallex issuing/payment-intent creates use a `/create`
> suffix (`/api/v1/issuing/cards/create`, `/api/v1/pa/payment_intents/create`).
> The doc shorthand `POST /api/v1/issuing/cards` resolves to the `/create`
> route used here.

### AI assistant

`src/app/api/chat/route.ts` runs a manual Claude tool-use loop
(`model: claude-opus-4-8`). The chat assistant uses **Anthropic tool-use directly** — it does not call the MCP server.

Chat tools: `get_balances`, `list_accounts`, `open_account`, `simulate_deposit`,
`convert_currency`, `list_cards`, `provision_card`, `provision_scoped_card`,
`reveal_card`, `simulate_purchase`, `checkout_at_demo_store`, `list_agents`,
`list_approvals`, `agent_report`, `create_topup`.

> **Two authority paths.** Card provisioning (both `provision_card` and
> `provision_scoped_card`) enforces the full policy stack — budget, velocity,
> MCC, and per-transaction cap — via `src/lib/provision.ts`, regardless of
> whether invoked from the chat assistant or the MCP server. The MCP server
> (`/api/mcp`) is the integration point for external headless agents; the chat
> route calls the same provisioning logic directly.

Try:
- *"Open a GBP account"* → creates a Global Account and reads back its bank details
- *"Move $10,000 from USD to HKD"* → FX conversion between your own wallet balances
- *"Simulate a $5,000 deposit into my USD account"* → credits the USD wallet
- *"Issue a scoped card for procurement-agent to buy Vercel Pro"* → provisions a single-use card with policy enforcement
- *"Top up $1000 USD"* → renders a Hosted Payment Page button to finish checkout

### MCP server

`src/mcp/server.ts` exposes 14 governance tools via `/api/mcp` (Streamable HTTP, unauthenticated in this demo). Both the internal card/approval routes and external headless agents connect to this endpoint. See `docs/QUICKSTART.md` for the external agent integration guide.

---

## Airwallex Developer MCP (sandbox)

This project pairs with the **Airwallex Developer MCP** (sandbox-only docs +
simulation tools) — a separate server operated by Airwallex, distinct from the
app-owned MCP server above. Add it to Claude Code:

```bash
claude mcp add-json airwallex-dev '{ "type": "http", "url": "https://mcp-demo.airwallex.com/developer" }'
```

Then run `/mcp` and complete the OAuth flow. See
<https://www.airwallex.com/docs/developer-tools/ai/developer-connector>.

---

## Key files

| Module | Purpose |
|---|---|
| `src/mcp/server.ts` | MCP control plane — 14 governance tools |
| `src/lib/provision.ts` | Card provisioning — policy enforcement, escalation, Airwallex card creation |
| `src/lib/airwallex.ts` | Airwallex REST API client (all server-side calls) |
| `src/lib/store.ts` | JSON store CRUD — policies, agents, approvals, task ledger |
| `src/lib/activity.ts` | Activity feed — merges Airwallex transaction feed + local ledger |
| `src/lib/merchant-simulator.ts` | Merchant counterparty — charges cards via Airwallex simulation API |
| `src/app/api/chat/route.ts` | AI chat endpoint — Anthropic tool-use loop (15 tools) |
| `src/app/api/mcp/route.ts` | MCP endpoint (Streamable HTTP, unauthenticated) |
| `agent/runner.mts` | Headless agent runner — `--replay` (scripted) and `--live` (Claude-driven) |
| `scripts/reset-demo.mjs` | Reset sandbox — cancel stale cards, reseed store.json |

---

## Notes & disclaimers

- **Demo only.** The login is a shared-password gate, not real auth. Sessions
  are signed but there is no user store. The MCP endpoint is unauthenticated.
- All traffic goes to the Airwallex **demo** environment. Do not point
  `AIRWALLEX_BASE_URL` at production.
- See `docs/PRD.md` for the full product spec, `DEMO.md` for the run-of-show,
  `docs/QUICKSTART.md` for external agent integration, and
  `docs/going-to-production.md` for what changes in a real deployment.
