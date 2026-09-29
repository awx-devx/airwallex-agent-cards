/**
 * reset-demo — return the demo to a clean, seeded state in well under a minute.
 *
 * Phase 1 scope:
 *  - Rewrite data/store.json with two seeded agents + empty approvals/ledger.
 *  - Ensure an issuing cardholder exists and is READY (create a DELEGATE if none;
 *    call the pass_review simulation endpoint if one is stuck in PENDING).
 *
 * Airwallex card cleanup (cancelling leftover demo/probe cards) will be added
 * with the provisioning phase. Run: npm run reset-demo
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd());
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const BASE = env.AIRWALLEX_BASE_URL || "https://api-demo.airwallex.com";

// ── Seed data ────────────────────────────────────────────────────────────────
const store = {
  policies: {
    "research-policy": {
      policy_id: "research-policy",
      display_name: "Research Policy",
      currency: "USD",
      total_budget: 20000,
      per_transaction_cap: 50,
      allowed_merchant_categories: ["5734", "7372"], // Software, SaaS/Cloud
      card_expiry_days: 365,
      velocity_max_per_hour: 5,
    },
    "procurement-policy": {
      policy_id: "procurement-policy",
      display_name: "Procurement Policy",
      currency: "USD",
      total_budget: 500,
      per_transaction_cap: 100,
      allowed_merchant_categories: ["5734", "7311", "4511"], // Software, Advertising, Travel
      card_expiry_days: 7,
      velocity_max_per_hour: 10,
    },
    "contractor-policy": {
      policy_id: "contractor-policy",
      display_name: "Contractor Policy (GBP)",
      currency: "GBP",
      total_budget: 2000,
      per_transaction_cap: 500,
      allowed_merchant_categories: ["7389"], // Professional Services
      card_expiry_days: 7,
      velocity_max_per_hour: 5,
    },
  },
  agents: {
    "research-agent": {
      agent_id: "research-agent",
      display_name: "Research Agent",
      project_id: "proj-research",
      issuance_mode: "human_provisioned",
      policy_id: "research-policy",
    },
    "procurement-agent": {
      agent_id: "procurement-agent",
      display_name: "Procurement Agent",
      project_id: "proj-procurement",
      issuance_mode: "self_serve_within_policy",
      policy_id: "procurement-policy",
    },
    "contractor-agent": {
      agent_id: "contractor-agent",
      display_name: "Contractor Agent",
      project_id: "proj-contractors",
      issuance_mode: "self_serve_within_policy",
      policy_id: "contractor-policy",
    },
  },
  approvals: [],
  taskLedger: [],
  meta: { seededAt: new Date().toISOString() },
};

function writeStore() {
  const dir = path.join(ROOT, "data");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "store.json"), JSON.stringify(store, null, 2));
  console.log(
    "Seeded data/store.json — policies:", Object.keys(store.policies).join(", "),
    "| agents:", Object.keys(store.agents).join(", "),
  );
}

// ── Airwallex cardholder ensure ──────────────────────────────────────────────
let TOKEN = null;
async function login() {
  const r = await fetch(`${BASE}/api/v1/authentication/login`, {
    method: "POST",
    headers: {
      "x-client-id": env.AIRWALLEX_CLIENT_ID,
      "x-api-key": env.AIRWALLEX_API_KEY,
      "Content-Type": "application/json",
    },
  });
  if (!r.ok) throw new Error(`login failed ${r.status}: ${await r.text()}`);
  TOKEN = (await r.json()).token;
}
async function awx(pathname, { method = "GET", body } = {}) {
  const r = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { ok: r.ok, status: r.status, json };
}

async function ensureCardholder() {
  const list = await awx("/api/v1/issuing/cardholders?page_size=100");
  const items = list.json?.items || [];
  let ch = items.find((c) => c.status === "READY") || items[0];
  if (!ch) {
    const created = await awx("/api/v1/issuing/cardholders/create", {
      method: "POST",
      body: { type: "DELEGATE", email: "agent-cards@example.com" },
    });
    ch = created.json;
    console.log("Created DELEGATE cardholder:", ch?.cardholder_id, "status:", ch?.status);
  } else {
    console.log("Reusing cardholder:", ch.cardholder_id, "status:", ch.status);
  }
  if (ch && ch.status === "PENDING") {
    const pass = await awx(
      `/api/v1/simulation/issuing/cardholders/${ch.cardholder_id}/pass_review`,
      { method: "POST" },
    );
    console.log("pass_review →", pass.status, pass.ok ? "(now READY)" : JSON.stringify(pass.json));
  }
  return ch?.cardholder_id;
}

async function cancelStaleCards() {
  const [activeRes, inactiveRes] = await Promise.all([
    awx("/api/v1/issuing/cards?page_size=100&card_status=ACTIVE"),
    awx("/api/v1/issuing/cards?page_size=100&card_status=INACTIVE"),
  ]);
  const items = [
    ...(activeRes.json?.items || []),
    ...(inactiveRes.json?.items || []),
  ];
  const demo = items.filter(
    (c) => c.metadata?.agent_id || (c.nick_name || "").toLowerCase().includes("agent"),
  );
  if (!demo.length) {
    console.log("No stale demo cards to cancel.");
    return;
  }
  let closed = 0;
  for (const c of demo) {
    const r = await awx(`/api/v1/issuing/cards/${c.card_id}/update`, {
      method: "POST",
      body: { card_status: "CLOSED" },
    });
    if (r.ok) closed++;
  }
  console.log(`Cancelled ${closed}/${demo.length} stale demo cards (active + frozen).`);
}

async function main() {
  writeStore();
  try {
    await login();
    await cancelStaleCards();
    const id = await ensureCardholder();
    console.log("Cardholder ready:", id);
  } catch (e) {
    console.warn("Cardholder ensure skipped/failed:", e.message);
    console.warn("(Store was still seeded. Check AIRWALLEX_* creds in .env.local.)");
  }
  console.log("\nreset-demo complete.");
}

main();
