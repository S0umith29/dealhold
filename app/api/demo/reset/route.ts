import { DealError, demoMode, resetDemo } from "@/lib/deals";
import { handle } from "@/lib/http";

// Demo-only reset so every judge can run the full flow.
export async function POST() {
  return handle(async () => {
    if (!demoMode()) throw new DealError("Not available.", 404);
    return resetDemo();
  });
}
