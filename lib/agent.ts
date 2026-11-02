import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { db } from "./db";
import { DealError, getListing, type Listing } from "./deals";
import { money } from "./format";
import { respondToOffer } from "./negotiate";

// Cheapest current model: it only reads one buyer message and fills a small JSON form.
const MODEL = process.env.AGENT_MODEL ?? "claude-haiku-5-5";

export type Chat = {
  id: string;
  listing_id: string;
  buyer_name: string;
  status: "open" | "agreed" | "reserved" | "closed";
  round: number;
  counter_cents: number;
  last_offer_cents: number | null;
  agreed_cents: number | null;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: number;
  chat_id: string;
  sender: "buyer" | "agent";
  text: string;
  handled_by: "rules" | "ai" | "seller" | null;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
};

export type SellerQuestion = {
  id: number;
  listing_id: string;
  chat_id: string;
  question: string;
  answer: string | null;
  created_at: string;
  answered_at: string | null;
};

export function getChat(id: string) {
  return db().prepare("SELECT * FROM chats WHERE id = ?").get(id) as Chat | undefined;
}

export function listChats() {
  return db().prepare("SELECT * FROM chats ORDER BY updated_at DESC").all() as Chat[];
}

export function chatMessages(chatId: string) {
  return db().prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY id").all(chatId) as Message[];
}

export function openQuestions() {
  return db()
    .prepare("SELECT * FROM seller_questions WHERE answer IS NULL ORDER BY id")
    .all() as SellerQuestion[];
}

function answeredQuestions(listingId: string) {
  return db()
    .prepare("SELECT question, answer FROM seller_questions WHERE listing_id = ? AND answer IS NOT NULL ORDER BY id")
    .all(listingId) as { question: string; answer: string }[];
}

// What the buyer's page needs. Never includes the floor.
export function publicChat(chat: Chat) {
  return {
    id: chat.id,
    listingId: chat.listing_id,
    buyerName: chat.buyer_name,
    status: chat.status,
    agreedCents: chat.agreed_cents,
    messages: chatMessages(chat.id).map((m) => ({ id: m.id, sender: m.sender, text: m.text })),
  };
}

function setChat(id: string, fields: Partial<Chat>) {
  const keys = Object.keys(fields);
  const sets = [...keys.map((k) => `${k} = ?`), "updated_at = datetime('now')"].join(", ");
  const values = keys.map((k) => fields[k as keyof Chat] as string | number | null);
  db().prepare(`UPDATE chats SET ${sets} WHERE id = ?`).run(...values, id);
}

