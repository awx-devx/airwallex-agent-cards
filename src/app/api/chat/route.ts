import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  getBalances,
  listCards,
  createPaymentIntent,
  listGlobalAccounts,
  createGlobalAccount,
  simulateDeposit,
  createConversion,
  getAgentEconomy,
  getCardDetails,
} from "@/lib/airwallex";
import { chargeCard } from "@/lib/merchant-simulator";
import { addLedgerEntry, readStore } from "@/lib/store";
import { getProduct } from "@/lib/demo-store";
import { invalidateActivityCache } from "@/lib/activity";
import { provisionCard, provisionScopedCard } from "@/lib/provision";
import { logMcp } from "@/mcp/log";
import { CLAUDE_MODEL, KNOWN_CURRENCIES, OPENABLE_ACCOUNTS, mccLabel } from "@/lib/config";
import { DEMO_PRODUCTS } from "@/lib/demo-store";
import { escalationLabel } from "@/lib/labels";

const OPENABLE_KNOWN_CURRENCIES = OPENABLE_ACCOUNTS.map((o) => o.currency);

// The Workers bundle resolves the SDK to its Node shim, which opens sockets
// through node-fetch. Those fail in workerd. Call the runtime fetch instead,
// and drop the Node agent the SDK still attaches to the request.
const workersFetch: typeof fetch = (input, init) => {
  if (init && "agent" in init) {
    const { agent: _agent, ...rest } = init as RequestInit & { agent?: unknown };
    return fetch(input, rest);
  }
  return fetch(input, init);
};

