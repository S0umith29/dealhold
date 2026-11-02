import { agentStats, sellerActivity } from "@/lib/agent";
import { handle } from "@/lib/http";

// Live data for the seller's buyer-activity grid (polled).
export async function GET() {
  return handle(async () => ({ rows: sellerActivity(), stats: agentStats() }));
}
