import { DealError, getListing, holdPriceFor } from "@/lib/deals";
import { handle } from "@/lib/http";
import { createHoldOrder } from "@/lib/paypal";

// Buyer tapped the PayPal button: create an AUTHORIZE order for the agreed price.
export async function POST(_req: Request, ctx: RouteContext<"/api/listings/[id]/order">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const listing = getListing(id);
    if (!listing) throw new DealError("Listing not found.", 404);
    if (listing.status !== "active") throw new DealError("This item is already reserved.", 409);
    const orderId = await createHoldOrder({ listingId: listing.id, title: listing.title, priceCents: holdPriceFor(listing) });
    return { orderId };
  });
}
