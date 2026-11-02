import { getChat, publicChat, startChat } from "@/lib/agent";
import { DealError } from "@/lib/deals";
import { handle } from "@/lib/http";

// A buyer starts chatting with the seller's agent.
export async function POST(req: Request, ctx: RouteContext<"/api/listings/[id]/chats">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { buyerName } = (await req.json().catch(() => ({}))) as { buyerName?: string };
    const name = buyerName?.trim().slice(0, 40);
    if (!name) throw new DealError("Please enter your name.");
    return publicChat(getChat(startChat(id, name))!);
  });
}
