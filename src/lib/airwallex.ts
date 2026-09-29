/**
 * Server-side Airwallex API client for the DEMO / sandbox environment.
 *
 * Auth flow (Airwallex):
 *   POST /api/v1/authentication/login  with headers x-client-id + x-api-key
 *   → { token, expires_at }.  The bearer token is then used for all calls.
 *
 * The token is cached in-process and refreshed a minute before expiry.
 *
 * This module must only be imported from server code (API routes / server
 * components). It reads AIRWALLEX_CLIENT_ID / AIRWALLEX_API_KEY from the env.
 */

import { randomUUID } from "crypto";
import { AIRWALLEX_BASE_URL } from "./config";

let cachedToken: { token: string; expiresAt: number } | null = null;

export class AirwallexError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "AirwallexError";
    this.status = status;
    this.body = body;
  }
}

function requireCreds(): { clientId: string; apiKey: string } {
  const clientId = process.env.AIRWALLEX_CLIENT_ID;
  const apiKey = process.env.AIRWALLEX_API_KEY;
  if (!clientId || !apiKey) {
    throw new AirwallexError(
      "Missing AIRWALLEX_CLIENT_ID / AIRWALLEX_API_KEY. Copy .env.local.example to .env.local and fill in your demo credentials.",
      500,
      null,
    );
  }
  return { clientId, apiKey };
}

async function authenticate(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60_000) {
    return cachedToken.token;
  }
  const { clientId, apiKey } = requireCreds();
  const res = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/authentication/login`, {
    method: "POST",
    headers: {
      "x-client-id": clientId,
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new AirwallexError(
      `Airwallex authentication failed (${res.status})`,
      res.status,
      safeJson(text),
    );
  }
  const data = safeJson(text) as { token: string; expires_at: string };
  cachedToken = {
    token: data.token,
    expiresAt: data.expires_at ? new Date(data.expires_at).getTime() : Date.now() + 25 * 60_000,
  };
  return data.token;
}

function safeJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/** Low-level authenticated request against the Airwallex demo API. */
export async function awxFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await authenticate();
  const res = await fetch(`${AIRWALLEX_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  const json = safeJson(text);
  if (!res.ok) {
    throw new AirwallexError(
      `Airwallex ${init.method || "GET"} ${path} failed (${res.status})`,
      res.status,
      json,
    );
  }
  return json as T;
}

// ── Types ───────────────────────────────────────────────────────────────

export interface Balance {
  currency: string;
  available_amount: number;
  total_amount: number;
  reserved_amount?: number;
  pending_amount?: number;
  account_type?: string; // cash | yield | credit
}

export interface Card {
  card_id: string;
  nick_name?: string;
  card_status: string;
  card_number?: string; // masked, e.g. **** 1234
  form_factor?: string;
  created_by?: string;
  authorization_controls?: {
    allowed_transaction_count?: "SINGLE" | "MULTIPLE";
    allowed_currencies?: string[];
    // Per the 2024-03-31 issuing revamp, limits live under transaction_limits.
    transaction_limits?: {
      currency?: string;
      limits?: { amount: number; interval: string }[];
    };
    allowed_merchant_categories?: string[];
    active_from?: string;
    active_to?: string; // authorizations after this time are rejected (expiry)
  };
  // Agent attribution — which agent/project this card belongs to.
  metadata?: Record<string, string>;
  created_at?: string;
}

export interface PaymentIntent {
  id: string;
  client_secret: string;
  amount: number;
  currency: string;
  status: string;
}

// ── Balances (Feature 2) ──────────────────────────────────────────────────

export async function getBalances(): Promise<Balance[]> {
  // Airwallex exposes current balances at /api/v1/balances/current.
  // (The docs shorthand "GET /api/v1/balances" resolves here.)
  return awxFetch<Balance[]>("/api/v1/balances/current");
}

// ── Cardholders (needed to issue cards) ────────────────────────────────────

interface Cardholder {
  cardholder_id: string;
  email?: string;
  type?: string;
  status?: string; // INCOMPLETE | PENDING | READY | DISABLED | DELETED
}

const DEMO_CARDHOLDER_EMAIL =
  process.env.AIRWALLEX_CARDHOLDER_EMAIL || "treasury-demo@example.com";

