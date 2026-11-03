import { NextResponse } from "next/server";
import { getChat, handleBuyerMessage, publicChat, startChat } from "@/lib/agent";
import { DealError, getListing, listListings, publicListing } from "@/lib/deals";
import { money } from "@/lib/format";
import { limit, LIMITS, visitor } from "@/lib/limits";

// Agent-to-agent buying: a buyer's own AI assistant (Claude, ChatGPT, any MCP client) can find
// items and haggle with the seller's assistant here. It gets the same rules as a human buyer:
// prices are decided by code, and paying still needs the human to approve the PayPal hold.
//
// A small, stateless MCP server over Streamable HTTP (JSON responses only).

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `DealHold lets you buy used items locally for your user.
Find an item, start a negotiation, and message the seller's assistant like a person would (questions, offers, pickup timing).
Prices are decided by the seller's rules, so be honest and reasonable. When a price is agreed, you get a checkout link:
your user opens it and approves a PayPal hold. They are only charged after they check the item at pickup.
Never agree to a price your user hasn't approved.`;

const TOOLS = [
  {
    name: "find_items",
    description: "List used items for sale, optionally filtered by words in the title or description.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Words to look for, e.g. 'sofa'" } },
    },
  },
  {
    name: "start_negotiation",
    description: "Open a chat with the seller's assistant about one item. Returns a chat_id for send_message.",
    inputSchema: {
      type: "object",
      properties: {
        listing_id: { type: "string" },
        buyer_name: { type: "string", description: "Your user's first name" },
      },
      required: ["listing_id", "buyer_name"],
    },
  },
  {
    name: "send_message",
    description:
      "Send one message to the seller's assistant (a question, an offer like 'Would you take $120?', or 'Deal'). Returns its reply, the current price, and a checkout link once a price is agreed.",
    inputSchema: {
      type: "object",
      properties: { chat_id: { type: "string" }, message: { type: "string" } },
      required: ["chat_id", "message"],
    },
  },
  {
    name: "get_chat",
    description: "Read the whole chat, e.g. to see an answer the seller sent later.",
    inputSchema: { type: "object", properties: { chat_id: { type: "string" } }, required: ["chat_id"] },
  },
];

// Public URL of this app, behind Render's proxy too.
function origin(req: Request) {
  // Prefer the configured address: request headers can be set by the caller.
  const configured = process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL;
  if (configured) return configured.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto.split(",")[0]}://${host}`;
}

function chatSummary(req: Request, chatId: string) {
  const chat = getChat(chatId);
  if (!chat) throw new DealError("Chat not found.", 404);
  const view = publicChat(chat);
  const agreed = chat.status === "agreed";
  return {
    chat_id: chat.id,
    status: chat.status,
    current_price: money(chat.agreed_cents ?? chat.counter_cents),
    assistant_reply: view.messages.filter((m) => m.sender === "agent").at(-1)?.text ?? "",
    ...(agreed
      ? {
          agreed_price: money(chat.agreed_cents!),
          checkout_url: `${origin(req)}/l/${chat.listing_id}?chat=${chat.id}`,
          next_step:
            "Ask your user to open checkout_url and approve the PayPal hold. They are only charged after checking the item at pickup.",
        }
      : {}),
  };
}

async function callTool(req: Request, name: string, args: Record<string, unknown>) {
  const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string).trim() : "");
  switch (name) {
    case "find_items": {
      const words = str("query").toLowerCase().split(/\s+/).filter(Boolean);
      return listListings()
        .filter((l) => l.status === "active")
        .filter((l) => words.every((w) => `${l.title} ${l.description}`.toLowerCase().includes(w)))
        .map((row) => {
          const l = publicListing(row);
          return {
            listing_id: l.id,
            title: l.title,
            asking_price: money(l.askCents),
            seller: l.sellerName,
            description: l.description,
            facts: l.facts,
            url: `${origin(req)}/l/${l.id}`,
          };
        });
    }
    case "start_negotiation": {
      const listing = getListing(str("listing_id"));
      if (!listing || listing.status !== "active") throw new DealError("That item isn't for sale.", 404);
      const name = str("buyer_name").slice(0, 30);
      if (!name) throw new DealError("buyer_name is required.");
      limit([[`chat:${visitor(req)}`, LIMITS.chatPerVisitor]], "Too many new chats. Try again later.");
      return chatSummary(req, startChat(listing.id, `${name} (AI agent)`));
    }
    case "send_message": {
      const chatId = str("chat_id");
      const text = str("message");
      if (!text) throw new DealError("message is required.");
      if (!getChat(chatId)) throw new DealError("Chat not found.", 404);
      limit([
        [`msg:${visitor(req)}`, LIMITS.messagePerVisitor],
        [`msg-chat:${chatId}`, LIMITS.messagePerChat],
        ["msg-all", LIMITS.messageEveryone],
      ]);
      await handleBuyerMessage(chatId, text);
      return chatSummary(req, chatId);
    }
    case "get_chat": {
      const chat = getChat(str("chat_id"));
      if (!chat) throw new DealError("Chat not found.", 404);
      return { ...chatSummary(req, chat.id), messages: publicChat(chat).messages.map((m) => ({ from: m.sender === "agent" ? "seller's assistant" : "you", text: m.text })) };
    }
    default:
      throw new DealError(`Unknown tool: ${name}`, 404);
  }
}

type RpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

async function respond(req: Request, msg: RpcRequest) {
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id ?? null, result });
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "dealhold", title: "DealHold", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const data = await callTool(req, name, args);
        return ok({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }], isError: false });
      } catch (err) {
        // Tool errors go back to the calling AI as text it can read and recover from.
        const text = err instanceof DealError ? err.message : "Something went wrong. Try again.";
        if (!(err instanceof DealError)) console.error("MCP tool failed", err);
        return ok({ content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return { jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32601, message: `Method not found: ${msg.method}` } };
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as RpcRequest | RpcRequest[] | null;
  if (!body) {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const messages = Array.isArray(body) ? body : [body];
  // Notifications (no id) need no answer.
  const requests = messages.filter((m) => m.id !== undefined && m.id !== null);
  if (requests.length === 0) return new Response(null, { status: 202 });
  const results = await Promise.all(requests.map((m) => respond(req, m)));
  return NextResponse.json(Array.isArray(body) ? results : results[0]);
}

// No server-to-client stream: this server only answers requests.
export function GET() {
  return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
}
