import { NextResponse } from "next/server";
import { getAgentEconomy, AirwallexError } from "@/lib/airwallex";

/** GET — the agent economy: cards grouped by agent with per-agent spend. */
export async function GET() {
  try {
    const economy = await getAgentEconomy();
    return NextResponse.json(economy);
  } catch (err) {
    const status = err instanceof AirwallexError ? err.status : 500;
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to load agents",
        details: err instanceof AirwallexError ? err.body : undefined,
      },
      { status },
    );
  }
}
