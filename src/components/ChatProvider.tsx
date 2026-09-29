"use client";

import { createContext, useContext, useRef, useState } from "react";

export interface TopUpAction {
  type: "topup";
  intent: { id: string; client_secret: string; amount: number; currency: string };
}

export interface IssuedAction {
  type: "issued";
  last4?: string;
  cap?: number;
  currency?: string;
  merchant?: string;
  cardId?: string;
  receiptUrl?: string;
}

export interface NeedsApprovalAction {
  type: "needs_approval";
  reason: string;
  approvalId?: string;
}

export interface BlockedAction {
  type: "blocked";
  reason: string;
}

export type ChatAction = TopUpAction | IssuedAction | NeedsApprovalAction | BlockedAction;

export interface Bubble {
  role: "user" | "assistant";
  text: string;
  actions?: ChatAction[];
}

interface ChatState {
  bubbles: Bubble[];
  busy: boolean;
  send: (text: string) => Promise<void>;
  started: boolean;
  pendingResume: string | null;
  setPendingResume: (msg: string) => void;
  clearPendingResume: () => void;
  chatOpen: boolean;
  openChat: () => void;
  closeChat: () => void;
}

const ChatContext = createContext<ChatState | null>(null);

const GREETING: Bubble = {
  role: "assistant",
  text: "I can check what an agent is allowed to spend, run a purchase, or show anything waiting for you.",
};

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [bubbles, setBubbles] = useState<Bubble[]>([GREETING]);
  const [busy, setBusy] = useState(false);
  const historyRef = useRef<unknown[]>([]);
  const [started, setStarted] = useState(false);
  const [pendingResume, setPendingResume] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setStarted(true);
    setBubbles((b) => [...b, { role: "user", text }]);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: historyRef.current }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      historyRef.current = data.history || [];
      setBubbles((b) => [
        ...b,
        { role: "assistant", text: data.reply, actions: data.actions },
      ]);
    } catch (err) {
      setBubbles((b) => [
        ...b,
        {
          role: "assistant",
          text: `⚠️ ${err instanceof Error ? err.message : "Something went wrong."}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ChatContext.Provider value={{
      bubbles, busy, send, started,
      pendingResume,
      setPendingResume: (msg) => setPendingResume(msg),
      clearPendingResume: () => setPendingResume(null),
      chatOpen,
      openChat: () => setChatOpen(true),
      closeChat: () => setChatOpen(false),
    }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat(): ChatState {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
