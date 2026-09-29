"use client";

const POINTS = [
  {
    title: "Cards",
    body: "Each agent spends on a real Airwallex virtual card — not a fake balance.",
  },
  {
    title: "Rules",
    body: "You set the budget, max per purchase, and which merchant types are allowed.",
  },
  {
    title: "Visibility",
    body: "Purchases are approved, sent to you, or blocked. Every charge shows up here.",
  },
];

export default function WelcomeModal({
  open,
  onClose,
  onOpenMcp,
}: {
  open: boolean;
  onClose: () => void;
  onOpenMcp?: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="card-surface relative z-10 w-full max-w-md p-7">
        <div className="mb-5">
          <h2 className="text-lg font-semibold">Virtual cards for AI agents</h2>
          <p className="mt-1 text-sm text-gray-400">
            Airwallex sandbox · no real money moves
          </p>
        </div>

        <ul className="space-y-3">
          {POINTS.map((p) => (
            <li key={p.title}>
              <div className="text-sm font-semibold text-gray-100">{p.title}</div>
              <div className="mt-0.5 text-sm text-gray-400">{p.body}</div>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex items-center gap-3">
          <button onClick={onClose} className="btn-primary flex-1">
            Get started
          </button>
          {onOpenMcp && (
            <button
              onClick={() => {
                onClose();
                onOpenMcp();
              }}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              See live API calls
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