const tools: Anthropic.Tool[] = [
  {
    name: "get_balances",
    description:
      "Get current wallet balances. Optionally filter to a single currency.",
    input_schema: {
      type: "object",
      properties: {
        currency: { type: "string", enum: KNOWN_CURRENCIES, description: "ISO currency code to filter to." },
      },
    },
  },
  {
    name: "list_cards",
    description: "List existing virtual cards and their spending limits.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "provision_card",
    description:
      "Issue a general-purpose virtual card for an agent (human-admin action). Use only when a human is manually provisioning a standing card — NOT for autonomous agent task execution. For agent tasks, use provision_scoped_card instead.",
    input_schema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "Registered agent ID (e.g. 'procurement-agent'). Must exist in the policy store.",
        },
        single_use: {
          type: "boolean",
          description: "True for a single-use card (auto-closes after one purchase). Defaults to false.",
        },
      },
      required: ["agent_id"],
    },
  },
  {
    name: "provision_scoped_card",
    description:
      "Issue a scoped, ephemeral card for a single agent task — single-use, locked to one merchant category, expiring in 15 minutes. ALWAYS use this (never provision_card) when running an autonomous agent task. If the request exceeds policy (budget, velocity, per-transaction cap) or the agent is human_provisioned, the result will be { pending_approval: true, approval_id, reason, message } — this is NOT a failure, it means a human must approve it. Tell the user the approval_id and direct them to /approvals.",
    input_schema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "Registered agent ID.",
        },
        task_id: {
          type: "string",
          description: "Unique task identifier for cost tracking (e.g. 'task-vercel-renewal').",
        },
        merchant_category: {
          type: "string",
          description: "MCC to lock the card to. Must be in the agent's policy allowlist. Common codes: 5734 Software, 7372 SaaS/Cloud, 7311 Advertising, 4511 Travel.",
        },
        amount: {
          type: "number",
          description: "Requested spend amount (clamped to policy per-transaction cap).",
        },
        expires_in_minutes: {
          type: "number",
          description: "Card TTL in minutes (default 15).",
        },
      },
      required: ["agent_id", "task_id", "merchant_category"],
    },
  },
  {
    name: "reveal_card",
    description:
      "Reveal an active card's full number, CVV and expiry (sandbox test details). Identify the card by agent id, nickname substring, or 'single_use' / 'multi_use'.",
    input_schema: {
      type: "object",
      properties: {
        card: {
          type: "string",
          description: "Agent id, nickname substring, or 'single_use' / 'multi_use'.",
        },
      },
    },
  },
  {
    name: "agent_report",
    description:
      "Report spend across the agent economy: each agent, its project, card count, and total spent.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_topup",
    description:
      "Create a PaymentIntent to top up a wallet. Returns a payment intent the user must complete on the Hosted Payment Page.",
    input_schema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Amount in major currency units." },
        currency: { type: "string", enum: KNOWN_CURRENCIES },
      },
      required: ["amount", "currency"],
    },
  },
  {
    name: "list_accounts",
    description: "List Global Accounts — local bank accounts (account number/IBAN/SWIFT) that receive money in each currency.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "open_account",
    description: "Open a new Global Account so the customer can receive money in a new currency.",
    input_schema: {
      type: "object",
      properties: {
        currency: { type: "string", enum: OPENABLE_KNOWN_CURRENCIES, description: "Currency to open." },
      },
      required: ["currency"],
    },
  },
  {
    name: "simulate_deposit",
    description: "Simulate an inbound bank deposit (sandbox only). Funds settle into the wallet balance.",
    input_schema: {
      type: "object",
      properties: {
        currency: { type: "string", enum: KNOWN_CURRENCIES },
        amount: { type: "number", description: "Amount in major currency units." },
      },
      required: ["currency", "amount"],
    },
  },
  {
    name: "convert_currency",
    description:
      "Move funds between wallet currencies via FX conversion (e.g. 'move $10,000 from USD to HKD'). Intra-account movement.",
    input_schema: {
      type: "object",
      properties: {
        from_currency: { type: "string", enum: KNOWN_CURRENCIES },
        to_currency: { type: "string", enum: KNOWN_CURRENCIES },
        amount: { type: "number", description: "Sell amount in major units." },
      },
      required: ["from_currency", "to_currency", "amount"],
    },
  },
  {
    name: "simulate_purchase",
    description:
      "Simulate a card purchase (sandbox only). Provide card_id for the exact card (preferred in agent mode). Otherwise identify by agent_id, 'single_use', 'multi_use', or nickname. When the card has agent/task metadata the spend is automatically recorded to the task ledger.",
    input_schema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Purchase amount in major currency units." },
        card_id: {
          type: "string",
          description: "Exact card ID (from provision_scoped_card result). Use this in agent mode.",
        },
        card: {
          type: "string",
          description: "Fallback: 'single_use', 'multi_use', agent_id, or nickname substring.",
        },
        merchant_category: {
          type: "string",
          description: "MCC code (e.g. 5734). If the card has an allowlist and this isn't in it, the purchase is declined.",
        },
      },
      required: ["amount"],
    },
  },
  {
    name: "list_agents",
    description: "List registered agents and their policy details (budget, per-transaction cap, MCC allowlist, velocity limit).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_approvals",
    description: "List approval queue items. Use this to check for pending card requests or limit-increase requests that need human sign-off.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "approved", "denied"],
          description: "Filter by status. Omit to return all.",
        },
      },
    },
  },
  {
    name: "checkout_at_demo_store",
    description:
      "Complete a purchase at the Demo SaaS Marketplace using a provisioned agent card. Use this instead of simulate_purchase when running an agent task — it routes through the storefront merchant so the purchase is visible at /demo-store. Returns approved/declined with a receipt.",
    input_schema: {
      type: "object",
      properties: {
        card_id: {
          type: "string",
          description: "Card ID returned by provision_scoped_card.",
        },
        product: {
          type: "string",
          enum: DEMO_PRODUCTS.map((p) => p.id),
          description: "Product to purchase at the demo store.",
        },
      },
      required: ["card_id", "product"],
    },
  },
];

