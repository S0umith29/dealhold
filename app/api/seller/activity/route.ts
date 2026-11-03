import { agentStats, sellerActivity } from "@/lib/agent";
import { salesStats } from "@/lib/deals";
import { handle } from "@/lib/http";

// Live data for the seller's buyer-activity grid (polled).
export async function GET() {
  return handle(async () => ({ rows: sellerActivity(), stats: agentStats(), sales: salesStats() }));
}
