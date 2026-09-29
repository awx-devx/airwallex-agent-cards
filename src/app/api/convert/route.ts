import { NextRequest, NextResponse } from "next/server";
import { createConversion, AirwallexError } from "@/lib/airwallex";

/**
 * POST — FX-convert between wallet currencies (move money USD → HKD, etc.).
 * Body: { fromCurrency, toCurrency, amount }  — `amount` is in fromCurrency
 * (the sell side). Executed at market rate; funds settle across wallet balances.
 */
export async function POST(req: NextRequest) {
  try {
    const { fromCurrency, toCurrency, amount } = await req.json();
    const amt = Number(amount);
    if (!fromCurrency || !toCurrency) {
      return NextResponse.json(
        { error: "fromCurrency and toCurrency are required" },
        { status: 400 },
      );
    }
    if (String(fromCurrency).toUpperCase() === String(toCurrency).toUpperCase()) {
      return NextResponse.json(
        { error: "fromCurrency and toCurrency must differ" },
        { status: 400 },
      );
    }
    if (!amt || amt <= 0) {
      return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });
    }
    const conversion = await createConversion({
      sellCurrency: String(fromCurrency).toUpperCase(),
      buyCurrency: String(toCurrency).toUpperCase(),
      sellAmount: amt,
    });
    return NextResponse.json({ conversion });
  } catch (err) {
    const status = err instanceof AirwallexError ? err.status : 500;
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Conversion failed",
        details: err instanceof AirwallexError ? err.body : undefined,
      },
      { status },
    );
  }
}
