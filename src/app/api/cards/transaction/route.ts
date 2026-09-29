import { NextRequest, NextResponse } from "next/server";
import { listCardTransactions, AirwallexError } from "@/lib/airwallex";
import { chargeCard } from "@/lib/merchant-simulator";
import { addLedgerEntry } from "@/lib/store";
import { invalidateActivityCache } from "@/lib/activity";

/** GET ?cardId= — list a card's transactions. */
export async function GET(req: NextRequest) {
  try {
    const cardId = req.nextUrl.searchParams.get("cardId");
    if (!cardId) {
      return NextResponse.json({ error: "cardId required" }, { status: 400 });
    }
    const transactions = await listCardTransactions(cardId);
    return NextResponse.json({ transactions });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST — simulate a card purchase (sandbox). Body: { cardId, amount, currency }.
 * Demonstrates agentic card spend + single-use enforcement.
 */
export async function POST(req: NextRequest) {
  try {
    const { cardId, agentId, amount, currency, merchantCategoryCode } = await req.json();
    const amt = Number(amount);
    if (!cardId) return NextResponse.json({ error: "cardId required" }, { status: 400 });
    if (!amt || amt <= 0)
      return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });
    const mcc = merchantCategoryCode || "5734";
    const ccy = (currency || "USD").toUpperCase();
    const result = await chargeCard({
      cardId,
      amount: amt,
      currency: ccy,
      merchant: "Console Purchase",
      mcc,
    });

    if (agentId) {
      invalidateActivityCache();
      await addLedgerEntry({
        task_id: `ui-${cardId}-${Date.now()}`,
        agent_id: agentId,
        card_id: cardId,
        amount: amt,
        currency: ccy,
        txn_id: result.txn_id,
        status: result.approved ? "APPROVED" : "DECLINED",
        merchant: result.merchant,
        mcc: result.mcc,
        decline_reason: result.decline_reason,
      });
    }

    // Keep the legacy { transaction } shape the CardTile expects.
    return NextResponse.json({
      transaction: {
        status: result.status,
        failure_reason: result.decline_reason,
        transaction_id: result.txn_id,
        transaction_amount: result.amount,
        transaction_currency: result.currency,
        masked_card_number: result.masked_card,
        merchant: { name: result.merchant, category_code: result.mcc },
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  const status = err instanceof AirwallexError ? err.status : 500;
  return NextResponse.json(
    {
      error: err instanceof Error ? err.message : "Transaction simulation failed",
      details: err instanceof AirwallexError ? err.body : undefined,
    },
    { status },
  );
}
