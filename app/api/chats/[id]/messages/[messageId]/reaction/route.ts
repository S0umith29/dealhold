import { getChat, publicChat, reactToMessage } from "@/lib/agent";
import { handle } from "@/lib/http";

// Buyer adds or removes an emoji reaction on a message.
export async function POST(req: Request, ctx: RouteContext<"/api/chats/[id]/messages/[messageId]/reaction">) {
  return handle(async () => {
    const { id, messageId } = await ctx.params;
    const { emoji } = (await req.json().catch(() => ({}))) as { emoji?: string };
    reactToMessage(id, Number(messageId), emoji ?? "");
    return publicChat(getChat(id)!);
  });
}
