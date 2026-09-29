"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const TITLES: Record<string, string> = {
  "/": "Home",
  "/agents": "Agents & cards",
  "/policies": "Policies",
  "/approvals": "Approvals",
  "/activity": "Activity",
  "/accounts": "Wallet",
  "/expenses": "Activity",
};

const SCENARIOS = [
  {
    preset: "over_cap",
    label: "Lower the purchase cap",
    description: "Sets max per purchase to $10 — the next larger task will create an approval",
    icon: "📊",
  },
  {
    preset: "velocity",
    label: "Limit purchases this hour",
    description: "Allows one purchase per hour — a second task will create an approval",
    icon: "⚡",
  },
  {
    preset: "human_provisioned",
    label: "Require approval for every card",
    description: "Procurement will need you to approve each new card",
    icon: "🔒",
  },
  {
    preset: "freeze_agent",
    label: "Freeze Procurement",
    description: "Blocks every new card for Procurement until you unfreeze it",
    icon: "🧊",
  },
] as const;

function DemoDropdown() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function apply(preset: string) {
    setLoading(preset);
    setStatus(null);
    try {
      const r = await fetch("/api/demo-controls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset }),
      });
      const d = await r.json();
      setStatus({ msg: d.message || d.error, ok: r.ok });
    } catch (e) {
      setStatus({ msg: e instanceof Error ? e.message : "Failed", ok: false });
    } finally {
      setLoading(null);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen((p) => !p); setStatus(null); }}
        className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-400 hover:bg-amber-500/20 transition-colors"
      >
        Demo
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[80] mt-2 w-80 rounded-xl border border-awx-border bg-awx-panel shadow-xl">
          <div className="border-b border-awx-border px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-200">Demo scenarios</span>
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                demo only
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-gray-500">
              Changes rules for <strong className="text-gray-400">Procurement</strong> so you can see what happens next
            </p>
          </div>

          <div className="p-3 flex flex-col gap-2">
            {SCENARIOS.map((s) => (
              <button
                key={s.preset}
                onClick={() => apply(s.preset)}
                disabled={loading !== null}
                className="flex items-start gap-3 rounded-lg border border-awx-border bg-awx-surface p-3 text-left hover:border-awx-accent/50 hover:bg-awx-accent/5 disabled:opacity-50 transition-colors"
              >
                <span className="text-base leading-none mt-0.5">{s.icon}</span>
                <div>
                  <div className="text-xs font-medium text-gray-200">{s.label}</div>
                  <div className="mt-0.5 text-[11px] text-gray-500">{s.description}</div>
                </div>
              </button>
            ))}
          </div>

          <div className="border-t border-awx-border px-4 py-3 flex items-center justify-between">
            <button
              onClick={() => apply("reset")}
              disabled={loading !== null}
              className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-50 underline underline-offset-2"
            >
              Reset for demo
            </button>
            {status && (
              <p className={`text-[11px] ${status.ok ? "text-emerald-400" : "text-red-300"}`}>
                {status.ok ? "✓" : "✗"} {status.msg}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TopBar({
  onOpenHelp,
  onOpenChat,
  onRunTask,
}: {
  onOpenHelp: () => void;
  onOpenChat: () => void;
  onRunTask?: () => void;
}) {
  const pathname = usePathname();
  const title = TITLES[pathname] || "AirAgent Cards";
  const showRunTask = pathname === "/" || pathname === "/agents";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-awx-border px-6">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-gray-200">{title}</span>
        <span className="rounded bg-white/5 px-2 py-0.5 text-[11px] text-gray-400">
          Sandbox · no real money
        </span>
      </div>
      <div className="flex items-center gap-2">
        {showRunTask && onRunTask && (
          <button
            onClick={onRunTask}
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
          >
            Run agent task
          </button>
        )}
        <button
          onClick={onOpenChat}
          className="rounded-lg bg-awx-accent/15 border border-awx-accent/30 px-3 py-1.5 text-sm font-medium text-awx-accent hover:bg-awx-accent/25 transition-colors"
        >
          Ask AI
        </button>
        <DemoDropdown />
        <button
          onClick={onOpenHelp}
          className="rounded-lg border border-awx-border px-3 py-1.5 text-sm text-gray-300 hover:bg-white/5"
        >
          About
        </button>
      </div>
    </header>
  );
}
