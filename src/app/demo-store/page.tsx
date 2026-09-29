"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DEMO_PRODUCTS, getProduct, type StoreProduct } from "@/lib/demo-store";
import { formatMoney } from "@/lib/format";

interface CheckoutResult {
  approved: boolean;
  status: string;
  amount: number;
  currency: string;
  merchant: string;
  txn_id?: string;
  decline_reason?: string;
  masked_card?: string;
}

function DemoStoreInner() {
  const params = useSearchParams();
  const productParam = params.get("product");
  const cardParam = params.get("card_id");

  const [selected, setSelected] = useState<StoreProduct | null>(
    productParam ? (getProduct(productParam) ?? null) : null,
  );
  const [cardId, setCardId] = useState(cardParam ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Auto-checkout when both product and card_id come in via URL
  useEffect(() => {
    if (productParam && cardParam && !result) {
      runCheckout(getProduct(productParam) ?? null, cardParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runCheckout(product: StoreProduct | null, cid: string) {
    if (!product || !cid.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/demo-store/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_id: cid.trim(), product_id: product.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      setResult(data as CheckoutResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setResult(null);
    setErr(null);
  }

  return (
    <div className="min-h-screen bg-awx-bg text-gray-100">
      {/* Store header */}
      <header className="border-b border-awx-border bg-[#0d1117] px-8 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-white">Dev SaaS Marketplace</span>
            <span className="rounded-full border border-awx-border px-2.5 py-0.5 text-[11px] text-gray-500">
              Agent Commerce Demo
            </span>
          </div>
          <span className="text-[11px] text-gray-600">Powered by Airwallex · sandbox</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-8 py-10">
        {/* Result overlay */}
        {result && (
          <div
            className={`mb-8 rounded-2xl border p-8 text-center ${
              result.approved
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-red-500/30 bg-red-500/5"
            }`}
          >
            <div className="text-4xl mb-3">{result.approved ? "✅" : "❌"}</div>
            <div className={`text-xl font-semibold mb-1 ${result.approved ? "text-emerald-300" : "text-red-300"}`}>
              {result.approved ? "Payment approved" : "Payment declined"}
            </div>
            <div className="text-sm text-gray-400 mb-1">
              {result.merchant} · {formatMoney(result.amount, result.currency)}
            </div>
            {result.txn_id && (
              <div className="text-[11px] font-mono text-gray-600">
                txn {result.txn_id}
              </div>
            )}
            {result.masked_card && (
              <div className="text-[11px] text-gray-600">{result.masked_card}</div>
            )}
            {!result.approved && result.decline_reason && (
              <div className="mt-2 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-red-300 inline-block">
                {result.decline_reason}
              </div>
            )}
            <button
              onClick={reset}
              className="mt-5 rounded-lg border border-awx-border px-4 py-2 text-sm text-gray-400 hover:bg-white/5"
            >
              ← Back to store
            </button>
          </div>
        )}

        {/* Product grid */}
        {!result && (
          <>
            <div className="mb-8">
              <h1 className="text-lg font-semibold text-gray-200">Available subscriptions</h1>
              <p className="mt-1 text-sm text-gray-500">
                Select a product to check out, or paste an agent card ID below.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-10">
              {DEMO_PRODUCTS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setSelected(p); setResult(null); }}
                  className={`rounded-2xl border p-5 text-left transition-all hover:bg-white/5 ${
                    selected?.id === p.id
                      ? "border-awx-accent bg-awx-accent/5 ring-1 ring-awx-accent/30"
                      : "border-awx-border bg-white/[0.02]"
                  }`}
                >
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-lg font-bold">
                    {p.logo}
                  </div>
                  <div className="text-sm font-semibold text-gray-100">{p.name}</div>
                  <div className="mt-0.5 text-[11px] text-gray-500 leading-snug">{p.tagline}</div>
                  <div className="mt-3 text-base font-bold text-white">
                    {formatMoney(p.price, p.currency)}
                    <span className="ml-1 text-xs font-normal text-gray-500">/ {p.period}</span>
                  </div>
                  <div className="mt-1 text-[10px] text-gray-600">MCC {p.mcc}</div>
                </button>
              ))}
            </div>

            {/* Checkout panel */}
            <div className={`rounded-2xl border bg-white/[0.02] p-6 transition-all ${selected ? "border-awx-accent/30" : "border-awx-border"}`}>
              <h2 className="mb-4 text-sm font-semibold text-gray-300">
                {selected ? `Checkout — ${selected.name}` : "Select a product above to check out"}
              </h2>

              {selected && (
                <div className="mb-4 rounded-xl bg-white/5 px-4 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">{selected.name}</span>
                    <span className="font-semibold text-white">
                      {formatMoney(selected.price, selected.currency)} / {selected.period}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-gray-500">
                    Merchant category: {selected.mcc} · {selected.currency}
                  </div>
                </div>
              )}

              <div className={selected ? "" : "opacity-40 pointer-events-none"}>
                <label className="mb-1.5 block text-xs text-gray-400">Agent card ID</label>
                <div className="flex gap-2">
                  <input
                    className="input flex-1 font-mono text-sm"
                    placeholder="Paste card ID from provision_scoped_card…"
                    value={cardId}
                    onChange={(e) => setCardId(e.target.value)}
                  />
                  <button
                    disabled={!selected || !cardId.trim() || busy}
                    onClick={() => runCheckout(selected, cardId)}
                    className="rounded-lg bg-awx-accent px-5 py-2 text-sm font-semibold text-white hover:bg-awx-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {busy ? "Processing…" : selected ? `Pay ${formatMoney(selected.price, selected.currency)}` : "Pay"}
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-gray-600">
                  Card controls (MCC lock, spending cap, expiry, single-use) are enforced by Airwallex on authorization.
                </p>
              </div>

              {err && (
                <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{err}</p>
              )}
            </div>
          </>
        )}
      </main>

      <footer className="border-t border-awx-border px-8 py-4 text-center text-[11px] text-gray-600">
        This is a sandbox demo — no real money is charged · Virtual card infrastructure by{" "}
        <span className="text-gray-500">Airwallex</span>
      </footer>
    </div>
  );
}

export default function DemoStorePage() {
  return (
    <Suspense>
      <DemoStoreInner />
    </Suspense>
  );
}