async function resolveCardholderId(): Promise<string> {
  const fromEnv = process.env.AIRWALLEX_CARDHOLDER_ID;
  if (fromEnv) return fromEnv;

  // Reuse an existing cardholder, preferring one that is READY to be issued
  // cards (a freshly created cardholder can sit in PENDING while it is screened).
  const list = await awxFetch<{ items: Cardholder[] }>(
    "/api/v1/issuing/cardholders?page_size=100",
  );
  const items = list.items || [];
  const ready = items.find((c) => c.status === "READY");
  if (ready) return ready.cardholder_id;
  if (items.length > 0) return items[0].cardholder_id;

  // Otherwise create a demo DELEGATE cardholder (company-name card). A DELEGATE
  // only requires an email; cards issued to it carry the business name.
  const created = await awxFetch<Cardholder>(
    "/api/v1/issuing/cardholders/create",
    {
      method: "POST",
      body: JSON.stringify({
        type: "DELEGATE",
        email: DEMO_CARDHOLDER_EMAIL,
      }),
    },
  );
  return created.cardholder_id;
}

// ── Cards (Feature 4) ──────────────────────────────────────────────────────

const CARD_LIST_PAGE_SIZE = 200;
const CARD_LIST_MAX_PAGES = 20;
const CARD_LIST_CACHE_MS = 15_000;

let _cardListCache: { cards: Card[]; ts: number } | null = null;

export function invalidateCardListCache() {
  _cardListCache = null;
}

/** Paginate GET /issuing/cards. Optional status filter (ACTIVE / INACTIVE / CLOSED). */
async function fetchCardPages(cardStatus?: string): Promise<Card[]> {
  const items: Card[] = [];
  for (let page = 0; page < CARD_LIST_MAX_PAGES; page++) {
    const qs = new URLSearchParams({
      page_size: String(CARD_LIST_PAGE_SIZE),
      page_num: String(page),
    });
    if (cardStatus) qs.set("card_status", cardStatus);
    const res = await awxFetch<{ items?: Card[] }>(`/api/v1/issuing/cards?${qs.toString()}`);
    const batch = res.items || [];
    items.push(...batch);
    if (batch.length < CARD_LIST_PAGE_SIZE) break;
  }
  return items;
}

/**
 * List cards. The Issuing list endpoint pages at `page_size` (max 200) and
 * the unfiltered call is oldest-first — a single page of 100 CLOSED cards
 * hid every newly issued ACTIVE card. We always fetch ACTIVE + INACTIVE by
 * status filter, then merge any extra pages from the unfiltered list.
 */
/** Paginated list only — no per-card detail fetch. Safe for activity/home. */
export async function listCardsSlim(): Promise<Card[]> {
  const [active, inactive] = await Promise.all([
    fetchCardPages("ACTIVE"),
    fetchCardPages("INACTIVE"),
  ]);
  const seen = new Set<string>();
  const items: Card[] = [];
  for (const c of [...active, ...inactive]) {
    if (!c.card_id || seen.has(c.card_id)) continue;
    seen.add(c.card_id);
    items.push(c);
  }
  return items;
}

export async function listCards(): Promise<Card[]> {
  if (_cardListCache && Date.now() - _cardListCache.ts < CARD_LIST_CACHE_MS) {
    return _cardListCache.cards;
  }
  const [active, inactive, rest] = await Promise.all([
    fetchCardPages("ACTIVE"),
    fetchCardPages("INACTIVE"),
    fetchCardPages(),
  ]);
  const seen = new Set<string>();
  const items: Card[] = [];
  for (const c of [...active, ...inactive, ...rest]) {
    if (!c.card_id || seen.has(c.card_id)) continue;
    seen.add(c.card_id);
    items.push(c);
  }
  // The list endpoint returns a slim card object without authorization_controls or metadata.
  // Fetch full details for live cards so metadata (agent_id, project_id) is always present.
  const cards = await Promise.all(
    items.map(async (c) => {
      if (c.card_status === "CLOSED") return c;
      try {
        return await awxFetch<Card>(`/api/v1/issuing/cards/${c.card_id}`);
      } catch {
        return c;
      }
    }),
  );
  _cardListCache = { cards, ts: Date.now() };
  return cards;
}

