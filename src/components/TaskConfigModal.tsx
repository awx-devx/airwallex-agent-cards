"use client";

import { useState } from "react";

const PRODUCTS = [
  { id: "vercel-pro",      label: "Vercel Pro",                    price: 18,  currency: "USD", mcc: "5734", mccLabel: "software",              agent: "procurement-agent" },
  { id: "github-copilot",  label: "GitHub Copilot Business",       price: 19,  currency: "USD", mcc: "7372", mccLabel: "SaaS/cloud",             agent: "procurement-agent" },
  { id: "openai-api",      label: "OpenAI API",                    price: 50,  currency: "USD", mcc: "5734", mccLabel: "software",              agent: "procurement-agent" },
  { id: "notion-plus",     label: "Notion Plus",                   price: 8,   currency: "USD", mcc: "7372", mccLabel: "SaaS/cloud",             agent: "procurement-agent" },
  { id: "pixel-co",        label: "Pixel & Co (UK design agency)", price: 500, currency: "GBP", mcc: "7389", mccLabel: "professional services",  agent: "contractor-agent"  },
] as const;

const AGENTS = [
  { id: "procurement-agent", label: "Procurement" },
  { id: "research-agent",    label: "Research" },
  { id: "contractor-agent",  label: "Contractor" },
] as const;

export interface TaskConfig {
  agent: string;
  product: string;
  amount: number;
  currency: string;
  description: string;
}

const DEFAULT: TaskConfig = {
  agent: "procurement-agent",
  product: "vercel-pro",
  amount: 18,
  currency: "USD",
  description: "Vercel Pro subscription renewal",
};

function makeTaskId(description: string) {
  return `task-${description.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`;
}

function buildDomesticPrompt(cfg: TaskConfig): string {
  const product = PRODUCTS.find((p) => p.id === cfg.product) ?? PRODUCTS[0];
  const taskId = makeTaskId(cfg.description);
  return `You are acting as the **${cfg.agent}** running an autonomous task.

Task: ${cfg.description}. Estimated cost: $${cfg.amount}.

Complete these steps without asking for confirmation:
1. Call list_agents to confirm your policy (MCC allowlist, per-transaction cap, budget remaining).
2. Call provision_scoped_card with agent_id="${cfg.agent}", task_id="${taskId}", merchant_category="${product.mcc}" (${product.mccLabel}), amount=${cfg.amount}.
3. If the card is refused (refused=true), explain why and stop.
4. If the card requires human approval (pending_approval=true), tell the user the approval_id and that they can approve it at /approvals. Then stop and wait.
5. If the card is issued, call checkout_at_demo_store with the returned card_id and product="${cfg.product}".
6. Summarise the outcome and share the receipt URL from the tool result.`;
}

function buildCrossBorderPrompt(cfg: TaskConfig): string {
  const product = PRODUCTS.find((p) => p.id === cfg.product);
  const taskId = makeTaskId(cfg.description);

  return `You are acting as the **${cfg.agent}** running an autonomous cross-border payment.

Task: ${cfg.description}. Amount: £${cfg.amount} GBP.

Complete these steps without asking for confirmation:
1. Call list_agents to confirm ${cfg.agent}'s policy (currency: GBP, per-transaction cap, budget remaining).
2. Call get_balances and report the current GBP wallet balance.
3. Call convert_currency with from_currency="USD", to_currency="GBP", amount=200 to fund this task and show the live Airwallex FX rate. Report the exchange rate and how much GBP was received.
4. Call provision_scoped_card with agent_id="${cfg.agent}", task_id="${taskId}", merchant_category="${product?.mcc ?? "7389"}" (${product?.mccLabel ?? "professional services"}), amount=${cfg.amount}, currency="GBP".
5. If the card is refused (refused=true), explain why and stop.
6. If the card requires human approval (pending_approval=true), tell the user the approval_id and direct them to /approvals. Then stop and wait.
7. If the card is issued, call simulate_purchase with the card_id from the provisioned card. The charge will be in GBP.
8. Summarise: the FX rate from step 3, the GBP amount charged, and whether the purchase was approved or declined.`;
}

export function buildTaskPrompt(cfg: TaskConfig): string {
  return cfg.currency !== "USD" ? buildCrossBorderPrompt(cfg) : buildDomesticPrompt(cfg);
}

export default function TaskConfigModal({
  open,
  onClose,
  onRun,
}: {
  open: boolean;
  onClose: () => void;
  onRun: (cfg: TaskConfig) => void;
}) {
  const [cfg, setCfg] = useState<TaskConfig>(DEFAULT);

  function set<K extends keyof TaskConfig>(k: K, v: TaskConfig[K]) {
    setCfg((prev) => ({ ...prev, [k]: v }));
  }

  function handleProductChange(productId: string) {
    const product = PRODUCTS.find((p) => p.id === productId);
    if (!product) return;
    setCfg((prev) => ({
      ...prev,
      product: productId,
      amount: product.price,
      currency: product.currency,
      agent: product.agent,
      description: product.currency === "USD"
        ? `${product.label} subscription renewal`
        : `Pay ${product.label} invoice`,
    }));
  }

  function handleRun() {
    onRun(cfg);
    onClose();
  }

  const isCrossBorder = cfg.currency !== "USD";

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="card-surface relative z-10 w-full max-w-sm p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-100">Run agent task</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white">&times;</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-400">Agent</label>
            <select
              className="input w-full"
              value={cfg.agent}
              onChange={(e) => set("agent", e.target.value)}
            >
              {AGENTS.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-400">Vendor / product</label>
            <select
              className="input w-full"
              value={cfg.product}
              onChange={(e) => handleProductChange(e.target.value)}
            >
              <optgroup label="SaaS / domestic (USD)">
                {PRODUCTS.filter((p) => p.currency === "USD").map((p) => (
                  <option key={p.id} value={p.id}>{p.label} — ${p.price}</option>
                ))}
              </optgroup>
              <optgroup label="International vendor (GBP)">
                {PRODUCTS.filter((p) => p.currency !== "USD").map((p) => (
                  <option key={p.id} value={p.id}>{p.label} — £{p.price}</option>
                ))}
              </optgroup>
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-400">
              Amount ({cfg.currency})
            </label>
            <input
              className="input w-full"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={cfg.amount || ""}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "");
                set("amount", v ? Number(v) : 0);
              }}
            />
            <p className="mt-1 text-[11px] text-gray-500">
              {isCrossBorder
                ? "The agent converts $200 USD to GBP first so you can see a live FX rate."
                : "If this is over the agent's max per purchase, it will wait for you on Approvals."}
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-400">Notes / Description</label>
            <input
              className="input w-full"
              type="text"
              value={cfg.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="e.g. Renew Vercel Pro subscription"
            />
          </div>

          {isCrossBorder && (
            <div className="rounded-lg border border-awx-accent/20 bg-awx-accent/5 px-3 py-2 text-[11px] text-gray-400">
              Cross-border: check the GBP wallet, convert USD if needed, issue a Contractor card, then pay the vendor in GBP.
            </div>
          )}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            onClick={handleRun}
            disabled={!cfg.amount || !cfg.description.trim()}
            className="btn-primary flex-1"
          >
            Run task
          </button>
          <button
            onClick={onClose}
            className="rounded-lg border border-awx-border px-4 py-2 text-sm text-gray-400 hover:bg-white/5"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
