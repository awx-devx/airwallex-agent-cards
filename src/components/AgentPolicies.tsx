"use client";

import { useCallback, useEffect, useState } from "react";
import { MERCHANT_CATEGORIES, KNOWN_CURRENCIES, mccLabel } from "@/lib/config";
import { formatMoney } from "@/lib/format";
import DemoNote from "@/components/DemoNote";
import { issuanceModeLabel, issuanceModeShort, policyLine, shortAgentName } from "@/lib/labels";
import type { Policy, Agent } from "@/lib/store";

// ── Shared helpers ────────────────────────────────────────────────────────────

interface AgentEconomy {
  agentId: string;
  cardCount: number;
  totalSpent: number;
  currency: string;
}

function blankPolicy(): Policy {
  return {
    policy_id: "",
    display_name: "",
    currency: "USD",
    total_budget: 5000,
    per_transaction_cap: 500,
    allowed_merchant_categories: [],
    card_expiry_days: 30,
    velocity_max_per_hour: 10,
  };
}

function blankAgent(): Agent {
  return {
    agent_id: "",
    display_name: "",
    project_id: "",
    issuance_mode: "human_provisioned",
    policy_id: "",
  };
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-white/5 px-2 py-0.5 text-gray-300">{children}</span>
  );
}

// ── PolicyForm ────────────────────────────────────────────────────────────────

interface PolicyFormProps {
  initial?: Policy;
  onSave: (policy: Policy) => void;
  onCancel: () => void;
}

