import { openDealFromOrder } from "@/lib/deals";
import { handle } from "@/lib/http";

// Buyer approved in PayPal: place the hold, open the deal, return the pickup code once.
export async function POST(_req: Request, ctx: RouteContext<"/api/orders/[orderId]/authorize">) {
  return handle(async () => {
    const { orderId } = await ctx.params;
    return openDealFromOrder(orderId);
  });
}
