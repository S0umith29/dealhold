"use client";

import { useEffect, useState } from "react";
import { money } from "@/lib/format";
import type { publicDeal } from "@/lib/deals";

type Deal = ReturnType<typeof publicDeal>;

const STATUS_TEXT: Record<Deal["status"], { title: string; body: (seller: string) => string }> = {
  held: { title: "Payment held", body: (s) => `Waiting for ${s} to approve. You haven't been charged.` },
  approved: { title: "Approved: go pick it up", body: (s) => `Check the item, then read your code to ${s}.` },
  completed: { title: "Done", body: (s) => `Payment sent to ${s}. Enjoy!` },
  cancelled: { title: "Cancelled", body: () => "The hold was released. You weren't charged." },
  locked: { title: "Locked", body: () => "Too many wrong codes were entered. Contact the seller or cancel." },
};

export function BuyerDeal({ initial, title, sellerName }: { initial: Deal; title: string; sellerName: string }) {
  const [deal, setDeal] = useState(initial);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setCode(localStorage.getItem(`dealhold-code-${deal.id}`));
    } catch {}
  }, [deal.id]);

  // Poll so the buyer sees approve / pickup without refreshing.
  useEffect(() => {
    if (deal.status === "completed" || deal.status === "cancelled") return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/deals/${deal.id}`);
      if (res.ok) setDeal(await res.json());
    }, 3000);
    return () => clearInterval(t);
  }, [deal.id, deal.status]);

  async function cancel() {
    if (!confirm("Cancel and release the hold?")) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/deals/${deal.id}/cancel`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) setError(data.error);
    else setDeal({ ...deal, status: "cancelled" });
    setBusy(false);
  }

  const text = STATUS_TEXT[deal.status];
  const active = deal.status === "held" || deal.status === "approved" || deal.status === "locked";

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="rounded-xl border border-line bg-white p-5">
        <p className="text-sm text-muted">
          {title} · {money(deal.priceCents)}
        </p>
        <h1 className="mt-1 text-xl font-semibold">{text.title}</h1>
        <p className="text-muted">{text.body(sellerName)}</p>
      </div>

      {active && (
        <div className="rounded-xl border border-brand bg-brand-soft p-5 text-center">
          <p className="text-sm">Your pickup code</p>
          <p className="my-2 font-mono text-4xl font-semibold tracking-[0.3em]">{code ?? "••••"}</p>
          <p className="text-sm">
            {code
              ? `Only give this to ${sellerName} after you've checked the item. It releases the payment.`
              : "The code was shown on the device you paid with."}
          </p>
        </div>
      )}

      {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {active && (
        <button
          onClick={cancel}
          disabled={busy}
          className="w-full rounded-lg border border-line bg-white px-4 py-2 text-sm hover:border-red-300 hover:text-red-700 disabled:opacity-50"
        >
          Item not as described? Cancel and release the hold
        </button>
      )}
    </div>
  );
}
