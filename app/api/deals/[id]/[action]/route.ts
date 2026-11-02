import { approveDeal, cancelDeal, completePickup, DealError } from "@/lib/deals";
import { handle } from "@/lib/http";

// Seller: approve | decline | pickup (with code). Buyer: cancel.
export async function POST(req: Request, ctx: RouteContext<"/api/deals/[id]/[action]">) {
  return handle(async () => {
    const { id, action } = await ctx.params;
    switch (action) {
      case "approve":
        return approveDeal(id);
      case "decline":
        return cancelDeal(id, "Declined by the seller");
      case "cancel":
        return cancelDeal(id, "Cancelled by the buyer");
      case "pickup": {
        const { code } = (await req.json().catch(() => ({}))) as { code?: string };
        if (!code || !/^\d{4}$/.test(code.trim())) throw new DealError("Enter the 4-digit code.");
        return completePickup(id, code);
      }
      default:
        throw new DealError("Unknown action.", 404);
    }
  });
}
