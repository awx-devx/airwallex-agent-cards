import { NextResponse } from "next/server";
import { getBalances, AirwallexError } from "@/lib/airwallex";

export async function GET() {
  try {
    const balances = await getBalances();
    return NextResponse.json({ balances });
  } catch (err) {
    const status = err instanceof AirwallexError ? err.status : 500;
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to load balances",
        details: err instanceof AirwallexError ? err.body : undefined,
      },
      { status },
    );
  }
}
