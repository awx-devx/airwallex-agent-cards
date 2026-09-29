/**
 * Local JSON policy/approval/ledger store (server-only).
 *
 * Policy and Agent are distinct entities. A Policy holds the spending rules;
 * an Agent references exactly one Policy via policy_id.
 *
 * This is the app-layer state the Airwallex API doesn't hold: per-agent policy,
 * issuance mode, the approval queue, and a task ledger (task_id ↔ transaction)
 * for the cost-per-task view. Airwallex remains the source of truth for cards,
 * balances, and transactions; this store never duplicates those.
 *
 * File-backed for the demo (reset-demo rewrites it). Not concurrency-safe beyond
 * a single dev process — fine for a localhost demo.
 */

import type { CardSummary } from "@/lib/provision";

export type IssuanceMode = "human_provisioned" | "self_serve_within_policy";

/** Spending rules — shared across all agents that reference this policy. */
export interface Policy {
  policy_id: string;
  display_name: string;
  currency: string;
  /** App-layer: total spend allowed per agent across all its cards. */
  total_budget: number;
  /** Airwallex-native (per card): per-transaction cap. */
  per_transaction_cap: number;
  /** Airwallex-native (per card): MCC allowlist. */
  allowed_merchant_categories: string[];
  /** Days from issuance until a provisioned card expires. */
  card_expiry_days: number;
  /** App-layer: max approved transactions per rolling hour. */
  velocity_max_per_hour: number;
}

export interface Agent {
  agent_id: string;
  display_name: string;
  project_id: string;
  issuance_mode: IssuanceMode;
  /** References a Policy by policy_id. */
  policy_id: string;
  frozen?: boolean;
}

export interface CardProvisionParams {
  agent_id: string;
  task_id: string;
  merchant_category: string;
  amount: number;
  currency?: string;
}

export interface Approval {
  id: string;
  agent_id: string;
  type: "limit_increase" | "card_provision";
  // limit_increase fields:
  field?: "per_transaction_cap" | "total_budget";
  current?: number;
  requested?: number;
  reason?: string;
  // card_provision fields:
  provision_params?: CardProvisionParams;
  escalation_reason?: string;
  card_result?: CardSummary;
  status: "pending" | "approved" | "denied";
  created_at: string;
  resolved_at?: string;
}

export interface LedgerEntry {
  task_id: string;
  agent_id: string;
  card_id: string;
  amount: number;
  currency: string;
  txn_id?: string;
  status: string; // e.g. "APPROVED" | "DECLINED"
  decline_reason?: string;
  merchant?: string;
  mcc?: string;
  receipt_url?: string;
  created_at: string;
}

export interface Store {
  policies: Record<string, Policy>;
  agents: Record<string, Agent>;
  approvals: Approval[];
  taskLedger: LedgerEntry[];
  meta: { seededAt?: string };
}

const STORE_KEY = "store.json";

function emptyStore(): Store {
  return { policies: {}, agents: {}, approvals: [], taskLedger: [], meta: {} };
}

/** Seeded demo state used when no store exists yet (local file or Workers KV). */
export function seedStore(): Store {
  return {
    policies: {
      "research-policy": {
        policy_id: "research-policy",
        display_name: "Research Policy",
        currency: "USD",
        total_budget: 20000,
        per_transaction_cap: 50,
        allowed_merchant_categories: ["5734", "7372"],
        card_expiry_days: 365,
        velocity_max_per_hour: 5,
      },
      "procurement-policy": {
        policy_id: "procurement-policy",
        display_name: "Procurement Policy",
        currency: "USD",
        total_budget: 500,
        per_transaction_cap: 100,
        allowed_merchant_categories: ["5734", "7311", "4511"],
        card_expiry_days: 7,
        velocity_max_per_hour: 10,
      },
      "contractor-policy": {
        policy_id: "contractor-policy",
        display_name: "Contractor Policy (GBP)",
        currency: "GBP",
        total_budget: 2000,
        per_transaction_cap: 500,
        allowed_merchant_categories: ["7389"],
        card_expiry_days: 7,
        velocity_max_per_hour: 5,
      },
    },
    agents: {
      "research-agent": {
        agent_id: "research-agent",
        display_name: "Research Agent",
        project_id: "proj-research",
        issuance_mode: "human_provisioned",
        policy_id: "research-policy",
      },
      "procurement-agent": {
        agent_id: "procurement-agent",
        display_name: "Procurement Agent",
        project_id: "proj-procurement",
        issuance_mode: "self_serve_within_policy",
        policy_id: "procurement-policy",
      },
      "contractor-agent": {
        agent_id: "contractor-agent",
        display_name: "Contractor Agent",
        project_id: "proj-contractors",
        issuance_mode: "self_serve_within_policy",
        policy_id: "contractor-policy",
      },
    },
    approvals: [],
    taskLedger: [],
    meta: { seededAt: new Date().toISOString() },
  };
}

type KvBinding = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
};

