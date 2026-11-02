import { DealError, openDealFromOrder } from "@/lib/deals";
import { handle } from "@/lib/http";

// Buyer approved in PayPal: place the hold, open the deal, return the pickup code once.
export async function POST(req: Request, ctx: RouteContext<"/api/orders/[orderId]/authorize">) {
  return handle(async () => {
    const { orderId } = await ctx.params;
    const { buyerName } = (await req.json().catch(() => ({}))) as { buyerName?: string };
    const name = buyerName?.trim().slice(0, 40);
    if (!name) throw new DealError("Please enter your name.");
    return openDealFromOrder(orderId, name);
  });
}
