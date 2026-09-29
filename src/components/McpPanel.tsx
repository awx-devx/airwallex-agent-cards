"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface McpEntry {
  ts: string;
  source: string;
  tool: string;
  args: unknown;
  ok: boolean;
  result?: unknown;
  error?: string;
}

function ago(ts: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}

function pretty(v: unknown): string {
  if (v == null) return "";
  try {
    const s = JSON.stringify(v, null, 2);
    return s.length > 600 ? s.slice(0, 600) + "\n…" : s;
  } catch {
    return String(v);
  }
}

export default function McpPanel({ open, onClose, chatOpen = false }: { open: boolean; onClose: () => void; chatOpen?: boolean }) {
  const [entries, setEntries] = useState<McpEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/mcp-log");
      const d = await r.json();
      setEntries(d.entries || []);
    } catch { /* swallow */ }
  }, []);

  useEffect(() => {
    if (!open) return;
    load();
    timer.current = setInterval(load, 3000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [open, load]);

  if (!open) return null;

  return (
    <div
      className="fixed top-14 bottom-0 z-[60] flex w-[420px] flex-col border-l border-awx-border bg-awx-bg shadow-2xl transition-[right] duration-300"
      style={{ right: chatOpen ? "420px" : "0px" }}
    >
      <div className="flex items-center justify-between border-b border-awx-border px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-200">Live API calls
          <span className="ml-1.5 inline-flex h-4 items-center rounded bg-white/5 px-1.5 text-[9px] font-normal text-gray-500" title="This demo endpoint is unauthenticated. Production would require per-agent tokens.">sandbox</span>
        </h2>
        <button onClick={onClose} className="text-gray-500 hover:text-white">&times;</button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {entries.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-500">No calls yet. Run a task or Ask AI to see traffic here.</p>
        )}
        {entries.map((e, i) => {
          const isExpanded = expanded.has(i);
          return (
            <div key={`${e.ts}-${i}`} className="rounded-lg border border-awx-border/60 bg-white/[0.03]">
              <button
                onClick={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i); else next.add(i);
                    return next;
                  })
                }
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${e.ok ? "bg-emerald-400" : "bg-red-400"}`} />
                <span className="flex-1 truncate text-[12px] font-mono text-gray-200">{e.tool}</span>
                <span className="text-[10px] text-gray-500">{e.source}</span>
                <span className="text-[10px] text-gray-500">{ago(e.ts)}</span>
                <span className="text-[10px] text-gray-500">{isExpanded ? "▾" : "▸"}</span>
              </button>
              {isExpanded && (
                <div className="border-t border-awx-border/40 px-3 py-2 text-[11px]">
                  <div className="mb-1 text-gray-500">args</div>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all text-gray-300">{pretty(e.args)}</pre>
                  <div className="mb-1 mt-2 text-gray-500">{e.ok ? "result" : "error"}</div>
                  <pre className={`max-h-40 overflow-auto whitespace-pre-wrap break-all ${e.ok ? "text-gray-300" : "text-red-300"}`}>
                    {e.ok ? pretty(e.result) : (e.error || "unknown error")}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
