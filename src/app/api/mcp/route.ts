import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServer } from "@/mcp/server";

export const dynamic = "force-dynamic";

// The shared local MCP server, hosted in-app. Both the console and the headless
// agent runner connect here over HTTP. Transports are kept per session in the
// dev process (module-scoped map).
const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

async function handle(req: Request): Promise<Response> {
  const sessionId = req.headers.get("mcp-session-id") || undefined;
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    // New connection (expects an initialize request).
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id: string) => {
        transports.set(id, transport as WebStandardStreamableHTTPServerTransport);
      },
    });
    transport.onclose = () => {
      const id = transport?.sessionId;
      if (id) transports.delete(id);
    };
    const server = buildMcpServer();
    await server.connect(transport);
  }

  return transport.handleRequest(req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