function PolicyForm({ initial, onSave, onCancel }: PolicyFormProps) {
  const editing = !!initial;
  const [form, setForm] = useState<Policy>(initial ?? blankPolicy());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof Policy>(key: K, value: Policy[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = form.policy_id.trim();
    if (!editing && !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      setErr("Policy ID must be lowercase: letters, digits, hyphens, starting with a letter/digit.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/policy", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "policy", ...form, policy_id: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      onSave(data.policy as Policy);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const mccs = form.allowed_merchant_categories;

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-awx-accent/40 bg-white/5 p-4 space-y-3"
    >
      <div className="text-sm font-medium text-gray-200">
        {editing ? `Edit policy — ${form.display_name}` : "New policy"}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-gray-400">Policy ID *</label>
          {editing ? (
            <div className="text-xs text-gray-300 py-2 px-2 rounded-lg bg-white/5">
              {form.policy_id}
            </div>
          ) : (
            <input
              className="input"
              value={form.policy_id}
              onChange={(e) => set("policy_id", e.target.value.toLowerCase())}
              placeholder="research-policy"
              required
            />
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-400">Display name *</label>
          <input
            className="input"
            value={form.display_name}
            onChange={(e) => set("display_name", e.target.value)}
            placeholder="Research Policy"
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="mb-1 block text-xs text-gray-400">Currency</label>
          <select
            className="input"
            value={form.currency}
            onChange={(e) => set("currency", e.target.value)}
          >
            {KNOWN_CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-400">Total budget</label>
          <input
            className="input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={form.total_budget || ""}
            onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); set("total_budget", v ? Number(v) : 0); }}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-400">Max per purchase</label>
          <input
            className="input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={form.per_transaction_cap || ""}
            onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); set("per_transaction_cap", v ? Number(v) : 0); }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-gray-400">Card expiry (days)</label>
          <input
            className="input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={form.card_expiry_days || ""}
            onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); set("card_expiry_days", v ? Number(v) : 0); }}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-400">Max purchases per hour</label>
          <input
            className="input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={form.velocity_max_per_hour || ""}
            onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); set("velocity_max_per_hour", v ? Number(v) : 0); }}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-gray-400">
          Allowed merchant types (empty = any)
        </label>
        <div className="flex flex-wrap gap-1.5">
          {MERCHANT_CATEGORIES.map((m) => {
            const on = mccs.includes(m.code);
            return (
              <button
                key={m.code}
                type="button"
                onClick={() =>
                  set(
                    "allowed_merchant_categories",
                    on ? mccs.filter((c) => c !== m.code) : [...mccs, m.code],
                  )
                }
                className={`rounded-full border px-2.5 py-1 text-[11px] ${
                  on
                    ? "border-awx-accent bg-awx-accent/15 text-white"
                    : "border-awx-border text-gray-400 hover:text-white"
                }`}
              >
                <span title={`Network code ${m.code}`}>{m.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {err && <p className="text-xs text-red-300">{err}</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" className="btn-primary flex-1" disabled={saving}>
          {saving ? "Saving…" : editing ? "Save changes" : "Create policy"}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── AgentForm ─────────────────────────────────────────────────────────────────

interface AgentFormProps {
  initial?: Agent;
  policies: Policy[];
  onSave: (agent: Agent) => void;
  onCancel: () => void;
}

function AgentForm({ initial, policies, onSave, onCancel }: AgentFormProps) {
  const editing = !!initial;
  const [form, setForm] = useState<Agent>(initial ?? blankAgent());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof Agent>(key: K, value: Agent[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = form.agent_id.trim();
    if (!editing && !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      setErr("Agent ID must be lowercase: letters, digits, hyphens, starting with a letter/digit.");
      return;
    }
    if (!form.policy_id) {
      setErr("A policy must be selected.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/policy", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "agent", ...form, agent_id: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      onSave(data.agent as Agent);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-awx-accent2/40 bg-white/5 p-4 space-y-3"
    >
      <div className="text-sm font-medium text-gray-200">
        {editing ? `Edit agent — ${form.display_name}` : "Add an agent to this policy"}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-gray-400">Agent ID *</label>
          {editing ? (
            <div className="text-xs text-gray-300 py-2 px-2 rounded-lg bg-white/5">
              {form.agent_id}
            </div>
          ) : (
            <input
              className="input"
              value={form.agent_id}
              onChange={(e) => set("agent_id", e.target.value.toLowerCase())}
              placeholder="research-agent-1"
              required
            />
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-400">Display name *</label>
          <input
            className="input"
            value={form.display_name}
            onChange={(e) => set("display_name", e.target.value)}
            placeholder="Research Bot Alpha"
            required
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-gray-400">Project ID *</label>
        <input
          className="input"
          value={form.project_id}
          onChange={(e) => set("project_id", e.target.value)}
          placeholder="proj-alpha"
          required
        />
      </div>

      <div>
        <label className="mb-1 block text-xs text-gray-400">Policy *</label>
        <select
          className="input"
          value={form.policy_id}
          onChange={(e) => set("policy_id", e.target.value)}
          required
        >
          <option value="">— Select a policy —</option>
          {policies.map((p) => (
            <option key={p.policy_id} value={p.policy_id}>
              {p.display_name}
            </option>
          ))}
        </select>
        {policies.length === 0 && (
          <p className="mt-1 text-[11px] text-amber-400">No policies yet — create one above first.</p>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs text-gray-400">How this agent spends</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => set("issuance_mode", "human_provisioned")}
            className={`flex-1 rounded-lg border px-3 py-2 text-xs ${
              form.issuance_mode === "human_provisioned"
                ? "border-awx-accent bg-awx-accent/10 text-white"
                : "border-awx-border text-gray-400 hover:text-white"
            }`}
          >
            Needs your approval
          </button>
          <button
            type="button"
            onClick={() => set("issuance_mode", "self_serve_within_policy")}
            className={`flex-1 rounded-lg border px-3 py-2 text-xs ${
              form.issuance_mode === "self_serve_within_policy"
                ? "border-awx-accent2 bg-awx-accent2/10 text-white"
                : "border-awx-border text-gray-400 hover:text-white"
            }`}
          >
            Can spend on its own
          </button>
        </div>
      </div>

      {err && <p className="text-xs text-red-300">{err}</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" className="btn-primary flex-1" disabled={saving}>
          {saving ? "Saving…" : editing ? "Save changes" : "Add agent"}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type PolicyFormState = { mode: "create" } | { mode: "edit"; policy: Policy } | null;
type AgentFormState = { mode: "create" } | { mode: "edit"; agent: Agent } | null;

export default function AgentPolicies({
  initialPolicies,
  initialAgents,
  section = "all",
}: {
  initialPolicies: Policy[];
  initialAgents: Agent[];
  section?: "policies" | "agents" | "all";
}) {
  const [policies, setPolicies] = useState<Policy[]>(initialPolicies);
  const [agents, setAgents] = useState<Agent[]>(initialAgents);
  const [economy, setEconomy] = useState<AgentEconomy[]>([]);
  const [policyForm, setPolicyForm] = useState<PolicyFormState>(null);
  const [agentForm, setAgentForm] = useState<AgentFormState>(null);
  const [deletingPolicyId, setDeletingPolicyId] = useState<string | null>(null);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [freezingId, setFreezingId] = useState<string | null>(null);

  const loadEconomy = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      if (!res.ok) return;
      const groups: AgentEconomy[] = (data.agents || []).map(
        (g: { agentId: string; cardCount: number; totalSpent: number; currency: string }) => ({
          agentId: g.agentId,
          cardCount: g.cardCount,
          totalSpent: g.totalSpent,
          currency: g.currency,
        }),
      );
      setEconomy(groups);
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    loadEconomy();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Back button closes an open form instead of navigating away
  const anyFormOpen = !!(policyForm || agentForm);
  useEffect(() => {
    if (!anyFormOpen) return;
    window.history.pushState({ awxFormOpen: true }, "");
    function onPop() {
      setPolicyForm(null);
      setAgentForm(null);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [anyFormOpen]);

  function econFor(id: string) {
    return economy.find((e) => e.agentId === id);
  }

  function policyFor(policyId: string) {
    return policies.find((p) => p.policy_id === policyId);
  }

  function onPolicySaved(policy: Policy) {
    setPolicies((prev) => {
      const idx = prev.findIndex((p) => p.policy_id === policy.policy_id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = policy;
        return next;
      }
      return [...prev, policy];
    });
    setPolicyForm(null);
  }

  function onAgentSaved(agent: Agent) {
    setAgents((prev) => {
      const idx = prev.findIndex((a) => a.agent_id === agent.agent_id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = agent;
        return next;
      }
      return [...prev, agent];
    });
    setAgentForm(null);
    loadEconomy();
  }

  async function handleDeletePolicy(policyId: string) {
    setDeleteErr(null);
    try {
      const res = await fetch("/api/policy", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "policy", policy_id: policyId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      setPolicies((prev) => prev.filter((p) => p.policy_id !== policyId));
      setDeletingPolicyId(null);
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  async function handleFreezeToggle(a: Agent) {
    const mode = a.frozen ? "unfreeze" : "freeze";
    setFreezingId(a.agent_id);
    try {
      const res = await fetch("/api/agents/freeze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: a.agent_id, mode }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      setAgents((prev) =>
        prev.map((ag) => ag.agent_id === a.agent_id ? { ...ag, frozen: mode === "freeze" } : ag)
      );
    } catch {
      // best-effort — agent list will reflect true state on next refresh
    } finally {
      setFreezingId(null);
    }
  }

  async function handleDeleteAgent(agentId: string) {
    setDeleteErr(null);
    try {
      const res = await fetch("/api/policy", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "agent", agent_id: agentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      setAgents((prev) => prev.filter((a) => a.agent_id !== agentId));
      setDeletingAgentId(null);
      loadEconomy();
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  return (
    <div className="card-surface mb-6 p-5">
      {/* ── Policies ─────────────────────────────────────────────────────── */}
      {(section === "all" || section === "policies") && <div className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300">
            Spending rules
            <DemoNote note="A policy is the set of rules any assigned agent must follow. Multiple agents can share one. This demo stores them locally." />
          </h2>
          <button
            className="btn-ghost !py-1 !text-xs"
            onClick={() => { setPolicyForm({ mode: "create" }); setAgentForm(null); }}
          >
            + Add policy
          </button>
        </div>

        {policyForm?.mode === "create" && (
          <div className="mb-4">
            <PolicyForm onSave={onPolicySaved} onCancel={() => setPolicyForm(null)} />
          </div>
        )}

        {policies.length === 0 && !policyForm && (
          <p className="py-2 text-sm text-gray-500">
            No policies yet. Click &ldquo;+ Add policy&rdquo; to create one.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {policies.map((p) => {
            if (policyForm?.mode === "edit" && policyForm.policy.policy_id === p.policy_id) {
              return (
                <div key={p.policy_id} className="sm:col-span-2">
                  <PolicyForm
                    initial={policyForm.policy}
                    onSave={onPolicySaved}
                    onCancel={() => setPolicyForm(null)}
                  />
                </div>
              );
            }
            const agentsUnder = agents.filter((a) => a.policy_id === p.policy_id);

            return (
              <div key={p.policy_id} className="rounded-xl border border-awx-border bg-white/5 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-100">{p.display_name}</div>
                    <div className="text-[11px] text-gray-500">
                      {p.policy_id}
                      {agentsUnder.length > 0 && (
                        <> · {agentsUnder.length} agent profile{agentsUnder.length === 1 ? "" : "s"}</>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase bg-awx-accent/15 text-awx-accent">
                    {p.currency}
                  </span>
                </div>

                <div className="mt-3 text-[11px] text-gray-400">{policyLine(p)}</div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  <Chip>{p.velocity_max_per_hour} purchases / hour</Chip>
                  <Chip>Cards expire in {p.card_expiry_days}d</Chip>
                  {p.allowed_merchant_categories.map((m) => (
                    <Chip key={m}><span title={`Network code ${m}`}>{mccLabel(m)}</span></Chip>
                  ))}
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <button
                    className="text-[11px] text-awx-accent hover:underline"
                    onClick={() => { setPolicyForm({ mode: "edit", policy: p }); setDeletingPolicyId(null); }}
                  >
                    Edit
                  </button>
                  {deletingPolicyId === p.policy_id ? (
                    <span className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-gray-400">Delete?</span>
                      <button className="text-red-400 hover:underline" onClick={() => handleDeletePolicy(p.policy_id)}>
                        Yes
                      </button>
                      <button className="text-gray-500 hover:underline" onClick={() => { setDeletingPolicyId(null); setDeleteErr(null); }}>
                        No
                      </button>
                      {deleteErr && <span className="text-red-300">{deleteErr}</span>}
                    </span>
                  ) : (
                    <button
                      className="text-[11px] text-gray-500 hover:text-red-300"
                      onClick={() => { setDeletingPolicyId(p.policy_id); setPolicyForm(null); setDeleteErr(null); }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>}

      {/* ── Divider ───────────────────────────────────────────────────────── */}
      {section === "all" && <div className="border-t border-awx-border mb-6" />}

      {/* ── Agents ───────────────────────────────────────────────────────── */}
      {(section === "all" || section === "agents") && <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300">
            Who uses these rules
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-gray-500">each agent is bound to one policy</span>
            <button
              className="btn-ghost !py-1 !text-xs"
              onClick={() => { setAgentForm({ mode: "create" }); setPolicyForm(null); }}
            >
              + Add an agent
            </button>
          </div>
        </div>

        {agentForm?.mode === "create" && (
          <div className="mb-4">
            <AgentForm
              policies={policies}
              onSave={onAgentSaved}
              onCancel={() => setAgentForm(null)}
            />
          </div>
        )}

        {agents.length === 0 && !agentForm && (
          <p className="py-2 text-sm text-gray-500">
            No agents yet. Click &ldquo;+ Add an agent&rdquo; to create one.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((a) => {
            if (agentForm?.mode === "edit" && agentForm.agent.agent_id === a.agent_id) {
              return (
                <div key={a.agent_id} className="sm:col-span-2 lg:col-span-3">
                  <AgentForm
                    initial={agentForm.agent}
                    policies={policies}
                    onSave={onAgentSaved}
                    onCancel={() => setAgentForm(null)}
                  />
                </div>
              );
            }

            const selfServe = a.issuance_mode === "self_serve_within_policy";
            const eco = econFor(a.agent_id);
            const linkedPolicy = policyFor(a.policy_id);

            return (
              <div key={a.agent_id} className={`rounded-xl border p-4 ${a.frozen ? "border-red-500/40 bg-red-500/5" : "border-awx-border bg-white/5"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-100">{shortAgentName(a.display_name, a.agent_id)}</span>
                      {a.frozen && (
                        <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-400">
                          frozen
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      {a.agent_id} · {a.project_id}
                    </div>
                    {eco && (
                      <div className="mt-0.5 text-[11px] text-gray-500">
                        {eco.cardCount} card{eco.cardCount === 1 ? "" : "s"} ·{" "}
                        {formatMoney(eco.totalSpent, eco.currency)} spent
                      </div>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                      selfServe
                        ? "bg-awx-accent2/15 text-awx-accent2"
                        : "bg-awx-accent/15 text-awx-accent"
                    }`}
                    title={issuanceModeLabel(a.issuance_mode)}
                  >
                    {issuanceModeShort(a.issuance_mode)}
                  </span>
                </div>

                {linkedPolicy && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px]">
                    <span className="text-gray-500">Policy:</span>
                    <span className="rounded bg-awx-accent/10 px-2 py-0.5 text-awx-accent">
                      {linkedPolicy.display_name}
                    </span>
                    <span className="text-gray-600">
                      {policyLine(linkedPolicy)}
                    </span>
                  </div>
                )}
                {!linkedPolicy && (
                  <div className="mt-2 text-[11px] text-amber-400">
                    ⚠ Policy &ldquo;{a.policy_id}&rdquo; not found
                  </div>
                )}

                <div className="mt-3 flex items-center gap-3">
                  <button
                    className="text-[11px] text-awx-accent hover:underline"
                    onClick={() => {
                      setAgentForm({ mode: "edit", agent: a });
                      setDeletingAgentId(null);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className={`text-[11px] hover:underline disabled:opacity-50 ${a.frozen ? "text-emerald-400" : "text-amber-400"}`}
                    disabled={freezingId === a.agent_id}
                    onClick={() => handleFreezeToggle(a)}
                  >
                    {freezingId === a.agent_id ? "…" : a.frozen ? "Unfreeze" : "Freeze"}
                  </button>
                  {deletingAgentId === a.agent_id ? (
                    <span className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-gray-400">Delete?</span>
                      <button className="text-red-400 hover:underline" onClick={() => handleDeleteAgent(a.agent_id)}>
                        Yes
                      </button>
                      <button className="text-gray-500 hover:underline" onClick={() => { setDeletingAgentId(null); setDeleteErr(null); }}>
                        No
                      </button>
                      {deleteErr && <span className="text-red-300">{deleteErr}</span>}
                    </span>
                  ) : (
                    <button
                      className="text-[11px] text-gray-500 hover:text-red-300"
                      onClick={() => { setDeletingAgentId(a.agent_id); setAgentForm(null); setDeleteErr(null); }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>}
    </div>
  );
}
