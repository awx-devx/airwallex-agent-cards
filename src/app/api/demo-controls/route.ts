import { NextResponse } from "next/server";
import { readStore, writeStore, seedStore } from "@/lib/store";
import { listCards, updateCardStatus } from "@/lib/airwallex";

export async function POST(req: Request) {
  const { preset } = (await req.json()) as { preset: string };
  const store = await readStore();

  const procPolicy = store.policies["procurement-policy"];
  const procAgent = store.agents["procurement-agent"];

  if (!procPolicy || !procAgent) {
    return NextResponse.json({ error: "procurement-agent not found — run reset-demo first" }, { status: 400 });
  }

  let message = "";

  switch (preset) {
    case "over_cap":
      procPolicy.per_transaction_cap = 10;
      message = "Per-transaction cap set to $10. Any task over $10 will escalate to /approvals.";
      await writeStore(store);
      break;

    case "velocity":
      procPolicy.velocity_max_per_hour = 1;
      message = "Velocity limit set to 1 txn/hr. After the first approved task, the next will escalate.";
      await writeStore(store);
      break;

    case "human_provisioned":
      procAgent.issuance_mode = "human_provisioned";
      message = "procurement-agent switched to human_provisioned. Every card request now requires approval.";
      await writeStore(store);
      break;

    case "freeze_agent":
      procAgent.frozen = true;
      message = "procurement-agent frozen. All card requests will hard-decline until unfrozen from the Policies page.";
      await writeStore(store);
      break;

    case "reset": {
      // Full demo reset: cancel Airwallex cards + reseed the store
      let cancelled = 0;
      try {
        const cards = await listCards();
        const demoCards = cards.filter(
          (c) => c.metadata?.agent_id || (c.nick_name || "").toLowerCase().includes("agent"),
        );
        for (const card of demoCards) {
          if (card.card_status === "ACTIVE" || card.card_status === "INACTIVE") {
            await updateCardStatus(card.card_id, "CLOSED").catch(() => {});
            cancelled++;
          }
        }
      } catch { /* best-effort */ }
      await writeStore(seedStore());
      message = `Demo reset: ${cancelled > 0 ? `cancelled ${cancelled} card${cancelled !== 1 ? "s" : ""}, ` : ""}policies and agents restored to defaults, approvals and ledger cleared.`;
      break;
    }

    default:
      return NextResponse.json({ error: `Unknown preset: ${preset}` }, { status: 400 });
  }

  return NextResponse.json({ ok: true, message, preset });
}
