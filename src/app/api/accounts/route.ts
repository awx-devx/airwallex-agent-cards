import { NextRequest, NextResponse } from "next/server";
import {
  listGlobalAccounts,
  createGlobalAccount,
  getAccountInfo,
  AirwallexError,
} from "@/lib/airwallex";

/** GET — list Global Accounts + the entity's domestic currency. */
export async function GET() {
  try {
    const [accounts, info] = await Promise.all([
      listGlobalAccounts(),
      getAccountInfo().catch(() => null),
    ]);
    return NextResponse.json({ accounts, info });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST — open a new Global Account (adds a currency + its account number).
 * Body: { countryCode, currency, transferMethod?, nickName? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.countryCode || !body.currency) {
      return NextResponse.json(
        { error: "countryCode and currency are required" },
        { status: 400 },
      );
    }
    const account = await createGlobalAccount({
      countryCode: String(body.countryCode).toUpperCase(),
      currency: String(body.currency).toUpperCase(),
      transferMethod: body.transferMethod === "SWIFT" ? "SWIFT" : "LOCAL",
      nickName: body.nickName,
    });
    return NextResponse.json({ account });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  const status = err instanceof AirwallexError ? err.status : 500;
  return NextResponse.json(
    {
      error: err instanceof Error ? err.message : "Accounts operation failed",
      details: err instanceof AirwallexError ? err.body : undefined,
    },
    { status },
  );
}
