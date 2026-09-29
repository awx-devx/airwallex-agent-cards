"use client";

import { useEffect, useState, useCallback } from "react";
import { formatMoney, ago } from "@/lib/format";
import { flagForCurrency } from "@/lib/config";

interface ActivityEvent {
  id: string;
  ts: number;
  type: "card_charge" | "fx" | "deposit" | "topup" | "card_lifecycle";
  title: string;
  subtitle?: string;
  amount?: number;
  currency?: string;
  direction?: "in" | "out";
  status?: string;
}

const TYPE_ICON: Record<string, string> = {
  fx: "⇄",
  deposit: "↓",
  topup: "↑",
};

const TYPE_LABEL: Record<string, string> = {
  fx: "FX",
  deposit: "Deposit",
  topup: "Top-up",
};

export default function AccountActivity({ refreshSignal }: { refreshSignal?: number }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/activity");
      const data = await res.json();
      const filtered: ActivityEvent[] = (data.events || []).filter(
        (e: ActivityEvent) => e.type === "fx" || e.type === "deposit" || e.type === "topup",
      );
      setEvents(filtered.slice(0, 12));
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshSignal]);

  return (
    <div className="card-surface p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-300">Account Activity</h2>
        <p className="mt-0.5 text-[11px] text-gray-500">Recent FX conversions, deposits, and top-ups.</p>
      </div>

      {loading && (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-white/5" />
          ))}
        </div>
      )}

      {!loading && events.length === 0 && (
        <p className="text-xs text-gray-500">No account activity yet.</p>
      )}

      {!loading && events.length > 0 && (
        <div className="space-y-0 divide-y divide-awx-border">
          {events.map((e) => (
            <div key={e.id} className="flex items-center gap-3 py-2.5">
              {/* Icon */}
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold
                ${e.type === "fx" ? "bg-awx-accent/15 text-awx-accent"
                  : e.direction === "in" ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-amber-500/15 text-amber-400"}`}>
                {TYPE_ICON[e.type] ?? "·"}
              </div>

              {/* Description */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                    {TYPE_LABEL[e.type]}
                  </span>
                  {e.status && (
                    <span className={`text-[10px] ${e.status === "SETTLED" || e.status === "SUCCEEDED" ? "text-emerald-500" : "text-gray-600"}`}>
                      · {e.status.toLowerCase()}
                    </span>
                  )}
                </div>
                {e.type === "fx" && e.subtitle ? (
                  <div className="truncate text-xs text-gray-300">{e.subtitle}</div>
                ) : (
                  <div className="truncate text-xs text-gray-300">
                    {e.currency && flagForCurrency(e.currency)}{" "}
                    {e.amount != null ? formatMoney(e.amount, e.currency ?? "") : e.subtitle ?? "—"}
                  </div>
                )}
              </div>

              {/* Time */}
              <div className="shrink-0 text-[11px] text-gray-600">{ago(e.ts)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
