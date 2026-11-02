"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";
import type { publicDeal } from "@/lib/deals";

type Deal = ReturnType<typeof publicDeal>;

export function SellerDealCard({ deal, title }: { deal: Deal; title: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(action: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/deals/${deal.id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error);
      router.refresh();
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3 rounded-xl border border-brand bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium">
            {deal.buyerName} · {money(deal.priceCents)}
          </p>
          <p className="text-sm text-muted">{title}</p>
        </div>
        <span className="rounded-full bg-brand-soft px-2 py-1 text-xs font-medium text-brand">
          {deal.status === "held" ? `${money(deal.priceCents)} held by PayPal` : deal.status}
        </span>
      </div>

      {deal.status === "held" && (
        <div className="flex gap-2">
          <button
            onClick={() => act("approve")}
            disabled={busy}
            className="flex-1 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={() => act("decline")}
            disabled={busy}
            className="rounded-lg border border-line px-4 py-2 text-sm disabled:opacity-50"
          >
            Decline
          </button>
        </div>
      )}

      {deal.status === "approved" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act("pickup", { code });
          }}
          className="flex gap-2"
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            placeholder="Buyer's 4-digit code"
            className="flex-1 rounded-lg border border-line px-3 py-2 font-mono outline-none focus:border-brand"
          />
          <button
            type="submit"
            disabled={busy || code.length !== 4}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Getting paid…" : "Get paid"}
          </button>
        </form>
      )}

      {deal.status === "locked" && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted">Too many wrong codes. Cancel to release the buyer&apos;s hold.</span>
          <button onClick={() => act("decline")} disabled={busy} className="rounded-lg border border-line px-3 py-2">
            Cancel deal
          </button>
        </div>
      )}

      {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
