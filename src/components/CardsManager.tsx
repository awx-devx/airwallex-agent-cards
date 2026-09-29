"use client";

import { useCallback, useEffect, useState } from "react";
import { formatMoney } from "@/lib/format";
import { MERCHANT_CATEGORIES } from "@/lib/config";
import { issuanceModeShort, policyLine, shortAgentName } from "@/lib/labels";
import { CardTile, type Card } from "./CardTile";

interface AgentGroup {
  agentId: string;
  projectId: string;
  currency: string;
  cardCount: number;
  totalSpent: number;
  cards: Card[];
}

interface PolicyConfig {
  policy_id: string;
  display_name: string;
  currency: string;
  per_transaction_cap: number;
  total_budget?: number;
}

interface AgentConfig {
  agent_id: string;
  display_name: string;
  project_id: string;
  issuance_mode: string;
  policy_id: string;
}

export default function CardsManager({ currencies: _currencies }: { currencies: string[] }) {
  const [agents, setAgents] = useState<AgentGroup[]>([]);
  const [untagged, setUntagged] = useState<Card[]>([]);
  const [policyConfigs, setPolicyConfigs] = useState<PolicyConfig[]>([]);
  const [agentConfigs, setAgentConfigs] = useState<AgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLeftovers, setShowLeftovers] = useState(false);

  const [issueOpen, setIssueOpen] = useState(false);
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [singleUse, setSingleUse] = useState(false);
  const [limit, setLimit] = useState("500");
  const [currency, setCurrency] = useState("USD");
  const [expiresOn, setExpiresOn] = useState("");
  const [mccs, setMccs] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Policy/agent configs update as soon as /api/policy resolves — don't block on the slow Airwallex call
    fetch("/api/policy")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setPolicyConfigs(data.policies || []);
          setAgentConfigs(data.agents || []);
        }
      })
      .catch(() => {});
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load agents");
      setAgents(data.agents || []);
      setUntagged(data.untagged || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function applyPolicyDefaults(id: string) {
    setSelectedPolicyId(id);
    if (!id) return;
    const p = policyConfigs.find((pol) => pol.policy_id === id);
    if (p) {
      setCurrency(p.currency);
      setLimit(String(p.per_transaction_cap));
    }
  }

  function openIssue(policyId: string, agentIdValue: string) {
    applyPolicyDefaults(policyId);
    setAgentId(agentIdValue);
    setCreateMsg(null);
    setIssueOpen(true);
  }

  const effectiveAgentId = agentId.trim();

  async function createNewCard(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveAgentId) {
      setCreateMsg("Select an agent first.");
      return;
    }
    setCreating(true);
    setCreateMsg(null);
    try {
      const res = await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: effectiveAgentId,
          policyId: selectedPolicyId || undefined,
          singleUse,
          limitAmount: Number(limit),
          currency,
          expiresOn: expiresOn || undefined,
          allowedMerchantCategories: mccs.length ? mccs : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create card");
      setCreateMsg(`Issued a ${singleUse ? "single-use" : "multi-use"} card.`);
      setIssueOpen(false);
      await load();
    } catch (err) {
      setCreateMsg(err instanceof Error ? err.message : "Failed to create card");
    } finally {
      setCreating(false);
    }
  }

  type FlatCard = Card & { agentId: string; projectId: string };
  const byDate = (a: FlatCard, b: FlatCard) => (b.created_at ?? "").localeCompare(a.created_at ?? "");
  const closedCards: FlatCard[] = agents
    .flatMap((g) =>
      g.cards
        .filter((c) => c.card_status === "CLOSED")
        .map((c) => ({ ...c, agentId: g.agentId, projectId: g.projectId })),
    )
    .sort(byDate);

  // Block issuance if the entered agent_id already has a live card.
  const selectedAgentHasCard =
    effectiveAgentId
      ? agents.some(
          (g) =>
            g.agentId === effectiveAgentId &&
            g.cards.some((c) => c.card_status === "ACTIVE" || c.card_status === "INACTIVE"),
        )
      : false;

  // Unmanaged agents: in Airwallex but not in any agent config
  const managedIds = new Set(agentConfigs.map((a) => a.agent_id));
  const unmanagedGroups = agents.filter((g) => !managedIds.has(g.agentId));

  const leftoverCount = unmanagedGroups.length + untagged.length + closedCards.length;
  const issuingAgent = agentConfigs.find((a) => a.agent_id === effectiveAgentId);

  return (
    <div className="space-y-4">
      <section className="space-y-4">
        <div className="card-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300">Agents</h2>
            <button className="btn-ghost !py-1.5" onClick={load}>
              Refresh
            </button>
          </div>

          {loading && <p className="text-sm text-gray-500">Loading agent cards…</p>}
          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
          )}

          {policyConfigs.length === 0 && agentConfigs.length === 0 && !loading && (
            <p className="text-sm text-gray-500">
              No agent profiles configured. Add a policy and agent profile on the{" "}
              <a href="/policies" className="text-awx-accent hover:underline">Policies page</a>{" "}
              to get started.
            </p>
          )}

          {/* Agent-first groups — each agent is the primary item; policy is metadata */}
          <div className="space-y-5">
            {agentConfigs.map((ac) => {
              const policy = policyConfigs.find((p) => p.policy_id === ac.policy_id);
              const ag = agents.find((g) => g.agentId === ac.agent_id);
              const currency = policy?.currency ?? ag?.currency ?? "USD";
              const budget = policy?.total_budget ?? 0;
              const spent = ag?.totalSpent ?? 0;
              const barPct = budget ? Math.min(100, (spent / budget) * 100) : 0;
              const overBudget = budget > 0 && spent >= budget;
              const selfServe = ac.issuance_mode === "self_serve_within_policy";
              const liveCards = (ag?.cards ?? [])
                .filter((c) => c.card_status !== "CLOSED")
                .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

              return (
                <div key={ac.agent_id} className="rounded-xl border border-awx-border bg-white/5 p-4">
                  {/* Agent header */}
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-100">{shortAgentName(ac.display_name, ac.agent_id)}</span>
                        <span className="font-mono text-[10px] text-gray-600">{ac.agent_id}</span>
                      </div>
                      {policy && (
                        <div className="mt-0.5 text-[11px] text-gray-500">
                          {policyLine(policy)}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${selfServe ? "bg-awx-accent2/15 text-awx-accent2" : "bg-awx-accent/15 text-awx-accent"}`}>
                        {issuanceModeShort(ac.issuance_mode)}
                      </span>
                      {budget > 0 && (
                        <span className={`text-[11px] font-semibold ${overBudget ? "text-red-400" : spent > 0 ? "text-amber-400" : "text-gray-500"}`}>
                          {formatMoney(spent, currency)}
                          <span className="font-normal text-gray-600"> / {formatMoney(budget, currency)}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Budget bar */}
                  {budget > 0 && (
                    <div className="mb-3">
                      <div className="h-1.5 w-full rounded-full bg-white/10">
                        <div
                          className={`h-1.5 rounded-full transition-all ${overBudget ? "bg-red-500" : barPct > 75 ? "bg-amber-500" : "bg-emerald-500"}`}
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                      <div className={`mt-1 text-[10px] ${overBudget ? "text-red-400" : barPct > 75 ? "text-amber-400" : "text-gray-600"}`}>
                        {overBudget
                          ? `⛔ ${formatMoney(spent - budget, currency)} over budget`
                          : barPct > 75
                          ? `⚠ ${Math.round(barPct)}% of budget used`
                          : `${formatMoney(budget - spent, currency)} remaining`}
                      </div>
                    </div>
                  )}

                  {/* Cards */}
                  {liveCards.length > 0 ? (
                    <div className="grid gap-3">
                      {liveCards.map((c) => (
                        <CardTile
                          key={c.card_id}
                          card={c}
                          agentId={ac.agent_id}
                          projectId={ac.project_id}
                          onChanged={load}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-lg border border-dashed border-awx-border px-3 py-2">
                      <span className="text-[11px] text-gray-600">No active card</span>
                      {policy && (
                        <button
                          type="button"
                          className="text-[11px] text-awx-accent hover:underline"
                          onClick={() => openIssue(policy.policy_id, ac.agent_id)}
                        >
                          Issue card
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {leftoverCount > 0 && (
            <div className="mt-6 border-t border-awx-border pt-4">
              <button
                onClick={() => setShowLeftovers((v) => !v)}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                {showLeftovers ? "▾" : "▸"} Show leftover sandbox cards ({leftoverCount})
              </button>
              {showLeftovers && (
                <div className="mt-3 space-y-4">
                  {closedCards.length > 0 && (
                    <div>
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        Closed · {closedCards.length}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {closedCards.map((c) => (
                          <CardTile
                            key={c.card_id}
                            card={c}
                            agentId={c.agentId}
                            projectId={c.projectId}
                            onChanged={load}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {unmanagedGroups.map((g) => {
                    const live = g.cards
                      .filter((c) => c.card_status !== "CLOSED")
                      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
                    return (
                      <div key={g.agentId}>
                        <div className="mb-2 text-[11px] font-mono text-gray-500">{g.agentId}</div>
                        {live.length > 0 ? (
                          <div className="grid gap-3 sm:grid-cols-2">
                            {live.map((c) => (
                              <CardTile key={c.card_id} card={c} agentId={g.agentId} projectId={g.projectId} onChanged={load} />
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500">No active cards.</p>
                        )}
                      </div>
                    );
                  })}
                  {untagged.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {[...untagged]
                        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
                        .map((c) => (
                          <CardTile key={c.card_id} card={c} onChanged={load} />
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {issueOpen && (
        <div className="fixed inset-0 z-[70] grid place-items-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIssueOpen(false)} />
          <form onSubmit={createNewCard} className="card-surface relative z-10 w-full max-w-sm space-y-4 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-100">Issue card</h2>
              <button type="button" onClick={() => setIssueOpen(false)} className="text-gray-500 hover:text-white">&times;</button>
            </div>
            <p className="text-[12px] text-gray-400">
              For {shortAgentName(issuingAgent?.display_name, effectiveAgentId)}
              {issuingAgent && (
                <span className="font-mono text-[10px] text-gray-600"> · {issuingAgent.agent_id}</span>
              )}
            </p>

            {selectedAgentHasCard && (
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                This agent already has an active card. Freeze or cancel it first.
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSingleUse(false)}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs ${
                  !singleUse ? "border-awx-accent bg-awx-accent/10 text-white" : "border-awx-border text-gray-400"
                }`}
              >
                Multi-use
              </button>
              <button
                type="button"
                onClick={() => setSingleUse(true)}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs ${
                  singleUse ? "border-awx-accent2 bg-awx-accent2/10 text-white" : "border-awx-border text-gray-400"
                }`}
              >
                Single-use
              </button>
            </div>
            <p className="text-[10px] text-gray-600">
              {singleUse
                ? "Closes after the first purchase."
                : "Stays open. Limit resets monthly."}
            </p>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-gray-400">
                  {singleUse ? "Max per purchase" : "Monthly spend limit"}
                </label>
                <input className="input" type="number" min="1" value={limit} onChange={(e) => setLimit(e.target.value)} />
              </div>
              <div className="w-24">
                <label className="mb-1 block text-xs text-gray-400">Currency</label>
                <div className="input bg-white/5 text-gray-400 cursor-not-allowed">{currency}</div>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-gray-400">Expires on (optional)</label>
              <input className="input" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
            </div>

            <div>
              <label className="mb-1 block text-xs text-gray-400">Allowed merchant types</label>
              <div className="flex flex-wrap gap-1.5">
                {MERCHANT_CATEGORIES.map((m) => {
                  const on = mccs.includes(m.code);
                  return (
                    <button
                      key={m.code}
                      type="button"
                      title={`Network code ${m.code}`}
                      onClick={() =>
                        setMccs((prev) =>
                          on ? prev.filter((c) => c !== m.code) : [...prev, m.code],
                        )
                      }
                      className={`rounded-full border px-2.5 py-1 text-[11px] ${
                        on
                          ? "border-awx-accent bg-awx-accent/15 text-white"
                          : "border-awx-border text-gray-400 hover:text-white"
                      }`}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[11px] text-gray-600">
                Leave empty to allow any merchant.
              </p>
            </div>

            <div className="flex gap-2">
              <button className="btn-primary flex-1" disabled={creating || !!selectedAgentHasCard || !effectiveAgentId}>
                {creating ? "Issuing…" : "Issue card"}
              </button>
              <button type="button" onClick={() => setIssueOpen(false)} className="rounded-lg border border-awx-border px-4 py-2 text-sm text-gray-400 hover:bg-white/5">
                Cancel
              </button>
            </div>

            {createMsg && (
              <p className={`rounded-lg px-3 py-2 text-xs ${
                createMsg.toLowerCase().includes("budget")
                  ? "bg-red-500/15 text-red-300 font-medium"
                  : createMsg.startsWith("Issued")
                  ? "bg-emerald-500/10 text-emerald-300"
                  : "bg-white/5 text-gray-300"
              }`}>{createMsg}</p>
            )}
          </form>
        </div>
      )}
    </div>
  );
}

