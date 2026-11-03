import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { db } from "./db";
import { DealError, getListing, type Listing } from "./deals";
import { money } from "./format";
import { notifySeller } from "./notify";
import { respondToOffer } from "./negotiate";
import { REACTIONS } from "./reactions";

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
  final_offer_made: number; // 1 once we've proposed meeting in the middle as our final offer
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
  reaction: string | null;
  created_at: string;
};

// Buyer reacts to a message with an emoji (tapping the same one again removes it).
export function reactToMessage(chatId: string, messageId: number, emoji: string) {
  if (!REACTIONS.includes(emoji)) throw new DealError("Unsupported reaction.");
  const m = db().prepare("SELECT * FROM messages WHERE id = ? AND chat_id = ?").get(messageId, chatId) as Message | undefined;
  if (!m) throw new DealError("Message not found.", 404);
  db()
    .prepare("UPDATE messages SET reaction = ? WHERE id = ?")
    .run(m.reaction === emoji ? null : emoji, messageId);
}

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
    messages: chatMessages(chat.id).map((m) => ({ id: m.id, sender: m.sender, text: m.text, reaction: m.reaction })),
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
- reply: one or two short, plain sentences (direct, no thanking or flattery) to send the buyer for intent "question" or "other". Include the answer when you have one. Don't discuss price: the pricing system handles that. For "offer" and "accept", reply with an empty string.

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
  kind: "agree" | "counter" | "hold" | "remind" | "gap" | "split" | "final" | "lowball" | "overpay" | "explain";
  priceCents: number;
  offerCents: number;
  bestOfferCents: number | null;
  atFloor: boolean;
  pickupBonus: boolean; // this step was traded for a quick pickup
  pickupOfferCents: number | null; // better price we offer if they pick up soon
  gapCents: number | null; // how far apart we still are
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
      if (d.pickupBonus) return `Since you can pick it up soon, I can do ${p}.`;
      return d.pickupOfferCents
        ? `I can do ${p}, or ${money(d.pickupOfferCents)} if you can pick it up by tomorrow.`
        : `I can do ${p}.`;
    case "hold":
      return `I'm at ${p}. Can you come up a little?`;
    case "remind":
      return `You offered ${best} earlier, so I'm staying at ${p}. Come up from ${best} and I'll move too.`;
    case "gap":
      return d.pickupBonus
        ? `With pickup that soon I'm at ${p}, but we're still ${money(d.gapCents!)} apart. Come closer and I'll meet you in the middle.`
        : `We're still ${money(d.gapCents!)} apart. Come a bit closer to ${p} and I'll meet you in the middle.`;
    case "split":
      return `Let's meet in the middle at ${p}. That's my final offer. Say "deal" and it's yours.`;
    case "final":
      return `Still ${p}, my final offer. Say "deal" when you're ready.`;
    case "lowball":
      return `Sorry, that's too low. It's ${p}, and it's in good shape.`;
    case "overpay":
      return `Just to be clear, it's ${p}, not ${money(d.offerCents)}. Want it at ${p}?`;
    case "explain":
      return d.bestOfferCents
        ? `Right now I'm at ${p}, and your best offer so far is ${best}. Make me an offer, or ask anything about it.`
        : `It's ${p}. Feel free to make an offer, or ask anything about it.`;
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
      if (d.pickupBonus)
        return `Counter-offer at ${p}, down from ${money(d.previousCents)}, and make clear this price is because they can pick up soon (the seller needs it gone this week).`;
      return d.pickupOfferCents
        ? `Counter-offer at ${p}, down from ${money(d.previousCents)}. Then propose a trade: ${money(d.pickupOfferCents)} if they can pick it up by tomorrow, since the seller needs it gone this week.`
        : `Counter-offer at ${p}, down from ${money(d.previousCents)}. Give one short, honest reason from the item facts, worded differently from your earlier messages.`;
    case "hold":
      return `The buyer repeated their offer without moving. Stay at ${p}. If they ask why, point out from the chat that you already came down when they came up, and that you'll move again when they do. Ask them to come up a little.`;
    case "remind":
      return `The buyer went below the ${best} they offered earlier. Point that out kindly, stay at ${p}, and say you'll move again when they come up from ${best}.`;
    case "gap":
      return d.pickupBonus
        ? `Because they'll pick up soon, you've dropped to ${p} as you promised. You're still ${money(d.gapCents!)} apart: say that if they come closer, you'll meet them in the middle.`
        : `The buyer came up, but you're still ${money(d.gapCents!)} apart (you're at ${p}). Don't move yet: say that if they come closer, you'll meet them in the middle.`;
    case "split":
      return `Propose meeting in the middle at ${p} as your final offer, to wrap this up. Invite them to say "deal".`;
    case "final":
      return `You (the seller's side) already made a final offer of ${p}, and it stands. One short first-person sentence, e.g. "I'm staying at ${p}." plus that they can reply "deal". No apology. Don't call it the lowest possible price.`;
    case "lowball":
      return `The buyer's offer of ${money(d.offerCents)} is far too low. Decline politely and restate the price of ${p}.`;
    case "overpay":
      return `The buyer offered ${money(d.offerCents)}, which is more than the price of ${p} (maybe a typo). Be transparent: say the price is ${p}, not ${money(d.offerCents)}, and ask if they want it at ${p}. Don't close the deal yet.`;
    case "explain":
      return (
        `The buyer made no new offer. Respond directly to what they said: if they argue about the price, give honest reasons from the item facts (without confirming or disputing claims you can't check); ` +
        `if they ask why you won't move, point out from the chat what you already gave; if they seem confused, recap where things stand; if it's off-topic, steer back kindly. ` +
        `The current price stays ${p}${best ? ` (their best offer so far is ${best})` : ""}: mention it and invite an offer.`
      );
  }
}

