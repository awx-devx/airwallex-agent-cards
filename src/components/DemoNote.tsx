"use client";

import { useState } from "react";

/**
 * A small circled-i that expands to show a demo-shortcut note on click.
 * Used inline in components to flag localhost simplifications.
 */
export default function DemoNote({ note }: { note: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-flex">
      <button
        onClick={() => setOpen((p) => !p)}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-600 text-[9px] font-bold text-gray-500 hover:border-gray-400 hover:text-gray-300"
        title="Demo note"
        aria-label="Demo note"
      >
        i
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-6 z-50 w-64 rounded-lg border border-awx-border bg-awx-panel p-3 text-[11px] leading-relaxed text-gray-300 shadow-xl">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Demo shortcut
            </div>
            {note}
          </div>
        </>
      )}
    </span>
  );
}
