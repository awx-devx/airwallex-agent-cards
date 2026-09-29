"use client";

import { useState } from "react";
import { KNOWN_CURRENCIES, flagForCurrency } from "@/lib/config";
import { formatMoney } from "@/lib/format";

interface ConversionResult {
  conversion_id: string;
  client_rate: number;
  currency_pair: string;
  sell_amount: number;
  sell_currency: string;
  buy_amount: number;
  buy_currency: string;
}

export default function FxConverter({ onConverted }: { onConverted?: () => void }) {
  const [fromCcy, setFromCcy] = useState("USD");
  const [toCcy, setToCcy] = useState("EUR");
  const [amount, setAmount] = useState("1000");
  const [converting, setConverting] = useState(false);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function swap() {
    setFromCcy(toCcy);
    setToCcy(fromCcy);
    setResult(null);
    setError(null);
  }

  async function convert(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || amt <= 0) { setError("Enter an amount greater than 0"); return; }
    if (fromCcy === toCcy) { setError("Choose two different currencies"); return; }
    setConverting(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromCurrency: fromCcy, toCurrency: toCcy, amount: amt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Conversion failed");
      setResult(data.conversion);
      onConverted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversion failed");
    } finally {
      setConverting(false);
    }
  }

  const canSubmit = !converting && Number(amount) > 0 && fromCcy !== toCcy;

  return (
    <div className="card-surface p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-300">FX Conversion</h2>
        <p className="mt-0.5 text-[11px] text-gray-500">
          Move funds between your wallet currencies at the live market rate — no intermediary bank.
        </p>
      </div>

      <form onSubmit={convert} className="space-y-3">
        {/* Amount — full width */}
        <div>
          <label className="mb-1 block text-xs text-gray-400">Amount</label>
          <input
            className="input"
            type="number"
            min="1"
            step="any"
            placeholder="e.g. 1000"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setResult(null); }}
          />
        </div>

        {/* From → swap → To */}
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <label className="mb-1 block text-xs text-gray-400">From</label>
            <select
              className="input"
              value={fromCcy}
              onChange={(e) => { setFromCcy(e.target.value); setResult(null); }}
            >
              {KNOWN_CURRENCIES.map((c) => (
                <option key={c} value={c}>{flagForCurrency(c)} {c}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={swap}
            className="mb-0.5 shrink-0 rounded-full border border-awx-border px-2.5 py-2 text-sm text-gray-400 hover:bg-white/5 hover:text-white"
            title="Swap currencies"
          >
            ⇄
          </button>
          <div className="flex-1 min-w-0">
            <label className="mb-1 block text-xs text-gray-400">To</label>
            <select
              className="input"
              value={toCcy}
              onChange={(e) => { setToCcy(e.target.value); setResult(null); }}
            >
              {KNOWN_CURRENCIES.filter((c) => c !== fromCcy).map((c) => (
                <option key={c} value={c}>{flagForCurrency(c)} {c}</option>
              ))}
            </select>
          </div>
        </div>

        <button className="btn-primary w-full" disabled={!canSubmit}>
          {converting ? "Converting…" : `Convert ${fromCcy} → ${toCcy}`}
        </button>
      </form>

      {/* Result */}
      {result && (
        <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[11px] text-gray-400">Sold</div>
              <div className="text-lg font-semibold text-gray-100">
                {formatMoney(result.sell_amount, result.sell_currency)}
              </div>
            </div>
            <div className="text-xl text-gray-500">→</div>
            <div className="text-right">
              <div className="text-[11px] text-gray-400">Received</div>
              <div className="text-lg font-semibold text-emerald-300">
                {formatMoney(result.buy_amount, result.buy_currency)}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2.5 text-[11px] text-gray-500">
            <span>Rate: 1 {result.sell_currency} = {result.client_rate.toFixed(4)} {result.buy_currency}</span>
            <span className="text-gray-600">{result.currency_pair}</span>
          </div>
          <p className="mt-2 text-[11px] text-gray-600">
            Funds settled instantly across your Airwallex wallet balances.
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
