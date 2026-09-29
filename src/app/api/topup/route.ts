import { NextRequest, NextResponse } from "next/server";
import { createPaymentIntent, AirwallexError } from "@/lib/airwallex";

/**
 * Feature 3 — create a PaymentIntent server-side. The client then hands the
 * returned { id, client_secret } to Airwallex.js to redirect to the Hosted
 * Payment Page (env: 'demo').
 */
export async function POST(req: NextRequest) {
  try {
    const { amount, currency } = await req.json();
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });
    }
    if (!currency || typeof currency !== "string") {
      return NextResponse.json({ error: "currency required" }, { status: 400 });
    }
    const intent = await createPaymentIntent(amt, currency.toUpperCase());
    return NextResponse.json({
      id: intent.id,
      client_secret: intent.client_secret,
      amount: intent.amount,
      currency: intent.currency,
    });
  } catch (err) {
    const status = err instanceof AirwallexError ? err.status : 500;
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to create payment intent",
        details: err instanceof AirwallexError ? err.body : undefined,
      },
      { status },
    );
  }
}
