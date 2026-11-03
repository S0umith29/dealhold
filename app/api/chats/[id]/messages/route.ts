import { getChat, handleBuyerMessage, publicChat } from "@/lib/agent";
import { DealError } from "@/lib/deals";
import { handle } from "@/lib/http";
import { limit, LIMITS, visitor } from "@/lib/limits";

// Buyer sends a message; the seller's agent replies.
export async function POST(req: Request, ctx: RouteContext<"/api/chats/[id]/messages">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { text } = (await req.json().catch(() => ({}))) as { text?: string };
    if (!text?.trim()) throw new DealError("Type a message.");
    limit(
      [
        [`msg:${visitor(req)}`, LIMITS.messagePerVisitor],
        [`msg-chat:${id}`, LIMITS.messagePerChat],
        ["msg-all", LIMITS.messageEveryone],
      ],
      "That's a lot of messages. Give it a minute and try again."
    );
    await handleBuyerMessage(id, text);
    return publicChat(getChat(id)!);
  });
}