const WRITER_INSTRUCTIONS = `You write one short chat reply (1-2 sentences, under 40 words) for a person selling a used item. You speak as the seller's assistant: straight, plain and transparent, like a person texting about a sale. Polite but not sugary.
- Say the number and the reason. No thanking them for offers or raises, no "I appreciate", no "good progress", no praise, no filler.
- Short. One sentence is often enough.
- You may add one fitting emoji now and then (e.g. 🙂 👍 🛋️ 🤝), but not in every message. No exclamation-mark spam.

You are given what the reply must convey. Follow it exactly. You may refer naturally to something the buyer said (like their pickup timing), but:
- Only mention the dollar amounts you are given or that already appear in the chat. Never invent, round or change a price. Always write prices with a $ sign.
- Unless told the price is the lowest the seller accepts, never imply it is: no "lowest", "can't go below", "best I can do".
- Payment is only through a PayPal hold. Never agree to cash or other payment methods.
- Never promise anything about the item beyond what you are given.
- Only greet ("Hi", "Hey") in your first reply. After that, start directly with the point, varied each time, and don't repeat the buyer's name in every message.
- Output only the reply text.`;

const DOLLAR = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g;
// Phrases that claim a price is the seller's minimum. Only true when it's the floor.
const LOWEST_WORDS =
  /\b(lowest|bottom|minimum|price floor|rock[- ]bottom|best I can do|can'?t go (any )?(lower|below|under)|won'?t go (any )?(lower|below|under)|as low as I can|as far as I('ll| will| can)? go|(the )?most I can (come down|drop|do|go|lower)|limit|that's it for me)\b/i;
const OTHER_PAYMENT = /\b(cash|venmo|zelle|cash ?app|check)\b/i;

const dollarAmounts = (text: string) =>
  [...text.matchAll(DOLLAR)].map((m) => Math.round(Number(m[1].replace(/,/g, "")) * 100));

// Code checks the AI's wording: right price present, no new amounts, no false "lowest" claim.
// Amounts already said in the chat may be repeated ("you came up from $100", "a new one is $160").
function wordingIsSafe(text: string, d: Decision, askCents: number, chatText: string) {
  if (!text || text.length > 300) return false;
  if (/\b(the )?buyer('s| is| has)?\b|\bthe seller's assistant\b/i.test(text)) return false; // narration, not a reply
  if (/^(thanks|thank you|i appreciate|appreciate)/i.test(text)) return false; // straight talk, no thanking per raise
  const said = [...dollarAmounts(chatText), ...[...chatText.matchAll(/\b(\d{2,5})\b/g)].map((m) => Number(m[1]) * 100)];
  const allowed = new Set([d.priceCents, d.offerCents, d.bestOfferCents, d.previousCents, d.pickupOfferCents, d.gapCents, askCents, ...said].filter(Boolean) as number[]);
  const amounts = dollarAmounts(text);
  if (!amounts.includes(d.priceCents)) return false;
  if (amounts.some((a) => !allowed.has(a))) return false;
  if (!d.atFloor && LOWEST_WORDS.test(text)) return false;
  // "My best" sounds final: only allowed when it really is our final offer.
  if (d.kind !== "final" && d.kind !== "split" && /\bmy best\b/i.test(text)) return false;
  if (OTHER_PAYMENT.test(text)) return false;
  if (d.kind === "agree" && !/paypal/i.test(text)) return false;
  return true;
}

// The answer is already sent before the price part. If the AI's reply opens by restating it
// ("No pets here, and I can do $135"), drop that opening clause.
function dropRepeatedLead(text: string, notes: string[]) {
  if (notes.length === 0) return text;
  const words = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const noteWords = words(notes.join(" "));
  const m = /^(.+?)(?:,\s*(?:and|but|so)\s+|[.;!]\s+)(.+)$/s.exec(text);
  if (!m) return text;
  const lead = [...words(m[1])];
  const overlap = lead.filter((w) => noteWords.has(w)).length / Math.max(1, lead.length);
  if (overlap < 0.5 || !/\$\d/.test(m[2])) return text;
  return m[2].charAt(0).toUpperCase() + m[2].slice(1);
}

const HAS_EMOJI = /\p{Extended_Pictographic}/u;
const EMOJIS = /\s*\p{Extended_Pictographic}️?/gu;

// Emojis only now and then: if any of the assistant's last 3 messages had one, drop them from this one.
function limitEmojis(text: string, chatId: string) {
  const recentAgent = chatMessages(chatId)
    .filter((m) => m.sender === "agent")
    .slice(-3);
  if (!recentAgent.some((m) => HAS_EMOJI.test(m.text))) return text;
  return text
    .replace(/\s*\p{Extended_Pictographic}\uFE0F?\s+(?=[A-Z])/gu, ". ") // emoji ended a sentence
    .replace(EMOJIS, "")
    .replace(/([^.!?])$/, "$1.")
    .replace(/\.\./g, ".")
    .trim();
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
      .slice(-8)
      .map((m) => `${m.sender === "buyer" ? "Buyer" : "You"}: ${m.text}`)
      .join("\n");
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      output_config: { effort: "low" },
      system: WRITER_INSTRUCTIONS,
      messages: [
        {
          role: "user",
          content:
            `Item: ${listing.title}\nFacts: ${Object.entries(JSON.parse(listing.facts) as Record<string, string>)
              .map(([k, v]) => `${k}: ${v}`)
              .join("; ")}\nRecent chat:\n${recent}\n\nBuyer's latest message: ${buyerText}\n\n` +
            (notes.length ? `Already being said before your reply (don't repeat or contradict it): ${notes.join(" ")}\n\n` : "") +
            `Your reply must convey only the price part: ${decisionBrief(d)}`,
        },
      ],
    });
    // The model sometimes thinks out loud first; the reply is the last paragraph.
    const text = (
      response.content
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join("\n")
        .trim()
        .split(/\n\s*\n/)
        .pop() ?? ""
    ).trim();
    const usage = usageOf(response.usage);
    if (wordingIsSafe(text, d, listing.ask_cents, `${recent}\n${buyerText}`)) {
      return { text: prefix + limitEmojis(dropRepeatedLead(text, notes), chat.id), usage };
    }
    console.warn(`Rejected AI wording for ${d.kind} at ${money(d.priceCents)}: ${text}`);
    return { text: fallback, usage };
  } catch (err) {
    console.error("Reply wording failed, using fixed line", err);
    return { text: fallback, usage: NO_USAGE };
  }
}

