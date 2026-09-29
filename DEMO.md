# DEMO.md — Run-of-show

A beat-by-beat guide for walking someone through the treasury demo. Total
runtime: ~8 minutes. Everything runs on `localhost:3000` against Airwallex
sandbox — no real money moves.

## Prerequisites

```bash
cp .env.local.example .env.local   # fill in AIRWALLEX_CLIENT_ID, AIRWALLEX_API_KEY, ANTHROPIC_API_KEY
npm install
npm run reset-demo                 # seeds agents, cancels stale cards, ensures cardholder
npm run dev                        # starts on :3000
```

Open [http://localhost:3000](http://localhost:3000). No login.

---

## Phase 1 — Human in the loop (~3 min)

A human does everything through the console UI.

### Beat 1: Orient
- The Welcome Modal opens automatically. Skim the four capabilities.
- Click **Get started**. You land on the assistant home: chat + wallet
  balances + top-up.

### Beat 2: Fund the treasury
- In the chat, type: **"Deposit $500 into our USD account"**
- The assistant finds a USD Global Account and calls `simulate_deposit`.
- Watch the USD balance update in Wallet Balances (auto-polls).

### Beat 3: Issue a card for an agent
- Type: **"Issue a multi-use card for the procurement agent, $100 cap, software and ads"**
- The assistant provisions a card tagged to `procurement-agent` with MCC lock
  and per-transaction cap.
- Navigate to **Agents** in the left nav. You'll see the card under the agent's
  policies section.

### Beat 4: Simulate a purchase (human-initiated)
- On the Agents page, find the new card → click **Simulate purchase**.
- Pick MCC **Software**, amount **$25** → the purchase goes through.
- Try MCC **Restaurants** → **declined** with `MERCHANT_CATEGORY_NOT_ALLOWED`.
  This is the Airwallex rail enforcing the control.

### Beat 5: Observe
- Back on **Dashboard**, the Recent Activity widget shows the charge and the
  decline, auto-polling every 5 seconds.
- Click the **MCP** button (top bar) to open the MCP traffic panel —
  every MCP tool call is visible here.

---

## Phase 2 — Human on the loop (~3 min)

An autonomous agent spends within policy. The human watches but doesn't act.

### Beat 6: Run the autonomous agent (replay)
Open a second terminal:
```bash
npm run agent -- --agent procurement-agent --replay
```

The agent runner connects to the same MCP server and executes three scripted
tasks:
1. **Vercel $20** (allowed MCC, under cap) → provisions scoped card → charges → **APPROVED**
2. **Delta $250** (over $100 cap) → **ESCALATED** to approval queue (reason: `OVER_CAP`) → auto-files a limit-increase request
3. **Blue Bottle $60** (MCC not in policy) → **BLOCKED at control plane** — card never minted

### Beat 7: Watch it arrive in the console
- Switch to the browser. On **Approvals**:
  - The **Approval Queue** shows the procurement-agent's pending limit-increase
    request (per-txn cap $100 → $250).
  - The **Agent Spend Summary** (Dashboard) shows per-agent spend totals.
- The **MCP traffic panel** shows the agent runner's calls flowing through the
  same server.

### Beat 8: Run the autonomous agent (live / Claude)
```bash
npm run agent -- --agent procurement-agent --live --task "Renew our Vercel Pro subscription, about $18"
```

This time Claude (claude-haiku-4-5) drives the loop: reads its own policy,
reasons that Vercel=$18 is within MCC 5734 and the $100 cap, provisions a
scoped card, pays, and records the spend — all with no human in the loop. Watch
the terminal narrate each tool call.

---

## Phase 3 — Human over the loop (~2 min)

The agent needs a human decision.

### Beat 9: Approve the escalation
- On the **Approvals** page, find the pending approval from Beat 6.
- Click **Approve**. The procurement-agent's per-txn cap is now $250.
- The policy card updates instantly.

### Beat 10: Retry the over-limit task
```bash
npm run agent -- --agent procurement-agent --replay --merchant "Delta Air Lines" --amount 250 --mcc 4511
```

This time the $250 flight purchase goes through — the card is minted with the
new higher cap and the purchase is **APPROVED**.

### Beat 11: Freeze an agent
- On the **Policies** page, find the procurement-agent and click **Freeze**.
  Every active card → INACTIVE. The agent's `frozen` flag flips to true —
  future `provision_card` / `provision_scoped_card` calls return `AGENT_FROZEN`.

---

## What's real, what's simulated

| Layer | Real | Simulated (labelled) |
|-------|------|---------------------|
| Card controls (MCC, cap, limit, expiry, single-use, freeze) | ✅ Airwallex rail | |
| Wallet balances & transactions | ✅ Airwallex API | |
| Global Accounts | ✅ Airwallex API | |
| FX conversions | ✅ Airwallex API | |
| Card provisioning | ✅ Airwallex Issuing API | |
| Merchant authorization | | ✅ Airwallex simulation API (same control path as production, no real card network) |
| Deposits / funding | | ✅ Airwallex simulation API |
| Card credential retrieval | ✅ Airwallex API | ⚠️ Proxied through app server (demo shortcut; production = PCI-compliant channel) |
| Agent identity | | ✅ Metadata tag (production = per-agent auth + crypto identity) |
| MCP server auth | | ✅ Open endpoint (production = per-agent tokens) |
| Policy / approval store | | ✅ JSON file (production = database) |
| Activity feed | ✅ Airwallex API (polled) | ⚠️ Polling, not webhooks (can't reach localhost) |

See [DEMO_NOTES.md](./DEMO_NOTES.md) for detailed explanations of each shortcut.

---

## Key files

| File | Purpose |
|------|---------|
| `src/mcp/server.ts` | Shared MCP control plane (14 tools) |
| `src/lib/merchant-simulator.ts` | Labelled sandbox merchant stand-in |
| `src/lib/airwallex.ts` | Server-side Airwallex API wrapper |
| `src/lib/store.ts` | JSON policy / approval / ledger store |
| `agent/runner.mts` | Headless agent runner (--replay / --live) |
| `scripts/reset-demo.mjs` | Clean reseed + stale card cancel |
| `DEMO_NOTES.md` | Localhost shortcuts documented |
| `CAPABILITIES.md` | Phase 0 probe results |
| `GAP_ANALYSIS.md` | Gap analysis + build status |

---

## Cleanup

```bash
npm run reset-demo   # cancels stale cards, reseeds store
```
