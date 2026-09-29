import { NextRequest, NextResponse } from "next/server";
import { getCardDetails, AirwallexError } from "@/lib/airwallex";

/**
 * GET ?cardId= — reveal sensitive card details (PAN/CVV/expiry).
 *
 * Sandbox returns test card numbers. In production you would NOT proxy the raw
 * PAN through your own server — you'd use Airwallex's PCI-compliant reveal
 * (network token / hosted card-details component). This is demo-only.
 */
export async function GET(req: NextRequest) {
  try {
    const cardId = req.nextUrl.searchParams.get("cardId");
    if (!cardId) {
      return NextResponse.json({ error: "cardId required" }, { status: 400 });
    }
    const details = await getCardDetails(cardId);
    return NextResponse.json({ details });
  } catch (err) {
    const status = err instanceof AirwallexError ? err.status : 500;
    return NextResponse.json(
      {
        error:
          err instanceof AirwallexError && err.status === 400
            ? "Card details are only available for ACTIVE cards."
            : err instanceof Error
              ? err.message
              : "Failed to reveal card",
      },
      { status },
    );
  }
}
