"use client";

import { useState } from "react";
import Link from "next/link";
import TopUpWidget from "@/components/TopUpWidget";
import AgentSpendSummary from "@/components/AgentSpendSummary";
import ApprovalQueue from "@/components/ApprovalQueue";
import RecentTransactions from "@/components/RecentTransactions";
import WalletBalancesClient from "@/components/WalletBalancesClient";
import DashboardHero from "@/components/DashboardHero";
import TaskConfigModal, { buildTaskPrompt, type TaskConfig } from "@/components/TaskConfigModal";
import { useChat } from "@/components/ChatProvider";
import type { Balance, GlobalAccount } from "@/lib/airwallex";
import type { ActivityEvent } from "@/lib/activityTypes";

export default function AssistantHome({
  currencies,
  initialBalances,
  initialAccounts,
  initialDomestic,
  initialActivity = [],
}: {
  currencies: string[];
  initialBalances: Balance[];
  initialAccounts: GlobalAccount[];
  initialDomestic: string;
  initialActivity?: ActivityEvent[];
}) {
  const { send, openChat } = useChat();
  const [taskOpen, setTaskOpen] = useState(false);

  function runTask(cfg: TaskConfig) {
    openChat();
    send(buildTaskPrompt(cfg));
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-lg font-semibold text-gradient">AirAgent Cards</h1>
        <p className="mt-0.5 text-sm text-gray-400">
          AI agents spend on Airwallex cards. You set the rules.
        </p>
      </div>

      <DashboardHero onRunTask={() => setTaskOpen(true)} />

      <ApprovalQueue compact />

      <RecentTransactions limit={6} initialEvents={initialActivity} />

      <AgentSpendSummary />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300">Wallet</h2>
          <Link href="/accounts" className="text-xs text-awx-accent hover:underline">
            Need another currency? Open an account
          </Link>
        </div>
        <WalletBalancesClient
          initialBalances={initialBalances}
          initialAccounts={initialAccounts}
          initialDomestic={initialDomestic}
        />
      </section>

      <details className="group">
        <summary className="cursor-pointer select-none list-none text-sm text-gray-500 hover:text-gray-300">
          <span className="group-open:hidden">▶ Deposit funds into a wallet</span>
          <span className="hidden group-open:inline">▼ Deposit funds into a wallet</span>
        </summary>
        <div className="mt-3">
          <TopUpWidget
            currencies={currencies.length ? currencies : ["USD", "HKD", "SGD", "EUR"]}
          />
        </div>
      </details>

      <TaskConfigModal
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        onRun={runTask}
      />
    </div>
  );
}
