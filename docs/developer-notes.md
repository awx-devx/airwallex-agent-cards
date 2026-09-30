# Developer Notes: Agent cards

> **TL;DR:** The Airwallex Issuing API's core card controls are solid and genuinely rail-enforced — MCC lock, spend caps, expiry, single-use, freeze, and cancel all produce correct, actionable decline codes on simulated authorizations. Friction is almost entirely at the developer experience layer. The two highest-priority open items are (1) no documented path from a localhost MCP endpoint to per-agent production auth, and (2) no documented PCI-safe path for autonomous agents to use provisioned cards — the correct pattern (agent holds `card_id`, server executes the charge) must be derived; Airwallex's agentic guides don't describe it. Most other findings are documentation improvements, not API redesigns. One issue was resolved during this build: ADV-9320 (Developer MCP simulation returning HTTP 400 due to sandbox header-size limit) — confirmed fixed 2026-07-21.

*Compiled from a full build of the Agent cards demo — a real working
implementation of programmatic agent spend built from scratch against the
Airwallex sandbox. Every finding below was discovered empirically, not from
reading docs.*

*API environment: `https://api.sandbox.airwallex.com` (sandbox)*

---

## Executive Summary

This demo was built to exercise the Airwallex Issuing API end-to-end in an
agentic context: a policy layer controlling what agents can spend, virtual cards
provisioned from policy, MCC locks and spend caps enforced at the card rail, an
approval queue for over-policy escalations, and an MCP server that wraps the
Issuing API so agents can request cards as tool calls. Every friction point
documented here was encountered while building that flow.

**The core is solid.** Every card control we probed — MCC allowlist,
per-transaction cap, total limit, expiry (`active_to`), single-use, freeze, and
cancel — is genuinely enforced by the Airwallex rail on simulated authorizations,
with clean, actionable reason codes. That is the foundation the agentic spend
story needs, and it works. The friction is almost entirely at the developer
experience layer — API shape inconsistencies, undocumented sandbox behavior, and
missing architectural guidance for agentic patterns. Most of the high-impact
items are documentation changes, not API redesigns.

**Three categories of friction, in order of impact:**

The most consequential gap is the **missing agentic architecture guidance**: there
is no documented path from an open localhost MCP endpoint to a production
per-agent auth setup, no PCI-safe way for an autonomous agent to retrieve card
credentials programmatically, and multi-currency agentic spend silently requires
a separate agent identity per billing currency — a constraint that arrives at
runtime with no upfront warning.

The second category is **API shape inconsistencies**: the card list endpoint omits
key fields that force N+1 follow-up calls, the deposits endpoint uses different
pagination conventions from every other endpoint, FX conversion amounts must be
sent as strings even though they are numbers, and card transactions have no
developer-defined reference field for task attribution. None of these are fatal,
but each causes a stumble — a 400, an empty response, or a silent wrong result.

The third category is **sandbox-specific behavior that differs from production
expectations**: simulated card transactions stay in `PENDING` status permanently
and never advance to CLEARED or SETTLED, the cardholder `PENDING → READY`
transition has no progress signal and no documented path forward, and sandbox
wallet balances cannot be reset, breaking repeatable test scenarios.

**One issue has been resolved since this document was first drafted:** the
Developer MCP's `simulate_create_issuing_transaction` tool was returning HTTP 400
because the sandbox's `max-http-header-size` (~8KB) was too small for Developer
MCP OAuth tokens. ADV-9320 raised the limit to 64KB. Confirmed working
2026-07-21.

---

## Priority Reference

| # | Issue | Priority | Fix type |
|---|-------|----------|----------|
| 5 | MCP server: no documented path to per-agent auth | **Critical** | Architecture guide |
| 6 | No documented PCI-safe credential flow for autonomous agents | **Critical** | Guide |
| 18 | Agent identity is only a metadata tag | **High** | API design |
| 2 | Card list endpoint forces N+1 calls | **High** | API |
| 21 | Multi-currency: one agent identity per billing currency | **High** | Docs + guide |
| 1 | Sandbox latency + simulation idempotency gap | **High** | API + docs |
| 16 | No task_id / reference on issuing transactions | **Medium** | API |
| 20 | Wallet balances cannot be reset in sandbox | **Medium** | API |
| 13 | Vendor MCP missing write operations | **Medium** | MCP |
| 3 | Simulated transactions stay PENDING permanently | **Medium** | Docs |
| 10 | Cardholder PENDING: no progress signal | **Medium** | Docs |
| 19 | Webhook behavior with simulated transactions | **Medium** | Docs |
| 7–9, 11–12, 14–15 | API shape papercuts | **Low–Med** | Docs / API |
| 4 | Developer MCP simulation blocked by header size | — | ✅ Fixed (ADV-9320) |

---

## Friction Points & Recommendations

### 1. Sandbox Latency + Single-Use Card Retry Race Condition

**Severity: High. Actively breaks agentic flows.**

**What the friction is:**

