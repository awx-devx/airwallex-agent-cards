import { NextResponse } from "next/server";
import { getActivity } from "@/lib/activity";
import { AirwallexError } from "@/lib/airwallex";

/** GET — unified recent activity feed (card charges, FX, deposits, top-ups, lifecycle). */
export async function GET() {
  try {
    const events = await getActivity();
    return NextResponse.json({ events });
  } catch (err) {
    const status = err instanceof AirwallexError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load activity" },
      { status },
    );
  }
}
