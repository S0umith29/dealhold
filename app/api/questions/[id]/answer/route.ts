import { answerSellerQuestion } from "@/lib/agent";
import { DealError } from "@/lib/deals";
import { handle } from "@/lib/http";
import { requireSeller } from "@/lib/seller-auth";

// Seller answers a question the agent couldn't.
export async function POST(req: Request, ctx: RouteContext<"/api/questions/[id]/answer">) {
  return handle(async () => {
    await requireSeller(req);
    const { id } = await ctx.params;
    const { answer } = (await req.json().catch(() => ({}))) as { answer?: string };
    const text = answer?.trim().slice(0, 300);
    if (!text) throw new DealError("Type an answer.");
    return answerSellerQuestion(Number(id), text);
  });
}