export interface CreateCardOptions {
  /** Single-use cards set allowed_transaction_count = SINGLE. */
  singleUse: boolean;
  /** Spending limit amount (per-transaction for single-use, else per-month). */
  limitAmount: number;
  currency: string;
  /** Agent attribution — both required so every card rolls up to an agent+project. */
  agentId: string;
  projectId: string;
  /** Optional expiry date (YYYY-MM-DD) → authorization_controls.active_to (end of day). */
  expiresOn?: string;
  /** Optional precise expiry (ISO datetime) → active_to. Overrides expiresOn. For scoped/ephemeral cards. */
  activeTo?: string;
  /** Optional MCC allowlist → authorization_controls.allowed_merchant_categories. */
  allowedMerchantCategories?: string[];
  /** Optional task attribution → card metadata.task_id (for scoped per-task cards). */
  taskId?: string;
  nickName?: string;
}

export async function createCard(opts: CreateCardOptions): Promise<Card> {
  const cardholderId = await resolveCardholderId();
  // Single-use → a per-transaction cap; multi-use → a monthly cap.
  // interval enum: PER_TRANSACTION | DAILY | WEEKLY | MONTHLY | ALL_TIME.
  const interval = opts.singleUse ? "PER_TRANSACTION" : "MONTHLY";

  const authorization_controls: Record<string, unknown> = {
    allowed_transaction_count: opts.singleUse ? "SINGLE" : "MULTIPLE",
    allowed_currencies: [opts.currency],
    transaction_limits: {
      currency: opts.currency,
      limits: [{ amount: opts.limitAmount, interval }],
    },
  };
  // Expiry: precise datetime (scoped/ephemeral cards) takes precedence, else end of day.
  if (opts.activeTo) authorization_controls.active_to = opts.activeTo;
  else if (opts.expiresOn) authorization_controls.active_to = `${opts.expiresOn}T23:59:59Z`;
  // MCC allowlist: only these merchant categories are permitted.
  if (opts.allowedMerchantCategories?.length) {
    authorization_controls.allowed_merchant_categories = opts.allowedMerchantCategories;
  }

  const metadata: Record<string, string> = {
    agent_id: opts.agentId,
    project_id: opts.projectId,
  };
  if (opts.taskId) metadata.task_id = opts.taskId;

  const body = {
    request_id: randomUUID(),
    created_by: "Treasury Demo",
    cardholder_id: cardholderId,
    form_factor: "VIRTUAL", // Company Virtual card
    is_personalized: false,
    program: { purpose: "COMMERCIAL" },
    nick_name: opts.nickName || `${opts.agentId} card`,
    // Agent/project/task attribution lives in card metadata (the durable identity;
    // a card is a disposable instrument, single-use ones close after one use).
    metadata,
    authorization_controls,
  };

  const card = await awxFetch<Card>("/api/v1/issuing/cards/create", {
    method: "POST",
    body: JSON.stringify(body),
  });
  invalidateCardListCache();
  return card;
}

// ── Agent economy: group cards by agent + per-card spend ─────────────────────

export interface AgentCard extends Card {
  spent: number;
}
export interface AgentGroup {
  agentId: string;
  projectId: string;
  currency: string;
  cardCount: number;
  totalSpent: number;
  cards: AgentCard[];
}

/** Sum settled/authorized spend on a card (declines/reversals excluded). */
function sumSpend(txns: CardTransaction[]): number {
  const counted = new Set(["CLEARED", "AUTHORIZED", "SETTLED", "APPROVED", "PENDING"]);
  return txns.reduce((acc, t) => {
    if (t.status && !counted.has(t.status)) return acc;
    const amt = Math.abs(t.billing_amount ?? t.transaction_amount ?? 0);
    return acc + amt;
  }, 0);
}

