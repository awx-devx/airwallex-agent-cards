/**
 * In-process MCP client used by console routes. Calls the same tool handlers
 * the HTTP MCP server exposes, without a localhost round-trip — required on
 * Cloudflare Workers, and avoids split-brain when MCP_URL is wrong.
 */
import { logMcp } from "@/mcp/log";
import { buildMcpServer } from "@/mcp/server";

type ToolResult = {
  content?: { type: string; text?: string }[];
  isError?: boolean;
};

type RegisteredTool = {
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<ToolResult>;
};

export async function callTool<T = unknown>(
  name: string,
  args: Record<string, unknown>,
  source = "console",
): Promise<T> {
  const server = buildMcpServer() as unknown as {
    _registeredTools: Record<string, RegisteredTool>;
  };
  const tool = server._registeredTools[name];
  if (!tool) {
    throw new Error(`Unknown MCP tool: ${name}`);
  }
  try {
    const res = await tool.handler(args, {});
    const textPart = res.content?.find((c) => c.type === "text");
    const data = textPart?.text ? JSON.parse(textPart.text) : null;
    logMcp({ ts: new Date().toISOString(), source, tool: name, args, ok: !res.isError, result: data });
    return data as T;
  } catch (e) {
    logMcp({
      ts: new Date().toISOString(),
      source,
      tool: name,
      args,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
