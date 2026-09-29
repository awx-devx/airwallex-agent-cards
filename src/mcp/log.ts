/**
 * In-memory ring buffer of MCP tool calls made by the console (and later the
 * agent runner), for the always-visible "raw MCP traffic" side panel. Lives in
 * the Next server process; the console client writes here, the /api/mcp-log
 * route reads here.
 */
export interface McpLogEntry {
  ts: string;
  source: string; // "console" | "agent:<id>"
  tool: string;
  args: unknown;
  ok: boolean;
  result?: unknown;
  error?: string;
}

// Back the buffer with globalThis so it's a single instance across Next route
// bundles (route handlers can otherwise get separate module copies in dev).
const g = globalThis as unknown as { __mcpLog?: McpLogEntry[] };
g.__mcpLog ||= [];
const buffer = g.__mcpLog;

export function logMcp(entry: McpLogEntry): void {
  buffer.unshift(entry);
  if (buffer.length > 100) buffer.length = 100;
}

export function getMcpLog(): McpLogEntry[] {
  return buffer.slice(0, 50);
}
