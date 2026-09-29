"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import WelcomeModal from "@/components/WelcomeModal";
import TaskConfigModal, { buildTaskPrompt, type TaskConfig } from "@/components/TaskConfigModal";
import { ChatProvider, useChat } from "@/components/ChatProvider";
import McpPanel from "@/components/McpPanel";
import Chat from "@/components/Chat";

function AppShellInner({
  children,
}: {
  children: React.ReactNode;
}) {
  const { send, pendingResume, clearPendingResume, chatOpen, openChat, closeChat } = useChat();

  const [resumeToast, setResumeToast] = useState<string | null>(null);

  useEffect(() => {
    if (pendingResume) {
      send(pendingResume);
      clearPendingResume();
      setResumeToast("Approved — the agent is finishing the purchase.");
      const t = setTimeout(() => setResumeToast(null), 5000);
      return () => clearTimeout(t);
    }
  }, [pendingResume, send, clearPendingResume]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [taskConfigOpen, setTaskConfigOpen] = useState(false);

  useEffect(() => {
    if (!sessionStorage.getItem("awx_welcome_seen")) {
      setHelpOpen(true);
      sessionStorage.setItem("awx_welcome_seen", "1");
    }
  }, []);

  function runAgentTask(cfg: TaskConfig) {
    openChat();
    send(buildTaskPrompt(cfg));
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onOpenHelp={() => setHelpOpen(true)}
          onOpenChat={openChat}
          onRunTask={() => setTaskConfigOpen(true)}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
      <WelcomeModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        onOpenMcp={() => setMcpOpen(true)}
      />
      <TaskConfigModal
        open={taskConfigOpen}
        onClose={() => setTaskConfigOpen(false)}
        onRun={runAgentTask}
      />
      <McpPanel open={mcpOpen} onClose={() => setMcpOpen(false)} chatOpen={chatOpen} />
      {resumeToast && (
        <div className="fixed bottom-5 left-1/2 z-[80] -translate-x-1/2 rounded-xl border border-emerald-500/30 bg-awx-panel px-4 py-2 text-sm text-emerald-200 shadow-xl">
          {resumeToast}
        </div>
      )}

      {/* AI chat drawer — starts below TopBar (top-14) so TopBar buttons stay accessible */}
      {chatOpen && (
        <div
          className="fixed inset-x-0 top-14 bottom-0 z-40 bg-black/40"
          onClick={closeChat}
        />
      )}
      <div
        className={`fixed top-14 bottom-0 right-0 z-50 flex w-[420px] flex-col border-l border-awx-border bg-[#131826] shadow-2xl transition-transform duration-300 ${
          chatOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-awx-border px-4">
          <span className="text-sm font-semibold text-gray-200">AI Assistant</span>
          <button
            onClick={closeChat}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-white/5 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <Chat />
        </div>
      </div>
    </div>
  );
}

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const showChrome =
    !pathname.startsWith("/topup") &&
    !pathname.startsWith("/demo-store");

  if (!showChrome) return <>{children}</>;

  return (
    <ChatProvider>
      <AppShellInner>{children}</AppShellInner>
    </ChatProvider>
  );
}
