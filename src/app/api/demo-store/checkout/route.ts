import { NextRequest, NextResponse } from "next/server";
import { listCards } from "@/lib/airwallex";
import { chargeCard } from "@/lib/merchant-simulator";
import { addLedgerEntry } from "@/lib/store";
import { invalidateActivityCache } from "@/lib/activity";
import { logMcp } from "@/mcp/log";
import { getProduct } from "@/lib/demo-store";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { card_id, product_id, amount: overrideAmount } = body as {
    card_id?: string;
    product_id?: string;
    amount?: number;
  };

  if (!card_id) {
    return NextResponse.json({ error: "card_id required" }, { status: 400 });
  }

  const product = product_id ? getProduct(product_id) : undefined;
  const amount = overrideAmount ?? product?.price ?? 10;
  const currency = product?.currency ?? "USD";
  const mcc = product?.mcc ?? "5734";
  const merchant = product?.name ?? "Demo Store";

  let result;
  try {
    result = await chargeCard({ cardId: card_id, amount, currency, merchant, mcc });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Checkout failed" },
      { status: 502 },
    );
  }

  // Record to task ledger and log to MCP panel when the card has agent metadata.
  const cards = await listCards();
  const card = cards.find((c) => c.card_id === card_id);
  if (card?.metadata?.agent_id) {
    await addLedgerEntry({
      task_id: card.metadata?.task_id ?? `store-${card_id.slice(0, 8)}`,
      agent_id: card.metadata.agent_id,
      card_id,
      amount,
      currency,
      txn_id: result.txn_id,
      status: result.approved ? "APPROVED" : "DECLINED",
      merchant,
      mcc,
      decline_reason: result.decline_reason,
    });
    invalidateActivityCache();
    logMcp({
      ts: new Date().toISOString(),
      source: "demo-store",
      tool: "checkout",
      args: { card_id: `${card_id.slice(0, 8)}…`, product_id, amount },
      ok: result.approved,
      result: result.approved ? { status: result.status, merchant } : undefined,
      error: result.decline_reason,
    });
  }

  return NextResponse.json({ ...result, product_id, merchant });
}
