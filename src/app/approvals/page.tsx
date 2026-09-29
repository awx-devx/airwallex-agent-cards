export const dynamic = "force-dynamic";

import ApprovalQueue from "@/components/ApprovalQueue";

export default function ApprovalsPage() {

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">Approvals</h1>
        <p className="mt-1 text-sm text-gray-400">
          When a purchase is over the limit or the agent needs you, it waits here.
        </p>
      </div>
      <ApprovalQueue showEmpty />
    </main>
  );
}
