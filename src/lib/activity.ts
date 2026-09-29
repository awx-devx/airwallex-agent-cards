/**
 * Aggregates a unified "recent activity" feed from Airwallex: agent card
 * charges, FX conversions, deposits/top-ups, and card lifecycle events. Each
 * source is fetched independently (allSettled) so one failing source doesn't
 * blank the whole feed. Server-only.
 */
import {
  listCardsSlim,
  listAllCardTransactions,
  listConversions,
  listDeposits,
  listPaymentIntents,
  type Card,
} from "@/lib/airwallex";
import { readStore } from "@/lib/store";
import { merchantLabel, shortAgentName } from "@/lib/labels";
import type { ActivityEvent } from "@/lib/activityTypes";

export type { ActivityEvent, ActivityType } from "@/lib/activityTypes";

function toTs(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

// ── Server-side stale-while-revalidate cache ──────────────────────────────
// The Airwallex sandbox can take 5-10 s per call. We cache the last result
// and serve it immediately on repeat requests while refreshing in the background.
const CACHE_TTL_MS = 30_000;
let _activityCache: { events: ActivityEvent[]; ts: number } | null = null;
let _activityRefreshing: Promise<ActivityEvent[]> | null = null;

const ACTIVITY_KV_KEY = "activity-cache.json";

type KvBinding = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

async function getKv(): Promise<KvBinding | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    const env = ctx?.env as { DEMO_STORE?: KvBinding } | undefined;
    return env?.DEMO_STORE ?? null;
  } catch {
    return null;
  }
}

