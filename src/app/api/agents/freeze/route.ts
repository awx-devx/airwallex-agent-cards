import { NextRequest, NextResponse } from "next/server";
import { listCards, updateCardStatus, AirwallexError } from "@/lib/airwallex";
import { readStore, writeStore } from "@/lib/store";

/**
 * POST — freeze (INACTIVE) or unfreeze (ACTIVE) all cards for an agent.
 * Body: { agentId, mode: "freeze" | "unfreeze" }
 * Persists the frozen flag in the policy store so the UI reflects state.
 */
export async function POST(req: NextRequest) {
  try {
    const { agentId, mode } = await req.json();
    if (!agentId || !["freeze", "unfreeze"].includes(mode)) {
      return NextResponse.json(
        { error: "agentId and mode (freeze|unfreeze) required" },
        { status: 400 },
      );
    }

    const store = await readStore();
    if (!store.agents[agentId]) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const targetStatus = mode === "freeze" ? "INACTIVE" : "ACTIVE";
    const sourceStatus = mode === "freeze" ? "ACTIVE" : "INACTIVE";

    const cards = await listCards();
    const targets = cards.filter(
      (c) => c.metadata?.agent_id === agentId && c.card_status === sourceStatus,
    );
    for (const c of targets) {
      await updateCardStatus(c.card_id, targetStatus);
    }

    store.agents[agentId].frozen = mode === "freeze";
    await writeStore(store);

    return NextResponse.json({ agentId, mode, affected: targets.length });
  } catch (err) {
    const status = err instanceof AirwallexError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Freeze failed" },
      { status },
    );
  }
}
