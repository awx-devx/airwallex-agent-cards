# Architecture Sequence Diagram

How chat, MCP, external agents, policy enforcement, approval resolution, and Airwallex authorization fit together in the demo. See `PRD.md` §4.7–4.9 and §5 for prose descriptions.

```mermaid
sequenceDiagram
    autonumber

    actor User
    participant UI as Chat UI
    participant Chat as Chat API<br/>(Anthropic tool-use)
    participant Claude
    participant Provision as Provision Service<br/>(provision.ts)
    participant MCP as App-Owned MCP Server<br/>(server.ts)
    participant Approval as Approval Store<br/>(store.ts)
    actor Operator as Human Operator
    participant AWX as Airwallex Issuing
    participant Merchant as Merchant Simulator<br/>(merchant-simulator.ts)
    participant Ledger as Local Task Ledger
    participant Agent as External<br/>Headless Agent

    Note over Chat,MCP: Claude selects tools via native Anthropic tool-use, not MCP.<br/>The Chat API calls provisionScopedCard() directly — the same<br/>function the MCP server wraps for external agents.

    Note over MCP,AWX: The app-owned MCP server is distinct from<br/>Airwallex Developer MCP.

    %% ── Chat-initiated task ──

    User->>UI: Submit procurement task
    UI->>Chat: POST /api/chat
    Chat->>Claude: Prompt + tool definitions
    Claude-->>Chat: tool_use: provision_scoped_card

    Chat->>Provision: provisionScopedCard() — direct import

    Provision->>Provision: Check policy: MCC, currency,<br/>frozen, budget, velocity, cap

    alt MCC, currency, or frozen-agent violation
        Provision-->>Chat: { refused: true, reason }
        Chat->>Claude: Tool result: declined
        Claude-->>UI: Explain decline to user

    else Budget, velocity, or per-transaction cap exceeded
        Provision->>Approval: Create pending card_provision request
        Approval-->>Provision: approval_id
        Provision-->>Chat: { pending_approval: true, approval_id }
        Chat->>Claude: Tool result: escalated
        Claude-->>UI: Report approval needed

        Note over Operator,Approval: Human resolves via /approvals UI or /api/approvals

        Operator->>MCP: resolve_approval(id, "approved")
        MCP->>Approval: Mark approved
        MCP->>Provision: provisionScopedCard(params, skipPolicyChecks=true)
        Provision->>AWX: POST /issuing/cards/create
        Note over Provision,AWX: Single-use, MCC-locked, amount-capped,<br/>authorization window via active_to
        AWX-->>Provision: card_id
        Provision-->>MCP: Card result
        MCP->>Approval: Store card_id on approval record

        Note over UI,Chat: Auto-resume: ApprovalQueue calls setPendingResume →<br/>AppShell effect opens chat drawer and sends resume message

        UI->>Chat: Resume message with card_id
        Chat->>Claude: Continue task

    else Within policy
        Provision->>AWX: POST /issuing/cards/create
        AWX-->>Provision: card_id
        Provision-->>Chat: Card result
        Chat->>Claude: Tool result: card provisioned
    end

    %% ── Checkout (merchant leg) ──

    Claude-->>Chat: tool_use: checkout_at_demo_store
    Chat->>Merchant: chargeCard() — direct import

    Merchant->>AWX: POST /simulation/issuing/create
    Note over AWX: Airwallex independently enforces<br/>native card authorization controls<br/>(MCC, spend cap, single-use, active_to)

    alt Authorization declined by Airwallex
        AWX-->>Merchant: Declined (reason code)
        Merchant-->>Chat: { approved: false, decline_reason }
        Chat->>Ledger: Record declined outcome
        Chat->>Claude: Tool result: declined
        Claude-->>UI: Explain decline

    else Authorization approved
        AWX-->>Merchant: Approved
        Merchant-->>Chat: { approved: true, txn_id }
        Chat->>Ledger: Record task spend + attribution
        Chat->>Claude: Tool result: receipt
        Claude-->>UI: Purchase confirmation + receipt URL
    end

    %% ── External headless agent ──

    rect rgb(245, 245, 255)
        Note over Agent,MCP: External agents bypass the chat UI and connect<br/>directly to the MCP server for governance tools.

        Agent->>MCP: get_policy
        MCP-->>Agent: Policy details

        Agent->>MCP: provision_scoped_card
        MCP->>Provision: provisionScopedCard()
        Provision->>AWX: POST /issuing/cards/create
        AWX-->>Provision: card_id
        Provision-->>MCP: Card result
        MCP-->>Agent: card_id

        Note over Agent,Merchant: The merchant charge bypasses MCP.<br/>The bundled runner imports chargeCard() directly;<br/>a pure-HTTP external client would call<br/>POST /api/demo-store/checkout or /api/cards/transaction.

        Agent->>Merchant: chargeCard() (direct import)
        Merchant->>AWX: POST /simulation/issuing/create
        AWX-->>Merchant: Result
        Merchant-->>Agent: Charge outcome

        Agent->>MCP: record_task_spend
        MCP->>Ledger: Write ledger entry
        MCP-->>Agent: Recorded
    end
```

## Interpretation

1. **Claude selects tools via native Anthropic tool-use, not MCP.** The Chat API handler calls `provisionScopedCard()` directly from `provision.ts` — the same function the MCP server wraps for external consumers.

2. **The app-owned MCP server is the governance control plane for external agents.** It is distinct from [Airwallex Developer MCP](https://www.airwallex.com/docs/developer-tools/ai/developer-connector). Card issuance and approval resolution routes (`/api/cards`, `/api/approvals`) also call through the MCP server internally via `mcpClient.ts`.

3. **External agents bypass the chat UI** and connect to the MCP server directly. The merchant charge step bypasses MCP entirely — the bundled runner imports `chargeCard()` directly; a pure-HTTP external client would call `POST /api/demo-store/checkout` or `POST /api/cards/transaction`. This mirrors production, where the merchant/network processes the authorization independently.

4. **App policy checks determine issuance, escalation, or refusal.** Budget, velocity, and per-transaction-cap breaches escalate for human approval. MCC, currency, and frozen-agent violations are declined without escalation.

5. **Airwallex independently enforces native card controls during authorization** — MCC allowlist, spend cap, single-use (`allowed_transaction_count: SINGLE`), and authorization window (`active_to`). These controls fire regardless of what the app checks.

6. **Approval resolution provisions exactly one card and resumes the task once.** The approval flow stores `card_id` on the approval record; the auto-resume path (`setPendingResume` → `AppShell` effect) sends a single continuation message to the chat.

7. **The local task ledger owns task attribution** (agent identity, task ID, spend amount). Airwallex remains authoritative for card state, wallet balances, and authorization status.