const SYSTEM = `You are the treasury assistant for an Airwallex demo app. You help manage a multi-currency treasury (Global Accounts, wallet balances, virtual cards, top-ups) AND act as a governed AI agent when asked to run tasks autonomously.

## Two modes

**Human admin mode** — the default. Answer questions, show balances, open accounts, manage cards.

**Agent task mode** — when the user asks you to act as a specific agent (e.g. "act as procurement-agent", "buy X for $Y"). In this mode:
- ALWAYS use provision_scoped_card (never provision_card). Pass the user-specified dollar amount as the "amount" field.
- Generate a descriptive task_id (e.g. "task-vercel-renewal"). Pick the correct MCC for the merchant type.
- Then call checkout_at_demo_store with the returned card_id and the matching product. This routes through the storefront so the purchase appears at /demo-store.
- After checkout_at_demo_store, tell the user the result and mention they can view the merchant receipt at: /demo-store
- The policy control plane enforces rules automatically — if refused (refused=true), explain the reason and stop.
- Do not ask for confirmation between steps; complete the task autonomously.

## Key concepts
- A Global Account is a real local bank account (account number/IBAN/SWIFT) used to RECEIVE money in a currency.
- A wallet balance is the money held. Funds arrive via Global Account deposit or top-up.
- provision_card / provision_scoped_card go through the policy control plane. If refused (refused=true), explain why and stop. If escalated (pending_approval=true), tell the user the approval_id, explain the reason, and direct them to /approvals to approve or deny it. After they approve, call list_approvals to find the card_result.card_id, then proceed with checkout_at_demo_store.

## Routing rules
- Balances/accounts/FX/top-up → direct API tools (get_balances, list_accounts, etc.)
- Card issuance → always provision_card or provision_scoped_card (never skipped)
- Agent task → provision_scoped_card → checkout_at_demo_store (in that order; use simulate_purchase only if no matching store product)
- "list agents / show policies" → list_agents
- "pending approvals / approval queue" → list_approvals (filter status: "pending")

## Amount parsing
- Amounts are in major currency units. "$500" = 500 USD, "1k" = 1000.
- Supported currencies: ${KNOWN_CURRENCIES.join(", ")}
- Openable account currencies: ${OPENABLE_KNOWN_CURRENCIES.join(", ")}

Be concise. Confirm what you did in one or two sentences. After completing an agent task, summarize: what was attempted, whether it was approved or refused, and the reason.`;

type ChatAction =
  | { type: "topup"; intent: { id: string; client_secret: string; amount: number; currency: string } }
  | { type: "issued"; last4?: string; cap?: number; currency?: string; merchant?: string; cardId?: string; receiptUrl?: string }
  | { type: "needs_approval"; reason: string; approvalId?: string }
  | { type: "blocked"; reason: string };

function pushProvisionOutcome(actions: ChatAction[], result: Record<string, unknown>) {
  if (result.pending_approval) {
    actions.push({
      type: "needs_approval",
      reason: escalationLabel(String(result.reason || "")),
      approvalId: result.approval_id ? String(result.approval_id) : undefined,
    });
    return;
  }
  if (result.refused) {
    actions.push({
      type: "blocked",
      reason: escalationLabel(String(result.reason || "")) || String(result.message || "Blocked by policy"),
    });
    return;
  }
  if (result.card_id) {
    const last4 = typeof result.card_number === "string"
      ? result.card_number.replace(/\D/g, "").slice(-4)
      : undefined;
    const limits = result.limits as { amount?: number }[] | undefined;
    actions.push({
      type: "issued",
      last4,
      cap: typeof result.card_limit === "number"
        ? result.card_limit
        : limits?.[0]?.amount,
      currency: result.currency ? String(result.currency) : undefined,
      merchant: result.merchant_category ? mccLabel(String(result.merchant_category)) : undefined,
      cardId: String(result.card_id),
    });
  }
}

const CHAT_LIMIT = 8;
const CHAT_GLOBAL_LIMIT = 80;
const CHAT_WINDOW_MS = 60 * 60 * 1000;

function recentHits(raw: string | null, now: number): number[] {
  if (!raw) return [];
  try {
    const hits = JSON.parse(raw);
    if (!Array.isArray(hits)) return [];
    return hits.filter((hit) => typeof hit === "number" && now - hit < CHAT_WINDOW_MS);
  } catch {
    return [];
  }
}