The sandbox can take 5–10 seconds to respond to issuing simulation calls. When
a request times out and the calling code retries, the card transaction may have
already been processed. For single-use cards, this creates an unrecoverable race:
the first attempt charged the card and auto-closed it; the retry sees
`card_status: CLOSED` and gets `failure_reason: CARD_CLOSED`, which looks like a
terminal error. The agent has no way to distinguish "retry needed, charge never
happened" from "charge succeeded, card correctly closed".

```ts
// src/lib/activity.ts:48-49
// The Airwallex sandbox can take 5-10 s per call. We cache the last result
// and serve it immediately on repeat requests while refreshing in the background.
```

**Where in the code:**

- `src/lib/airwallex.ts:96` — `signal: AbortSignal.timeout(10000)`
- `src/lib/merchant-simulator.ts:98-99` — comment explaining that `PENDING`
  status from a successful `single_phase` auth is approved, not a decline
- `CAPABILITIES.md` probe result: `single_use: first → PENDING; second → FAILED / CARD_CLOSED`

**Workaround used:**

The demo treats `PENDING` and `CARD_CLOSED` differently in the merchant
simulator. The activity feed uses stale-while-revalidate with a 30-second TTL.
The agent runner does not retry after a timeout — it records the uncertainty and
stops, leaving reconciliation to the human.

**Recommendation:**

1. **Idempotency key support on simulated authorizations.** The simulation
   endpoint (`POST /api/v1/simulation/issuing/create`) should accept a
   `request_id` / `idempotency_key` field. A retry with the same key should
   return the original result rather than processing a second charge. Card
   issuance already requires `request_id`; the simulation endpoint should too.

2. **Document the single-use card lifecycle explicitly.** When
   `allowed_transaction_count: SINGLE` is set, the card transitions to
   `card_status: CLOSED` immediately after the first authorization. A second
   attempt returns `failure_reason: CARD_CLOSED`, *not* a limit-exceeded error.
   The docs should call this out explicitly, including the recommendation to check
   the transaction status before retrying on timeout rather than retrying the
   purchase call directly.

---

### 2. Card List Endpoint Returns Slim Objects — Forced N+1 Calls

**Severity: High. Causes significant sandbox latency amplification.**

**What the friction is:**

`GET /api/v1/issuing/cards` returns card objects that omit `authorization_controls`
and `metadata` entirely. Both fields are essential for any agentic use case:
`metadata` carries `agent_id` / `project_id` (agent attribution), and
`authorization_controls` carries spend limits, MCC allowlists, and expiry. To do
anything useful — group by agent, check limits, display controls — the developer
must fetch each card individually with `GET /api/v1/issuing/cards/{card_id}`.

**Where in the code:**

```ts
// src/lib/airwallex.ts:209-220
// The list endpoint returns a slim card object without authorization_controls or metadata.
// Fetch full details for all non-CLOSED cards so metadata (agent_id, project_id) is always present.
return Promise.all(
  items.map(async (c) => {
    if (c.card_status === "CLOSED") return c;
    try {
      return await awxFetch<Card>(`/api/v1/issuing/cards/${c.card_id}`);
    } catch {
      return c;
    }
  }),
);
```

With 10 active cards, this becomes 11 API calls (1 list + 10 detail fetches) on
every page load. At sandbox latency of 1–3s per call, the Agents page and
Dashboard are noticeably slow.

**Workaround used:**

Parallel `Promise.all` over detail fetches for non-CLOSED cards, with a
stale-while-revalidate cache at the activity layer. CLOSED cards are served from
the slim list object.

**Recommendation:**

Include `authorization_controls` and `metadata` in the list response. These are
the two fields most commonly needed for any agent-facing use case. Alternatively,
add an `include_details=true` query parameter that returns the full object shape
in a single call. The N+1 pattern is a significant developer experience problem
and a sandbox latency multiplier.

---

### 3. Simulated Transactions Stay PENDING Permanently in Sandbox

**Severity: Medium. Transactions appear immediately but never advance to CLEARED or SETTLED.**

**What the friction is:**

Simulated transactions appear in `GET /api/v1/issuing/transactions` immediately
after `POST /api/v1/simulation/issuing/create`. However, they stay in `PENDING`
status indefinitely — they never advance to `CLEARING`, `CLEARED`, or `SETTLED`.
This is unlike production, where real card network events drive the transaction
through its lifecycle.

Verified by live sandbox testing: both `AUTHORIZATION` and `CLEARING` transaction
types (controlled by the `single_phase` field) return `status: PENDING`
immediately after simulation and remain PENDING 10+ minutes later.

**Where in the code:**

```ts
// src/lib/activity.ts:202-204
// Airwallex sandbox transactions stay PENDING permanently (never advance to
// CLEARED/SETTLED), so this local ledger is the authoritative source for
// agent spend data and card_charge events in demo mode.
// Deduplicate against any Airwallex txn_ids already in the feed.
```

The activity feed merges Airwallex transaction data with the local ledger. The
local ledger records agent identity, task IDs, and policy metadata that the
Airwallex transaction object does not carry — and provides a spend-authoritative
source that does not depend on transaction status progression.

**Workaround used:**

