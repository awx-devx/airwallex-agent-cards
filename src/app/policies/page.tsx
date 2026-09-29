import AgentPolicies from "@/components/AgentPolicies";
import { listAgents, listPolicies } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function PoliciesPage() {
  const agents = await listAgents();
  const policies = await listPolicies();

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Policies</h1>
        <p className="mt-1 text-sm text-gray-400">
          Spending rules first, then which agents use them. A policy sets the budget, max per purchase, and allowed merchant types.
        </p>
      </div>
      <AgentPolicies initialPolicies={policies} initialAgents={agents} section="all" />
    </main>
  );
}
