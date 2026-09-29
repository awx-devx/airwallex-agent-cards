import Link from "next/link";
import { flagForCurrency } from "@/lib/config";
import { formatMoney } from "@/lib/format";
import type { WalletView } from "@/lib/wallet";

/** Presentational wallet-balance card grid (usable in server or client trees). */
export default function WalletBalances({ view }: { view: WalletView }) {
  const { currencies, cashByCurrency, accountByCurrency, domestic } = view;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {currencies.map((ccy) => {
        const b = cashByCurrency.get(ccy);
        const acct = accountByCurrency.get(ccy);
        const isDomestic = ccy === domestic;
        const accountRef = acct?.accountNumber
          ? acct.accountNumber
          : acct?.iban
            ? `…${acct.iban.slice(-8)}`
            : null;
        return (
          <Link
            key={ccy}
            href="/accounts"
            className="card-surface block p-4 hover:ring-1 hover:ring-awx-accent/50 transition-shadow cursor-pointer"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xl">{flagForCurrency(ccy)}</span>
              <span className="rounded bg-white/5 px-2 py-0.5 text-xs font-medium text-gray-300">
                {ccy}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-gray-400">
              {isDomestic ? "Domestic" : "Wallet"}
              {isDomestic && (
                <span className="rounded bg-awx-accent/20 px-1 py-0.5 text-[9px] font-semibold uppercase text-awx-accent">
                  home
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xl font-semibold tracking-tight">
              {formatMoney(b?.available_amount, ccy)}
            </div>
            <div className="mt-2 text-[11px] text-gray-500">
              {acct ? (
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span>Account</span>
                    {acct.status === "PROCESSING" && (
                      <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase text-amber-400">
                        processing
                      </span>
                    )}
                  </div>
                  {accountRef && (
                    <div className="font-mono text-[10px] text-gray-400">{accountRef}</div>
                  )}
                </div>
              ) : (
                "No account"
              )}
            </div>
          </Link>
        );
      })}

      <Link
        href="/accounts"
        className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-awx-border p-4 text-gray-500 hover:border-awx-accent/50 hover:text-awx-accent transition-colors cursor-pointer"
      >
        <span className="text-2xl leading-none">+</span>
        <span className="text-[11px] font-medium uppercase tracking-wide">Open account</span>
      </Link>
    </div>
  );
}