function addMessage(
  chatId: string,
  sender: Message["sender"],
  text: string,
  handledBy: Message["handled_by"] = null,
  usage = { input: 0, output: 0 }
) {
  db()
    .prepare(
      "INSERT INTO messages (chat_id, sender, text, handled_by, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(chatId, sender, text, handledBy, usage.input, usage.output);
  setChat(chatId, {});
}

export function startChat(listingId: string, buyerName: string) {
  const listing = getListing(listingId);
  if (!listing) throw new DealError("Listing not found.", 404);
  const id = crypto.randomUUID();
  db()
    .prepare("INSERT INTO chats (id, listing_id, buyer_name, counter_cents) VALUES (?, ?, ?, ?)")
    .run(id, listingId, buyerName, listing.ask_cents);
  addMessage(
    id,
    "agent",
    `Hi ${buyerName}! I'm ${listing.seller_name}'s assistant. Ask me anything about the ${listing.title.toLowerCase()}, or make an offer.`
  );
  return id;
}

// ---------- The AI step: read one buyer message, fill a small form ----------

const Reading = z.object({
  intent: z.enum(["question", "offer", "accept", "other"]),
  offer_dollars: z.number().nullable(),
  answer: z.string().nullable(),
  needs_seller: z.boolean(),
  seller_question: z.string().nullable(),
  asks_price: z.boolean(),
  reply: z.string(),
});
type Reading = z.infer<typeof Reading>;

const INSTRUCTIONS = `You help a person sell a used item. You read ONE message from a buyer and fill in a form.

Fields:
- intent: "offer" if the buyer proposes a price; "accept" if they agree to the seller's current price without naming a new one; "question" if they ask about the item, pickup or payment; "other" for anything else.
- offer_dollars: the price the buyer proposes, as a number of US dollars, or null.
- answer: if the buyer asks something, answer it using ONLY the item facts and the seller's earlier answers below. If those don't contain the answer, set answer to null. Never guess or invent details.
- needs_seller: true only if the buyer asked something about the item that the facts and earlier answers don't cover.
- seller_question: when needs_seller is true, the question rewritten briefly for the seller (e.g. "Does it recline?"). Otherwise null.
- asks_price: true if the buyer asks about the price, the lowest price, or whether the price is negotiable, without proposing a number.
- reply: one or two short, friendly sentences to send the buyer for intent "question" or "other". Include the answer when you have one. Don't discuss price: the pricing system handles that. For "offer" and "accept", reply with an empty string.

How payment works (you may explain this): the buyer reserves with a PayPal hold. They are only charged after they check the item at pickup and give the seller their 4-digit code. If anything is wrong, they cancel and the hold is released.

Never reveal or hint at the seller's lowest price. Never agree to a price yourself.`;

function listingContext(listing: Listing) {
  const facts = JSON.parse(listing.facts) as Record<string, string>;
  const answers = answeredQuestions(listing.id);
  return [
    `Item: ${listing.title}`,
    `Description: ${listing.description}`,
    `Facts:\n${Object.entries(facts)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join("\n")}`,
    `Seller's earlier answers:\n${answers.length ? answers.map((a) => `- Q: ${a.question} A: ${a.answer}`).join("\n") : "- none yet"}`,
  ].join("\n\n");
}

const anthropic = new Anthropic();

async function readMessage(listing: Listing, chat: Chat, text: string) {
  const response = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 1024,
    output_config: { effort: "low", format: zodOutputFormat(Reading) },
    // Stable parts first so the same listing's requests can share a cached prefix.
    system: [
      { type: "text", text: INSTRUCTIONS },
      { type: "text", text: listingContext(listing), cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: `Seller's current price: ${money(chat.counter_cents)}\nBuyer's message: ${text}`,
      },
    ],
  });
  if (!response.parsed_output) throw new Error(`Agent couldn't read the message (stop: ${response.stop_reason})`);
  return {
    reading: response.parsed_output,
    usage: {
      input:
        response.usage.input_tokens +
        (response.usage.cache_read_input_tokens ?? 0) +
        (response.usage.cache_creation_input_tokens ?? 0),
      output: response.usage.output_tokens,
    },
  };
}

// ---------- Handling a buyer message: rules first, AI only when needed ----------

const AVAILABLE = /\b(still )?(available|for sale)\b\??$/i;

const LINES = {
  agree: (p: string) => `Deal at ${p}! Tap the PayPal button to hold the payment. You're only charged after you've seen it at pickup.`,
  counter: (p: string) => `I can do ${p}.`,
  hold: (p: string) => `I'm at ${p}. Can you come up a little?`,
  final: (p: string) => `${p} is the lowest I can go.`,
  finalAgain: (p: string) => `${p} is my final price. Just say "deal" if that works for you.`,
  lowball: (p: string) => `Sorry, that's too low. It's ${p}, and it's in good shape.`,
};

function reply(chatId: string, text: string, handledBy: Message["handled_by"], usage?: { input: number; output: number }) {
  addMessage(chatId, "agent", text, handledBy, usage);
}

