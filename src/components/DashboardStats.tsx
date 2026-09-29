"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/format";

interface Stats {
  agentCount: number;
  frozenCount: number;
  cardCount: number;
  pendingApprovals: number;
  totalSpend: number;
  spendCurrency: string;
}

export default function DashboardStats() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [policyRes, agentsRes, approvalsRes, expensesRes] = await Promise.all([
          fetch("/api/policy"),
          fetch("/api/agents"),
          fetch("/api/approvals"),
          fetch("/api/expenses"),
        ]);
        const [policy, agentsData, approvalsData, expensesData] = await Promise.all([
          policyRes.json(),
          agentsRes.json(),
          approvalsRes.json(),
          expensesRes.json(),
        ]);

        const agents: { frozen?: boolean }[] = policy.agents ?? [];
        const agentEconomy: { cardCount: number }[] = agentsData.agents ?? [];
        const approvals: { status: string }[] = approvalsData.approvals ?? [];

        setStats({
          agentCount: agents.length,
          frozenCount: agents.filter((a) => a.frozen).length,
          cardCount: agentEconomy.reduce((s, a) => s + (a.cardCount ?? 0), 0),
          pendingApprovals: approvals.filter((a) => a.status === "pending").length,
          totalSpend: expensesData.summary?.totalSpend ?? 0,
          spendCurrency: expensesData.summary?.currency ?? "USD",
        });
      } catch {
        // best-effort
      }
    }
    load();
  }, []);

  if (!stats) return null;

  const items = [
    {
      label: "Agent profiles",
      value: String(stats.agentCount),
      sub: stats.frozenCount > 0 ? `${stats.frozenCount} frozen` : "none frozen",
      subColor: stats.frozenCount > 0 ? "text-red-400" : "text-gray-500",
      icon: "🤖",
      href: "/policies",
    },
    {
      label: "Cards issued",
      value: String(stats.cardCount),
      sub: "across all agents",
      subColor: "text-gray-500",
      icon: "💳",
      href: "/agents",
    },
    {
      label: "Pending approvals",
      value: String(stats.pendingApprovals),
      sub: stats.pendingApprovals > 0 ? "needs attention" : "queue clear",
      subColor: stats.pendingApprovals > 0 ? "text-amber-400" : "text-gray-500",
      icon: "✅",
      href: "/approvals",
    },
    {
      label: "Agent spend",
      value: formatMoney(stats.totalSpend, stats.spendCurrency),
      sub: "approved transactions",
      subColor: "text-gray-500",
      icon: "💰",
      href: "/expenses",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className="block rounded-2xl border border-awx-border border-t-2 border-t-orange-500/70 bg-orange-500/5 px-4 py-3 transition-colors hover:bg-orange-500/10"
        >
          <div className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/15 text-base">
            {item.icon}
          </div>
          <div className="text-xl font-semibold text-white">{item.value}</div>
          <div className="mt-0.5 text-[11px] text-gray-500">{item.label}</div>
          <div className={`flex items-center gap-1.5 text-[11px] ${item.subColor}`}>
            {item.sub}
          </div>
        </Link>
      ))}
    </div>
  );
}
