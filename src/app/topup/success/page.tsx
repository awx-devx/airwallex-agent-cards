import Link from "next/link";

export default function TopUpSuccess() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="card-surface max-w-md p-8 text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-awx-accent2/20 text-2xl">
          ✓
        </div>
        <h1 className="text-xl font-semibold">Top-up complete</h1>
        <p className="mt-2 text-sm text-gray-400">
          Your Airwallex Hosted Payment Page checkout succeeded. Balances update
          once the payment settles in the demo environment.
        </p>
        <Link href="/dashboard" className="btn-primary mt-6">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
