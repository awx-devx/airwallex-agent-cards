/**
 * The shared local MCP server. Both clients — the human console and the headless
 * agent runner — call these exact tools. It wraps the Airwallex API
 * (lib/airwallex) and the local policy store (lib/store); nothing here is a
 * private path the UI can bypass.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  listCards,
  updateCardStatus,
  getBalances,
  getCardDetails,
  listCardTransactions,
  listAllCardTransactions,
} from "@/lib/airwallex";
import {
  readStore,
  writeStore,
  getAgent,
  getPolicy,
  updatePolicy,
  addApproval,
  resolveApproval,
  updateApprovalCardResult,
  addLedgerEntry,
  type Policy,
} from "@/lib/store";
import { provisionCard, provisionScopedCard, cardSummary, isBlocked, isPending } from "@/lib/provision";

function text(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj) }] };
}

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "treasury-control-plane", version: "1.0.0" });

  server.registerTool(
    "list_agents",
    { description: "List configured agents and their policies.", inputSchema: {} },
    async () => {
      const store = await readStore();
      const result = Object.values(store.agents).map((a) => ({
        ...a,
        policy: store.policies[a.policy_id] ?? null,
      }));
      return text(result);
    },
  );

  server.registerTool(
    "get_policy",
    { description: "Get one agent's policy and issuance mode.", inputSchema: { agent_id: z.string() } },
    async ({ agent_id }) => {
      const agent = await getAgent(agent_id);
      if (!agent) return text({ error: `unknown agent ${agent_id}` });
      const policy = await getPolicy(agent.policy_id);
      return text({ agent, policy: policy ?? null });
    },
  );

  server.registerTool(
    "set_policy",
    {
      description: "Update an agent's policy fields (human action).",
      inputSchema: {
        agent_id: z.string(),
        total_budget: z.number().optional(),
        per_transaction_cap: z.number().optional(),
        velocity_max_per_hour: z.number().optional(),
        card_expiry_days: z.number().optional(),
        allowed_merchant_categories: z.array(z.string()).optional(),
      },
    },
    async ({ agent_id, ...patch }) => {
      const agent = await getAgent(agent_id);
      if (!agent) return text({ error: `unknown agent ${agent_id}` });
      const clean = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      ) as Partial<Omit<Policy, "policy_id" | "display_name">>;
      const policy = await updatePolicy(agent.policy_id, clean);
      return policy
        ? text({ agent, policy })
        : text({ error: `policy "${agent.policy_id}" not found for agent ${agent_id}` });
    },
  );

  server.registerTool(
    "provision_card",
    {
      description:
        "Issue a virtual card for an agent. Missing controls fall back to the agent's policy (per-transaction cap, MCC allowlist, expiry from card_expiry_days). Tags the card with agent_id + project_id.",
      inputSchema: {
        agent_id: z.string(),
        project_id: z.string().optional(),
        single_use: z.boolean().optional(),
        limit_amount: z.number().optional(),
        currency: z.string().optional(),
        allowed_merchant_categories: z.array(z.string()).optional(),
        expires_on: z.string().optional(),
      },
    },
    async (args) => text(await provisionCard(args, `agent:${args.agent_id}`)),
  );

  server.registerTool(
    "provision_scoped_card",
    {
      description:
        "Issue a SCOPED, EPHEMERAL card for a single agent task — single-use, locked to one merchant category, and expiring in minutes. If the request exceeds the agent's policy (budget, velocity, or per-transaction cap), the request is escalated to the human approval queue instead of declined outright. In that case the response contains { pending_approval: true, approval_id } — tell the user and direct them to the /approvals page. Agents with issuance_mode=human_provisioned always escalate regardless of policy limits. Tags the card with agent_id + project_id + task_id.",
      inputSchema: {
        agent_id: z.string(),
        task_id: z.string(),
        merchant_category: z.string().describe("MCC to lock the card to (e.g. 5734)."),
        amount: z.number().optional().describe("Per-transaction cap; defaults to the agent's policy."),
        currency: z.string().optional(),
        expires_in_minutes: z.number().optional().describe("Time-to-live in minutes (default 15)."),
      },
    },
    async (args) => text(await provisionScopedCard(args, `agent:${args.agent_id}`)),
  );

  server.registerTool(
    "list_agent_cards",
    { description: "List an agent's cards.", inputSchema: { agent_id: z.string() } },
    async ({ agent_id }) => {
      const cards = await listCards();
      return text(cards.filter((c) => c.metadata?.agent_id === agent_id).map(cardSummary));
    },
  );

  server.registerTool(
    "get_card_credentials",
    {
      description:
        "Retrieve the full card credentials (PAN, CVV, expiry) for an ACTIVE card so an agent can use them at a merchant checkout. Only works for cards the requesting agent owns (matched by agent_id in metadata). ⚠️ DEMO SHORTCUT: In production, credentials would flow through a PCI-compliant channel (e.g. Airwallex's hosted reveal component or network tokenization) — never proxied through your own server. This tool exists because it's a localhost demo; see DEMO_NOTES.md.",
      inputSchema: {
        card_id: z.string(),
        agent_id: z.string().describe("Must match the card's metadata.agent_id — agents can only reveal their own cards."),
      },
    },
    async ({ card_id, agent_id }) => {
      const cards = await listCards();
      const card = cards.find((c) => c.card_id === card_id);
      if (!card) return text({ error: `card ${card_id} not found` });
      if (card.metadata?.agent_id !== agent_id) {
        return text({ refused: true, reason: "NOT_YOUR_CARD", message: `Card ${card_id} belongs to ${card.metadata?.agent_id || "unknown"}, not ${agent_id}.` });
      }
      if (card.card_status !== "ACTIVE") {
        return text({ error: `Card is ${card.card_status}; credentials are only available for ACTIVE cards.` });
      }
      try {
        const details = await getCardDetails(card_id);
        return text({
          card_id,
          card_number: details.card_number,
          cvv: details.cvv,
          expiry_month: details.expiry_month,
          expiry_year: details.expiry_year,
          name_on_card: details.name_on_card,
          demo_note: "Sandbox test card — usable only via the simulator. In production, use Airwallex's PCI-compliant reveal or network tokenization.",
        });
      } catch (err) {
        return text({ error: err instanceof Error ? err.message : "Failed to retrieve card details" });
      }
    },
  );

  server.registerTool(
    "freeze_agent",
    {
      description:
        "Freeze, unfreeze, or cancel an agent's cards. 'freeze' sets the agent's frozen flag (blocking future issuance) and deactivates all active cards. 'unfreeze' clears the frozen flag and reactivates frozen cards. 'cancel' closes all active cards permanently (does not affect the frozen flag).",
      inputSchema: { agent_id: z.string(), mode: z.enum(["freeze", "unfreeze", "cancel"]).optional() },
    },
    async ({ agent_id, mode }) => {
      const store = await readStore();
      const agent = store.agents[agent_id];
      if (!agent) return text({ error: `unknown agent ${agent_id}` });

      if (mode === "unfreeze") {
        agent.frozen = false;
        await writeStore(store);
        const cards = await listCards();
        const frozen = cards.filter(
          (c) => c.metadata?.agent_id === agent_id && c.card_status === "INACTIVE",
        );
        const affected: string[] = [];
        for (const c of frozen) {
          await updateCardStatus(c.card_id, "ACTIVE");
          affected.push(c.card_id);
        }
        return text({ agent_id, mode: "unfreeze", frozen: false, reactivated_count: affected.length, reactivated: affected });
      }

      const targetStatus = mode === "cancel" ? "CLOSED" : "INACTIVE";
      if (mode !== "cancel") {
        agent.frozen = true;
        await writeStore(store);
      }
      const cards = await listCards();
      const mine = cards.filter(
        (c) => c.metadata?.agent_id === agent_id && c.card_status === "ACTIVE",
      );
      const affected: string[] = [];
      for (const c of mine) {
        await updateCardStatus(c.card_id, targetStatus);
        affected.push(c.card_id);
      }
      return text({ agent_id, mode: mode || "freeze", frozen: agent.frozen, status: targetStatus, affected_count: affected.length, affected });
    },
  );

  server.registerTool(
    "get_balances",
    { description: "Current wallet balances.", inputSchema: {} },
    async () => text(await getBalances()),
  );

  server.registerTool(
    "list_transactions",
    {
      description: "List card transactions, optionally for one card.",
      inputSchema: { card_id: z.string().optional() },
    },
    async ({ card_id }) =>
      text(card_id ? await listCardTransactions(card_id) : await listAllCardTransactions()),
  );

  server.registerTool(
    "request_limit_increase",
    {
      description:
        "Agent asks a human to raise a policy limit. Creates a pending approval in the console's queue.",
      inputSchema: {
        agent_id: z.string(),
        field: z.enum(["per_transaction_cap", "total_budget"]),
        requested: z.number(),
        reason: z.string().optional(),
      },
    },
    async ({ agent_id, field, requested, reason }) => {
      const agent = await getAgent(agent_id);
      if (!agent) return text({ error: `unknown agent ${agent_id}` });
      const policy = await getPolicy(agent.policy_id);
      if (!policy) return text({ error: `policy "${agent.policy_id}" not found for agent ${agent_id}` });
      const approval = await addApproval({
        agent_id,
        type: "limit_increase",
        field,
        current: policy[field] as number,
        requested,
        reason,
      });
      return text(approval);
    },
  );

  server.registerTool(
    "record_task_spend",
    {
      description:
        "Record the outcome of an agent task's card charge to the task ledger (powers cost-per-task and per-agent budget views). The agent runner calls this after the merchant charge so the control plane has a task_id ↔ transaction record; Airwallex doesn't carry our task_id.",
      inputSchema: {
        task_id: z.string(),
        agent_id: z.string(),
        card_id: z.string(),
        amount: z.number(),
        currency: z.string(),
        status: z.string().describe("APPROVED | DECLINED | FAILED"),
        txn_id: z.string().optional(),
        decline_reason: z.string().optional(),
        merchant: z.string().optional(),
        mcc: z.string().optional(),
      },
    },
    async (args) => text(await addLedgerEntry(args)),
  );

  server.registerTool(
    "list_approvals",
    {
      description: "List approval-queue items. After a card_provision approval is approved, the card details are in card_result on the approval object — use card_result.card_id to proceed with checkout_at_demo_store.",
      inputSchema: {},
    },
    async () => text((await readStore()).approvals),
  );

  server.registerTool(
    "resolve_approval",
    {
      description: "Human approves or denies an approval. For limit_increase: updates the policy field. For card_provision: provisions the card immediately on approval — card details appear in card_result.",
      inputSchema: { id: z.string(), decision: z.enum(["approved", "denied"]) },
    },
    async ({ id, decision }) => {
      const { approval, applied } = await resolveApproval(id, decision);
      if (!approval) return text({ error: `approval ${id} not found` });
      if (decision === "approved" && approval.type === "card_provision" && approval.provision_params && !approval.card_result) {
        const card = await provisionScopedCard(approval.provision_params, `approval:${id}`, true);
        if (!isBlocked(card) && !isPending(card)) {
          await updateApprovalCardResult(id, card);
          return text({ approval: { ...approval, card_result: card, status: "approved" }, card });
        }
        return text({ approval, card, applied });
      }
      return text({ approval, applied });
    },
  );

  return server;
}
