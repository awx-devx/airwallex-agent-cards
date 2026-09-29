"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { MERCHANT_CATEGORIES, mccLabel } from "@/lib/config";
import { declineReasonLabel, purchaseOutcome, shortAgentName } from "@/lib/labels";

export interface Card {
  card_id: string;
  nick_name?: string;
  card_status: string;
  card_number?: string;
  created_at?: string;
  authorization_controls?: {
    allowed_transaction_count?: "SINGLE" | "MULTIPLE";
    transaction_limits?: { currency?: string; limits?: { amount: number; interval: string }[] };
    allowed_merchant_categories?: string[];
    active_to?: string;
  };
  metadata?: Record<string, string>;
  spent: number;
}

interface Details {
  card_number: string;
  cvv: string;
  expiry_month: number;
  expiry_year: number;
  name_on_card: string;
}

export function CardTile({ card: c, agentId, projectId, onChanged }: {
  card: Card;
  agentId?: string;
  projectId?: string;
  onChanged: () => void;
}) {
  const single = c.authorization_controls?.allowed_transaction_count === "SINGLE";
  const limits = c.authorization_controls?.transaction_limits;
  const limitObj = limits?.limits?.[0];
  const cardCcy = limits?.currency || "USD";
  const active = c.card_status === "ACTIVE";
  const expiry = c.authorization_controls?.active_to;
  const allowedMccs = c.authorization_controls?.allowed_merchant_categories || [];

  const [amount, setAmount] = useState(() => {
    const cap = c.authorization_controls?.transaction_limits?.limits?.[0]?.amount;
    if (typeof cap === "number" && cap > 0) return String(Math.min(18, cap));
    return "18";
  });
  const [mcc, setMcc] = useState(() => {
    const allowed = c.authorization_controls?.allowed_merchant_categories || [];
    return allowed[0] || "5734";
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [freezing, setFreezing] = useState(false);
  const [details, setDetails] = useState<Details | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealErr, setRevealErr] = useState<string | null>(null);

  async function simulatePurchase() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/cards/transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardId: c.card_id,
          agentId: agentId || undefined,
          amount: Number(amount),
          currency: cardCcy,
          merchantCategoryCode: mcc || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Purchase failed");
      const t = data.transaction || {};
      const usedMcc = t.merchant?.category_code || mcc || "5734";
      const approved = t.status !== "FAILED";
      const extra = approved && single ? " Card closed after this purchase." : "";
      setResult(
        purchaseOutcome({
          approved,
          amount: Number(amount),
          currency: cardCcy,
          mcc: usedMcc,
          reason: t.failure_reason ? declineReasonLabel(t.failure_reason) : undefined,
        }) + extra,
      );
      onChanged();
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Purchase failed");
    } finally {
      setBusy(false);
    }
  }

  async function reveal() {
    if (details) { setDetails(null); return; }
    setRevealing(true);
    setRevealErr(null);
    try {
      const res = await fetch(`/api/cards/details?cardId=${c.card_id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reveal failed");
      setDetails(data.details);
    } catch (err) {
      setRevealErr(err instanceof Error ? err.message : "Reveal failed");
    } finally {
      setRevealing(false);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-awx-border bg-gradient-to-br from-[#1a2036] to-[#0f1322] p-5">
      <div className="flex items-start justify-between">
        <div>
          <span className="text-xs font-medium text-gray-300">{c.nick_name || "Virtual card"}</span>
          {agentId && (
            <div className="mt-0.5 text-[10px] text-gray-500">
              {shortAgentName(undefined, agentId)}{projectId ? ` · ${projectId}` : ""}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-1.5">
            <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${single ? "bg-awx-accent2/20 text-awx-accent2" : "bg-awx-accent/20 text-awx-accent"}`}>
              {single ? "single-use" : "multi-use"}
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${active ? "bg-emerald-500/15 text-emerald-300" : "bg-gray-500/20 text-gray-400"}`}>
              {active && <span className="live-dot" />}
              {c.card_status?.toLowerCase() || "—"}
            </span>
          </div>
          {c.card_status === "CLOSED" && single && (
            <span className="text-[10px] text-gray-500">used once · auto-closed</span>
          )}
        </div>
      </div>

      {details ? (
        <div className="mt-5 space-y-1 font-mono text-sm text-gray-100">
          <div className="text-lg tracking-widest">{details.card_number}</div>
          <div className="flex gap-4 text-xs text-gray-400">
            <span>exp {String(details.expiry_month).padStart(2, "0")}/{String(details.expiry_year).slice(-2)}</span>
            <span>cvv {details.cvv}</span>
          </div>
          <div className="text-[11px] text-gray-500">{details.name_on_card}</div>
          <div className="mt-1 text-[10px] text-gray-600">Sandbox test card — in production, use PCI-compliant reveal or network tokenization</div>
        </div>
      ) : (
        <div className="mt-5 flex items-baseline gap-3">
          <span className="font-mono text-lg tracking-widest text-gray-100">
            {c.card_number ? `•••• •••• •••• ${c.card_number.replace(/\D/g, "").slice(-4)}` : "•••• •••• •••• ••••"}
          </span>
          {expiry && (
            <span className="font-mono text-xs text-gray-400">
              {(() => { const d = new Date(expiry); return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(-2)}`; })()}
            </span>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-3">
        {active && (
          <button onClick={reveal} className="text-[11px] text-awx-accent hover:underline">
            {revealing ? "Revealing…" : details ? "Hide details" : "Reveal card number"}
          </button>
        )}
        {details && (
          <button
            onClick={() =>
              navigator.clipboard?.writeText(
                `${details.card_number} ${String(details.expiry_month).padStart(2, "0")}/${details.expiry_year} ${details.cvv}`,
              )
            }
            className="text-[11px] text-gray-400 hover:text-white"
          >
            Copy
          </button>
        )}
      </div>
      {revealErr && <p className="mt-1 text-[11px] text-red-300">{revealErr}</p>}
      {details && (
        <p className="mt-1 text-[11px] text-gray-600">
          Sandbox test card — usable only via the simulator below, not at real
          merchants. In production, reveal via Airwallex&apos;s PCI component.
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-y-1 text-[11px] text-gray-400">
        <span>Limit</span>
        <span className="text-right text-gray-200">
          {limitObj ? `${formatMoney(limitObj.amount, cardCcy)} / ${limitObj.interval.toLowerCase().replace("per_", "")}` : "—"}
        </span>
        <span>Spent</span>
        <span className="text-right text-gray-200">
          {formatMoney(c.spent, cardCcy)}
          {limitObj && (
            <span className="text-gray-500"> / {formatMoney(limitObj.amount, cardCcy)}</span>
          )}
        </span>
        {limitObj && (
          <div className="col-span-2 mt-0.5">
            <div className="h-1 w-full rounded-full bg-white/10">
              <div
                className="h-1 rounded-full bg-awx-accent transition-all"
                style={{ width: `${Math.min(100, (c.spent / limitObj.amount) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {allowedMccs.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-gray-500">
          <span>Allowed:</span>
          {allowedMccs.map((m) => (
            <span key={m} title={`Network code ${m}`} className="rounded bg-white/5 px-1.5 py-0.5 text-gray-300">
              {mccLabel(m)}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-awx-border pt-3">
        <div className="mb-2 text-[11px] font-medium text-gray-400">Try a purchase (sandbox)</div>
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="w-28">
              <label className="mb-1 block text-[10px] text-gray-500">Amount</label>
              <input
                className="input !py-1.5"
                type="number"
                min="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={!active}
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-[10px] text-gray-500">Merchant type</label>
              <select
                className="input !py-1.5"
                value={mcc}
                onChange={(e) => setMcc(e.target.value)}
                disabled={!active}
              >
                {MERCHANT_CATEGORIES.map((m) => (
                  <option key={m.code} value={m.code}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[10px] text-gray-600">
            Uses Airwallex’s sandbox authorize API. Same controls as production, no real network.
          </p>
          <button
            className="btn-ghost !py-1.5 w-full"
            onClick={simulatePurchase}
            disabled={busy || !active || !mcc}
            title={!active ? "Card not active" : ""}
          >
            {busy ? "Trying…" : "Try a purchase"}
          </button>
        </div>
      </div>
      {result && (
        <p className={`mt-2 rounded-lg px-3 py-2 text-xs ${
          result.startsWith("Approved")
            ? "bg-emerald-500/10 text-emerald-300"
            : "bg-red-500/10 text-red-300"
        }`}>
          {result}
        </p>
      )}
      {c.card_status !== "CLOSED" && (
        <div className="mt-3 border-t border-awx-border pt-2.5 flex items-center gap-4">
          <button
            className={`text-[11px] hover:underline disabled:opacity-50 ${active ? "text-amber-400" : "text-emerald-400"}`}
            disabled={freezing}
            onClick={async () => {
              setFreezing(true);
              try {
                const res = await fetch("/api/cards", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ cardId: c.card_id, status: active ? "INACTIVE" : "ACTIVE" }),
                });
                if (res.ok) onChanged();
              } finally {
                setFreezing(false);
              }
            }}
          >
            {freezing ? "…" : active ? "Freeze card" : "Unfreeze card"}
          </button>
          <button
            className="text-[11px] text-gray-600 hover:text-red-400 disabled:opacity-50"
            disabled={freezing}
            onClick={async () => {
              if (!confirm("Cancel this card? This cannot be undone.")) return;
              setFreezing(true);
              try {
                const res = await fetch("/api/cards", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ cardId: c.card_id, status: "CLOSED" }),
                });
                if (res.ok) onChanged();
              } finally {
                setFreezing(false);
              }
            }}
          >
            Cancel card
          </button>
        </div>
      )}
    </div>
  );
}
