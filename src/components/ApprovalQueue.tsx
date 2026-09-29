"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatMoney, ago } from "@/lib/format";
import DemoNote from "@/components/DemoNote";
import { useChat } from "@/components/ChatProvider";
import { escalationLabel, fieldLabel, merchantLabel, shortAgentName } from "@/lib/labels";

interface CardProvisionParams {
  agent_id: string;
  task_id: string;
  merchant_category: string;
  amount: number;
  currency?: string;
}

interface Approval {
  id: string;
  agent_id: string;
  type: "limit_increase" | "card_provision" | string;
  // limit_increase fields:
  field?: string;
  current?: number;
  requested?: number;
  reason?: string;
  // card_provision fields:
  provision_params?: CardProvisionParams;
  escalation_reason?: string;
  card_result?: Record<string, unknown>;
  status: "pending" | "approved" | "denied";
  created_at: string;
  resolved_at?: string;
}


export default function ApprovalQueue({
  showEmpty,
  compact,
}: {
  showEmpty?: boolean;
  compact?: boolean;
}) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const { setPendingResume } = useChat();

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/approvals");
      const d = await r.json();
      setApprovals(d.approvals || []);
    } catch { /* swallow */ }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 5000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]);

  async function resolve(id: string, decision: "approved" | "denied", approval: Approval) {
    setBusy(id);
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision }),
      });
      const data = await res.json();
      await load();

      // Auto-resume the agent if this was a card_provision approval.
      if (decision === "approved" && approval.type === "card_provision" && approval.provision_params) {
        const result = data?.result as Record<string, unknown> | undefined;
        // card_id may come from the provisioned card or from the stored card_result.
        const cardId =
          (result?.card as Record<string, unknown> | undefined)?.card_id ??
          ((result?.approval as Record<string, unknown> | undefined)?.card_result as Record<string, unknown> | undefined)?.card_id ??
          (approval.card_result as Record<string, unknown> | undefined)?.card_id;
        const { amount, currency = "USD", task_id: taskId, agent_id: agentId } = approval.provision_params;
        const msg = cardId
          ? `Approval ${id} has been approved by a human. A ${formatMoney(amount, currency)} card was provisioned for ${agentId}: card_id=${cardId}, task=${taskId}. Please call checkout_at_demo_store now with card_id=${cardId} and the appropriate product to complete the task.`
          : `Approval ${id} has been approved by a human for ${agentId} task ${taskId}. Please call provision_scoped_card again — the exception has been granted — then complete the checkout.`;
        setPendingResume(msg);
      }
    } finally {
      setBusy(null);
    }
  }

  const pending = approvals.filter((a) => a.status === "pending");
  const resolved = approvals.filter((a) => a.status !== "pending");

  if (compact && pending.length === 0) return null;

  if (approvals.length === 0) {
    if (!showEmpty) return null;
    return (
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300">Needs you</h2>
          <span className="text-[11px] text-gray-500">nothing waiting</span>
        </div>
        <div className="card-surface flex items-center gap-3 px-5 py-4">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-xs text-gray-400">Nothing waiting — spend is inside the rules.</span>
        </div>
      </section>
    );
  }

  return (
    <section>
    <div className={`card-surface p-5 ${compact ? "" : "mb-6"}`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-300">{compact ? "Needs you" : "Approvals"}</h2>
          {pending.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
              {pending.length} waiting
            </span>
          )}
        </div>
        <span className="text-[11px] text-gray-500">
          {compact ? (
            <Link href="/approvals" className="text-awx-accent hover:underline">
              Review all
            </Link>
          ) : (
            <>
              agents ask, you decide
              <DemoNote note="When a purchase is over the cap, the wrong merchant type, or the agent is set to need approval, it lands here. Sandbox only — production would add auth and notifications." />
            </>
          )}
        </span>
      </div>

      {pending.length > 0 && (
        <div className="space-y-2 mb-3">
          {pending.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
              <div className="min-w-0 flex-1">
                {a.type === "card_provision" && a.provision_params ? (
                  <>
                    <div className="text-sm text-gray-100">
                      <span className="font-medium">{shortAgentName(undefined, a.agent_id)}</span> wants{" "}
                      <span className="text-amber-300">{formatMoney(a.provision_params.amount, a.provision_params.currency ?? "USD")}</span>
                      {" "}at a {merchantLabel(a.provision_params.merchant_category).toLowerCase()} merchant
                    </div>
                    <div className="mt-0.5 text-[11px] text-gray-500">
                      {a.escalation_reason && (
                        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-400">
                          {escalationLabel(a.escalation_reason)}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm text-gray-100">
                      <span className="font-medium">{shortAgentName(undefined, a.agent_id)}</span> wants a higher{" "}
                      {fieldLabel(a.field)}{" "}
                      {formatMoney(a.current ?? 0, "USD")} → {formatMoney(a.requested ?? 0, "USD")}
                    </div>
                    {a.reason && <div className="mt-0.5 text-[11px] text-gray-500 truncate">{a.reason}</div>}
                  </>
                )}
                <div className="text-[10px] text-gray-600 mt-0.5">{ago(a.created_at)}</div>
              </div>
              <button
                onClick={() => resolve(a.id, "approved", a)}
                disabled={busy === a.id}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                onClick={() => resolve(a.id, "denied", a)}
                disabled={busy === a.id}
                className="rounded-lg border border-awx-border px-3 py-1.5 text-[11px] font-semibold text-gray-400 hover:text-white disabled:opacity-50"
              >
                Deny
              </button>
            </div>
          ))}
        </div>
      )}

      {!compact && resolved.length > 0 && (
        <div className="space-y-1">
          {resolved.slice(0, 10).map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-[11px] text-gray-500">
              <span className={`h-1.5 w-1.5 rounded-full ${a.status === "approved" ? "bg-emerald-400" : "bg-red-400"}`} />
              <span>{shortAgentName(undefined, a.agent_id)}</span>
              {a.type === "card_provision" && a.provision_params ? (
                <>
                  <span className="font-mono">card {formatMoney(a.provision_params.amount, a.provision_params.currency ?? "USD")}</span>
                  {a.card_result && <span className="font-mono text-gray-600">{String(a.card_result.card_id ?? "").slice(0, 12)}…</span>}
                </>
              ) : (
                <>
                  <span className="font-mono">{fieldLabel(a.field ?? "")}</span>
                  <span>{formatMoney(a.current ?? 0, "USD")} &rarr; {formatMoney(a.requested ?? 0, "USD")}</span>
                </>
              )}
              <span className={a.status === "approved" ? "text-emerald-400" : "text-red-400"}>{a.status}</span>
              <span>{a.resolved_at ? ago(a.resolved_at) : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
    </section>
  );
}
