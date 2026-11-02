import { getChat, handleBuyerMessage, publicChat } from "@/lib/agent";
import { DealError } from "@/lib/deals";
import { handle } from "@/lib/http";

// Buyer sends a message; the seller's agent replies.
export async function POST(req: Request, ctx: RouteContext<"/api/chats/[id]/messages">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { text } = (await req.json().catch(() => ({}))) as { text?: string };
    if (!text?.trim()) throw new DealError("Type a message.");
    await handleBuyerMessage(id, text);
    return publicChat(getChat(id)!);
  });
}