Every card charge writes a `LedgerEntry` to `data/store.json` immediately at
charge time. The activity feed merges both sources and deduplicates on
transaction ID.

**Recommendation:**

1. Document that simulated transactions remain in `PENDING` status in sandbox and
   do not go through a settlement cycle. Developers whose apps filter for
   `CLEARED` or `SETTLED` transactions will find that sandbox simulations never
   satisfy that check.
2. Document the `single_phase` field in the simulation request body. `single_phase:
   true` produces a `CLEARING` transaction type; omitting it produces only an
   `AUTHORIZATION` (hold). Neither the field nor this distinction appears in the
   current simulation reference.

---

### 4. Developer MCP Simulation Calls — ✅ Resolved (ADV-9320, 2026-07-21)

**Status: Fixed. Confirmed working against sandbox on 2026-07-21.**

**What the issue was:**

`POST /api/v1/simulation/issuing/create` returned HTTP 400 for any developer
using the Developer MCP. The simulation endpoint itself was not broken — calls
with API key tokens or standard OAuth tokens succeeded. The rejection happened
because the sandbox enforced an ~8KB `max-http-header-size` and Developer MCP
OAuth tokens exceeded this limit. The error body gave no indication of the cause.

**Note on earlier misdiagnosis:** This was initially attributed to a missing or
wrong `x-api-version` header. That was incorrect. The header value is irrelevant;
the failure was at the HTTP layer before application logic ran.

**Root cause and fix:**

ADV-9320 / `app-sandbox-api-service!194` raised the sandbox `max-http-header-size`
to 64KB. No changes to the MCP tool or client code are needed.

**Remaining action:**

Remove any "Developer MCP simulation may fail" warnings from the Developer MCP
setup guide and sandbox overview, now that ADV-9320 is deployed. A meaningful
400 error body (e.g. "request header too large") would have immediately
identified the real cause when it was live — worth adding for any future
infrastructure limit violations.

---

### 5. MCP Server Has No Auth — No Documented Path to Production

**Severity: High for any real deployment.**

**What the friction is:**

The demo's MCP endpoint (`/api/mcp`) is explicitly unauthenticated. Any process
that can reach the port can call `provision_card`, `get_card_credentials`, or
`freeze_agent` without presenting any credential. The app marks this prominently:

- `src/components/TopBar.tsx:184`: `title="MCP traffic log — no auth in this demo"`
- `src/components/McpPanel.tsx:61`: `"The MCP endpoint has no auth in this demo. Production would require per-agent tokens."`

But there is no documented path from "open MCP endpoint" to "per-agent
authenticated MCP endpoint". The MCP protocol itself does not define an
authentication mechanism, and the Airwallex docs do not describe how to implement
per-agent auth for an MCP server that wraps the Issuing API.

**Where in the code:**

- `src/app/api/mcp/route.ts` — no auth check at the route level
- `src/middleware.ts` — `/api/mcp` is in the public paths exclusion list
- `src/mcp/server.ts` — tools rely on the caller's claimed `agent_id` with no
  cryptographic verification

**Workaround used:**

No auth, relying on localhost network isolation and the demo context. The
`agent_id` field in tool calls is trusted by convention, not verified.

**Recommendation:**

Publish a reference architecture for MCP server authentication in an agentic
context. The minimal viable path would cover:

1. **Mutual TLS or bearer token per agent** — how an agent presents a credential
   to the MCP server, and how the MCP server maps that credential to an
   `agent_id` in the policy store.
2. **Scoped API keys** — whether Airwallex plans to support per-agent API keys
   that the MCP server can issue and scope to a single agent identity, rather
   than all agents sharing one master key.
3. **Machine-to-machine OAuth** — the vendor MCP uses OAuth for human-facing
   developer tools. Is there a client credentials variant that an autonomous
   agent runner can use?

Without this guidance, every team building an agentic spend product will
implement incompatible ad-hoc auth schemes, or ship with the open endpoint
pattern by accident.

---

### 6. `get_card_credentials` — No Documented PCI-Safe Path for Autonomous Agents

**Severity: High for production use.**

**What the friction is:**

To demonstrate an agent using a card at a merchant, the demo needed to retrieve
the PAN, CVV, and expiry of a provisioned card. The only available path in the
sandbox is `GET /api/v1/issuing/cards/{id}/details`, which returns the full card
number through the developer's own server:

```ts
// src/lib/airwallex.ts:594-595
// Sandbox returns test card numbers. In production you'd use Airwallex's
// PCI-compliant reveal (network token / hosted card-details component) instead
// of returning the raw PAN through your own server.
```

```ts
// src/mcp/server.ts:134
// ⚠️ DEMO SHORTCUT: In production, credentials would flow through a PCI-compliant
// channel — never proxied through your own server.
```

The production alternatives (hosted card-details iframe, network tokenization)
are designed for human browsers: a person clicks "reveal" and the iframe shows
them the number without the server touching it. These do not work for autonomous
agents, which have no UI and need the credential programmatically to pass to a
merchant's API.

