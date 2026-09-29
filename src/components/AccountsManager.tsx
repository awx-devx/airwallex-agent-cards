"use client";

import { useCallback, useEffect, useState } from "react";
import { OPENABLE_ACCOUNTS, flagForCountry, flagForCurrency } from "@/lib/config";
import { formatMoney } from "@/lib/format";

interface GlobalAccount {
  id: string;
  nickName?: string;
  accountName?: string;
  currency: string;
  countryCode: string;
  status: string;
  accountNumber?: string;
  iban?: string;
  swiftCode?: string;
  accountType?: string;
  institutionName?: string;
  routingCodes: { type: string; value: string }[];
  supportedCurrencies: string[];
}

interface AccountInfo {
  businessName: string;
  countryCode: string;
  domesticCurrency: string;
}

function StatusBadge({ status }: { status: string }) {
  const active = status === "ACTIVE";
  const processing = status === "PROCESSING";
  const title = processing
    ? "Airwallex is provisioning this account — it will become ACTIVE within minutes to hours"
    : undefined;
  return (
    <span
      title={title}
      className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
        active
          ? "bg-emerald-500/15 text-emerald-300"
          : processing
            ? "bg-amber-500/15 text-amber-300 cursor-help"
            : "bg-gray-500/15 text-gray-300"
      }`}
    >
      {status.toLowerCase()}
    </span>
  );
}

export default function AccountsManager() {
  const [accounts, setAccounts] = useState<GlobalAccount[]>([]);
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [balancesByCurrency, setBalancesByCurrency] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [preset, setPreset] = useState(OPENABLE_ACCOUNTS[1]?.label || "");
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accountsRes, balancesRes] = await Promise.all([
        fetch("/api/accounts"),
        fetch("/api/balances"),
      ]);
      const accountsData = await accountsRes.json();
      if (!accountsRes.ok) throw new Error(accountsData.error || "Failed to load accounts");
      setAccounts(accountsData.accounts || []);
      setInfo(accountsData.info || null);

      if (balancesRes.ok) {
        const balancesData = await balancesRes.json();
        const map = new Map<string, number>();
        for (const b of balancesData.balances || []) {
          if (b.account_type === "cash" || !map.has(b.currency)) {
            map.set(b.currency, b.available_amount ?? 0);
          }
        }
        setBalancesByCurrency(map);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function openAccount(e: React.FormEvent) {
    e.preventDefault();
    const choice = OPENABLE_ACCOUNTS.find((o) => o.label === preset);
    if (!choice) return;
    setOpening(true);
    setNotice(null);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          countryCode: choice.countryCode,
          currency: choice.currency,
          transferMethod: choice.transferMethod,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to open account");
      setNotice(
        `Opened ${choice.currency} account (${data.account?.status || "ACTIVE"}).`,
      );
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to open account");
    } finally {
      setOpening(false);
    }
  }

  const domestic = info?.domesticCurrency;

  // ACTIVE accounts first, PROCESSING second, anything else last
  const sortedAccounts = [...accounts].sort((a, b) => {
    const rank = (s: string) => (s === "ACTIVE" ? 0 : s === "PROCESSING" ? 1 : 2);
    return rank(a.status) - rank(b.status);
  });

  return (
    <div className="space-y-6">
      {info && (
        <p className="text-sm text-gray-400">
          {info.businessName} · domestic currency{" "}
          <span className="font-medium text-gray-200">{info.domesticCurrency}</span>
        </p>
      )}

      {/* Open a currency account */}
      <form
        onSubmit={openAccount}
        className="card-surface flex flex-wrap items-end gap-3 p-5"
      >
        <div className="flex-1 min-w-[220px]">
          <label className="mb-1 block text-xs text-gray-400">
            Add a currency account
          </label>
          <select
            className="input"
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
          >
            {OPENABLE_ACCOUNTS.map((o) => (
              <option key={o.label} value={o.label}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-primary" disabled={opening}>
          {opening ? "Opening…" : "Open account"}
        </button>
        {notice && (
          <p className="w-full rounded-lg bg-white/5 px-3 py-2 text-xs text-gray-300">
            {notice}
          </p>
        )}
      </form>

      {loading && <p className="text-sm text-gray-500">Loading accounts…</p>}
      {error && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {sortedAccounts.map((a) => (
          <AccountCard
            key={a.id}
            account={a}
            isDomestic={a.currency === domestic}
            balance={balancesByCurrency.get(a.currency)}
            onDeposited={(msg) => {
              setNotice(msg);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function AccountCard({
  account: a,
  isDomestic,
  balance,
  onDeposited,
}: {
  account: GlobalAccount;
  isDomestic: boolean;
  balance?: number;
  onDeposited: (msg: string) => void;
}) {
  const [expanded, setExpanded] = useState(isDomestic);
  const [amount, setAmount] = useState("5000");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function deposit() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/accounts/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ globalAccountId: a.id, amount: Number(amount) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Deposit failed");
      const line = `Simulated ${a.currency} ${amount} deposit — it will settle into your ${a.currency} wallet balance.`;
      setMsg(line);
      onDeposited(line);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Deposit failed");
    } finally {
      setBusy(false);
    }
  }

  const canDeposit = a.status === "ACTIVE";

  return (
    <div
      className={`card-surface ${isDomestic ? "ring-1 ring-awx-accent/50" : ""}`}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left p-5 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">{flagForCountry(a.countryCode)}</span>
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                {a.nickName || `${a.currency} account`}
                {isDomestic && (
                  <span className="rounded bg-awx-accent/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-awx-accent">
                    domestic
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-500">
                {a.institutionName} · {a.countryCode}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              <span className="rounded bg-white/5 px-2 py-0.5 text-xs font-medium text-gray-300">
                {a.currency}
              </span>
              <StatusBadge status={a.status} />
            </div>
            <div className="text-right text-lg font-semibold tracking-tight">
              {formatMoney(balance, a.currency)}
            </div>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-awx-border">
          <dl className="space-y-1.5 text-sm pt-4">
            {a.accountNumber && (
              <Row label="Account number" value={a.accountNumber} mono />
            )}
            {a.iban && <Row label="IBAN" value={a.iban} mono />}
            {a.swiftCode && <Row label="SWIFT / BIC" value={a.swiftCode} mono />}
            {a.routingCodes.slice(0, 3).map((rc) => (
              <Row
                key={`${rc.type}:${rc.value}`}
                label={rc.type.replace(/_/g, " ")}
                value={rc.value}
                mono
              />
            ))}
            {a.supportedCurrencies.length > 1 && (
              <Row
                label="Also receives"
                value={a.supportedCurrencies.filter((c) => c !== a.currency).join(", ") || "—"}
              />
            )}
          </dl>

          <div className="mt-4 flex items-end gap-2 border-t border-awx-border pt-4">
            <div className="flex-1">
              <label className="mb-1 block text-[11px] text-gray-500">
                Simulate an inbound deposit ({a.currency})
              </label>
              <input
                className="input !py-1.5"
                type="number"
                min="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={!canDeposit}
              />
            </div>
            <button
              className="btn-ghost !py-1.5"
              onClick={deposit}
              disabled={busy || !canDeposit}
              title={canDeposit ? "" : "Account must be ACTIVE to receive deposits"}
            >
              {busy ? "Depositing…" : "Deposit"}
            </button>
          </div>
          {msg && <p className="mt-2 text-xs text-gray-400">{msg}</p>}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs capitalize text-gray-500">{label}</dt>
      <dd className={`text-gray-200 ${mono ? "font-mono text-xs" : "text-sm"}`}>
        {value}
      </dd>
    </div>
  );
}
