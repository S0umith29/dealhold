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
  best_offer_cents: number | null; // highest price this buyer has offered
  last_concession_cents: number | null; // how much our previous counter came down
  pickup_bonus_used: number; // 1 once the quick-pickup step has been given
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
  quick_pickup: z.boolean(),
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
- quick_pickup: true if the buyer offers to pick up today, tomorrow, or "right now/ASAP".
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
  return { reading: response.parsed_output, usage: usageOf(response.usage) };
}

// ---------- Handling a buyer message: rules first, AI only when needed ----------

const AVAILABLE = /\b(still )?(available|for sale)\b\??$/i;
const BARE_NUMBER = /^(?:how about |what about |ok |okay )?\$?\s*(\d{2,5}(?:\.\d{1,2})?)\s*(?:\$|dollars|bucks)?\s*\??$/i;

type Usage = { input: number; output: number };
const NO_USAGE: Usage = { input: 0, output: 0 };
const addUsage = (a: Usage, b: Usage) => ({ input: a.input + b.input, output: a.output + b.output });

function usageOf(u: Anthropic.Usage): Usage {
  return {
    input: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    output: u.output_tokens,
  };
}

function reply(chatId: string, text: string, handledBy: Message["handled_by"], usage?: Usage) {
  addMessage(chatId, "agent", text, handledBy, usage);
}

// What the pricing code decided for one offer. The AI only words it.
type Decision = {
  kind: "agree" | "counter" | "hold" | "remind" | "final" | "lowball";
  priceCents: number;
  offerCents: number;
  bestOfferCents: number | null;
  repeated: boolean;
  atFloor: boolean;
  pickupBonus: boolean; // this step was traded for a quick pickup
  previousCents: number; // our price before this offer
};

// Fixed wording: used if the AI's wording fails the checks below. Never claims "lowest" unless it's the floor.
function fallbackLine(d: Decision) {
  const p = money(d.priceCents);
  const best = d.bestOfferCents ? money(d.bestOfferCents) : "";
  switch (d.kind) {
    case "agree":
      return `Deal at ${p}! Tap the PayPal button to hold the payment. You're only charged after you've seen it at pickup.`;
    case "counter":
      return d.pickupBonus ? `Since you can pick it up soon, I can do ${p}.` : `I can do ${p}.`;
    case "hold":
      return `I'm at ${p}. Can you come up a little?`;
    case "remind":
      return d.repeated
        ? `I'm staying at ${p}, just above your ${best} offer. Say "deal" to lock it in.`
        : `You offered ${best} earlier. Let's meet at ${p}?`;
    case "final":
      if (d.atFloor) return d.repeated ? `${p} is the lowest I can go. Just say "deal" if that works for you.` : `${p} is the lowest I can go.`;
      return d.repeated ? `${p} is my final offer. Just say "deal" if that works for you.` : `${p} is my best price.`;
    case "lowball":
      return `Sorry, that's too low. It's ${p}, and it's in good shape.`;
  }
}

// What the reply must convey, per decision. The AI may phrase it freely around these facts.
function decisionBrief(d: Decision) {
  const p = money(d.priceCents);
  const best = d.bestOfferCents ? money(d.bestOfferCents) : "";
  switch (d.kind) {
    case "agree":
      return `The deal is agreed at ${p}. Confirm it warmly, and tell the buyer to tap the PayPal button below to hold the payment. They're only charged after they've seen the item at pickup.`;
    case "counter":
      return d.pickupBonus
        ? `Counter-offer at ${p}, down from ${money(d.previousCents)}, and make clear this price is because they can pick up soon (the seller needs it gone this week).`
        : `Counter-offer at ${p}, down from ${money(d.previousCents)}. Use different wording from your earlier messages.`;
    case "hold":
      return `The buyer repeated their offer. Stay at ${p} and ask them to come up a little.`;
    case "remind":
      return d.repeated
        ? `Stay at ${p}, which is just above the ${best} the buyer offered earlier. Invite them to say "deal".`
        : `The buyer lowered their offer below the ${best} they offered earlier. Point that out kindly and suggest meeting at ${p}.`;
    case "final":
      return d.atFloor
        ? `${p} is the lowest the seller will accept. Say so, and invite them to say "deal".`
        : `${p} is the seller's final offer in this chat. Do NOT call it the lowest possible price. Invite them to say "deal".`;
    case "lowball":
      return `The buyer's offer of ${money(d.offerCents)} is far too low. Decline politely and restate the price of ${p}.`;
  }
}

const WRITER_INSTRUCTIONS = `You write one short chat reply (1-2 sentences, under 40 words) for a person selling a used item. You speak as the seller's assistant: friendly, plain, no emojis, no exclamation-mark spam.

You are given what the reply must convey. Follow it exactly. You may refer naturally to something the buyer said (like their pickup timing), but:
- Only mention the dollar amounts you are given. Never invent, round or change a price.
- Unless told the price is the lowest the seller accepts, never imply it is: no "lowest", "can't go below", "best I can do".
- Payment is only through a PayPal hold. Never agree to cash or other payment methods.
- Never promise anything about the item beyond what you are given.
- Don't start with "Thanks" every time; vary your openings and don't repeat the buyer's name in every message.
- Output only the reply text.`;

