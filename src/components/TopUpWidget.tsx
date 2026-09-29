"use client";

import { useState } from "react";
import { AIRWALLEX_ENV } from "@/lib/clientConfig";
import { redirectToHostedPayment } from "@/lib/airwallexJs";

export default function TopUpWidget({ currencies }: { currencies: string[] }) {
  const [amount, setAmount] = useState("1000");
  const [currency, setCurrency] = useState(currencies[0] || "USD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startTopUp() {
    setError(null);
    setBusy(true);
    try {
      // 1. Create the PaymentIntent server-side.
      const res = await fetch("/api/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount), currency }),
      });
      const intent = await res.json();
      if (!res.ok) throw new Error(intent.error || "Failed to create payment intent");

      // 2. Load Airwallex.js and redirect to the Hosted Payment Page (env: demo).
      await redirectToHostedPayment(intent);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit failed");
      setBusy(false);
    }
  }

  return (
    <div className="card-surface p-5">
      <h2 className="mb-1 text-sm font-semibold">Deposit funds into a wallet</h2>
      <p className="mb-4 text-xs text-gray-400">
        Creates a PaymentIntent and redirects to the Airwallex Hosted Payment
        Page (env: <code>{AIRWALLEX_ENV}</code>).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[140px] flex-1">
          <label className="mb-1 block text-xs text-gray-400">Amount</label>
          <input
            className="input"
            type="number"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="min-w-[110px]">
          <label className="mb-1 block text-xs text-gray-400">Currency</label>
          <select
            className="input"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-primary" onClick={startTopUp} disabled={busy}>
          {busy ? "Redirecting…" : "Deposit"}
        </button>
      </div>
      {error && (
        <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
