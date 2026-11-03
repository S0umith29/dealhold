import webpush from "web-push";
import { db } from "./db";

// Browser push notifications to the seller ("Leo: $135 held. Tap to approve.").
// Uses the standard Web Push protocol, so no third-party notification service is needed.

let configured = false;
function configure() {
  if (configured) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(VAPID_SUBJECT || "mailto:dealhold@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
  return true;
}

export function saveSubscription(sub: webpush.PushSubscription) {
  db()
    .prepare("INSERT OR REPLACE INTO push_subscriptions (endpoint, subscription) VALUES (?, ?)")
    .run(sub.endpoint, JSON.stringify(sub));
}

// Fire-and-forget: a failed notification must never break a deal.
export function notifySeller(message: { title: string; body: string; url?: string }) {
  if (!configure()) return;
  const subs = db().prepare("SELECT endpoint, subscription FROM push_subscriptions").all() as {
    endpoint: string;
    subscription: string;
  }[];
  const payload = JSON.stringify({ ...message, url: message.url ?? "/seller" });
  for (const s of subs) {
    webpush.sendNotification(JSON.parse(s.subscription), payload).catch((err: { statusCode?: number }) => {
      // 404/410: the browser unsubscribed; forget it.
      if (err.statusCode === 404 || err.statusCode === 410) {
        db().prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(s.endpoint);
      } else {
        console.error("Push notification failed", err);
      }
    });
  }
}
