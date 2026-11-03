import { DealError, demoMode } from "@/lib/deals";
import { handle } from "@/lib/http";
import { limit, LIMITS, visitor } from "@/lib/limits";
import { simulateBuyers } from "@/lib/simulate";
import { requireSeller } from "@/lib/seller-auth";

// Demo-only: start five scripted buyers chatting with the seller's assistant at once.
export async function POST(req: Request) {
  return handle(async () => {
    if (!demoMode()) throw new DealError("Not available.", 404);
    await requireSeller(req);
    const { listingId } = (await req.json().catch(() => ({}))) as { listingId?: string };
    limit(
      [
        [`sim:${visitor(req)}`, LIMITS.simulatePerVisitor],
        ["sim-all", LIMITS.simulateEveryone],
      ],
      "The simulation ran a few times already. Try again later."
    );
    return simulateBuyers(listingId || "sofa-123");
  });
}