async function chatKv() {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    const env = ctx?.env as {
      DEMO_STORE?: {
        get(key: string): Promise<string | null>;
        put(key: string, value: string): Promise<void>;
      };
    } | undefined;
    return env?.DEMO_STORE ?? null;
  } catch {
    return null;
  }
}

async function chatLimit(ip: string): Promise<string | null> {
  const kv = await chatKv();
  if (!kv) return null;
  const now = Date.now();
  const ipKey = `chat-ip:${ip}`;
  const [ipRaw, globalRaw] = await Promise.all([kv.get(ipKey), kv.get("chat-global")]);
  const ipHits = recentHits(ipRaw, now);
  const globalHits = recentHits(globalRaw, now);
  if (ipHits.length >= CHAT_LIMIT) {
    return "This demo allows 8 chat messages an hour from one network. Try again later, or use the buttons.";
  }
  if (globalHits.length >= CHAT_GLOBAL_LIMIT) {
    return "Chat is busy on this demo. Try again in an hour, or use the buttons.";
  }
  ipHits.push(now);
  globalHits.push(now);
  await Promise.all([
    kv.put(ipKey, JSON.stringify(ipHits)),
    kv.put("chat-global", JSON.stringify(globalHits)),
  ]);
  return null;
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it to .env.local." },
      { status: 500 },
    );
  }

  let userMessage = "";
  let history: Anthropic.MessageParam[] = [];
  try {
    const body = await req.json();
    userMessage = String(body.message || "");
    if (Array.isArray(body.history)) history = body.history;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!userMessage.trim()) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }
  const limited = await chatLimit(
    req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown",
  );
  if (limited) {
    return NextResponse.json({ error: limited }, { status: 429 });
  }

  const anthropic = new Anthropic({ fetch: workersFetch });
  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: "user", content: userMessage },
  ];
  const actions: ChatAction[] = [];

  try {
    for (let step = 0; step < 8; step++) {
      const response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 2048,
        system: SYSTEM,
        tools,
        messages,
      });

      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") {
        const reply = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return NextResponse.json({ reply: reply || "Done.", actions, history: messages });
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const { content, isError } = await runTool(
          block.name,
          block.input as Record<string, unknown>,
          actions,
        );
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content, is_error: isError });
      }
      messages.push({ role: "user", content: toolResults });
    }

    return NextResponse.json({
      reply: "I wasn't able to finish that — please try rephrasing.",
      actions,
      history: messages,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Chat failed" },
      { status: 500 },
    );
  }
}

