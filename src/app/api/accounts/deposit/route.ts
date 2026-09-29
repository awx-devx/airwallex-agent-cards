import { NextRequest, NextResponse } from "next/server";
import { simulateDeposit, AirwallexError } from "@/lib/airwallex";

/**
 * POST — simulate an inbound bank deposit into a Global Account (sandbox only).
 * A settled deposit credits the wallet balance in that account's currency.
 * Body: { globalAccountId, amount }
 */
export async function POST(req: NextRequest) {
  try {
    const { globalAccountId, amount } = await req.json();
    const amt = Number(amount);
    if (!globalAccountId) {
      return NextResponse.json({ error: "globalAccountId required" }, { status: 400 });
    }
    if (!amt || amt <= 0) {
      return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });
    }
    const deposit = await simulateDeposit({ globalAccountId, amount: amt });
    return NextResponse.json({ deposit });
  } catch (err) {
    const status = err instanceof AirwallexError ? err.status : 500;
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Deposit simulation failed",
        details: err instanceof AirwallexError ? err.body : undefined,
      },
      { status },
    );
  }
}
