"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatMoney, ago } from "@/lib/format";
import DemoNote from "@/components/DemoNote";
import { statusLabel } from "@/lib/labels";
import type { ActivityEvent } from "@/lib/activityTypes";

// Toggle chips → which event types they include.
const FILTERS: { key: string; label: string; types?: ActivityEvent["type"][]; declined?: boolean }[] = [
  { key: "all", label: "All" },
  { key: "purchases", label: "Purchases", types: ["card_charge"] },
  { key: "declines", label: "Declines", types: ["card_charge"], declined: true },
  { key: "deposits", label: "Deposits", types: ["deposit", "topup"] },
];

const ICON: Record<ActivityEvent["type"], string> = {
  card_charge: "💳",
  fx: "🔁",
  deposit: "⬇️",
  topup: "➕",
  card_lifecycle: "🪪",
};

function declined(status?: string) {
  return status === "FAILED" || status === "DECLINED";
}

export default function RecentTransactions({
  limit,
  pollMs = 5000,
  agentFilter,
  initialEvents = [],
}: {
  limit?: number;
  pollMs?: number;
  agentFilter?: string;
  initialEvents?: ActivityEvent[];
}) {
  const [events, setEvents] = useState<ActivityEvent[]>(initialEvents);
  const [on, setOn] = useState("all");
  const [updated, setUpdated] = useState<number | null>(initialEvents.length ? Date.now() : null);
  const [loading, setLoading] = useState(initialEvents.length === 0);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const inflight = useRef<Promise<void> | null>(null);
  const hasEvents = useRef(initialEvents.length > 0);

  const load = useCallback(async () => {
    if (inflight.current) return inflight.current;
    inflight.current = (async () => {
      try {
        const res = await fetch("/api/activity");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load activity");
        const next = data.events || [];
        hasEvents.current = next.length > 0;
        setEvents(next);
        setUpdated(Date.now());
        setErr(null);
      } catch (e) {
        if (!hasEvents.current) {
          setErr(e instanceof Error ? e.message : "Failed to load activity");
        }
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    return inflight.current;
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, pollMs);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load, pollMs]);

  const filter = FILTERS.find((f) => f.key === on) ?? FILTERS[0];
  const shown = events
    .filter((e) => !filter.types || filter.types.includes(e.type))
    .filter((e) => !filter.declined || declined(e.status))
    .filter((e) => filter.key !== "purchases" || !declined(e.status))
    .filter((e) => !agentFilter || e.agent_id === agentFilter)
    .slice(0, limit ?? 100);

  return (
    <div className="card-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-300">Recent activity</h2>
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            live
          </span>
          <DemoNote note="This feed mixes Airwallex sandbox charges with local task receipts. Production would use webhooks instead of polling." />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-gray-500">
            {updated ? `updated ${ago(updated)}` : "…"}
          </span>
          {limit != null && (
            <Link href="/activity" className="text-xs text-awx-accent hover:underline">
              View all →
            </Link>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const active = on === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setOn(f.key)}
              className={`rounded-full border px-2.5 py-1 text-[11px] ${
                active
                  ? "border-awx-accent bg-awx-accent/15 text-white"
                  : "border-awx-border text-gray-500 hover:text-gray-300"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {agentFilter && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-awx-accent/10 px-3 py-2 text-[11px]">
          <span className="text-awx-accent">Filtered by agent:</span>
          <span className="font-medium text-white">{agentFilter}</span>
          <a href="/activity" className="ml-auto text-gray-400 hover:text-white">
            Clear ×
          </a>
        </div>
      )}

      {err && <p className="mb-2 text-[11px] text-red-300">{err}</p>}

      <div className="divide-y divide-awx-border/60">
        {loading && shown.length === 0 && (
          <p className="py-6 text-center text-sm text-gray-500">Loading activity…</p>
        )}
        {!loading && shown.length === 0 && (
          <p className="py-6 text-center text-sm text-gray-500">
            No activity yet for the selected filters.
          </p>
        )}
        {shown.map((e) => (
          <div key={e.id} className="flex items-center gap-3 py-2.5">
            <span className="text-base">{ICON[e.type]}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-gray-100">{e.title}</div>
              {e.subtitle && (
                <div className="truncate text-[11px] text-gray-500">{e.subtitle}</div>
              )}
            </div>
            <div className="text-right">
              {e.amount != null && e.currency && (
                <div
                  className={`text-sm ${
                    declined(e.status)
                      ? "text-gray-500 line-through"
                      : e.direction === "in"
                        ? "text-emerald-300"
                        : "text-gray-200"
                  }`}
                >
                  {e.direction === "in" ? "+" : e.direction === "out" ? "−" : ""}
                  {formatMoney(e.amount, e.currency)}
                </div>
              )}
              <div className="text-[11px] text-gray-500">
                {declined(e.status) ? (
                  <span className="text-red-300">{statusLabel(e.status)}</span>
                ) : (
                  statusLabel(e.status)
                )}{" "}
                · {ago(e.ts)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