async function runTool(
  name: string,
  input: Record<string, unknown>,
  actions: ChatAction[],
): Promise<{ content: string; isError: boolean }> {
  try {
    switch (name) {
      case "get_balances": {
        const all = await getBalances();
        const filter = input.currency ? String(input.currency).toUpperCase() : null;
        return { content: JSON.stringify(filter ? all.filter((b) => b.currency === filter) : all), isError: false };
      }
      case "list_cards": {
        const cards = await listCards();
        return {
          content: JSON.stringify(cards.map((c) => ({
            card_id: c.card_id,
            nick_name: c.nick_name,
            status: c.card_status,
            type: c.authorization_controls?.allowed_transaction_count,
            currency: c.authorization_controls?.transaction_limits?.currency,
            limits: c.authorization_controls?.transaction_limits?.limits,
            agent_id: c.metadata?.agent_id,
          }))),
          isError: false,
        };
      }
      case "provision_card": {
        if (!input.agent_id) {
          return { content: "agent_id is required.", isError: true };
        }
        const result = await provisionCard(
          {
            agent_id: String(input.agent_id),
            single_use: !!input.single_use,
          },
          "chat",
        );
        pushProvisionOutcome(actions, result as Record<string, unknown>);
        return { content: JSON.stringify(result), isError: false };
      }
      case "provision_scoped_card": {
        if (!input.agent_id || !input.task_id || !input.merchant_category) {
          return { content: "agent_id, task_id, and merchant_category are required.", isError: true };
        }
        const result = await provisionScopedCard(
          {
            agent_id: String(input.agent_id),
            task_id: String(input.task_id),
            merchant_category: String(input.merchant_category),
            amount: input.amount ? Number(input.amount) : undefined,
            expires_in_minutes: input.expires_in_minutes ? Number(input.expires_in_minutes) : undefined,
          },
          "chat",
        );
        pushProvisionOutcome(actions, result as Record<string, unknown>);
        return { content: JSON.stringify(result), isError: false };
      }
      case "reveal_card": {
        const hint = input.card ? String(input.card).toLowerCase() : "";
        const cards = await listCards();
        const active = cards.filter((c) => c.card_status === "ACTIVE");
        const isSingle = (c: (typeof cards)[number]) =>
          c.authorization_controls?.allowed_transaction_count === "SINGLE";
        let target = active[0];
        if (hint.includes("single")) target = active.find(isSingle) || target;
        else if (hint.includes("multi")) target = active.find((c) => !isSingle(c)) || target;
        else if (hint)
          target = active.find(
            (c) =>
              (c.nick_name || "").toLowerCase().includes(hint) ||
              (c.metadata?.agent_id || "").toLowerCase().includes(hint),
          ) || target;
        if (!target) return { content: "No active card available to reveal.", isError: true };
        const d = await getCardDetails(target.card_id);
        return {
          content: JSON.stringify({
            card: target.nick_name,
            agent_id: target.metadata?.agent_id,
            card_number: d.card_number,
            cvv: d.cvv,
            expiry: `${String(d.expiry_month).padStart(2, "0")}/${d.expiry_year}`,
            name_on_card: d.name_on_card,
            note: "Sandbox test card — usable only via the purchase simulator.",
          }),
          isError: false,
        };
      }
      case "agent_report": {
        const economy = await getAgentEconomy();
        return {
          content: JSON.stringify({
            agents: economy.agents.map((a) => ({
              agent_id: a.agentId,
              project_id: a.projectId,
              cards: a.cardCount,
              total_spent: `${a.totalSpent} ${a.currency}`,
            })),
            untagged_cards: economy.untagged.length,
          }),
          isError: false,
        };
      }
      case "create_topup": {
        const intent = await createPaymentIntent(
          Number(input.amount),
          String(input.currency || "USD").toUpperCase(),
        );
        actions.push({
          type: "topup",
          intent: { id: intent.id, client_secret: intent.client_secret, amount: intent.amount, currency: intent.currency },
        });
        return {
          content: JSON.stringify({
            payment_intent_id: intent.id,
            amount: intent.amount,
            currency: intent.currency,
            status: intent.status,
            note: "A Hosted Payment Page button has been shown to the user.",
          }),
          isError: false,
        };
      }
      case "list_accounts": {
        const accounts = await listGlobalAccounts();
        return {
          content: JSON.stringify(accounts.map((a) => ({
            currency: a.currency,
            country: a.countryCode,
            status: a.status,
            nick_name: a.nickName,
            bank: a.institutionName,
            account_number: a.accountNumber,
            iban: a.iban,
            swift: a.swiftCode,
          }))),
          isError: false,
        };
      }
      case "open_account": {
        const currency = String(input.currency || "").toUpperCase();
        const preset = OPENABLE_ACCOUNTS.find((o) => o.currency === currency);
        if (!preset) return { content: `Cannot open ${currency}. Openable: ${OPENABLE_KNOWN_CURRENCIES.join(", ")}.`, isError: true };
        const account = await createGlobalAccount({
          countryCode: preset.countryCode,
          currency: preset.currency,
          transferMethod: preset.transferMethod,
        });
        return {
          content: JSON.stringify({
            currency: account.currency,
            country: account.countryCode,
            status: account.status,
            account_number: account.accountNumber,
            iban: account.iban,
            swift: account.swiftCode,
            note: account.status === "PROCESSING" ? "Provisioning — will be ACTIVE shortly." : "Active and ready to receive funds.",
          }),
          isError: false,
        };
      }
      case "simulate_deposit": {
        const currency = String(input.currency || "").toUpperCase();
        const amount = Number(input.amount);
        const accounts = await listGlobalAccounts();
        const ga = accounts.find((a) => a.currency === currency && a.status === "ACTIVE") ||
          accounts.find((a) => a.currency === currency);
        if (!ga) return { content: `No Global Account for ${currency}. Open one first.`, isError: true };
        if (ga.status !== "ACTIVE") return { content: `${currency} account is ${ga.status}; deposits require ACTIVE.`, isError: true };
        await simulateDeposit({ globalAccountId: ga.id, amount });
        return { content: JSON.stringify({ currency, amount, note: `Simulated ${currency} ${amount} deposit; settles into the ${currency} wallet.` }), isError: false };
      }
      case "convert_currency": {
        const from = String(input.from_currency || "").toUpperCase();
        const to = String(input.to_currency || "").toUpperCase();
        if (from === to) return { content: "from_currency and to_currency must differ.", isError: true };
        const conv = await createConversion({ sellCurrency: from, buyCurrency: to, sellAmount: Number(input.amount) });
        return {
          content: JSON.stringify({
            sold: `${conv.sell_amount} ${conv.sell_currency}`,
            bought: `${conv.buy_amount} ${conv.buy_currency}`,
            rate: conv.client_rate,
            status: conv.status,
          }),
          isError: false,
        };
      }
      case "simulate_purchase": {
        const amount = Number(input.amount);
        const cards = await listCards();
        const active = cards.filter((c) => c.card_status === "ACTIVE");
        let target = active[0];

        if (input.card_id) {
          target = active.find((c) => c.card_id === String(input.card_id)) || target;
        } else {
          const hint = input.card ? String(input.card).toLowerCase() : "";
          const isSingle = (c: (typeof cards)[number]) =>
            c.authorization_controls?.allowed_transaction_count === "SINGLE";
          if (hint.includes("single")) target = active.find(isSingle) || target;
          else if (hint.includes("multi")) target = active.find((c) => !isSingle(c)) || target;
          else if (hint)
            target = active.find(
              (c) =>
                (c.nick_name || "").toLowerCase().includes(hint) ||
                (c.metadata?.agent_id || "").toLowerCase().includes(hint),
            ) || target;
        }
        if (!target) return { content: "No active card available.", isError: true };

        const ccy = target.authorization_controls?.transaction_limits?.currency || "USD";
        const mcc = input.merchant_category ? String(input.merchant_category) : "5734";
        const result = await chargeCard({
          cardId: target.card_id,
          amount,
          currency: ccy,
          merchant: "Agent Purchase",
          mcc,
        });

        // Record to task ledger when card has agent context
        const agentId = target.metadata?.agent_id;
        const taskId = target.metadata?.task_id;
        if (agentId) {
          invalidateActivityCache();
          await addLedgerEntry({
            task_id: taskId || `chat-${target.card_id}`,
            agent_id: agentId,
            card_id: target.card_id,
            amount,
            currency: ccy,
            txn_id: result.txn_id,
            status: result.approved ? "APPROVED" : "DECLINED",
            merchant: result.merchant,
            mcc: result.mcc,
            decline_reason: result.decline_reason,
          });
          logMcp({
            ts: new Date().toISOString(),
            source: "chat",
            tool: "simulate_purchase",
            args: { card_id: target.card_id, agent_id: agentId, task_id: taskId, amount, mcc },
            ok: result.approved,
            result: { status: result.status, txn_id: result.txn_id },
            error: result.approved ? undefined : result.decline_reason,
          });
        }

        if (!result.approved) {
          actions.push({
            type: "blocked",
            reason: result.decline_reason || "Blocked by card controls",
          });
        }
        return {
          content: JSON.stringify({
            card: target.nick_name,
            card_id: target.card_id,
            agent_id: agentId,
            task_id: taskId,
            amount,
            currency: ccy,
            mcc,
            status: result.status,
            failure_reason: result.decline_reason,
            note: result.approved
              ? `Approved. Single-use cards close after this purchase.`
              : `Declined: ${result.decline_reason}.`,
          }),
          isError: false,
        };
      }
      case "list_agents": {
        const store = await readStore();
        const result = Object.values(store.agents).map((a) => ({
          ...a,
          policy: store.policies[a.policy_id] ?? null,
        }));
        return { content: JSON.stringify(result), isError: false };
      }
      case "list_approvals": {
        const store = await readStore();
        const statusFilter = input.status ? String(input.status) : null;
        const approvals = statusFilter
          ? store.approvals.filter((a) => a.status === statusFilter)
          : store.approvals;
        return { content: JSON.stringify(approvals), isError: false };
      }
      case "checkout_at_demo_store": {
        if (!input.card_id || !input.product) {
          return { content: "card_id and product are required.", isError: true };
        }
        const product = getProduct(String(input.product));
        const charge = chargeCard;
        if (!product) return { content: `Unknown product: ${input.product}`, isError: true };

        const cards = await listCards();
        const card = cards.find((c) => c.card_id === String(input.card_id));
        if (!card) return { content: `Card ${input.card_id} not found.`, isError: true };

        const ccy = product.currency;
        const result = await charge({
          cardId: card.card_id,
          amount: product.price,
          currency: ccy,
          merchant: product.name,
          mcc: product.mcc,
        });

        const agentId = card.metadata?.agent_id;
        const taskId = card.metadata?.task_id;
        if (agentId) {
          invalidateActivityCache();
          await addLedgerEntry({
            task_id: taskId || `store-${card.card_id.slice(0, 8)}`,
            agent_id: agentId,
            card_id: card.card_id,
            amount: product.price,
            currency: ccy,
            txn_id: result.txn_id,
            status: result.approved ? "APPROVED" : "DECLINED",
            merchant: product.name,
            mcc: product.mcc,
            decline_reason: result.decline_reason,
            receipt_url: result.approved ? `/demo-store?product=${String(input.product)}&card_id=${card.card_id}` : undefined,
          });
          logMcp({
            ts: new Date().toISOString(),
            source: "chat",
            tool: "checkout_at_demo_store",
            args: { card_id: `${card.card_id.slice(0, 8)}…`, product: input.product, amount: product.price },
            ok: result.approved,
            result: result.approved ? { status: result.status, merchant: product.name } : undefined,
            error: result.decline_reason,
          });
        }

        if (result.approved) {
          const lastIssued = [...actions].reverse().find((a) => a.type === "issued");
          if (lastIssued && lastIssued.type === "issued") {
            lastIssued.receiptUrl = `/demo-store?product=${product.id}&card_id=${card.card_id}`;
            lastIssued.merchant = product.name;
          } else {
            actions.push({
              type: "issued",
              cardId: card.card_id,
              merchant: product.name,
              cap: product.price,
              currency: ccy,
              receiptUrl: `/demo-store?product=${product.id}&card_id=${card.card_id}`,
            });
          }
        } else {
          actions.push({
            type: "blocked",
            reason: result.decline_reason || "Blocked by card controls",
          });
        }
        return {
          content: JSON.stringify({
            product: product.name,
            amount: product.price,
            currency: ccy,
            status: result.status,
            approved: result.approved,
            decline_reason: result.decline_reason,
            txn_id: result.txn_id,
            store_url: `/demo-store?product=${product.id}&card_id=${card.card_id}`,
            note: result.approved
              ? `Payment approved at ${product.name}. View merchant receipt at /demo-store`
              : `Payment declined: ${result.decline_reason}`,
          }),
          isError: false,
        };
      }
      default:
        return { content: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    return {
      content: err instanceof Error ? err.message : "Tool execution failed",
      isError: true,
    };
  }
}
