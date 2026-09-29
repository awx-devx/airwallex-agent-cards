/**
 * Shared card provisioning logic used by both the MCP server (agent runner) and
 * the chat assistant (human/agent mode). Enforces app-layer policy — budget,
 * velocity, MCC allowlist — before calling Airwallex. Logs every call to the
 * MCP traffic panel so the panel reflects all paths, not just the agent runner.
 */
import { createCard, listCards } from "@/lib/airwallex";
import { getAgent, getPolicy, recentApprovedCount, totalSpent, addCardApproval } from "@/lib/store";
import { logMcp } from "@/mcp/log";

type AirwallexCard = Awaited<ReturnType<typeof listCards>>[number];

export type CardSummary = {
  card_id: string;
  nick_name?: string;
  status?: string;
  type?: string;
  currency?: string;
  limits?: unknown;
  expires?: string;
  allowed_merchant_categories?: string[];
  agent_id?: string;
  project_id?: string;
  task_id?: string;
  [key: string]: unknown;
};

export type PolicyBlock = {
  refused: true;
  reason: string;
  message: string;
  agent_id?: string;
  task_id?: string;
};

export type PendingApproval = {
  pending_approval: true;
  approval_id: string;
  reason: string;
  message: string;
  agent_id?: string;
  task_id?: string;
};

export type ProvisionResult = CardSummary | PolicyBlock | PendingApproval;

export function isBlocked(r: ProvisionResult): r is PolicyBlock {
  return "refused" in r && r.refused === true;
}

export function isPending(r: ProvisionResult): r is PendingApproval {
  return "pending_approval" in r && (r as PendingApproval).pending_approval === true;
}

export function cardSummary(c: AirwallexCard): CardSummary {
  return {
    card_id: c.card_id,
    nick_name: c.nick_name,
    status: c.card_status,
    type: c.authorization_controls?.allowed_transaction_count,
    currency: c.authorization_controls?.transaction_limits?.currency,
    limits: c.authorization_controls?.transaction_limits?.limits,
    expires: c.authorization_controls?.active_to,
    allowed_merchant_categories: c.authorization_controls?.allowed_merchant_categories,
    agent_id: c.metadata?.agent_id,
    project_id: c.metadata?.project_id,
    task_id: c.metadata?.task_id,
  };
}

function block(
  reason: string,
  message: string,
  ids?: { agent_id?: string; task_id?: string },
): PolicyBlock {
  return { refused: true, reason, message, ...ids };
}

