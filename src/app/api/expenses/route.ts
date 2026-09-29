import { NextResponse } from "next/server";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {

  const store = await readStore();
  const entries = store.taskLedger;

  // Per-agent aggregates
  const byAgent: Record<string, { txns: number; approved: number; total: number; currency: string }> = {};
  for (const e of entries) {
    if (!byAgent[e.agent_id]) byAgent[e.agent_id] = { txns: 0, approved: 0, total: 0, currency: e.currency };
    byAgent[e.agent_id].txns++;
    if (e.status === "APPROVED") {
      byAgent[e.agent_id].approved++;
      byAgent[e.agent_id].total += e.amount;
    }
  }

  const totalSpend = entries.filter((e) => e.status === "APPROVED").reduce((s, e) => s + e.amount, 0);
  const totalTxns = entries.length;
  const approvedTxns = entries.filter((e) => e.status === "APPROVED").length;
  const currency = entries[0]?.currency ?? "USD";

  return NextResponse.json({
    summary: { totalSpend, totalTxns, approvedTxns, currency },
    byAgent,
    entries,
  });
}
