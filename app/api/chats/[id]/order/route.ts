import { createOrderForChat } from "@/lib/deals";
import { handle } from "@/lib/http";

// Buyer tapped the PayPal button: create an AUTHORIZE order for the price agreed in the chat.
export async function POST(_req: Request, ctx: RouteContext<"/api/chats/[id]/order">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return { orderId: await createOrderForChat(id) };
  });
}
