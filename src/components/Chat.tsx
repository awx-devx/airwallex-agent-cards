"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { redirectToHostedPayment } from "@/lib/airwallexJs";
import { useChat, type ChatAction } from "@/components/ChatProvider";
import { formatMoney } from "@/lib/format";

const SUGGESTIONS = [
  "What can Procurement spend?",
  "Buy Vercel Pro",
  "Any approvals?",
];

// Render text with clickable links: markdown [label](url), bare https://, and /demo-store paths
function renderText(text: string): React.ReactNode {
  const TOKEN = /(\[([^\]]+)\]\(([^)]+)\)|https?:\/\/[^\s)]+|\/demo-store[^\s)]*)/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const full = match[1];
    if (full.startsWith('[')) {
      // markdown link
      const label = match[2], href = match[3];
      nodes.push(<a key={match.index} href={href} target="_blank" rel="noreferrer" className="text-awx-accent underline">{label}</a>);
    } else {
      nodes.push(<a key={match.index} href={full} target="_blank" rel="noreferrer" className="text-awx-accent underline break-all">{full}</a>);
    }
    last = match.index + full.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function OutcomeCard({ action }: { action: ChatAction }) {
  if (action.type === "issued") {
    return (
      <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
        <div className="text-xs font-semibold text-emerald-300">Issued</div>
        <div className="mt-1 text-[12px] text-gray-200">
          {action.last4 ? `Card ···· ${action.last4}` : "Card ready"}
          {action.cap != null && action.currency ? ` · ${formatMoney(action.cap, action.currency)} cap` : ""}
          {action.merchant ? ` · ${action.merchant}` : ""}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link href="/agents" className="rounded-lg border border-awx-border px-2.5 py-1 text-[11px] text-gray-200 hover:bg-white/5">
            View card
          </Link>
          {action.receiptUrl && (
            <Link href={action.receiptUrl} className="rounded-lg border border-awx-border px-2.5 py-1 text-[11px] text-gray-200 hover:bg-white/5">
              Open receipt
            </Link>
          )}
        </div>
      </div>
    );
  }
  if (action.type === "needs_approval") {
    return (
      <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
        <div className="text-xs font-semibold text-amber-300">Needs you</div>
        <div className="mt-1 text-[12px] text-gray-200">{action.reason}</div>
        <Link href="/approvals" className="mt-2 inline-flex rounded-lg bg-amber-500/20 px-2.5 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-500/30">
          Review approval
        </Link>
      </div>
    );
  }
  if (action.type === "blocked") {
    return (
      <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
        <div className="text-xs font-semibold text-red-300">Blocked</div>
        <div className="mt-1 text-[12px] text-gray-200">{action.reason}</div>
      </div>
    );
  }
  return null;
}

function TopUpButton({ intent }: { intent: { id: string; client_secret: string; amount: number; currency: string } }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setError(null);
    setBusy(true);
    try {
      await redirectToHostedPayment(intent);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit redirect failed");
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button onClick={handleClick} disabled={busy} className="btn-primary w-full">
        {busy ? "Redirecting…" : `Complete ${intent.currency} ${intent.amount} deposit →`}
      </button>
      {error && (
        <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-red-300">{error}</p>
      )}
    </div>
  );
}

export default function Chat() {
  const { bubbles, busy, send, started } = useChat();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [bubbles, busy]);

  function submit(text: string) {
    send(text);
    setInput("");
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {bubbles.map((b, i) => (
          <div
            key={i}
            className={`flex ${b.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
                b.role === "user" ? "bg-awx-accent text-white" : "bg-white/5 text-gray-100"
              }`}
            >
              {b.role === "assistant" ? renderText(b.text) : b.text}
              {b.actions?.map((a, j) =>
                a.type === "topup" ? (
                  <TopUpButton key={j} intent={a.intent} />
                ) : (
                  <OutcomeCard key={j} action={a} />
                ),
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-white/5 px-4 py-2.5 text-sm text-gray-400">
              Thinking…
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-awx-accent/30 bg-awx-accent/5 p-4">
        {!started && (
          <div className="mb-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => submit(s)}
                disabled={busy}
                className="rounded-full border border-awx-border px-3 py-1 text-xs text-gray-300 hover:bg-white/5 disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="flex gap-2"
        >
          <input
            className="w-full rounded-lg border border-awx-accent/50 bg-white/5 px-3 py-2 text-sm text-gray-100 outline-none placeholder:text-gray-500 focus:border-awx-accent focus:ring-1 focus:ring-awx-accent/40"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask what an agent can spend, or buy something…"
            disabled={busy}
          />
          <button className="btn-primary px-5" disabled={busy || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
