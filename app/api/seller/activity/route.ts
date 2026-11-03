import { agentStats, sellerActivity } from "@/lib/agent";
import { salesStats } from "@/lib/deals";
import { handle } from "@/lib/http";
import { requireSeller } from "@/lib/seller-auth";

// Live data for the seller's buyer-activity grid (polled).
export async function GET() {
  return handle(async () => {
    await requireSeller();
    return { rows: sellerActivity(), stats: agentStats(), sales: salesStats() };
  });
}
