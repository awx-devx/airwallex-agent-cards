import { NextRequest, NextResponse } from "next/server";
import { callTool } from "@/lib/mcpClient";
import { readStore } from "@/lib/store";

/** GET — list approval queue items (direct store read — no MCP round-trip needed). */
export async function GET() {
  try {
    const { approvals } = await readStore();
    return NextResponse.json({ approvals });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load approvals" },
      { status: 500 },
    );
  }
}

/** POST — resolve an approval. Body: { id, decision: "approved" | "denied" } */
export async function POST(req: NextRequest) {
  try {
    const { id, decision } = await req.json();
    if (!id || !["approved", "denied"].includes(decision)) {
      return NextResponse.json({ error: "id and decision (approved|denied) required" }, { status: 400 });
    }
    const result = await callTool("resolve_approval", { id: String(id), decision });
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to resolve approval" },
      { status: 500 },
    );
  }
}