const DOLLAR = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g;
// Phrases that claim a price is the seller's minimum. Only true when it's the floor.
const LOWEST_WORDS =
  /\b(lowest|bottom|minimum|floor|rock[- ]bottom|best I can do|can'?t go (any )?(lower|below|under)|won'?t go (any )?(lower|below|under)|as low as I can|as far as I('ll| will| can)? go|most I can (come down|do|go)|limit)\b/i;
const OTHER_PAYMENT = /\b(cash|venmo|zelle|cash ?app|check)\b/i;

// Code checks the AI's wording: right price present, no other amounts, no false "lowest" claim.
function wordingIsSafe(text: string, d: Decision, askCents: number) {
  if (!text || text.length > 300) return false;
  const allowed = new Set([d.priceCents, d.offerCents, d.bestOfferCents, d.previousCents, askCents].filter(Boolean) as number[]);
  const amounts = [...text.matchAll(DOLLAR)].map((m) => Math.round(Number(m[1].replace(/,/g, "")) * 100));
  if (!amounts.includes(d.priceCents)) return false;
  if (amounts.some((a) => !allowed.has(a))) return false;
  if (!d.atFloor && LOWEST_WORDS.test(text)) return false;
  if (OTHER_PAYMENT.test(text)) return false;
  if (d.kind === "agree" && !/paypal/i.test(text)) return false;
  return true;
}

// AI writes the sentence around the code's decision; falls back to fixed wording if anything is off.
async function wordDecision(
  listing: Listing,
  chat: Chat,
  buyerText: string,
  d: Decision,
  notes: string[] = []
): Promise<{ text: string; usage: Usage }> {
  // Notes (an answer, or "I'll check with the seller") lead the reply, word for word.
  const prefix = notes.length ? `${notes.join(" ")} ` : "";
  const fallback = prefix + fallbackLine(d);
  try {
    const recent = chatMessages(chat.id)
      .slice(-5)
      .map((m) => `${m.sender === "buyer" ? "Buyer" : "You"}: ${m.text}`)
      .join("\n");
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      output_config: { effort: "low" },
      system: WRITER_INSTRUCTIONS,
      messages: [
        {
          role: "user",
          content:
            `Item: ${listing.title}\nRecent chat:\n${recent}\n\nBuyer's latest message: ${buyerText}\n\n` +
            (notes.length ? `Already being said before your reply (don't repeat or contradict it): ${notes.join(" ")}\n\n` : "") +
            `Your reply must convey only the price part: ${decisionBrief(d)}`,
        },
      ],
    });
    const text = response.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join(" ")
      .trim();
    const usage = usageOf(response.usage);
    if (wordingIsSafe(text, d, listing.ask_cents)) return { text: prefix + text, usage };
    console.warn(`Rejected AI wording for ${d.kind} at ${money(d.priceCents)}: ${text}`);
    return { text: fallback, usage };
  } catch (err) {
    console.error("Reply wording failed, using fixed line", err);
    return { text: fallback, usage: NO_USAGE };
  }
}

// Runs the pricing code for one offer and saves the new state. Returns the decision to word.
function negotiate(chat: Chat, listing: Listing, offerCents: number, quickPickup = false): Decision {
  const result = respondToOffer(
    {
      counterCents: chat.counter_cents,
      floorCents: listing.floor_cents,
      round: chat.round,
      bestOfferCents: chat.best_offer_cents,
      lastConcessionCents: chat.last_concession_cents,
      pickupBonusUsed: Boolean(chat.pickup_bonus_used),
    },
    offerCents,
    { quickPickup }
  );
  const conceded = "concessionCents" in result && result.concessionCents > 0;
  const pickupBonus = "pickupBonus" in result && result.pickupBonus;
  if (result.kind === "agree") {
    setChat(chat.id, { status: "agreed", agreed_cents: result.priceCents, round: result.round });
  } else {
    setChat(chat.id, {
      counter_cents: result.priceCents,
      round: result.round,
      best_offer_cents: Math.max(chat.best_offer_cents ?? 0, offerCents),
      ...(conceded ? { last_concession_cents: result.concessionCents } : {}),
      ...(pickupBonus ? { pickup_bonus_used: 1 } : {}),
    });
  }
  return {
    kind: result.kind,
    priceCents: result.priceCents,
    offerCents,
    bestOfferCents: result.kind === "remind" ? result.bestOfferCents : chat.best_offer_cents,
    repeated: "repeated" in result ? result.repeated : false,
    atFloor: result.priceCents === listing.floor_cents,
    pickupBonus,
    previousCents: chat.counter_cents,
  };
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
  // A bare number ("80?", "$85", "90 dollars") is an offer: no reading step needed, and no mixing it up with sizes.
  const bare = BARE_NUMBER.exec(text);
  if (bare && chat.status === "open") {
    const decision = negotiate(chat, listing, Math.round(Number(bare[1]) * 100));
    const worded = await wordDecision(listing, chat, text, decision);
    return reply(chatId, worded.text, "ai", worded.usage);
  }

  const read = await readMessage(listing, chat, text);
  const reading = read.reading;
  let usage = read.usage;

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
    const decision = negotiate(chat, listing, offerCents, reading.quick_pickup);
    const worded = await wordDecision(listing, chat, text, decision, parts.splice(0));
    usage = addUsage(usage, worded.usage);
    parts.push(worded.text);
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
