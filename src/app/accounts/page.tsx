import AccountsManager from "@/components/AccountsManager";
import AccountActivitySection from "@/components/AccountActivitySection";

export const dynamic = "force-dynamic";

export default function AccountsPage() {

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Accounts</h1>
        <p className="mt-1 text-sm text-gray-400">
          Local bank details for each currency. Open another account or simulate a deposit.
        </p>
      </div>
      <AccountsManager />
      <AccountActivitySection />
    </main>
  );
}
