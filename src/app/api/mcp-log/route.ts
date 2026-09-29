import { NextResponse } from "next/server";
import { getMcpLog } from "@/mcp/log";

/** GET — recent MCP tool calls (for the raw-MCP side panel). */
export async function GET() {
  return NextResponse.json({ entries: getMcpLog() });
}