export async function provisionCard(
  args: {
    agent_id: string;
    project_id?: string;
    single_use?: boolean;
    limit_amount?: number;
    currency?: string;
    allowed_merchant_categories?: string[];
    expires_on?: string;
  },
  source = "chat",
): Promise<ProvisionResult> {
  const tool = "provision_card";
  const ts = new Date().toISOString();

  const agent = await getAgent(args.agent_id);
  if (!agent) {
    const r = block("NO_POLICY", `Agent ${args.agent_id} has no configured policy. Register the agent first.`, { agent_id: args.agent_id });
    logMcp({ ts, source, tool, args, ok: false, error: r.message });
    return r;
  }
  if (agent.frozen) {
    const r = block("AGENT_FROZEN", `Agent ${args.agent_id} is frozen. A human must unfreeze it from the Agents page before new cards can be issued.`, { agent_id: args.agent_id });
    logMcp({ ts, source, tool, args, ok: false, error: r.message });
    return r;
  }
  const p = await getPolicy(agent.policy_id);
  if (!p) {
    const r = block("NO_POLICY", `Agent ${args.agent_id} references policy "${agent.policy_id}" which does not exist.`, { agent_id: args.agent_id });
    logMcp({ ts, source, tool, args, ok: false, error: r.message });
    return r;
  }
  if ((await recentApprovedCount(args.agent_id)) >= p.velocity_max_per_hour) {
    const r = block("VELOCITY_EXCEEDED", `${args.agent_id} has hit the ${p.velocity_max_per_hour}/hr velocity limit.`, { agent_id: args.agent_id });
    logMcp({ ts, source, tool, args, ok: false, error: r.message });
    return r;
  }
  const limitForBudget = args.limit_amount ?? p.per_transaction_cap ?? 100;
  if ((await totalSpent(args.agent_id)) + limitForBudget > p.total_budget) {
    const r = block("BUDGET_EXCEEDED", `Issuing a ${limitForBudget} ${p.currency} card would exceed ${args.agent_id}'s ${p.total_budget} ${p.currency} budget.`, { agent_id: args.agent_id });
    logMcp({ ts, source, tool, args, ok: false, error: r.message });
    return r;
  }
  const existing = await listCards();
  const live = existing.find(
    (c) => c.metadata?.agent_id === args.agent_id &&
      (c.card_status === "ACTIVE" || c.card_status === "INACTIVE"),
  );
  if (live) {
    const r = block("CARD_ALREADY_EXISTS", `Agent ${args.agent_id} already has an active card (${live.card_id}). Cancel it before issuing a new one.`, { agent_id: args.agent_id });
    logMcp({ ts, source, tool, args, ok: false, error: r.message });
    return r;
  }
  const requestedCcy = (args.currency || p.currency || "USD").toUpperCase();
  if (requestedCcy !== p.currency.toUpperCase()) {
    const r = block("CURRENCY_MISMATCH", `Policy "${p.policy_id}" is in ${p.currency}; cannot issue ${requestedCcy} for ${args.agent_id}.`, { agent_id: args.agent_id });
    logMcp({ ts, source, tool, args, ok: false, error: r.message });
    return r;
  }
  const limit = args.limit_amount ?? p.per_transaction_cap ?? 100;
  const mccs = args.allowed_merchant_categories ?? p.allowed_merchant_categories;
  const expiresOn = args.expires_on ?? new Date(Date.now() + p.card_expiry_days * 86400000).toISOString().slice(0, 10);
  const projectId = args.project_id ?? agent.project_id ?? "unassigned";

  const card = await createCard({
    singleUse: !!args.single_use,
    limitAmount: limit,
    currency: requestedCcy,
    agentId: args.agent_id,
    projectId,
    expiresOn,
    allowedMerchantCategories: mccs && mccs.length ? mccs : undefined,
  });
  const summary = cardSummary(card);
  logMcp({ ts: new Date().toISOString(), source, tool, args, ok: true, result: summary });
  return summary;
}

function escalate(
  approvalId: string,
  reason: string,
  message: string,
  ids?: { agent_id?: string; task_id?: string },
): PendingApproval {
  return { pending_approval: true, approval_id: approvalId, reason, message, ...ids };
}

