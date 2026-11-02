"use client";

import { useEffect, useRef } from "react";
import { loadScript } from "@paypal/paypal-js";

type Props = {
  clientId: string;
  createOrder: () => Promise<string>;
  onApprove: (orderId: string) => Promise<void>;
  onError: (message: string) => void;
};

// Renders PayPal's own button (JS SDK v5) with intent=authorize, i.e. a hold, not a charge.
// We render it directly because the React wrapper didn't mount the button with React 19.
export function PayPalHoldButton({ clientId, createOrder, onApprove, onError }: Props) {
  const container = useRef<HTMLDivElement>(null);
  // Keep the latest callbacks without re-rendering PayPal's iframe.
  const handlers = useRef({ createOrder, onApprove, onError });
  handlers.current = { createOrder, onApprove, onError };

  useEffect(() => {
    let closed = false;
    let buttons: { close: () => Promise<void> } | undefined;

    loadScript({ clientId, intent: "authorize", currency: "USD" })
      .then((paypal) => {
        if (closed || !paypal?.Buttons || !container.current) return;
        const b = paypal.Buttons({
          fundingSource: "paypal",
          style: { layout: "vertical", label: "pay" },
          createOrder: () => handlers.current.createOrder(),
          onApprove: (data) => handlers.current.onApprove(data.orderID),
          onError: () => handlers.current.onError("PayPal ran into a problem. Please try again."),
        });
        buttons = b;
        return b.render(container.current);
      })
      .catch(() => handlers.current.onError("Couldn't load PayPal. Check your connection and refresh."));

    return () => {
      closed = true;
      buttons?.close().catch(() => {});
    };
  }, [clientId]);

  return <div ref={container} className="min-h-[45px]" />;
}
