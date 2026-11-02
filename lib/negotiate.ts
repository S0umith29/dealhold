// Price decisions are plain code: the AI never sees the floor and can't be talked below it.
//
// The negotiation has a short, human shape instead of trading $5 steps forever:
//   1. Open:  first counter, part of the way toward the buyer.
//   2. Trade: a smaller step, plus a better price *if* they pick up soon (contingent offer).
//   3. Close: if we're within reach, meet in the middle as a final offer; if we're still far apart,
//             hold and ask them to come closer before we split the difference.
// Throughout: never move when the buyer doesn't, never reward going below their own earlier offer,
// never go below the seller's floor.

// Offers below this share of the floor are lowballs: declined without moving the price.
const LOWBALL_RATIO = 0.6;
// The opening counter moves this share of the gap toward the buyer's offer.
const OPENING_CONCESSION = 0.4;
const MIN_STEP_CENTS = 500;
const CLOSE_ENOUGH_CENTS = 500;
const PICKUP_BONUS_CENTS = 500;
// From the third move on, we split the difference only once the gap is this small.
const SPLIT_GAP_CENTS = 2500;

export type NegotiationState = {
  counterCents: number;
  floorCents: number;
  round: number; // how many times the buyer has raised their offer
  bestOfferCents: number | null; // the highest price this buyer has offered so far
  lastConcessionCents: number | null; // how much our previous counter came down
  pickupBonusUsed: boolean;
  closed: boolean; // we've made our final, meet-in-the-middle offer
};

export type NegotiationResult =
  | { kind: "agree"; priceCents: number }
  | { kind: "counter"; priceCents: number; concessionCents: number; pickupBonus: boolean; pickupOfferCents: number | null }
  | { kind: "hold"; priceCents: number } // buyer didn't move, so neither do we
  | { kind: "remind"; priceCents: number; bestOfferCents: number } // buyer went below their own earlier offer
  | { kind: "gap"; priceCents: number; gapCents: number } // still far apart: come closer, then we'll split
  | { kind: "split"; priceCents: number } // meet in the middle: our final offer
  | { kind: "final"; priceCents: number } // already made our final offer
  | { kind: "lowball"; priceCents: number };

const roundUpTo5Dollars = (cents: number) => Math.ceil(cents / 500) * 500;
const roundTo5Dollars = (cents: number) => Math.round(cents / 500) * 500;

export function respondToOffer(
  state: NegotiationState,
  offerCents: number,
  opts: { quickPickup?: boolean } = {}
): NegotiationResult & { round: number } {
  const { counterCents, floorCents, bestOfferCents, lastConcessionCents } = state;
  const raised = bestOfferCents === null || offerCents > bestOfferCents;
  const pickupTrade = Boolean(opts.quickPickup) && !state.pickupBonusUsed && !state.closed;
  const round = raised ? state.round + 1 : state.round;

  // They accept our price, and add a quick pickup: honor the pickup discount we offered.
  if (offerCents >= counterCents && pickupTrade) {
    return { kind: "agree", priceCents: Math.max(floorCents, counterCents - PICKUP_BONUS_CENTS), round };
  }
  // Buyer meets or beats our current price: take our price (never charge more than we asked).
  if (offerCents >= counterCents) return { kind: "agree", priceCents: counterCents, round };

  // Within $5 of our price and above the floor: not worth another round.
  if (counterCents - offerCents <= CLOSE_ENOUGH_CENTS && offerCents >= floorCents) {
    return { kind: "agree", priceCents: offerCents, round };
  }

  // We already made our final offer: it stands.
  if (state.closed) return { kind: "final", priceCents: counterCents, round };

  // Going below their own earlier offer earns nothing.
  if (bestOfferCents !== null && offerCents < bestOfferCents) {
    return { kind: "remind", priceCents: counterCents, bestOfferCents, round };
  }

  if (offerCents < floorCents * LOWBALL_RATIO) return { kind: "lowball", priceCents: counterCents, round };

  // Same offer again: only a new quick-pickup promise can move us.
  if (!raised && !pickupTrade) return { kind: "hold", priceCents: counterCents, round };

  const target = Math.max(offerCents, floorCents);

  // 3. Close (third raise onward, or we're already near the floor).
  if (round >= 3 || counterCents - floorCents <= MIN_STEP_CENTS) {
    const gap = counterCents - offerCents;
    if (gap > SPLIT_GAP_CENTS) return { kind: "gap", priceCents: counterCents, gapCents: gap, round };
    const middle = Math.max(floorCents, roundUpTo5Dollars((counterCents + target) / 2));
    if (offerCents >= middle) return { kind: "agree", priceCents: offerCents, round };
    return { kind: "split", priceCents: middle, round };
  }

  // 1. Open, or 2. Trade.
  let step =
    round === 1 || lastConcessionCents === null
      ? (counterCents - target) * OPENING_CONCESSION
      : Math.min(offerCents - (bestOfferCents ?? offerCents), lastConcessionCents);
  step = Math.max(MIN_STEP_CENTS, roundTo5Dollars(step));
  // They already offered a quick pickup: give the pickup step now.
  if (pickupTrade) step += PICKUP_BONUS_CENTS;

  const next = Math.max(floorCents, target, counterCents - step);
  if (offerCents >= next) return { kind: "agree", priceCents: offerCents, round };
  const concessionCents = Math.max(MIN_STEP_CENTS, counterCents - next - (pickupTrade ? PICKUP_BONUS_CENTS : 0));

  // On the trade move, if they haven't offered a quick pickup yet, ask for one in exchange for a better price.
  const pickupOfferCents =
    round === 2 && !pickupTrade && !state.pickupBonusUsed && next - PICKUP_BONUS_CENTS >= floorCents
      ? next - PICKUP_BONUS_CENTS
      : null;

  return { kind: "counter", priceCents: next, concessionCents, pickupBonus: pickupTrade, pickupOfferCents, round };
}