export async function provisionScopedCard(
  args: {
    agent_id: string;
    task_id: string;
    merchant_category: string;
    amount?: number;
    currency?: string;
    expires_in_minutes?: number;
  },
  source = "chat",
  skipPolicyChecks = false,
): Promise<ProvisionResult> {
  const tool = "provision_scoped_card";
  const ts = new Date().toISOString();

  const agent = await getAgent(args.agent_id);
  if (!agent) {
    const r = block("NO_POLICY", `Agent ${args.agent_id} has no registered profile. Add one on the Policies page before requesting cards.`, { agent_id: args.agent_id, task_id: args.task_id });
    logMcp({ ts, source, tool, args, ok: false, error: r.message });
    return r;
  }
  if (agent.frozen) {
    const r = block("AGENT_FROZEN", `Agent ${args.agent_id} is frozen. Unfreeze it from the Policies page before requesting cards.`, { agent_id: args.agent_id, task_id: args.task_id });
    logMcp({ ts, source, tool, args, ok: false, error: r.message });
    return r;
  }
  const p = await getPolicy(agent.policy_id);
  if (!p) {
    const r = block("NO_POLICY", `Agent ${args.agent_id} references policy "${agent.policy_id}" which does not exist.`, { agent_id: args.agent_id, task_id: args.task_id });
    logMcp({ ts, source, tool, args, ok: false, error: r.message });
    return r;
  }

  // Hard declines — always enforced regardless of skipPolicyChecks.
  if (p.allowed_merchant_categories.length && !p.allowed_merchant_categories.includes(args.merchant_category)) {
    const r = block("MCC_NOT_IN_POLICY", `MCC ${args.merchant_category} is not in ${args.agent_id}'s allowed list [${p.allowed_merchant_categories.join(", ")}].`, { agent_id: args.agent_id, task_id: args.task_id });
    logMcp({ ts, source, tool, args, ok: false, error: r.message });
    return r;
  }
  const requestedCcy = (args.currency || p.currency).toUpperCase();
  if (requestedCcy !== p.currency.toUpperCase()) {
    const r = block("CURRENCY_MISMATCH", `Policy "${p.policy_id}" is in ${p.currency}; cannot issue ${requestedCcy}.`, { agent_id: args.agent_id, task_id: args.task_id });
    logMcp({ ts, source, tool, args, ok: false, error: r.message });
    return r;
  }

  const requested = args.amount ?? p.per_transaction_cap;

  if (!skipPolicyChecks) {
    // human_provisioned agents always require a human to approve card issuance.
    if (agent.issuance_mode === "human_provisioned") {
      const approval = await addCardApproval({ agent_id: args.agent_id, task_id: args.task_id, merchant_category: args.merchant_category, amount: requested, currency: args.currency, escalation_reason: "HUMAN_PROVISIONED" });
      const r = escalate(approval.id, "HUMAN_PROVISIONED", `${args.agent_id} is set to human_provisioned — a human must approve every card request.`, { agent_id: args.agent_id, task_id: args.task_id });
      logMcp({ ts, source, tool, args, ok: false, error: r.message });
      return r;
    }
    if ((await recentApprovedCount(args.agent_id)) >= p.velocity_max_per_hour) {
      const approval = await addCardApproval({ agent_id: args.agent_id, task_id: args.task_id, merchant_category: args.merchant_category, amount: requested, currency: args.currency, escalation_reason: "VELOCITY_EXCEEDED" });
      const r = escalate(approval.id, "VELOCITY_EXCEEDED", `${args.agent_id} has hit the ${p.velocity_max_per_hour}/hr velocity limit. A human can approve an exception.`, { agent_id: args.agent_id, task_id: args.task_id });
      logMcp({ ts, source, tool, args, ok: false, error: r.message });
      return r;
    }
    const spent = await totalSpent(args.agent_id);
    if (spent + requested > p.total_budget) {
      const approval = await addCardApproval({ agent_id: args.agent_id, task_id: args.task_id, merchant_category: args.merchant_category, amount: requested, currency: args.currency, escalation_reason: "BUDGET_EXCEEDED" });
      const r = escalate(approval.id, "BUDGET_EXCEEDED", `${requested} ${p.currency} would exceed ${args.agent_id}'s ${p.total_budget} ${p.currency} budget (spent: ${spent}). A human can approve an exception.`, { agent_id: args.agent_id, task_id: args.task_id });
      logMcp({ ts, source, tool, args, ok: false, error: r.message });
      return r;
    }
    if (requested > p.per_transaction_cap) {
      const approval = await addCardApproval({ agent_id: args.agent_id, task_id: args.task_id, merchant_category: args.merchant_category, amount: requested, currency: args.currency, escalation_reason: "OVER_CAP" });
      const r = escalate(approval.id, "OVER_CAP", `${requested} ${p.currency} exceeds the per-transaction cap of ${p.per_transaction_cap} ${p.currency} for ${args.agent_id}. A human can approve an exception.`, { agent_id: args.agent_id, task_id: args.task_id });
      logMcp({ ts, source, tool, args, ok: false, error: r.message });
      return r;
    }
  }

  const amount = requested;
  const minutes = args.expires_in_minutes ?? 15;
  const activeTo = new Date(Date.now() + minutes * 60_000).toISOString();

  const card = await createCard({
    singleUse: true,
    limitAmount: amount,
    currency: requestedCcy,
    agentId: args.agent_id,
    projectId: agent.project_id || "unassigned",
    allowedMerchantCategories: [args.merchant_category],
    activeTo,
    taskId: args.task_id,
    nickName: `${args.agent_id} · ${args.task_id}`,
  });
  const summary: CardSummary = {
    ...cardSummary(card),
    scoped: true,
    task_id: args.task_id,
    merchant_category: args.merchant_category,
    expires_at: activeTo,
    card_limit: amount,
    requested_amount: requested,
    capped_to_policy: false,
  };
  logMcp({ ts: new Date().toISOString(), source, tool, args, ok: true, result: summary });
  return summary;
}
