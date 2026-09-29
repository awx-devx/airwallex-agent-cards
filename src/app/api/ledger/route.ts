import { NextResponse } from "next/server";
import { readStore } from "@/lib/store";

/** GET — task ledger + per-agent budget summary. */
export async function GET() {
  const store = await readStore();
  const ledger = store.taskLedger;

  const byAgent: Record<string, { spent: number; declined: number; blocked: number; count: number }> = {};
  for (const e of ledger) {
    const a = (byAgent[e.agent_id] ||= { spent: 0, declined: 0, blocked: 0, count: 0 });
    a.count++;
    if (e.status === "APPROVED") a.spent += e.amount;
    else if (e.status === "DECLINED") a.declined += e.amount;
    else if (e.status === "BLOCKED_AT_ISSUANCE") a.blocked += e.amount;
  }

  const agentSummaries = Object.entries(store.agents).map(([id, agent]) => {
    const policy = store.policies[agent.policy_id];
    const s = byAgent[id] || { spent: 0, declined: 0, blocked: 0, count: 0 };
    return {
      agent_id: id,
      display_name: agent.display_name,
      budget: policy?.total_budget ?? 0,
      currency: policy?.currency ?? "USD",
      spent: s.spent,
      declined: s.declined,
      blocked: s.blocked,
      task_count: s.count,
      remaining: (policy?.total_budget ?? 0) - s.spent,
    };
  });

  return NextResponse.json({ ledger, agentSummaries });
}
