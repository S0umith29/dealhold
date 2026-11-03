"use client";

import { useEffect, useState } from "react";

type State = "unsupported" | "off" | "on" | "blocked" | "busy";

// Push keys are base64url; the browser wants raw bytes.
function keyBytes(base64url: string) {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

// Lets the seller get a phone/desktop notification when money is held or a buyer asks something.
export function NotificationsButton({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("off");

  useEffect(() => {
    if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") return setState("blocked");
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (!sub) return;
        setState("on");
        // Re-send it: free hosting forgets subscriptions when it restarts.
        fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub) });
      })
      .catch(() => setState("unsupported"));
  }, [publicKey]);

  async function turnOn() {
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "blocked" : "off");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      setState(res.ok ? "on" : "off");
    } catch {
      setState("off");
    }
  }

  if (state === "unsupported") return null;
  if (state === "on") return <span className="text-xs text-brand">🔔 Notifications on</span>;
  if (state === "blocked") return <span className="text-xs text-muted">Notifications blocked in browser settings</span>;
  return (
    <button
      onClick={turnOn}
      disabled={state === "busy"}
      className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand hover:text-brand disabled:opacity-50"
    >
      {state === "busy" ? "Turning on…" : "🔔 Turn on notifications"}
    </button>
  );
}