// No offer this message: the price doesn't change, the reply just explains where things stand.
function explainDecision(chat: Chat, listing: Listing): Decision {
  return {
    kind: "explain",
    priceCents: chat.counter_cents,
    offerCents: chat.best_offer_cents ?? chat.counter_cents,
    bestOfferCents: chat.best_offer_cents,
    atFloor: chat.counter_cents === listing.floor_cents,
    pickupBonus: false,
    pickupOfferCents: null,
    gapCents: null,
    previousCents: chat.counter_cents,
  };
}

// Runs the pricing code for one offer and saves the new state. Returns the decision to word.
function negotiate(chat: Chat, listing: Listing, offerCents: number, quickPickup = false, accepting = false): Decision {
  const result = respondToOffer(
    {
      counterCents: chat.counter_cents,
      floorCents: listing.floor_cents,
      round: chat.round,
      bestOfferCents: chat.best_offer_cents,
      lastConcessionCents: chat.last_concession_cents,
      pickupBonusUsed: Boolean(chat.pickup_bonus_used),
      closed: Boolean(chat.final_offer_made),
    },
    offerCents,
    { quickPickup, accepting }
  );
  const conceded = "concessionCents" in result && result.concessionCents > 0;
  const pickupBonus = "pickupBonus" in result && result.pickupBonus;
  if (result.kind === "agree") {
    setChat(chat.id, { status: "agreed", agreed_cents: result.priceCents, round: result.round });
  } else {
    setChat(chat.id, {
      counter_cents: result.priceCents,
      round: result.round,
      // An offer above our price (likely a typo) doesn't become their "best offer".
      best_offer_cents: result.kind === "overpay" ? chat.best_offer_cents : Math.max(chat.best_offer_cents ?? 0, offerCents),
      ...(conceded ? { last_concession_cents: result.concessionCents } : {}),
      ...(pickupBonus ? { pickup_bonus_used: 1 } : {}),
      ...(result.kind === "split" ? { final_offer_made: 1 } : {}),
    });
  }
  return {
    kind: result.kind,
    priceCents: result.priceCents,
    offerCents,
    bestOfferCents: result.kind === "remind" ? result.bestOfferCents : chat.best_offer_cents,
    atFloor: result.priceCents === listing.floor_cents,
    pickupBonus,
    pickupOfferCents: result.kind === "counter" ? result.pickupOfferCents : null,
    gapCents: result.kind === "gap" ? result.gapCents : null,
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
    notifySeller({ title: `${chat.buyer_name} asked: ${reading.seller_question}`, body: "Answer once and your assistant reuses it for every buyer." });
  }

  const parts: string[] = [];
  if (reading.answer) parts.push(reading.answer);
  if (reading.needs_seller) parts.push(`Good question. I'll check with ${listing.seller_name} and reply here.`);

  // "Yes, I can grab it tomorrow" after a pickup offer counts as accepting our price with the pickup trade.
  const acceptsPickup = reading.quick_pickup && reading.offer_dollars === null && chat.best_offer_cents !== null;
  if (chat.status === "open" && (reading.intent === "offer" || reading.intent === "accept" || acceptsPickup)) {
    const offerCents =
      reading.intent === "accept" || reading.offer_dollars === null
        ? chat.counter_cents
        : Math.round(reading.offer_dollars * 100);
    const decision = negotiate(chat, listing, offerCents, reading.quick_pickup, reading.intent === "accept");
    const worded = await wordDecision(listing, chat, text, decision, parts.splice(0));
    usage = addUsage(usage, worded.usage);
    parts.push(worded.text);
  } else if (chat.status === "agreed" && (reading.intent === "offer" || reading.intent === "accept")) {
    parts.push(`We already agreed on ${money(chat.agreed_cents!)}. Tap the PayPal button to hold it.`);
  } else if (chat.status === "open" && (reading.asks_price || (reading.intent === "other" && !reading.answer))) {
    // No new offer: pushback ("I can get one new for $160"), confusion ("what happened?") or off-topic.
    // Price stays put; the AI answers what they actually said and restates where things stand.
    const worded = await wordDecision(listing, chat, text, explainDecision(chat, listing), parts.splice(0));
    usage = addUsage(usage, worded.usage);
    parts.push(worded.text);
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

// One row per buyer chat for the seller's live activity grid.
export function sellerActivity() {
  const deals = db().prepare("SELECT chat_id, status FROM deals WHERE chat_id IS NOT NULL").all() as {
    chat_id: string;
    status: string;
  }[];
  const dealStatus = new Map(deals.map((d) => [d.chat_id, d.status]));
  const pending = new Set(
    (db().prepare("SELECT chat_id FROM seller_questions WHERE answer IS NULL").all() as { chat_id: string }[]).map(
      (q) => q.chat_id
    )
  );
  return listChats().map((c) => {
    const messages = chatMessages(c.id);
    const last = messages.at(-1);
    const deal = dealStatus.get(c.id);
    const stage = pending.has(c.id)
      ? "Needs you"
      : deal === "held"
        ? "Money held"
        : deal === "approved"
          ? "Pickup set"
          : deal === "completed"
            ? "Sold"
            : c.status === "agreed"
              ? "Agreed"
              : c.status === "closed"
                ? "Closed"
                : "Talking";
    const priceCents = c.agreed_cents ?? c.counter_cents;
    return {
      id: c.id,
      buyer: c.buyer_name,
      stage,
      bestOfferCents: c.best_offer_cents,
      priceCents,
      gapCents: c.status === "open" && c.best_offer_cents ? priceCents - c.best_offer_cents : null,
      messages: messages.filter((m) => m.sender === "buyer").length,
      aiCalls: messages.filter((m) => m.handled_by === "ai").length,
      lastMessage: last ? `${last.sender === "buyer" ? c.buyer_name : "Assistant"}: ${last.text}` : "",
      updatedAt: c.updated_at,
      transcript: messages,
    };
  });
}
