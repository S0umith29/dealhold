import { getChat, publicChat } from "@/lib/agent";
import { DealError } from "@/lib/deals";
import { handle } from "@/lib/http";

// The buyer's chat (polled for the seller's answers).
export async function GET(_req: Request, ctx: RouteContext<"/api/chats/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const chat = getChat(id);
    if (!chat) throw new DealError("Chat not found.", 404);
    return publicChat(chat);
  });
}
