// Code checks every reply the AI writes before a buyer sees it. Plain functions, so they're tested.

// What the pricing code decided for one offer. The AI only words it.
export type Decision = {
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

const DOLLAR = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g;
// Phrases that claim a price is the seller's minimum. Only true when it's the floor.
const LOWEST_WORDS =
  /\b(lowest|bottom|minimum|price floor|rock[- ]bottom|best I can do|can'?t go (any )?(lower|below|under)|won'?t go (any )?(lower|below|under)|as low as I can|as far as I('ll| will| can)? go|(the )?most I can (come down|drop|do|go|lower)|limit|that's it for me)\b/i;
const OTHER_PAYMENT = /\b(cash|venmo|zelle|cash ?app|check)\b/i;

const dollarAmounts = (text: string) =>
  [...text.matchAll(DOLLAR)].map((m) => Math.round(Number(m[1].replace(/,/g, "")) * 100));

// Code checks the AI's wording: right price present, no new amounts, no false "lowest" claim.
// Amounts already said in the chat may be repeated ("you came up from $100", "a new one is $160").
export function wordingIsSafe(text: string, d: Decision, askCents: number, chatText: string) {
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