async function readPersistedCache(): Promise<ActivityEvent[] | null> {
  const kv = await getKv();
  if (!kv) return null;
  try {
    const raw = await kv.get(ACTIVITY_KV_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { events?: ActivityEvent[]; ts?: number };
    if (!Array.isArray(parsed.events)) return null;
    return parsed.events;
  } catch {
    return null;
  }
}

async function writePersistedCache(events: ActivityEvent[]): Promise<void> {
  const kv = await getKv();
  if (!kv) return;
  try {
    await kv.put(
      ACTIVITY_KV_KEY,
      JSON.stringify({ events, ts: Date.now() }),
      { expirationTtl: 300 },
    );
  } catch {
    // non-fatal
  }
}

export function invalidateActivityCache() {
  _activityCache = null;
}

function ledgerEvents(ledger: Awaited<ReturnType<typeof readStore>>["taskLedger"]): ActivityEvent[] {
  return ledger.map((entry) => ({
    id: `txn-${entry.txn_id || entry.task_id}`,
    ts: toTs(entry.created_at),
    type: "card_charge" as const,
    title: `${shortAgentName(undefined, entry.agent_id)} · ${entry.merchant || "purchase"}`,
    subtitle: entry.mcc ? merchantLabel(entry.mcc) : entry.task_id,
    amount: entry.amount,
    currency: entry.currency,
    direction: "out" as const,
    status: entry.status,
    agent_id: entry.agent_id,
  }));
}

/** Instant feed from the local task ledger — no Airwallex round trip. */
export async function getLocalActivity(): Promise<ActivityEvent[]> {
  try {
    const events = ledgerEvents((await readStore()).taskLedger);
    return events.sort((a, b) => b.ts - a.ts).slice(0, 100);
  } catch {
    return [];
  }
}

export async function getActivity(): Promise<ActivityEvent[]> {
  const now = Date.now();
  // Fresh cache — return immediately.
  if (_activityCache && now - _activityCache.ts < CACHE_TTL_MS) {
    return _activityCache.events;
  }
  // Stale in-process cache — return stale data now and refresh in the background.
  if (_activityCache && !_activityRefreshing) {
    _activityRefreshing = _fetchActivity()
      .then((events) => { _activityCache = { events, ts: Date.now() }; void writePersistedCache(events); return events; })
      .catch(() => _activityCache!.events)
      .finally(() => { _activityRefreshing = null; });
    return _activityCache.events;
  }
  // Cold isolate: serve last KV snapshot immediately, refresh behind it.
  if (!_activityCache) {
    const persisted = await readPersistedCache();
    if (persisted) {
      _activityCache = { events: persisted, ts: 0 };
    }
  }
  if (_activityCache && !_activityRefreshing) {
    _activityRefreshing = _fetchActivity()
      .then((events) => { _activityCache = { events, ts: Date.now() }; void writePersistedCache(events); return events; })
      .catch(() => _activityCache!.events)
      .finally(() => { _activityRefreshing = null; });
    return _activityCache.events;
  }
  // First request on a cold isolate: return the local ledger now so the UI
  // is never blocked on Airwallex, then fill in sandbox events behind it.
  if (!_activityRefreshing) {
    _activityRefreshing = _fetchActivity()
      .then((events) => { _activityCache = { events, ts: Date.now() }; void writePersistedCache(events); return events; })
      .finally(() => { _activityRefreshing = null; });
  }
  const local = await getLocalActivity();
  if (local.length) {
    _activityCache = { events: local, ts: 0 };
    return local;
  }
  return _activityRefreshing;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function _fetchActivity(): Promise<ActivityEvent[]> {
  const [cardsR, txnsR, fxR, depR, piR] = await Promise.allSettled([
    withTimeout(listCardsSlim(), 8_000, "cards"),
    withTimeout(listAllCardTransactions(50), 8_000, "txns"),
    withTimeout(listConversions(), 8_000, "fx"),
    withTimeout(listDeposits(), 8_000, "deposits"),
    withTimeout(listPaymentIntents(), 8_000, "topups"),
  ]);

  // Log any sources that failed so problems surface in server logs.
  const sources = { cards: cardsR, txns: txnsR, fx: fxR, deposits: depR, paymentIntents: piR };
  for (const [name, r] of Object.entries(sources)) {
    if (r.status === "rejected") {
      console.error(`[activity] ${name} fetch failed:`, r.reason);
    }
  }

  const cards: Card[] = cardsR.status === "fulfilled" ? cardsR.value : [];
  const cardById = new Map(cards.map((c) => [c.card_id, c]));
  const events: ActivityEvent[] = [];

  // Agent card charges
  if (txnsR.status === "fulfilled") {
    for (const t of txnsR.value) {
      const card = t.card_id ? cardById.get(t.card_id) : undefined;
      const agent = card?.metadata?.agent_id;
      const amt = t.billing_amount ?? t.transaction_amount;
      events.push({
        id: `txn-${t.transaction_id || Math.random()}`,
        ts: toTs(
          (t as { created_at?: unknown; posted_date?: unknown; transaction_date?: unknown })
            .created_at ??
            (t as { posted_date?: unknown }).posted_date ??
            (t as { transaction_date?: unknown }).transaction_date,
        ),
        type: "card_charge",
        title: `${shortAgentName(undefined, agent) || card?.nick_name || "Card"} · ${t.merchant?.name?.trim() || "purchase"}`,
        subtitle: card?.card_number ? `card ${card.card_number.slice(-4)}` : undefined,
        amount: amt != null ? Math.abs(amt) : undefined,
        currency: t.billing_currency || t.transaction_currency,
        direction: "out",
        status: t.status,
        agent_id: agent,
      });
    }
  }

  // FX conversions
  if (fxR.status === "fulfilled") {
    for (const c of fxR.value) {
      events.push({
        id: `fx-${c.conversion_id}`,
        ts: toTs(c.created_at),
        type: "fx",
        title: "FX conversion",
        subtitle: `Sold ${c.sell_amount} ${c.sell_currency} → ${c.buy_amount} ${c.buy_currency} @ ${c.client_rate}`,
        status: c.status,
      });
    }
  }

  // Deposits — fall back to now() if the API returns no timestamp (sandbox simulation)
  const nowMs = Date.now();
  if (depR.status === "fulfilled") {
    for (const d of depR.value) {
      events.push({
        id: `dep-${d.id || Math.random()}`,
        ts: toTs(d.create_time ?? d.created_at) || nowMs,
        type: "deposit",
        title: "Deposit",
        subtitle: d.payer?.name || d.reference || "inbound funds",
        amount: d.amount,
        currency: d.currency,
        direction: "in",
        status: d.status,
      });
    }
  }

  // Top-ups (Payments)
  if (piR.status === "fulfilled") {
    for (const p of piR.value) {
      events.push({
        id: `pi-${p.id || Math.random()}`,
        ts: toTs(p.created_at),
        type: "topup",
        title: "Top-up (Payments)",
        subtitle: p.id,
        amount: p.amount,
        currency: p.currency,
        direction: "in",
        status: p.status,
      });
    }
  }

  // Card lifecycle (issued + non-active status changes)
  for (const c of cards) {
    const agent = c.metadata?.agent_id;
    events.push({
      id: `card-issued-${c.card_id}`,
      ts: toTs(c.created_at),
      type: "card_lifecycle",
      title: `Card issued · ${shortAgentName(undefined, agent) || c.nick_name || "card"}`,
      subtitle: c.card_number ? `card ${c.card_number.slice(-4)}` : undefined,
      status: c.card_status,
      agent_id: agent,
    });
    if (c.card_status && c.card_status !== "ACTIVE") {
      const label = c.card_status === "INACTIVE" ? "frozen" : c.card_status.toLowerCase();
      events.push({
        id: `card-status-${c.card_id}`,
        ts: toTs((c as { updated_at?: unknown }).updated_at ?? c.created_at),
        type: "card_lifecycle",
        title: `Card ${label} · ${shortAgentName(undefined, agent) || c.nick_name || "card"}`,
        status: c.card_status,
        agent_id: agent,
      });
    }
  }

  // Task ledger — local record of every card charge (UI simulations + MCP agent charges).
  // Sandbox transactions appear in GET /issuing/transactions but stay PENDING permanently.
  // Local ledger carries agent identity and task metadata the Airwallex object does not.
  // Deduplicate against any Airwallex txn_ids already in the feed.
  const awxTxnIds = new Set(events.filter((e) => e.type === "card_charge").map((e) => e.id));
  try {
    for (const entry of ledgerEvents((await readStore()).taskLedger)) {
      if (awxTxnIds.has(entry.id)) continue;
      events.push(entry);
    }
  } catch {
    // non-fatal — store read failure shouldn't blank the feed
  }

  return events.sort((a, b) => b.ts - a.ts).slice(0, 100);
}
