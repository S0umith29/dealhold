import { DealError, demoMode, resetDemo } from "@/lib/deals";
import { handle } from "@/lib/http";
import { limit, visitor } from "@/lib/limits";
import { requireSeller } from "@/lib/seller-auth";

// Demo-only reset so every judge can run the full flow.
export async function POST(req: Request) {
  return handle(async () => {
    if (!demoMode()) throw new DealError("Not available.", 404);
    await requireSeller(req);
    limit([[`reset:${visitor(req)}`, { limit: 10, ms: 60 * 60_000 }]], "Reset a lot already. Try again later.");
    return resetDemo();
  });
}
