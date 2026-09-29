import RecentTransactions from "@/components/RecentTransactions";
import ExpensesView from "@/components/ExpensesView";
import { getLocalActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  const { agent } = await searchParams;
  const initialEvents = await getLocalActivity();

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Activity</h1>
        <p className="mt-1 text-sm text-gray-400">
          Purchases, declines, and deposits. Receipts stay on the purchase row.
        </p>
      </div>
      <div className="space-y-6">
        <RecentTransactions agentFilter={agent} initialEvents={initialEvents} />
        <ExpensesView compact />
      </div>
    </main>
  );
}
