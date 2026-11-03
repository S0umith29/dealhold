import type { PushSubscription } from "web-push";
import { DealError } from "@/lib/deals";
import { handle } from "@/lib/http";
import { saveSubscription, validPushEndpoint } from "@/lib/notify";
import { requireSeller } from "@/lib/seller-auth";

// The seller's browser registers for push notifications.
export async function POST(req: Request) {
  return handle(async () => {
    await requireSeller(req);
    let sub = (await req.json().catch(() => null)) as PushSubscription | null;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth || !validPushEndpoint(sub.endpoint) || JSON.stringify(sub).length > 2000) {
      throw new DealError("Invalid subscription.");
    }
    sub = { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } };
    saveSubscription(sub);
  });
}