The correct production pattern — agent holds a `card_id` reference, server
executes the merchant charge directly so the PAN never enters the agent context
— does exist and works. The friction is that Airwallex's documentation does not
describe this pattern for agentic use cases. Developers must derive it
themselves or discover the sandbox shortcut first and then figure out the
production equivalent.

**Where in the code:**

- `src/app/api/cards/details/route.ts:8-11`
- `src/mcp/server.ts:134-137` (in `get_card_credentials` tool description)
- `src/lib/airwallex.ts:593-595`

**Workaround used:**

For the sandbox demo: proxy the raw PAN through the Next.js server. The card
number never leaves the server process in logs (last-4 mask only), but it does
pass through the app's memory.

**Recommendation:**

This is a real gap for agentic use cases: agents need credentials to pay, but
PCI-compliant flows are designed for human browsers, not autonomous code. Two
paths forward:

1. **Machine-readable scoped token endpoint**: a server-to-server credential
   retrieval that returns a scoped, single-use, time-limited token (not the raw
   PAN) that can be presented to a specific merchant's tokenization API. This is
   what Visa Intelligent Commerce does with scoped agent tokens.

2. **Explicit sandbox carve-out**: document `GET /details` explicitly as
   "sandbox only, suitable for demos and local testing; production requires a
   PCI-compliant channel." Currently developers discover this constraint by
   reading between the lines.

---

### 7. `/deposits` Endpoint Has Different Pagination Conventions

**Severity: Medium. Causes silent empty responses.**

**What the friction is:**

`GET /api/v1/deposits` requires *both* `page_num` and `page_size` to be
explicitly set; omitting either returns an error or an empty result with no
warning. It also returns a bare JSON array rather than the
`{ items: [...], total_count: N }` envelope that all other list endpoints return.

**Where in the code:**

```ts
// src/lib/airwallex.ts:683-688
// /deposits requires BOTH page_num and page_size, and returns a bare array.
const res = await awxFetch<Deposit[] | { items: Deposit[] }>(
  "/api/v1/deposits?page_num=0&page_size=20",
);
return Array.isArray(res) ? res : res.items || [];
```

The defensive `Array.isArray(res) ? res : res.items || []` guard was added
specifically to handle the possibility that this endpoint might change to return
the standard envelope.

**Workaround used:**

Always include `page_num=0&page_size=20`. Defensively handle both bare array
and `{ items }` envelope responses.

**Recommendation:**

Standardize `GET /deposits` to accept the same `page_size`-only pagination
convention used by all other list endpoints, and return the
`{ items: [...], total_count: N }` envelope. The current convention is a
papercut that every developer building an activity feed will encounter.

---

### 8. FX Conversion Amounts Must Be Sent as Strings, Not Numbers

**Severity: Medium. Silent failure if sent as a number.**

**What the friction is:**

`POST /api/v1/fx/conversions/create` requires `sell_amount` and `buy_amount` to
be sent as JSON strings (e.g., `"10000"`) rather than JSON numbers (`10000`).
Sending a number either silently converts to zero or returns a validation error
that does not explain the issue. This is inconsistent with every other amount
field in the API.

**Where in the code:**

```ts
// src/lib/airwallex.ts:723-724
if (opts.sellAmount != null) body.sell_amount = String(opts.sellAmount);
else if (opts.buyAmount != null) body.buy_amount = String(opts.buyAmount);
```

The explicit `String()` conversion was added after encountering the issue.

**Recommendation:**

Accept both strings and numbers for all amount fields. If the serialization
format must be a string for internal reasons, return a clear validation error:
"sell_amount must be a string representation of a decimal number."

---

### 9. Global Account `required_features[0]` Is Misleadingly a SWIFT Currency

**Severity: Medium. Causes incorrect primary currency display.**

**What the friction is:**

A multi-currency Global Account has a `required_features` array listing the
currencies it can receive. When an account supports both LOCAL and SWIFT
transfers, `required_features[0]` is often a SWIFT currency, not the LOCAL
currency the account is anchored to. A developer who uses
`required_features[0].currency` as the account's primary currency will display
the wrong currency.

**Where in the code:**

```ts
// src/lib/airwallex.ts:453-461
// Prefer the LOCAL currency as the account's primary (a multi-currency GA
// lists many SWIFT currencies but is anchored to one local currency).
const localFeature = ga.required_features?.find(
  (f) => f.transfer_method === "LOCAL",
);
const currency =
  localFeature?.currency ||
  ga.required_features?.[0]?.currency ||
  ga.supported_features?.[0]?.currency ||
  "";
```

**Workaround used:**

Find the `required_features` entry where `transfer_method === "LOCAL"` and use
that as the primary currency. Fall back to the first entry only if no LOCAL
feature exists.

**Recommendation:**

Add a `primary_currency` field to the Global Account object that explicitly
identifies the anchor currency, independent of the ordering of
`required_features`. Also document the ordering convention (or lack thereof) in
the Global Accounts API reference.

---

### 10. Cardholder PENDING State — Silent Wait With No Progress Signal

**Severity: Medium. Blocks card issuance with no clear cause.**

**What the friction is:**

