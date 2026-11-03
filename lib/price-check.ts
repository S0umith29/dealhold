import type { Listing } from "./deals";
import { money } from "./format";
import { findNewPrices } from "./listing-ai";

// When a buyer says "I can get one new for $120", the assistant checks today's new prices with
// Channel3 instead of taking their word or arguing blind.
// If the seller matched the exact product when listing, that price is used. Otherwise one search
// per listing finds similar new items, and the cheapest is used: the fairest number to quote.

type NewPrice = { priceCents: number; store: string; exact: boolean };

const storeOf = (url: string | null) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : "online";
  } catch {
    return "online";
  }
};

const searches = new Map<string, Promise<NewPrice | null>>(); // one search per listing per run

async function cheapestSimilar(listing: Listing): Promise<NewPrice | null> {
  try {
    const found = (await findNewPrices(listing.title)).sort((a, b) => a.priceCents - b.priceCents);
    return found[0] ? { priceCents: found[0].priceCents, store: found[0].store, exact: false } : null;
  } catch (err) {
    console.error("Channel3 price check failed", err);
    return null;
  }
}

export async function newPriceFor(listing: Listing): Promise<NewPrice | null> {
  if (listing.new_price_cents) {
    return { priceCents: listing.new_price_cents, store: storeOf(listing.product_url), exact: true };
  }
  if (!process.env.CHANNEL3_API_KEY) return null;
  if (!searches.has(listing.id)) searches.set(listing.id, cheapestSimilar(listing));
  return searches.get(listing.id)!;
}

// One plain sentence the assistant says before its price reply. Code writes it, so the number is exact.
export async function claimNote(listing: Listing, claimedCents: number) {
  const real = await newPriceFor(listing);
  if (!real) return null;
  const what = real.exact ? "a new one is about" : "the cheapest similar new one I found is";
  return claimedCents < real.priceCents * 0.85
    ? `I checked: ${what} ${money(real.priceCents)} today (${real.store}), not ${money(claimedCents)}.`
    : `Fair point: ${what} ${money(real.priceCents)} today (${real.store}).`;
}
