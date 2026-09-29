/**
 * MCP smoke test — connects to the shared MCP server as an independent client
 * (the way the headless agent runner will), lists tools, and calls a couple.
 * Proves the server handshake works outside the console. Run: node scripts/mcp-smoke.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_ = process.env.MCP_URL || "http://localhost:3000/api/mcp";

async function main() {
  const client = new Client({ name: "smoke", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(URL_)));

  const tools = await client.listTools();
  console.log("Tools:", tools.tools.map((t) => t.name).join(", "));

  const agents = await client.callTool({ name: "list_agents", arguments: {} });
  const agentList = JSON.parse(agents.content.find((c) => c.type === "text").text);
  console.log("Agents:", agentList.map((a) => `${a.agent_id}(${a.issuance_mode})`).join(", "));

  const bal = await client.callTool({ name: "get_balances", arguments: {} });
  const balances = JSON.parse(bal.content.find((c) => c.type === "text").text);
  const usd = balances.find((b) => b.currency === "USD" && b.account_type === "cash");
  console.log("USD cash balance:", usd?.available_amount);

  await client.close();
  console.log("SMOKE OK");
}
main().catch((e) => {
  console.error("SMOKE FAIL:", e.message);
  process.exit(1);
});