export async function getAgentEconomy(): Promise<{
  agents: AgentGroup[];
  untagged: AgentCard[];
}> {
  const cards = await listCards();
  // Enrich each card with its spend. Skip closed/inactive cards — they can't
  // be charged and their historical transactions don't affect live economy.
  const enriched: AgentCard[] = await Promise.all(
    cards.map(async (c) => {
      if (c.card_status !== "ACTIVE") return { ...c, spent: 0 };
      let spent = 0;
      try {
        spent = sumSpend(await listCardTransactions(c.card_id));
      } catch {
        spent = 0;
      }
      return { ...c, spent };
    }),
  );

  const groups = new Map<string, AgentGroup>();
  const untagged: AgentCard[] = [];
  for (const c of enriched) {
    const agentId = c.metadata?.agent_id;
    const projectId = c.metadata?.project_id || "—";
    const currency = c.authorization_controls?.transaction_limits?.currency || "USD";
    if (!agentId) {
      if (c.card_status !== "CLOSED") untagged.push(c);
      continue;
    }
    const g =
      groups.get(agentId) ||
      { agentId, projectId, currency, cardCount: 0, totalSpent: 0, cards: [] };
    g.cards.push(c);
    g.cardCount += 1;
    g.totalSpent += c.spent;
    groups.set(agentId, g);
  }
  return {
    agents: Array.from(groups.values()).sort((a, b) => b.totalSpent - a.totalSpent),
    untagged,
  };
}

// ── Payment Intents / Top-up (Feature 3) ────────────────────────────────────

