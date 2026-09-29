#!/usr/bin/env node
/**
 * Diagnostic: test each Airwallex API source used by the Activity feed.
 * Run with:  node --env-file=.env.local scripts/diagnose-activity.mjs
 */

const BASE = process.env.AIRWALLEX_API_URL || "https://api-demo.airwallex.com";
const CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID;
const API_KEY = process.env.AIRWALLEX_API_KEY;

if (!CLIENT_ID || !API_KEY) {
  console.error("❌  AIRWALLEX_CLIENT_ID / AIRWALLEX_API_KEY not set — run with --env-file=.env.local");
  process.exit(1);
}

async function authenticate() {
  const res = await fetch(`${BASE}/api/v1/authentication/login`, {
    method: "POST",
    headers: { "x-client-id": CLIENT_ID, "x-api-key": API_KEY, "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Auth failed ${res.status}: ${JSON.stringify(data)}`);
  console.log("✅  Authenticated. Token expires:", data.expires_at);
  return data.token;
}

async function get(token, path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

async function check(label, token, path) {
  try {
    const { status, ok, data } = await get(token, path);
    const count = Array.isArray(data) ? data.length : (data?.items?.length ?? data?.total_count ?? "?");
    const icon = ok ? "✅" : "❌";
    console.log(`${icon}  ${label}: HTTP ${status}, count=${count}`);
    if (!ok) console.log("    Response:", JSON.stringify(data).slice(0, 300));
  } catch (e) {
    console.log(`❌  ${label}: threw — ${e.message}`);
  }
}

const token = await authenticate();

await check("listCards",               token, "/api/v1/issuing/cards?page_size=50&status=ALL");
await check("listAllCardTransactions", token, "/api/v1/issuing/cards/transactions?page_size=50");
await check("listConversions",         token, "/api/v1/fx/conversions?page_size=20");
await check("listDeposits",            token, "/api/v1/deposits?page_num=0&page_size=20");
await check("listPaymentIntents",      token, "/api/v1/pa/payment_intents?page_size=20");
