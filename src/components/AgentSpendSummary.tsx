"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/format";
import { shortAgentName } from "@/lib/labels";

interface AgentSummary {
  agentId: string;
  displayName: string;
  currency: string;
  totalSpent: number;
  totalBudget: number;
  cardCount: number;
}

export default function AgentSpendSummary() {
  const [summaries, setSummaries] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [agentsRes, policyRes] = await Promise.all([
          fetch("/api/agents"),
          fetch("/api/policy"),
        ]);
        const agentsData = await agentsRes.json();
        const policyData = await policyRes.json();

        const spendByAgent = new Map(
          (agentsData.agents || []).map(
            (g: { agentId: string; totalSpent: number; cardCount: number; currency: string }) => [
              g.agentId,
              g,
            ],
          ),
        );

        // Build a map of policy_id → policy for budget/currency resolution
        const policyMap = new Map(
          (policyData.policies || []).map(
            (p: { policy_id: string; currency: string; total_budget: number }) => [
              p.policy_id,
              p,
            ],
          ),
        );

        const result: AgentSummary[] = (policyData.agents || []).map(
          (a: { agent_id: string; display_name: string; policy_id: string }) => {
            const ag = spendByAgent.get(a.agent_id) as
              | { totalSpent: number; cardCount: number; currency: string }
              | undefined;
            const policy = policyMap.get(a.policy_id) as
              | { currency: string; total_budget: number }
              | undefined;
            return {
              agentId: a.agent_id,
              displayName: a.display_name,
              currency: policy?.currency ?? ag?.currency ?? "USD",
              totalSpent: ag?.totalSpent ?? 0,
              totalBudget: policy?.total_budget ?? 0,
              cardCount: ag?.cardCount ?? 0,
            };
          },
        );

        setSummaries(result);
      } catch {
        // best-effort
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading || summaries.length === 0) return null;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300">Agent spend</h2>
        <Link href="/agents" className="text-xs text-awx-accent hover:underline">
          Manage cards →
        </Link>

      </div>
      <div className="card-surface overflow-hidden">
        {summaries.map((s, i) => {
          const pct = s.totalBudget ? Math.min(100, (s.totalSpent / s.totalBudget) * 100) : 0;
          const over = s.totalBudget > 0 && s.totalSpent >= s.totalBudget;
          const barColor = over
            ? "bg-red-500"
            : pct > 75
              ? "bg-amber-500"
              : "bg-emerald-500";

          return (
            <Link
              key={s.agentId}
              href="/agents"
              className={`flex items-center gap-4 px-5 py-3.5 hover:bg-white/5 transition-colors ${
                i > 0 ? "border-t border-awx-border" : ""
              }`}
            >
              <div className="w-36 shrink-0">
                <div className="text-sm text-gray-100">{shortAgentName(s.displayName, s.agentId)}</div>
                <div className="text-[11px] text-gray-500">
                  {s.cardCount} card{s.cardCount === 1 ? "" : "s"}
                </div>
                {over && (
                  <div className="text-[11px] font-medium text-red-400">⛔ budget exhausted</div>
                )}
                {!over && pct > 75 && (
                  <div className="text-[11px] font-medium text-amber-400">⚠ {Math.round(pct)}% used</div>
                )}
              </div>

              <div className="flex-1">
                <div className="h-1.5 w-full rounded-full bg-white/10">
                  <div
                    className={`h-1.5 rounded-full transition-all ${barColor}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              <div className="w-32 shrink-0 text-right">
                <span
                  className={`text-sm font-medium ${s.totalSpent > 0 ? "text-amber-400" : "text-gray-500"}`}
                >
                  {formatMoney(s.totalSpent, s.currency)}
                </span>
                {s.totalBudget > 0 && (
                  <span className="text-[11px] text-gray-500">
                    {" / "}
                    {formatMoney(s.totalBudget, s.currency)}
                  </span>
                )}
              </div>

              <span className="text-[11px] text-gray-600">→</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