When a new `DELEGATE` cardholder is created, it may return with `status: PENDING`
while Airwallex screens it. A card issuance attempt against a PENDING cardholder
fails, but the error message does not link the failure to the cardholder's
screening status. The developer must independently query the cardholder, observe
PENDING, and then know to call `pass_review` to advance it — an endpoint that
appears nowhere in the Issuing getting-started path.

Whether a developer hits this depends on their sandbox account's KYC
auto-approval setting. Accounts named "Sandbox Business" or "New Business
Sandbox" get auto-approval enabled and never see PENDING. Any other account name
leaves auto-approval off and PENDING is the default — a silent day-one blocker
with no documented path forward.

```js
// scripts/reset-demo.mjs:127-133
if (ch && ch.status === "PENDING") {
  const pass = await awx(
    `/api/v1/simulation/issuing/cardholders/${ch.cardholder_id}/pass_review`,
    { method: "POST" },
  );
}
```

**Workaround used:**

`reset-demo.mjs` defensively calls `pass_review` whenever a cardholder is found
in PENDING state. `resolveCardholderId()` in `src/lib/airwallex.ts` prefers
READY cardholders over PENDING ones.

**Recommendation:**

1. **Surface `pass_review` prominently** in the "Getting Started with Issuing"
   sandbox documentation. It should be a standard setup step in the "create your
   first card" walkthrough.
2. **Return a clear error** on card issuance against a PENDING cardholder that
   explicitly says "cardholder is in PENDING state; call
   `POST /simulation/issuing/cardholders/{id}/pass_review` to advance it in
   the sandbox."
3. **Document the account-naming convention** that triggers KYC auto-approval
   ("Sandbox Business" or "New Business Sandbox") in the sandbox setup guide.

---

### 11. Single-Use Card Close Reason Is `CARD_CLOSED`, Not `LIMIT_EXCEEDED`

**Severity: Medium. Breaks naive retry logic.**

**What the friction is:**

When a single-use card (`allowed_transaction_count: SINGLE`) is used and a
second authorization is attempted, the decline reason is `CARD_CLOSED`, not
something like `TRANSACTION_COUNT_EXCEEDED` or `SINGLE_USE_EXHAUSTED`. This is
unintuitive: the developer expects a limit-type error but gets a lifecycle error.
It also creates an ambiguity — `CARD_CLOSED` can mean "a human manually closed
this card" or "this card was used and auto-closed". The developer cannot
distinguish these from the reason code alone.

**Where in the code:**

- `CAPABILITIES.md` probe result: `single_use: first → PENDING; second → FAILED / CARD_CLOSED`
- `src/lib/merchant-simulator.ts:101`: handles `FAILED` and `CARD_CLOSED` as declined states

**Recommendation:**

Return a distinct reason code for single-use exhaustion —
`ALLOWED_TRANSACTION_COUNT_EXCEEDED` or `SINGLE_USE_CARD_EXHAUSTED`. The current
`CARD_CLOSED` is accurate but does not communicate the cause. The reason code
should tell the developer *why* the card is closed, not just that it is.

---

### 12. Transaction Timestamp Field Names Are Inconsistent

**Severity: Low-Medium. Causes incorrect sorting and "just now" timestamps.**

**What the friction is:**

Card transactions returned from `GET /api/v1/issuing/transactions` do not have a
guaranteed `created_at` field. The developer had to probe for multiple alternative
timestamp fields: `created_at`, `posted_date`, and `transaction_date`. Deposit
objects returned from `GET /api/v1/deposits` sometimes have no timestamp at all
in the sandbox, falling back to the current time.

**Where in the code:**

```ts
// src/lib/activity.ts:109-113
ts: toTs(
  (t as { created_at?: unknown; posted_date?: unknown; transaction_date?: unknown })
    .created_at ??
    (t as { posted_date?: unknown }).posted_date ??
    (t as { transaction_date?: unknown }).transaction_date,
),
```

```ts
// src/lib/activity.ts:141-147
// Deposits — fall back to now() if the API returns no timestamp (sandbox simulation)
ts: toTs(d.create_time ?? d.created_at) || nowMs,
```

**Recommendation:**

Guarantee a `created_at` ISO 8601 timestamp on every resource returned by the
Issuing and Deposits APIs, consistent across all resource types.
Simulation-created deposits should always include a timestamp; the current
behavior where sandbox deposits arrive without one breaks chronological ordering
in any activity feed.

---

### 13. Vendor MCP Has No Tool for Opening Global Accounts or Executing FX Conversions

**Severity: Medium for Developer MCP users.**

**What the friction is:**

The Airwallex Developer MCP exposes tools for reading balances and global
accounts, but not for *writing* new state: creating a global account and
executing (as distinct from quoting) an FX conversion are both absent. A
developer relying on the vendor MCP to prototype these flows must fall back to
raw REST.

Complete gap inventory from `CAPABILITIES.md`:

| Operation | Vendor MCP Tool | Raw API |
|---|---|---|
| Open global account | None | `/global_accounts/create` |
| Execute FX conversion | None (quote/amend/list only) | `/fx/conversions/create` |
| Cardholder `pass_review` (sandbox) | None | `/simulation/issuing/cardholders/{id}/pass_review` |
| Reveal card details (PAN/CVV) | None | `/issuing/cards/{id}/details` |
| Create PaymentIntent (HPP top-up) | None | `/pa/payment_intents/create` |

