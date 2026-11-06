"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Demo only: five scripted buyers message the assistant at once, so the grid fills up live.
export function SimulateButton({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setNote(null);
          const res = await fetch("/api/demo/simulate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ listingId }),
          });
          const data = await res.json().catch(() => ({}));
          setNote(res.ok ? "5 buyers are messaging now. Watch the grid, and tap a row to read a chat." : (data.error ?? "Couldn't start."));
          setBusy(false);
          router.refresh();
        }}
        className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Starting…" : "▶ Simulate 5 buyers"}
      </button>
      <span className="text-xs text-muted">{note ?? "You only see this for demo purposes"}</span>
    </div>
  );
}
