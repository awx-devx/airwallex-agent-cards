/**
 * Verifies scoped ephemeral cards: provision via the MCP server, then confirm
 * the scope holds at the rail (allowed merchant approves, others decline).
 * Run with dev server up: node scripts/test-scoped.mjs
 */
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l && !l.startsWith("#") && l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const BASE = env.AIRWALLEX_BASE_URL;
const MCP = process.env.MCP_URL || "http://localhost:3000/api/mcp";

async function rawAuth(token, cardId, amount, mcc) {
  const r = await fetch(`${BASE}/api/v1/simulation/issuing/create`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-api-version": "2024-04-04" },
    body: JSON.stringify({ card_id: cardId, transaction_amount: amount, transaction_currency: "USD", single_phase: true, merchant_category_code: mcc, merchant_info: "Test" }),
  });
  const j = await r.json();
  return { status: j.status, reason: j.failure_reason };
}

async function main() {
  const client = new Client({ name: "scoped-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP)));
  const res = await client.callTool({
    name: "provision_scoped_card",
    arguments: { agent_id: "research-agent", task_id: "task-001", merchant_category: "5734", amount: 40, expires_in_minutes: 15 },
  });
  const card = JSON.parse(res.content.find((c) => c.type === "text").text);
  await client.close();
  console.log("Scoped card:", JSON.stringify({
    card_id: card.card_id, type: card.type, allowed: card.allowed_merchant_categories,
    expires_at: card.expires_at, task_id: card.task_id, status: card.status,
  }, null, 2));

  const tok = (await (await fetch(`${BASE}/api/v1/authentication/login`, { method: "POST", headers: { "x-client-id": env.AIRWALLEX_CLIENT_ID, "x-api-key": env.AIRWALLEX_API_KEY } })).json()).token;

  // Card A: allowed merchant → approves (then single-use closes it).
  console.log("[card A] allowed 5734 $10 →", await rawAuth(tok, card.card_id, 10, "5734"));
  console.log("[card A] reuse attempt 5734 $10 →", await rawAuth(tok, card.card_id, 10, "5734"), "(single-use: card now closed)");

  // Card B: fresh scoped card, hit a DISALLOWED merchant first → merchant lock declines.
  const client2 = new Client({ name: "scoped-test", version: "1.0.0" });
  await client2.connect(new StreamableHTTPClientTransport(new URL(MCP)));
  const res2 = await client2.callTool({
    name: "provision_scoped_card",
    arguments: { agent_id: "research-agent", task_id: "task-002", merchant_category: "5734", amount: 40 },
  });
  const cardB = JSON.parse(res2.content.find((c) => c.type === "text").text);
  await client2.close();
  console.log("[card B] blocked 5812 $10 →", await rawAuth(tok, cardB.card_id, 10, "5812"), "(merchant lock)");
  console.log("SCOPED TEST DONE");
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
