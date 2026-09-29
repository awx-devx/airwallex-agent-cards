/**
 * Phase 0 capability probe — hits the Airwallex sandbox (api-demo) directly and
 * reports, per control, whether a violating simulated authorization is actually
 * declined and with what reason code. Read-only conclusions go into CAPABILITIES.md.
 *
 * Run: node scripts/probe.mjs
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const BASE = env.AIRWALLEX_BASE_URL || "https://api-demo.airwallex.com";
const API_VERSION = env.AIRWALLEX_API_VERSION || "2024-04-04";
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

async function awx(path, { method = "GET", body, headers } = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { ok: r.ok, status: r.status, json };
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function resolveCardholder() {
  const list = await awx("/api/v1/issuing/cardholders?page_size=100");
  const items = list.json?.items || [];
  const ready = items.find((c) => c.status === "READY");
  if (ready) return { id: ready.cardholder_id, status: ready.status, created: false };
  const created = await awx("/api/v1/issuing/cardholders/create", {
    method: "POST",
    body: { type: "DELEGATE", email: "probe@example.com" },
  });
  return {
    id: created.json?.cardholder_id,
    status: created.json?.status,
    created: true,
  };
}

async function createCard(cardholderId, controls, nick) {
  const r = await awx("/api/v1/issuing/cards/create", {
    method: "POST",
    body: {
      request_id: randomUUID(),
      created_by: "Probe",
      cardholder_id: cardholderId,
      form_factor: "VIRTUAL",
      is_personalized: false,
      program: { purpose: "COMMERCIAL" },
      nick_name: nick,
      authorization_controls: controls,
    },
  });
  if (!r.ok) throw new Error(`create card failed ${r.status}: ${JSON.stringify(r.json)}`);
  return r.json;
}

async function auth(cardId, amount, mcc = "5734") {
  const r = await awx("/api/v1/simulation/issuing/create", {
    method: "POST",
    headers: { "x-api-version": API_VERSION },
    body: {
      card_id: cardId,
      transaction_amount: amount,
      transaction_currency: "USD",
      single_phase: true,
      merchant_info: "Probe Merchant",
      merchant_category_code: mcc,
    },
  });
  if (!r.ok) return { httpError: r.status, body: r.json };
  return { status: r.json?.status, reason: r.json?.failure_reason };
}

const results = [];
function record(control, detail) {
  results.push({ control, ...detail });
  console.log(`\n### ${control}`);
  console.log(JSON.stringify(detail, null, 2));
}

async function main() {
  await login();
  console.log("Authenticated against", BASE);

  // 1. Cardholder lifecycle
  const ch = await resolveCardholder();
  record("cardholder_lifecycle", {
    reused_existing: !ch.created,
    status_on_create: ch.status,
    note: ch.created
      ? "Freshly created DELEGATE cardholder"
      : "Reused an existing READY cardholder",
  });
  const cardholderId = ch.id;
  if (!cardholderId) throw new Error("no cardholder id");

  const usd = { currency: "USD" };

  // 2. MCC lock
  {
    const card = await createCard(
      cardholderId,
      {
        allowed_transaction_count: "MULTIPLE",
        allowed_currencies: ["USD"],
        allowed_merchant_categories: ["5734"],
        transaction_limits: { ...usd, limits: [{ amount: 1000, interval: "MONTHLY" }] },
      },
      "probe-mcc",
    );
    const allowed = await auth(card.card_id, 10, "5734");
    const blocked = await auth(card.card_id, 10, "5812");
    record("mcc_lock", { allowed_5734: allowed, blocked_5812: blocked });
  }

  // 3. Per-transaction cap
  {
    const card = await createCard(
      cardholderId,
      {
        allowed_transaction_count: "MULTIPLE",
        allowed_currencies: ["USD"],
        transaction_limits: { ...usd, limits: [{ amount: 50, interval: "PER_TRANSACTION" }] },
      },
      "probe-pertxn",
    );
    const under = await auth(card.card_id, 20);
    const over = await auth(card.card_id, 100);
    record("per_transaction_cap", { under_50: under, over_50: over });
  }

  // 4. Cumulative / total card limit (ALL_TIME)
  {
    const card = await createCard(
      cardholderId,
      {
        allowed_transaction_count: "MULTIPLE",
        allowed_currencies: ["USD"],
        transaction_limits: { ...usd, limits: [{ amount: 30, interval: "ALL_TIME" }] },
      },
      "probe-alltime",
    );
    const first = await auth(card.card_id, 20);
    await sleep(1500);
    const second = await auth(card.card_id, 20); // cumulative 40 > 30
    record("total_card_limit_all_time", { first_20: first, second_20_cumulative_40: second });
  }

  // 5. Expiry (active_to in the past)
  {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const card = await createCard(
      cardholderId,
      {
        allowed_transaction_count: "MULTIPLE",
        allowed_currencies: ["USD"],
        active_to: `${yesterday}T23:59:59Z`,
        transaction_limits: { ...usd, limits: [{ amount: 500, interval: "MONTHLY" }] },
      },
      "probe-expired",
    );
    const afterExpiry = await auth(card.card_id, 10);
    record("expiry_active_to", { expired_on: yesterday, auth_after_expiry: afterExpiry });
  }

  // 6. Single-use
  {
    const card = await createCard(
      cardholderId,
      {
        allowed_transaction_count: "SINGLE",
        allowed_currencies: ["USD"],
        transaction_limits: { ...usd, limits: [{ amount: 500, interval: "PER_TRANSACTION" }] },
      },
      "probe-single",
    );
    const first = await auth(card.card_id, 10);
    const second = await auth(card.card_id, 10);
    record("single_use", { first: first, second: second });
  }

  // 7. Freeze (INACTIVE) then reactivate
  {
    const card = await createCard(
      cardholderId,
      {
        allowed_transaction_count: "MULTIPLE",
        allowed_currencies: ["USD"],
        transaction_limits: { ...usd, limits: [{ amount: 500, interval: "MONTHLY" }] },
      },
      "probe-freeze",
    );
    const before = await auth(card.card_id, 10);
    const freeze = await awx(`/api/v1/issuing/cards/${card.card_id}/update`, {
      method: "POST",
      body: { card_status: "INACTIVE" },
    });
    await sleep(1000);
    const whileFrozen = await auth(card.card_id, 10);
    const unfreeze = await awx(`/api/v1/issuing/cards/${card.card_id}/update`, {
      method: "POST",
      body: { card_status: "ACTIVE" },
    });
    await sleep(1000);
    const afterUnfreeze = await auth(card.card_id, 10);
    record("freeze_inactive", {
      before,
      freeze_http: freeze.status,
      while_frozen: whileFrozen,
      unfreeze_http: unfreeze.status,
      after_unfreeze: afterUnfreeze,
    });
  }

  // 8. Cancel (CLOSED)
  {
    const card = await createCard(
      cardholderId,
      {
        allowed_transaction_count: "MULTIPLE",
        allowed_currencies: ["USD"],
        transaction_limits: { ...usd, limits: [{ amount: 500, interval: "MONTHLY" }] },
      },
      "probe-cancel",
    );
    const cancel = await awx(`/api/v1/issuing/cards/${card.card_id}/update`, {
      method: "POST",
      body: { card_status: "CLOSED" },
    });
    await sleep(1000);
    const afterCancel = await auth(card.card_id, 10);
    record("cancel_closed", { cancel_http: cancel.status, auth_after_cancel: afterCancel });
  }

  console.log("\n\n===== PROBE COMPLETE =====");
}

main().catch((e) => {
  console.error("PROBE ERROR:", e.message);
  process.exit(1);
});
