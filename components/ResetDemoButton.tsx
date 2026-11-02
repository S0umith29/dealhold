"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Shown only in demo mode: lets each judge start the flow fresh.
export function ResetDemoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        if (!confirm("Reset the demo? Buyer chats are cleared and sold items go back on sale.")) return;
        setBusy(true);
        await fetch("/api/demo/reset", { method: "POST" });
        try {
          Object.keys(localStorage)
            .filter((k) => k.startsWith("dealhold-"))
            .forEach((k) => localStorage.removeItem(k));
        } catch {}
        setBusy(false);
        router.refresh();
      }}
      className="rounded-lg border border-dashed border-line px-3 py-1.5 text-xs text-muted hover:border-brand hover:text-brand disabled:opacity-50"
    >
      {busy ? "Resetting…" : "Reset demo"}
    </button>
  );
}
