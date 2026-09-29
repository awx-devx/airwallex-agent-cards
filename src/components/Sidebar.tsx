"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const GROUPS: {
  label: string;
  defaultOpen?: boolean;
  items: { href: string; label: string; icon: string }[];
}[] = [
  {
    label: "Spend",
    defaultOpen: true,
    items: [
      { href: "/", label: "Home", icon: "◧" },
      { href: "/agents", label: "Agents & cards", icon: "💳" },
      { href: "/approvals", label: "Approvals", icon: "✅" },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/accounts", label: "Wallet", icon: "🏦" },
      { href: "/activity", label: "Activity", icon: "📈" },
    ],
  },
  {
    label: "Setup",
    defaultOpen: true,
    items: [{ href: "/policies", label: "Policies", icon: "📋" }],
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/activity") return pathname === "/activity" || pathname === "/expenses";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Sidebar() {
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState(0);
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUPS.map((g) => [g.label, g.defaultOpen ?? false])),
  );
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadPendingCount = useCallback(async () => {
    try {
      const r = await fetch("/api/approvals");
      const d = await r.json();
      const count = (d.approvals ?? []).filter((a: { status: string }) => a.status === "pending").length;
      setPendingCount(count);
    } catch { /* swallow */ }
  }, []);

  useEffect(() => {
    loadPendingCount();
    timer.current = setInterval(loadPendingCount, 10000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [loadPendingCount]);

  useEffect(() => {
    const group = GROUPS.find((g) => g.items.some((i) => isActive(pathname, i.href)));
    if (group && !open[group.label]) {
      setOpen((prev) => ({ ...prev, [group.label]: true }));
    }
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-awx-border bg-awx-panel">
      <Link href="/" className="flex items-center gap-2.5 px-4 py-4">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
          <path d="M11 1L21 11L11 21L1 11Z" fill="#6155E4"/>
          <path d="M11 6.5L15.5 11L11 15.5L6.5 11Z" fill="#0b0f1a"/>
        </svg>
        <span className="text-[15px] font-semibold tracking-tight text-gradient">AirAgent Cards</span>
        <span className="rounded bg-awx-accent2/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-awx-accent2">
          demo
        </span>
      </Link>

      <nav className="flex-1 space-y-4 px-2 py-2">
        {GROUPS.map((group) => {
          const expanded = open[group.label] ?? false;
          return (
            <div key={group.label}>
              <button
                type="button"
                onClick={() => setOpen((prev) => ({ ...prev, [group.label]: !prev[group.label] }))}
                className="mb-1 flex w-full items-center justify-between px-3 text-[10px] font-semibold uppercase tracking-wide text-gray-600 hover:text-gray-400"
              >
                {group.label}
                <span className="text-[9px]">{expanded ? "▾" : "▸"}</span>
              </button>
              {expanded && (
                <div className="space-y-1">
                  {group.items.map((l) => {
                    const active = isActive(pathname, l.href);
                    const showBadge = l.href === "/approvals" && pendingCount > 0;
                    return (
                      <Link
                        key={l.href}
                        href={l.href}
                        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all ${
                          active
                            ? "bg-awx-accent/20 text-white shadow-glow-accent"
                            : "text-gray-400 hover:bg-white/5 hover:text-white"
                        }`}
                      >
                        <span className="w-4 text-center">{l.icon}</span>
                        <span className="flex-1">{l.label}</span>
                        {showBadge && (
                          <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                            {pendingCount}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
