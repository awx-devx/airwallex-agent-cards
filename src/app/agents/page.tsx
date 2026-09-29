import CardsManager from "@/components/CardsManager";
import ApprovalQueue from "@/components/ApprovalQueue";
import { KNOWN_CURRENCIES } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function AgentsPage() {

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Agents & cards</h1>
        <p className="mt-1 text-sm text-gray-400">
          Each agent spends on its own Airwallex card, inside a policy.{" "}
          <a href="/policies" className="text-awx-accent hover:underline">Edit the rules</a>.
        </p>
      </div>
      <ApprovalQueue compact />
      <div className="mb-6" />
      <CardsManager currencies={KNOWN_CURRENCIES} />
    </main>
  );
}
