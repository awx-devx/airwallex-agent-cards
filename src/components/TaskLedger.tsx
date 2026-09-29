"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatMoney, ago } from "@/lib/format";
import DemoNote from "@/components/DemoNote";
import { declineReasonLabel } from "@/lib/labels";

interface LedgerEntry {
  task_id: string;
  agent_id: string;
  card_id: string;
  amount: number;
  currency: string;
  status: string;
  decline_reason?: string;
  merchant?: string;
  mcc?: string;
  created_at: string;
}

interface AgentSummary {
  agent_id: string;
  display_name: string;
  budget: number;
  currency: string;
  spent: number;
  declined: number;
  blocked: number;
  task_count: number;
  remaining: number;
}


function statusColor(s: string) {
  if (s === "APPROVED") return "text-emerald-400";
  if (s === "DECLINED" || s === "BLOCKED_AT_ISSUANCE") return "text-red-400";
  return "text-gray-400";
}

export default function TaskLedger() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [summaries, setSummaries] = useState<AgentSummary[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/ledger");
      const d = await r.json();
      setEntries(d.ledger || []);
      setSummaries(d.agentSummaries || []);
    } catch { /* swallow */ }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 5000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]);

  if (entries.length === 0 && summaries.length === 0) return null;

  return (
    <div className="card-surface mb-6 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300">Agent spend &amp; task ledger</h2>
        <span className="text-[11px] text-gray-500">{entries.length} tasks recorded
          <DemoNote note="Velocity (max txns/hr) and budget enforcement happen at the app layer before card provisioning. The Airwallex-native controls (per-txn cap, MCC lock, expiry, single-use) are enforced at the rail on every authorization. Production would add an inline auth-webhook for tighter budget enforcement." />
        </span>
      </div>

      {/* Per-agent budget bars */}
      {summaries.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          {summaries.map((s) => {
            const pct = s.budget > 0 ? Math.min(100, (s.spent / s.budget) * 100) : 0;
            const warn = pct > 80;
            return (
              <div key={s.agent_id} className="rounded-xl border border-awx-border bg-white/5 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-200">{s.display_name}</span>
                  <span className="text-[11px] text-gray-500">{s.task_count} tasks</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${warn ? "bg-amber-500" : "bg-emerald-500"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[11px]">
                  <span className={warn ? "text-amber-400" : "text-emerald-400"}>
                    {formatMoney(s.spent, s.currency)} spent
                  </span>
                  <span className="text-gray-500">
                    {formatMoney(s.remaining, s.currency)} of {formatMoney(s.budget, s.currency)} remaining
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Task ledger table */}
      {entries.length > 0 && (
        <div className="divide-y divide-awx-border/60">
          {entries.slice(0, 30).map((e, i) => (
            <div key={`${e.task_id}-${i}`} className="flex items-center gap-3 py-2">
              <span className={`text-[11px] font-mono ${statusColor(e.status)}`}>{e.status}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] text-gray-200">
                  <span className="font-mono text-gray-400">{e.task_id}</span>
                  {e.merchant && <span className="ml-2 text-gray-300">{e.merchant}</span>}
                </div>
                <div className="text-[10px] text-gray-500">
                  {e.agent_id} · card {e.card_id.slice(0, 8)}…
                  {e.decline_reason && <span className="ml-1 text-red-400">{declineReasonLabel(e.decline_reason)}</span>}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[12px] text-gray-200">{formatMoney(e.amount, e.currency)}</div>
                <div className="text-[10px] text-gray-500">{ago(e.created_at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
