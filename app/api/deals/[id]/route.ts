import { DealError, getDeal, publicDeal } from "@/lib/deals";
import { handle } from "@/lib/http";

// Deal status for the buyer's page (polled).
export async function GET(_req: Request, ctx: RouteContext<"/api/deals/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const deal = getDeal(id);
    if (!deal) throw new DealError("Deal not found.", 404);
    return publicDeal(deal);
  });
}