**Workaround used:**

All five missing operations are called via raw REST. The local MCP server built
for this demo wraps all of them so that agent code can call them as tools.

**Recommendation:**

Priority order for vendor MCP additions:

1. `execute_fx_conversion` — developers building treasury apps routinely need to
   move money between currencies; a quote tool without an execute tool is half
   an implementation.
2. `create_global_account` — opening a new currency account is a first-day
   action for any multi-currency treasury.
3. `create_payment_intent` — required for the HPP top-up flow.
4. Cardholder `pass_review` simulation — needed for sandbox onboarding.
5. **Revisit tool naming for agent contexts.** `simulate_create_issuing_transaction`
   conflates "run a sandbox simulation" (implementation detail) with "create a
   transaction" (developer intent) — LLMs sometimes infer from "simulate" that the
   action is not real and decline to call it. A name like `test_card_authorization`
   makes the intent unambiguous. More broadly: for tools an LLM agent will call,
   prefer verbs that describe intent (`authorize`, `charge`, `execute`) over
   implementation verbs (`simulate_*`).

---

### 14. `/api/v1/balances` Docs Shorthand Differs from Actual Endpoint Path

**Severity: Low. Causes 404 on first attempt.**

The documentation refers to wallet balances via the shorthand
`GET /api/v1/balances`. The actual working endpoint is
`GET /api/v1/balances/current`. A developer who copies the shorthand gets a 404.

```ts
// src/lib/airwallex.ts:156-158
// Airwallex exposes current balances at /api/v1/balances/current.
// (The docs shorthand "GET /api/v1/balances" resolves here.)
return awxFetch<Balance[]>("/api/v1/balances/current");
```

**Recommendation:** Redirect `/api/v1/balances` to `/api/v1/balances/current`,
or update all documentation to use the full path consistently.

---

### 15. Create Endpoints Use a `/create` Suffix Rather Than Standard POST-to-Collection

**Severity: Low. Non-standard REST pattern surprises developers.**

Airwallex create operations use an RPC-style `/create` suffix:

- `POST /api/v1/issuing/cards/create`
- `POST /api/v1/issuing/cardholders/create`
- `POST /api/v1/global_accounts/create`
- `POST /api/v1/pa/payment_intents/create`

A developer who tries `POST /api/v1/issuing/cards` (the standard REST path) gets
an error with no guidance.

**Recommendation:** Document the `/create` convention prominently in the API
overview, or redirect `POST /resource` to `POST /resource/create`.

---

### 16. No Native `task_id` on Issuing Transactions — Parallel Ledger Required

**Severity: Medium. Significant boilerplate for any agentic accounting.**

**What the friction is:**

