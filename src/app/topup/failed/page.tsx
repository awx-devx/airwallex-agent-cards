import Link from "next/link";

export default function TopUpFailed() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="card-surface max-w-md p-8 text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-red-500/20 text-2xl">
          ✕
        </div>
        <h1 className="text-xl font-semibold">Top-up not completed</h1>
        <p className="mt-2 text-sm text-gray-400">
          The Hosted Payment Page checkout was cancelled or failed. You can try
          again from the dashboard.
        </p>
        <Link href="/dashboard" className="btn-primary mt-6">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