async function getKv(): Promise<KvBinding | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    const env = ctx?.env as { DEMO_STORE?: KvBinding } | undefined;
    return env?.DEMO_STORE ?? null;
  } catch {
    return null;
  }
}

let _cache: Store | null = null;

/** Old store shape — agents had inline policy fields. Used only during migration. */
interface LegacyAgent {
  agent_id: string;
  display_name: string;
  project_id: string;
  issuance_mode: IssuanceMode;
  policy: Omit<Policy, "policy_id" | "display_name">;
  frozen?: boolean;
}

function parseStore(raw: string): Store {
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  // Migrate old format: agents had inline `policy` objects, no top-level `policies` key.
  if (!parsed.policies && parsed.agents) {
    const legacyAgents = parsed.agents as Record<string, LegacyAgent>;
    const policies: Record<string, Policy> = {};
    const agents: Record<string, Agent> = {};
    for (const [id, old] of Object.entries(legacyAgents)) {
      const policyId = `${id}-policy`;
      policies[policyId] = {
        policy_id: policyId,
        display_name: `${old.display_name} Policy`,
        ...old.policy,
      };
      agents[id] = {
        agent_id: old.agent_id,
        display_name: old.display_name,
        project_id: old.project_id,
        issuance_mode: old.issuance_mode,
        policy_id: policyId,
        frozen: old.frozen,
      };
    }
    return {
      policies,
      agents,
      approvals: (parsed.approvals as Approval[]) || [],
      taskLedger: (parsed.taskLedger as LedgerEntry[]) || [],
      meta: (parsed.meta as { seededAt?: string }) || {},
    };
  }

  return {
    policies: (parsed.policies as Record<string, Policy>) || {},
    agents: (parsed.agents as Record<string, Agent>) || {},
    approvals: (parsed.approvals as Approval[]) || [],
    taskLedger: (parsed.taskLedger as LedgerEntry[]) || [],
    meta: (parsed.meta as { seededAt?: string }) || {},
  };
}

async function readFromDisk(): Promise<string | null> {
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const storePath = path.join(process.cwd(), "data", "store.json");
    return fs.readFileSync(storePath, "utf8");
  } catch {
    return null;
  }
}

async function writeToDisk(json: string): Promise<void> {
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const storePath = path.join(process.cwd(), "data", "store.json");
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, json);
  } catch {
    // Workers (and some serverless runtimes) have no writable filesystem.
  }
}

export async function readStore(): Promise<Store> {
  if (_cache) return _cache;

  const kv = await getKv();
  if (kv) {
    const raw = await kv.get(STORE_KEY);
    if (raw) {
      _cache = parseStore(raw);
      return _cache;
    }
    const seeded = seedStore();
    await kv.put(STORE_KEY, JSON.stringify(seeded, null, 2));
    _cache = seeded;
    return seeded;
  }

  const raw = await readFromDisk();
  if (raw) {
    const store = parseStore(raw);
    // Persist a one-time migration of the legacy inline-policy shape.
    if (!raw.includes('"policies"')) {
      await writeStore(store);
    }
    _cache = store;
    return store;
  }

  const seeded = seedStore();
  await writeStore(seeded);
  return seeded;
}

export async function writeStore(store: Store): Promise<void> {
  _cache = store;
  const json = JSON.stringify(store, null, 2);
  const kv = await getKv();
  if (kv) {
    await kv.put(STORE_KEY, json);
    return;
  }
  await writeToDisk(json);
}

// ── Policy CRUD ───────────────────────────────────────────────────────────────

export async function listPolicies(): Promise<Policy[]> {
  return Object.values((await readStore()).policies);
}

export async function getPolicy(policyId: string): Promise<Policy | undefined> {
  return (await readStore()).policies[policyId];
}

export async function createPolicy(policy: Policy): Promise<Policy> {
  const store = await readStore();
  if (store.policies[policy.policy_id]) {
    throw new Error(`Policy "${policy.policy_id}" already exists`);
  }
  store.policies[policy.policy_id] = policy;
  await writeStore(store);
  return policy;
}

export async function updatePolicy(
  policyId: string,
  patch: Partial<Omit<Policy, "policy_id">>,
): Promise<Policy | undefined> {
  const store = await readStore();
  const policy = store.policies[policyId];
  if (!policy) return undefined;
  Object.assign(policy, patch);
  await writeStore(store);
  return policy;
}

export async function deletePolicy(policyId: string): Promise<boolean> {
  const store = await readStore();
  if (!store.policies[policyId]) return false;
  const dependents = Object.values(store.agents)
    .filter((a) => a.policy_id === policyId)
    .map((a) => a.agent_id);
  if (dependents.length > 0) {
    throw new Error(
      `Cannot delete: ${dependents.length} agent profile${dependents.length === 1 ? "" : "s"} reference this policy (${dependents.join(", ")}). Remove or reassign them first.`,
    );
  }
  delete store.policies[policyId];
  await writeStore(store);
  return true;
}

