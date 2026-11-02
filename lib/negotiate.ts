// Price decisions are plain code: the AI never sees the floor and can't be talked below it.

export const MAX_ROUNDS = 6;
// Offers below this share of the floor are lowballs: declined without moving the price.
const LOWBALL_RATIO = 0.6;
// Each counter moves this share of the gap toward the buyer's offer.
const CONCESSION = 0.4;
const CLOSE_ENOUGH_CENTS = 500;

export type NegotiationState = {
  counterCents: number;
  floorCents: number;
  round: number;
  lastOfferCents: number | null; // the buyer's previous offer
};

export type NegotiationResult =
  | { kind: "agree"; priceCents: number }
  | { kind: "counter"; priceCents: number }
  | { kind: "hold"; priceCents: number } // buyer didn't move, so neither do we
  | { kind: "final"; priceCents: number; repeated: boolean }
  | { kind: "lowball"; priceCents: number };

const roundTo5Dollars = (cents: number) => Math.ceil(cents / 500) * 500;

export function respondToOffer(state: NegotiationState, offerCents: number): NegotiationResult & { round: number } {
  const { counterCents, floorCents, lastOfferCents } = state;
  const round = state.round + 1;

  // Buyer meets or beats our current price: take our price (never charge more than we asked).
  if (offerCents >= counterCents) return { kind: "agree", priceCents: counterCents, round };

  // Within $5 of our price and above the floor: not worth another round.
  if (counterCents - offerCents <= CLOSE_ENOUGH_CENTS && offerCents >= floorCents) {
    return { kind: "agree", priceCents: offerCents, round };
  }

  if (offerCents < floorCents * LOWBALL_RATIO) return { kind: "lowball", priceCents: counterCents, round };

  // Already at the floor: stand firm.
  if (counterCents === floorCents) {
    if (offerCents >= floorCents) return { kind: "agree", priceCents: offerCents, round };
    return { kind: "final", priceCents: floorCents, repeated: true, round };
  }

  // Out of rounds: our current price becomes final (repeating an offer doesn't unlock the floor).
  if (round >= MAX_ROUNDS) {
    return { kind: "final", priceCents: counterCents, repeated: round > MAX_ROUNDS, round };
  }

  // Buyer repeated (or lowered) their offer: hold our price instead of bidding against ourselves.
  if (lastOfferCents !== null && offerCents <= lastOfferCents) return { kind: "hold", priceCents: counterCents, round };

  const target = Math.max(offerCents, floorCents);
  // Always move at least $5, so a counter never repeats the same price.
  const step = Math.min(roundTo5Dollars(counterCents - (counterCents - target) * CONCESSION), counterCents - 500);
  const next = Math.max(floorCents, target, step);
  if (offerCents >= next) return { kind: "agree", priceCents: offerCents, round };
  return next === floorCents ? { kind: "final", priceCents: next, repeated: false, round } : { kind: "counter", priceCents: next, round };
}
