"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PayPalHoldButton } from "./PayPalHoldButton";
import { money } from "@/lib/format";

type Props = {
  listingId: string;
  sellerName: string;
  priceCents: number;
  status: "active" | "reserved" | "sold";
  paypalClientId: string;
};

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
  return data as T;
}

export function HoldPanel({ listingId, sellerName, priceCents, status, paypalClientId }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status !== "active") {
    return (
      <div className="rounded-xl border border-line bg-white p-4">
        <p className="font-medium">{status === "sold" ? "Sold" : "Reserved"}</p>
        <p className="text-sm text-muted">
          {status === "sold"
            ? "This item has been sold."
            : "Someone has reserved this item. Check back if the deal falls through."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-line bg-white p-4">
      <div>
        <p className="text-sm text-muted">Reserve for</p>
        <p className="text-2xl font-semibold">{money(priceCents)}</p>
      </div>

      <ul className="space-y-1 text-sm text-muted">
        <li>• PayPal holds the money. You aren&apos;t charged yet.</li>
        <li>• At pickup, check the item, then give {sellerName} your code.</li>
        <li>• Not as described? Cancel, and the hold is released.</li>
      </ul>

      <label className="block text-sm">
        <span className="text-muted">Your name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Leo"
          maxLength={40}
          className="mt-1 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-brand"
        />
      </label>

      {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {busy && <p className="text-sm text-muted">Placing your hold…</p>}

      <div className={name.trim() ? "" : "pointer-events-none opacity-40"} aria-disabled={!name.trim()}>
        <PayPalHoldButton
          clientId={paypalClientId}
          createOrder={async () => {
            setError(null);
            const { orderId } = await post<{ orderId: string }>(`/api/listings/${listingId}/order`);
            return orderId;
          }}
          onApprove={async (orderId) => {
            setBusy(true);
            try {
              const { dealId, code } = await post<{ dealId: string; code: string }>(
                `/api/orders/${orderId}/authorize`,
                { buyerName: name }
              );
              // The code is shown once; keep it on this device for the deal page.
              try {
                localStorage.setItem(`dealhold-code-${dealId}`, code);
              } catch {}
              router.push(`/d/${dealId}`);
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
          onError={setError}
        />
      </div>
    </div>
  );
}
