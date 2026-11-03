import type { PushSubscription } from "web-push";
import { DealError } from "@/lib/deals";
import { handle } from "@/lib/http";
import { saveSubscription } from "@/lib/notify";

// The seller's browser registers for push notifications.
export async function POST(req: Request) {
  return handle(async () => {
    const sub = (await req.json().catch(() => null)) as PushSubscription | null;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new DealError("Invalid subscription.");
    saveSubscription(sub);
  });
}