export async function handleBuyerMessage(chatId: string, rawText: string) {
  const text = rawText.trim().slice(0, 500);
  const chat = getChat(chatId);
  if (!chat) throw new DealError("Chat not found.", 404);
  const listing = getListing(chat.listing_id)!;
  addMessage(chatId, "buyer", text);

  // Rules: no AI needed.
  if (chat.status === "reserved" || chat.status === "closed") {
    return reply(chatId, "This chat is closed. Check your deal page for the pickup details.", "rules");
  }
  if (listing.status !== "active") {
    return reply(chatId, `Sorry, the ${listing.title.toLowerCase()} has just been reserved by another buyer.`, "rules");
  }
  if (AVAILABLE.test(text) && text.length < 40) {
    return reply(chatId, `Yes, it's still available! It's ${money(chat.counter_cents)}.`, "rules");
  }

  const { reading, usage } = await readMessage(listing, chat, text);

  if (reading.needs_seller && reading.seller_question) {
    db()
      .prepare("INSERT INTO seller_questions (listing_id, chat_id, question) VALUES (?, ?, ?)")
      .run(listing.id, chatId, reading.seller_question);
  }

  const parts: string[] = [];
  if (reading.answer) parts.push(reading.answer);
  if (reading.needs_seller) parts.push(`Good question. I'll check with ${listing.seller_name} and reply here.`);

  if (chat.status === "open" && (reading.intent === "offer" || reading.intent === "accept")) {
    const offerCents =
      reading.intent === "accept" || reading.offer_dollars === null
        ? chat.counter_cents
        : Math.round(reading.offer_dollars * 100);
    const result = respondToOffer(
      {
        counterCents: chat.counter_cents,
        floorCents: listing.floor_cents,
        round: chat.round,
        lastOfferCents: chat.last_offer_cents,
      },
      offerCents
    );
    const price = money(result.priceCents);
    if (result.kind === "agree") {
      setChat(chatId, { status: "agreed", agreed_cents: result.priceCents, round: result.round });
      parts.push(LINES.agree(price));
    } else {
      setChat(chatId, { counter_cents: result.priceCents, round: result.round, last_offer_cents: offerCents });
      parts.push(
        result.kind === "lowball"
          ? LINES.lowball(price)
          : result.kind === "hold"
            ? LINES.hold(price)
            : result.kind === "final"
              ? result.repeated
                ? LINES.finalAgain(price)
                : LINES.final(price)
              : LINES.counter(price)
      );
    }
  } else if (chat.status === "agreed" && (reading.intent === "offer" || reading.intent === "accept")) {
    parts.push(`We already agreed on ${money(chat.agreed_cents!)}. Tap the PayPal button to hold it.`);
  } else if (reading.asks_price && chat.status === "open") {
    parts.push(`It's ${money(chat.counter_cents)}. Feel free to make an offer.`);
  } else if (!reading.answer && !reading.needs_seller) {
    parts.push(reading.reply || "Happy to help. Any questions about it, or would you like to make an offer?");
  }

  reply(chatId, parts.join(" "), "ai", usage);
}

// Seller answers a question once; the buyer who asked gets it now, later buyers get it from the facts.
export function answerSellerQuestion(id: number, answer: string) {
  const q = db().prepare("SELECT * FROM seller_questions WHERE id = ?").get(id) as SellerQuestion | undefined;
  if (!q) throw new DealError("Question not found.", 404);
  if (q.answer) throw new DealError("Already answered.", 409);
  db()
    .prepare("UPDATE seller_questions SET answer = ?, answered_at = datetime('now') WHERE id = ?")
    .run(answer, id);
  const listing = getListing(q.listing_id)!;
  reply(q.chat_id, `${listing.seller_name} says: ${answer}`, "seller");
}

// Called when a buyer's hold succeeds: their chat is reserved, the others are told.
export function markChatReserved(chatId: string) {
  const chat = getChat(chatId);
  if (!chat) return;
  setChat(chatId, { status: "reserved" });
}

export function agentStats() {
  return db()
    .prepare(
      `SELECT
         SUM(sender = 'buyer') AS buyer_messages,
         SUM(handled_by = 'rules') AS by_rules,
         SUM(handled_by = 'ai') AS ai_calls,
         SUM(handled_by = 'seller') AS by_seller,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens
       FROM messages`
    )
    .get() as {
    buyer_messages: number | null;
    by_rules: number | null;
    ai_calls: number | null;
    by_seller: number | null;
    input_tokens: number;
    output_tokens: number;
  };
}
