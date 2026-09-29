"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatMoney, ago } from "@/lib/format";
import { declineReasonLabel, merchantLabel, shortAgentName } from "@/lib/labels";

interface LedgerEntry {
  task_id: string;
  agent_id: string;
  card_id: string;
  amount: number;
  currency: string;
  txn_id?: string;
  status: string;
  decline_reason?: string;
  merchant?: string;
  mcc?: string;
  receipt_url?: string;
  created_at: string;
}

interface AgentStat {
  txns: number;
  approved: number;
  total: number;
  currency: string;
}

interface ExpensesData {
  summary: { totalSpend: number; totalTxns: number; approvedTxns: number; currency: string };
  byAgent: Record<string, AgentStat>;
  entries: LedgerEntry[];
}

function StatusBadge({ status }: { status: string }) {
  const ok = status === "APPROVED";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
      ok ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"
    }`}>
      {ok ? "Approved" : "Declined"}
    </span>
  );
}

export default function ExpensesView({ compact }: { compact?: boolean }) {
  const [data, setData] = useState<ExpensesData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/expenses")
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setErr(e.message));
  }, []);

  if (err) return <p className="text-sm text-red-300">{err}</p>;
  if (!data) return <p className="text-sm text-gray-500">Loading…</p>;

  const { summary, byAgent, entries } = data;
  const agentList = Object.entries(byAgent).sort((a, b) => b[1].total - a[1].total);
  const totalForPct = summary.totalSpend || 1;

  return (
    <div className="space-y-6">
      {!compact && (
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total approved spend", value: formatMoney(summary.totalSpend, summary.currency) },
          { label: "Transactions", value: `${summary.approvedTxns} approved / ${summary.totalTxns} total` },
          { label: "Agents active", value: String(Object.keys(byAgent).length) },
        ].map((s) => (
          <div key={s.label} className="card-surface p-4">
            <p className="text-[11px] text-gray-500">{s.label}</p>
            <p className="mt-1 text-xl font-semibold text-white">{s.value}</p>
          </div>
        ))}
      </div>
      )}

      {agentList.length > 0 && (
        <div className="card-surface p-5">
          <h2 className="mb-4 text-sm font-semibold text-gray-300">Spend by agent</h2>
          <div className="space-y-3">
            {agentList.map(([agentId, stat]) => {
              const pct = Math.round((stat.total / totalForPct) * 100);
              return (
                <div key={agentId}>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="font-medium text-gray-200">{shortAgentName(undefined, agentId)}</span>
                    <span className="text-gray-400">
                      {formatMoney(stat.total, stat.currency)} · {stat.approved}/{stat.txns} purchases
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-white/5">
                    <div
                      className="h-1.5 rounded-full bg-awx-accent"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card-surface p-5">
        <h2 className="mb-4 text-sm font-semibold text-gray-300">
          {compact ? "Task receipts" : "All transactions"}
        </h2>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">
            No purchases yet. Run an agent task or try a purchase on a card.
          </p>
        ) : (
          <div className="divide-y divide-awx-border/60">
            {entries.map((e, i) => (
              <div key={`${e.task_id}-${i}`} className="flex items-start gap-3 py-3">
                <div className="mt-0.5 text-base">{e.status === "APPROVED" ? "💳" : "⛔"}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-gray-100">
                      {e.merchant ?? e.task_id}
                    </span>
                    <StatusBadge status={e.status} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-gray-500">
                    <span>{shortAgentName(undefined, e.agent_id)}</span>
                    {e.task_id && (
                      <>
                        <span>·</span>
                        <span className="font-mono">{e.task_id}</span>
                      </>
                    )}
                    {e.mcc && (
                      <>
                        <span>·</span>
                        <span>{merchantLabel(e.mcc)}</span>
                      </>
                    )}
                    {e.decline_reason && (
                      <><span>·</span><span className="text-red-300">{declineReasonLabel(e.decline_reason)}</span></>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-sm font-medium ${
                    e.status === "APPROVED" ? "text-gray-100" : "text-gray-500 line-through"
                  }`}>
                    {formatMoney(e.amount, e.currency)}
                  </div>
                  <div className="mt-0.5 flex items-center justify-end gap-2 text-[11px] text-gray-500">
                    <span>{ago(e.created_at)}</span>
                    {e.receipt_url && (
                      <Link
                        href={e.receipt_url}
                        className="text-awx-accent hover:underline"
                        target="_blank"
                      >
                        Receipt →
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