Airwallex card transactions have no way to carry a developer-defined task
identifier. An agent running tasks (task-001 = "renew Vercel", task-002 = "pay
AWS invoice") needs to reconcile which transaction corresponds to which task for
cost tracking and auditing. Card `metadata` can carry `task_id` at issuance, but
this only works for single-use-per-task cards — multi-use cards shared across
tasks cannot carry per-task metadata.

The demo solved this with a complete parallel task ledger:

- `src/lib/store.ts` — `LedgerEntry` schema and CRUD
- `record_task_spend` MCP tool — agent runner calls this after every charge
- Activity feed deduplicates between local ledger and Airwallex transaction feed

From `GAP_ANALYSIS.md`:
> Airwallex transactions don't carry our task_id. The agent runner writes a task
> ledger entry (task_id, agent_id, card_id, txn_id, amount, status) to the JSON
> store. Cost-per-task reads the ledger.

**Recommendation:**

Support a `reference` or `metadata` field on issuing transaction records at
simulation time, returned on the transaction record from `GET /issuing/transactions`.
This eliminates the need for a parallel local task ledger and makes cost-per-task
accounting a first-class API concern — the agentic equivalent of the
`merchant_order_id` field on PaymentIntents.

---

### 18. Agent Identity Is Only a Metadata Tag — No Native Concept

**Severity: High. Structural limit on production credibility.**

**What the friction is:**

There is no "agent" resource in the Airwallex API. Agent identity in this demo
is an `agent_id` string stored in card `metadata`. This works for attribution
and reporting, but has four concrete limitations:

1. Any caller who knows an `agent_id` can claim to be that agent — no credential
   verification.
2. All agents share one Airwallex account and one set of API credentials.
3. "Freeze all cards for agent X" requires querying all cards, filtering by
   `metadata.agent_id === X`, and calling update on each — no bulk operation.
4. Per-agent velocity and budget limits are enforced only at the app layer (local
   JSON store), not at the Airwallex layer. If the app is bypassed or crashes,
   the limits vanish.

From `DEMO_NOTES.md`:
> Production: Each agent would have its own auth credential (at minimum an API
> key scoped to its permissions), and ideally a cryptographic identity.

**Recommendation:**

A first-class "agent" or "sub-account" concept in the Issuing API would:

1. Allow per-agent API credentials with scoped permissions.
2. Support bulk operations scoped to an agent (freeze all cards in one call).
3. Optionally carry per-agent velocity and budget limits at the API layer.

Even without these API changes, a reference architecture for multi-agent spend
management on a single Airwallex account — how to use metadata for attribution,
what app-layer enforcement is needed, what the production auth pattern looks like
— would give developers a clear starting point.

---

### 19. Webhook Behavior for Simulated Transactions Is Undocumented

**Severity: Low for localhost, High for staged integrations.**

**What the friction is:**

It is unclear whether simulated transactions created via
`POST /simulation/issuing/create` trigger the same webhook events as real
transactions. The demo could not test webhooks because webhook delivery requires
a public HTTPS endpoint. The decision to build on polling was forced by this
constraint, not by preference.

Two non-obvious webhook behaviors were discovered from docs reading rather than
testing:
- The `succeeded` event fires at *both* authorization and clearing — same event
  name, distinguished only by the `transaction_type` field in the payload.
- Deduplicate on `event.id` — the same event can be delivered more than once.

**Recommendation:**

1. Document whether sandbox simulation triggers webhooks, and if so, which event
   types. This is a first question for every developer building a real-time feed.
2. Publish an `ngrok`/tunnel guide in the sandbox quick-start so developers can
   test webhook delivery locally.
3. Document the `transaction_type` field that distinguishes authorization from
   clearing events within `issuing.transaction.succeeded`. Two events with
   identical names that mean different things, distinguished only by an inner
   field, is a significant gotcha.

---

### 20. Sandbox Wallet Balances Cannot Be Reset — Breaks Repeatable FX Demos

**Severity: Medium. Affects any demo or integration test that depends on a known starting balance.**

**What the friction is:**

Sandbox wallet balances accumulate across sessions and cannot be reset via API.
There is no "drain wallet" simulation endpoint and no way to zero out a currency
wallet.

This was discovered when building a cross-border scenario: an agent was prompted
to convert USD → GBP only if the GBP balance was insufficient. On the first run
it worked. On the second run the GBP balance was ~£530 (leftover from run one)
and the agent correctly skipped the conversion — silently removing the FX story
from the demo.

**Workaround used:**

Changed the agent prompt to always convert a fixed $200 USD → GBP
unconditionally. It's a prompt workaround for a missing API primitive.

**Why this matters beyond demos:**

Integration tests that assert wallet behavior ("balance increases by X after a
deposit") cannot guarantee a clean state between runs. Developers must track
prior state and subtract it, or accept flaky assertions.

**Recommendation:**

1. Add a `POST /simulation/accounts/reset` endpoint (or per-currency variant)
   that resets wallet balances to a specified amount. Stripe, Adyen, and
   Checkout.com all offer variants of this.
2. If not feasible, document the absence explicitly and recommend asserting
   deltas rather than absolute balances in integration tests.

---

### 21. Multi-currency Agentic Spend Requires a Separate Agent Identity Per Billing Currency

**Severity: High. Structural constraint that shapes the entire multi-currency architecture.**

**What the friction is:**

An Airwallex virtual card is issued in a specific billing currency. Any agentic
spend implementation that enforces per-agent policies must map those policies to
currencies: a policy that controls a USD card must track USD spend, and a policy
that controls a GBP card must track GBP spend. A single agent identity with a
single policy budget cannot span currencies without losing spend tracking
integrity.

The `CURRENCY_MISMATCH` error is clear, but it arrives at runtime when the agent
tries to provision a card. The developer must then backtrack, create a new policy
with the correct currency, create a new agent profile, and update routing logic.

This is counterintuitive for three reasons:

1. The Airwallex wallet is genuinely multi-currency — a single account can hold
   USD, GBP, EUR, and HKD simultaneously, with FX as a first-class API.
2. The natural developer mental model is: "I have one spend-management agent; it
   decides which currency to pay in based on context."
3. Nothing in the cardholder architecture requires currency segregation — the
   same `DELEGATE` cardholder backs cards in all currencies. Only the policy
   layer enforces it.

A second undocumented behavior compounds the topology constraint. The simulation
endpoint accepts any `transaction_currency` against any card regardless of the
card's configured billing currency — there is no validation that they match.
A GBP card can be charged in USD without error; `billing_currency` in the response
follows `transaction_currency`, not the card's configured currency. The practical
risk: an agent that routes a task to the wrong currency card (e.g., a USD task
sent to a GBP agent) does not receive a validation error. The charge succeeds,
debiting the wrong wallet balance and breaking per-agent spend tracking with no
signal that the currency routing was wrong.

**Where in the code:**

```js
// scripts/reset-demo.mjs — two separate agent identities required
"contractor-policy": {
  currency: "GBP",
  total_budget: 2000,
  per_transaction_cap: 500,
  allowed_merchant_categories: ["7389"],
},
"contractor-agent": {
  issuance_mode: "self_serve_within_policy",
  policy_id: "contractor-policy",
},
```

The chat assistant prompt explicitly routes GBP tasks to `contractor-agent` and
USD tasks to `procurement-agent`. Without this routing, a GBP payment attempt
through `procurement-agent` returns `CURRENCY_MISMATCH` immediately.

**Workaround used:**

One agent profile per billing currency, with explicit routing in the chat prompt
and task configuration UI.

**Recommendation:**

1. **Document the constraint upfront** in the Issuing API reference. The error
   message is clear but the architectural implication is not: developers need to
   know before building that their agent topology must map to their currency
   topology.

2. **Publish a cross-border builder guide** walking through the full chain: open
   a GBP wallet → convert USD → create a GBP policy → create a GBP-currency
   agent → provision a GBP card → simulate a GBP purchase. This is the most
   common real-world pattern for startups paying international contractors or
   vendors, and currently there is no end-to-end guide connecting these four API
   surfaces (Wallets, FX, Policy, Issuing).

3. **Document simulation currency behavior and add a mismatch warning.** The
   simulation endpoint accepts any `transaction_currency` against any card with no
   validation against the card's configured currency. `billing_currency` follows
   `transaction_currency`, not the card's configuration. This is undocumented and
   counterintuitive: a developer who expects the card's currency to enforce
   transaction currency will have no safety net. Add a callout: "The simulation
   does not enforce that `transaction_currency` matches the card's configured
   billing currency. To avoid incorrect wallet debits, ensure your agent routes
   tasks to cards in the correct currency before calling the simulation."

---

## Quick Wins — Documentation Only, No API Changes

These can be addressed with documentation changes alone:

1. **`GET /api/v1/balances` → actual endpoint is `/api/v1/balances/current`.**
   Update all references in the Balances API docs.

2. **Developer MCP simulation (ADV-9320) resolved.** Remove any "may fail"
   warnings from the Developer MCP setup guide and sandbox overview.

3. **Single-use card decline reason is `CARD_CLOSED`, not a limit code.** Add
   a note to the Issuing Controls docs and card lifecycle state-machine diagram.

4. **`required_features[0]` may be a SWIFT currency, not the LOCAL anchor.**
   Add a note to the Global Accounts API reference: filter by
   `transfer_method === "LOCAL"` to find the primary currency.

5. **`/deposits` pagination requires both `page_num` and `page_size`** and
   returns a bare array. Document this as a known exception to the standard
   pagination pattern.

6. **FX conversion `sell_amount` / `buy_amount` must be strings.** Add a note
   to the FX conversions reference; the inconsistency with other amount fields
   is a common stumbling block.

7. **Cardholder `pass_review` simulation endpoint.** Add it to the Getting
   Started with Issuing guide as a standard sandbox setup step. Also document
   the account-naming convention that triggers KYC auto-approval ("Sandbox
   Business" / "New Business Sandbox").

8. **Webhook `transaction_type` field.** Add a table to the issuing webhook docs
   distinguishing authorization events from clearing events within
   `issuing.transaction.succeeded`.

9. **MCP auth gap.** Add a "Production considerations" section to the agentic
   spend / MCP developer guide covering what changes between a localhost endpoint
   and a per-agent auth setup.

10. **`/create` suffix convention.** Add a note to the API overview so developers
    do not try standard REST paths.

11. **Multi-currency card issuance requires one agent identity per billing
    currency.** Document the `CURRENCY_MISMATCH` constraint in the provisioning
    reference and publish the cross-border builder guide.

---

## Larger API / SDK Changes Worth Considering

These require engineering investment but would meaningfully improve the developer
experience for agentic spend use cases.

### A. Idempotency on Simulation Endpoint

Add `request_id` / `idempotency_key` support to
`POST /api/v1/simulation/issuing/create`. This is already required on card
issuance; extending it to simulation makes retry-safe agent flows possible
without building a local "did this already fire?" ledger.

### B. Full Object in Card List Response

Include `authorization_controls` and `metadata` in `GET /api/v1/issuing/cards`
list responses. The N+1 pattern forces one detail fetch per active card and
amplifies sandbox latency significantly. An `include_details=true` query
parameter would be a non-breaking addition.

### C. `task_id` / `reference` on Issuing Transactions

Allow developers to attach a developer-defined `reference` string or `metadata`
object to a transaction at simulation time, returned on the transaction record
from `GET /issuing/transactions`. This eliminates the parallel local task ledger
and makes cost-per-task accounting a first-class API concern.

### D. First-Class Agent / Sub-Account Resource

A lightweight "agent" resource in the Issuing API with its own credential, scoped
to provisioning cards and retrieving its own transactions, supporting bulk
freeze/cancel operations and optionally carrying velocity and budget limits at
the API layer. Even a minimal version — scoped API keys per agent — would
eliminate the shared-credentials architecture that makes production agent
deployments risky.

### E. `primary_currency` on Global Accounts

Add an explicit `primary_currency` field to the Global Account resource rather
than requiring developers to parse `required_features` to find the LOCAL entry.

---

*Document generated from full codebase audit. Last updated: 2026-07-21.*
*All file:line references verified against the live codebase.*
