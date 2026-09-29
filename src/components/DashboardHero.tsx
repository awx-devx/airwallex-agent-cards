"use client";

export default function DashboardHero({ onRunTask }: { onRunTask: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-awx-border bg-awx-panel/60 px-5 py-4">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-white">Run an agent task</div>
        <p className="mt-0.5 text-[12px] text-gray-500">
          Procurement buys something on a scoped Airwallex card. Defaults to Vercel Pro · $18.
        </p>
      </div>
      <button onClick={onRunTask} className="btn-primary shrink-0">
        Run agent task
      </button>
    </div>
  );
}