export async function createPaymentIntent(
  amount: number,
  currency: string,
): Promise<PaymentIntent> {
  const body = {
    request_id: randomUUID(),
    merchant_order_id: `topup-${Date.now()}`,
    amount,
    currency,
    descriptor: "Treasury demo top-up",
  };
  return awxFetch<PaymentIntent>("/api/v1/pa/payment_intents/create", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Account info / domestic currency ────────────────────────────────────────

// Home currency for a business, derived from its country of incorporation.
const COUNTRY_TO_CURRENCY: Record<string, string> = {
  US: "USD", GB: "GBP", HK: "HKD", SG: "SGD", AU: "AUD", CA: "CAD",
  JP: "JPY", CN: "CNY", NZ: "NZD", CH: "CHF",
  DE: "EUR", FR: "EUR", NL: "EUR", IE: "EUR", ES: "EUR", IT: "EUR",
};

export function currencyForCountry(countryCode: string): string {
  return COUNTRY_TO_CURRENCY[countryCode?.toUpperCase()] || "USD";
}

export interface AccountInfo {
  businessName: string;
  countryCode: string;
  domesticCurrency: string;
}

export async function getAccountInfo(): Promise<AccountInfo> {
  const acct = await awxFetch<{
    account_details?: {
      business_details?: {
        business_name?: string;
        business_address?: { country_code?: string };
      };
    };
  }>("/api/v1/account");
  const biz = acct.account_details?.business_details;
  const countryCode = biz?.business_address?.country_code || "US";
  return {
    businessName: biz?.business_name || "Your business",
    countryCode,
    domesticCurrency: currencyForCountry(countryCode),
  };
}

// ── Global Accounts (domestic account + add currency accounts) ───────────────

export interface GlobalAccount {
  id: string;
  nickName?: string;
  accountName?: string;
  currency: string;
  countryCode: string;
  status: string; // ACTIVE | PROCESSING | CLOSED | FAILED
  accountNumber?: string;
  iban?: string;
  swiftCode?: string;
  accountType?: string;
  institutionName?: string;
  routingCodes: { type: string; value: string }[];
  /** All currencies this account can receive (multi-currency GAs support many). */
  supportedCurrencies: string[];
}

interface RawGlobalAccount {
  id: string;
  nick_name?: string;
  account_name?: string;
  country_code: string;
  status: string;
  account_number?: string;
  iban?: string;
  swift_code?: string;
  account_type?: string;
  institution?: { name?: string };
  required_features?: { currency: string; transfer_method?: string }[];
  supported_features?: {
    currency: string;
    routing_codes?: { type: string; value: string }[];
  }[];
}

function parseGlobalAccount(ga: RawGlobalAccount): GlobalAccount {
  // Prefer the LOCAL currency as the account's primary (a multi-currency GA
  // lists many SWIFT currencies but is anchored to one local currency).
  const localFeature = ga.required_features?.find(
    (f) => f.transfer_method === "LOCAL",
  );
  const currency =
    localFeature?.currency ||
    ga.required_features?.[0]?.currency ||
    ga.supported_features?.[0]?.currency ||
    "";
  const supportedCurrencies = Array.from(
    new Set((ga.supported_features || []).map((f) => f.currency).filter(Boolean)),
  );
  // Collect unique routing codes across supported features.
  const seen = new Set<string>();
  const routingCodes: { type: string; value: string }[] = [];
  for (const f of ga.supported_features || []) {
    for (const rc of f.routing_codes || []) {
      const key = `${rc.type}:${rc.value}`;
      if (rc.value && rc.value !== "-" && !seen.has(key)) {
        seen.add(key);
        routingCodes.push(rc);
      }
    }
  }
  return {
    id: ga.id,
    nickName: ga.nick_name,
    accountName: ga.account_name,
    currency,
    countryCode: ga.country_code,
    status: ga.status,
    accountNumber: ga.account_number && ga.account_number !== "-" ? ga.account_number : undefined,
    iban: ga.iban,
    swiftCode: ga.swift_code,
    accountType: ga.account_type,
    institutionName: ga.institution?.name,
    routingCodes,
    supportedCurrencies,
  };
}

export async function listGlobalAccounts(): Promise<GlobalAccount[]> {
  const res = await awxFetch<{ items: RawGlobalAccount[] }>(
    "/api/v1/global_accounts?page_size=100",
  );
  return (res.items || []).map(parseGlobalAccount);
}

export async function createGlobalAccount(opts: {
  countryCode: string;
  currency: string;
  transferMethod?: "LOCAL" | "SWIFT";
  nickName?: string;
}): Promise<GlobalAccount> {
  const body = {
    request_id: randomUUID(),
    country_code: opts.countryCode,
    nick_name: opts.nickName || `${opts.currency} Global Account`,
    required_features: [
      { currency: opts.currency, transfer_method: opts.transferMethod || "LOCAL" },
    ],
  };
  const ga = await awxFetch<RawGlobalAccount>("/api/v1/global_accounts/create", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return parseGlobalAccount(ga);
}

// ── Sandbox: simulate an inbound deposit (funds a wallet balance) ────────────

export interface SimulatedDeposit {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export async function simulateDeposit(opts: {
  globalAccountId: string;
  amount: number;
}): Promise<SimulatedDeposit> {
  // Sandbox-only. A settled deposit into a Global Account credits the wallet
  // balance in that account's currency — this is how funds enter the wallet.
  return awxFetch<SimulatedDeposit>("/api/v1/simulation/deposit/create", {
    method: "POST",
    body: JSON.stringify({
      global_account_id: opts.globalAccountId,
      amount: opts.amount,
      status: "SETTLED",
      payer_name: "Demo Payer",
      reference: "Simulated inbound deposit",
    }),
  });
}

// ── Sandbox: simulate a card transaction (agentic card spend) ────────────────

// Simulation endpoint accepts any x-api-version; header is sent for observability.
const AIRWALLEX_API_VERSION = process.env.AIRWALLEX_API_VERSION || "2024-04-04";

export interface SimulatedCardTxn {
  transaction_id?: string;
  status?: string; // APPROVED | PENDING | FAILED
  failure_reason?: string;
  billing_amount?: number;
  billing_currency?: string;
  transaction_amount?: number;
  transaction_currency?: string;
  masked_card_number?: string;
  merchant?: { name?: string; category_code?: string; country?: string };
  transaction_type?: string;
}

export async function simulateCardTransaction(opts: {
  cardId: string;
  amount: number;
  currency: string;
  merchantInfo?: string;
  merchantCategoryCode?: string;
}): Promise<SimulatedCardTxn> {
  // single_phase=true authorizes AND clears in one step (a completed purchase).
  return awxFetch<SimulatedCardTxn>("/api/v1/simulation/issuing/create", {
    method: "POST",
    headers: { "x-api-version": AIRWALLEX_API_VERSION },
    body: JSON.stringify({
      card_id: opts.cardId,
      transaction_amount: opts.amount,
      transaction_currency: opts.currency,
      single_phase: true,
      merchant_info: opts.merchantInfo || "Agent Purchase",
      merchant_category_code: opts.merchantCategoryCode || "5734",
    }),
  });
}

// ── Sensitive card details (reveal PAN/CVV/expiry) ───────────────────────────
// Sandbox returns test card numbers. In production you'd use Airwallex's
// PCI-compliant reveal (network token / hosted card-details component) instead
// of returning the raw PAN through your own server.

export interface CardDetails {
  card_number: string;
  cvv: string;
  expiry_month: number;
  expiry_year: number;
  name_on_card: string;
}

export async function getCardDetails(cardId: string): Promise<CardDetails> {
  // Only ACTIVE cards return details.
  return awxFetch<CardDetails>(
    `/api/v1/issuing/cards/${encodeURIComponent(cardId)}/details`,
  );
}

export interface CardTransaction {
  transaction_id?: string;
  status?: string;
  billing_amount?: number;
  billing_currency?: string;
  transaction_amount?: number;
  transaction_currency?: string;
  merchant?: { name?: string };
  transaction_type?: string;
  created_at?: string;
}

export async function listCardTransactions(cardId: string): Promise<CardTransaction[]> {
  const res = await awxFetch<{ items: CardTransaction[] }>(
    `/api/v1/issuing/transactions?card_id=${encodeURIComponent(cardId)}&page_size=20`,
    { headers: { "x-api-version": AIRWALLEX_API_VERSION } },
  );
  return res.items || [];
}

export async function listAllCardTransactions(pageSize = 50): Promise<
  (CardTransaction & { card_id?: string })[]
> {
  const res = await awxFetch<{ items: (CardTransaction & { card_id?: string })[] }>(
    `/api/v1/issuing/transactions?page_size=${pageSize}`,
    { headers: { "x-api-version": AIRWALLEX_API_VERSION } },
  );
  return res.items || [];
}

/** Freeze (INACTIVE), reactivate (ACTIVE) or cancel (CLOSED) a card. */
export async function updateCardStatus(
  cardId: string,
  status: "ACTIVE" | "INACTIVE" | "CLOSED",
): Promise<Card> {
  const card = await awxFetch<Card>(`/api/v1/issuing/cards/${encodeURIComponent(cardId)}/update`, {
    method: "POST",
    body: JSON.stringify({ card_status: status }),
  });
  invalidateCardListCache();
  return card;
}

// ── FX conversion (move funds between your own wallet currencies) ────────────

export interface Conversion {
  conversion_id: string;
  buy_currency: string;
  buy_amount: number;
  sell_currency: string;
  sell_amount: number;
  client_rate: number;
  currency_pair: string;
  status: string; // SCHEDULED | SETTLED | CANCELLED | OVERDUE
  created_at?: string;
}

export async function listConversions(): Promise<Conversion[]> {
  const res = await awxFetch<{ items: Conversion[] }>("/api/v1/fx/conversions?page_size=20");
  return res.items || [];
}

export interface Deposit {
  id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  create_time?: string;
  created_at?: string;
  payer?: { name?: string };
  reference?: string;
}

export async function listDeposits(): Promise<Deposit[]> {
  // /deposits requires BOTH page_num and page_size, and returns a bare array.
  const res = await awxFetch<Deposit[] | { items: Deposit[] }>(
    "/api/v1/deposits?page_num=0&page_size=20",
  );
  return Array.isArray(res) ? res : res.items || [];
}

export interface PaymentIntentSummary {
  id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  created_at?: string;
}

export async function listPaymentIntents(): Promise<PaymentIntentSummary[]> {
  const res = await awxFetch<{ items: PaymentIntentSummary[] }>(
    "/api/v1/pa/payment_intents?page_size=20",
  );
  return res.items || [];
}

/**
 * Create an FX conversion within the wallet: sell one currency, buy another.
 * Executed at the current market rate (no locked quote). Funds come from the
 * wallet by default. Specify exactly one of sellAmount / buyAmount (the dealt
 * side); Airwallex computes the other from the rate. This is intra-account
 * movement between your own balances — not a payout to a third party.
 */
export async function createConversion(opts: {
  sellCurrency: string;
  buyCurrency: string;
  sellAmount?: number;
  buyAmount?: number;
}): Promise<Conversion> {
  const body: Record<string, unknown> = {
    request_id: randomUUID(),
    sell_currency: opts.sellCurrency,
    buy_currency: opts.buyCurrency,
  };
  if (opts.sellAmount != null) body.sell_amount = String(opts.sellAmount);
  else if (opts.buyAmount != null) body.buy_amount = String(opts.buyAmount);
  return awxFetch<Conversion>("/api/v1/fx/conversions/create", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