/** Returns the agent and its resolved policy, or undefined if either is missing. */
export async function getAgentWithPolicy(
  agentId: string,
): Promise<{ agent: Agent; policy: Policy } | undefined> {
  const store = await readStore();
  const agent = store.agents[agentId];
  if (!agent) return undefined;
  const policy = store.policies[agent.policy_id];
  if (!policy) return undefined;
  return { agent, policy };
}

// ── Agent CRUD ────────────────────────────────────────────────────────────────

export async function listAgents(): Promise<Agent[]> {
  return Object.values((await readStore()).agents);
}

export async function getAgent(agentId: string): Promise<Agent | undefined> {
  return (await readStore()).agents[agentId];
}

export async function createAgent(agent: Agent): Promise<Agent> {
  const store = await readStore();
  if (store.agents[agent.agent_id]) {
    throw new Error(`Agent "${agent.agent_id}" already exists`);
  }
  store.agents[agent.agent_id] = agent;
  await writeStore(store);
  return agent;
}

export async function updateAgent(
  agentId: string,
  patch: Partial<Omit<Agent, "agent_id">>,
): Promise<Agent | undefined> {
  const store = await readStore();
  const agent = store.agents[agentId];
  if (!agent) return undefined;
  Object.assign(agent, patch);
  await writeStore(store);
  return agent;
}

export async function deleteAgent(agentId: string): Promise<boolean> {
  const store = await readStore();
  if (!store.agents[agentId]) return false;
  delete store.agents[agentId];
  await writeStore(store);
  return true;
}

// ── Approvals ─────────────────────────────────────────────────────────────────

export async function addApproval(a: Omit<Approval, "id" | "status" | "created_at">): Promise<Approval> {
  const store = await readStore();
  const approval: Approval = {
    ...a,
    id: `apr_${Date.now().toString(36)}`,
    status: "pending",
    created_at: new Date().toISOString(),
  };
  store.approvals.unshift(approval);
  await writeStore(store);
  return approval;
}

export async function addCardApproval(params: CardProvisionParams & { escalation_reason: string }): Promise<Approval> {
  const store = await readStore();
  // Return existing pending approval for the same agent+task to avoid duplicates.
  const existing = store.approvals.find(
    (a) =>
      a.type === "card_provision" &&
      a.agent_id === params.agent_id &&
      a.provision_params?.task_id === params.task_id &&
      a.status === "pending",
  );
  if (existing) return existing;
  const approval: Approval = {
    id: `apr_${Date.now().toString(36)}`,
    agent_id: params.agent_id,
    type: "card_provision",
    provision_params: {
      agent_id: params.agent_id,
      task_id: params.task_id,
      merchant_category: params.merchant_category,
      amount: params.amount,
      currency: params.currency,
    },
    escalation_reason: params.escalation_reason,
    status: "pending",
    created_at: new Date().toISOString(),
  };
  store.approvals.unshift(approval);
  await writeStore(store);
  return approval;
}

export async function updateApprovalCardResult(id: string, cardResult: CardSummary): Promise<void> {
  const store = await readStore();
  const approval = store.approvals.find((a) => a.id === id);
  if (approval) {
    approval.card_result = cardResult;
    await writeStore(store);
  }
}

export async function resolveApproval(
  id: string,
  decision: "approved" | "denied",
): Promise<{ approval?: Approval; applied?: boolean }> {
  const store = await readStore();
  const approval = store.approvals.find((a) => a.id === id);
  if (!approval) return {};
  if (approval.status !== "pending") return { approval, applied: false };
  approval.status = decision;
  approval.resolved_at = new Date().toISOString();
  let applied = false;
  if (decision === "approved" && approval.type === "limit_increase") {
    const agent = store.agents[approval.agent_id];
    if (agent) {
      const policy = store.policies[agent.policy_id];
      if (policy) {
        if (approval.field && approval.requested != null) {
          policy[approval.field] = approval.requested;
        }
        applied = true;
      }
    }
  }
  await writeStore(store);
  return { approval, applied };
}

// ── Ledger ────────────────────────────────────────────────────────────────────

/** Count of APPROVED tasks in the last hour for an agent (for velocity enforcement). */
export async function recentApprovedCount(agentId: string, windowMs = 3_600_000): Promise<number> {
  const cutoff = Date.now() - windowMs;
  return (await readStore()).taskLedger.filter(
    (e) =>
      e.agent_id === agentId &&
      e.status === "APPROVED" &&
      new Date(e.created_at).getTime() > cutoff,
  ).length;
}

/** Total approved spend across all tasks for an agent (for budget enforcement). */
export async function totalSpent(agentId: string): Promise<number> {
  return (await readStore()).taskLedger
    .filter((e) => e.agent_id === agentId && e.status === "APPROVED")
    .reduce((sum, e) => sum + e.amount, 0);
}

export async function addLedgerEntry(e: Omit<LedgerEntry, "created_at">): Promise<LedgerEntry> {
  const store = await readStore();
  const entry: LedgerEntry = { ...e, created_at: new Date().toISOString() };
  store.taskLedger.unshift(entry);
  await writeStore(store);
  return entry;
}
