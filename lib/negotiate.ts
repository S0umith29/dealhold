// Price decisions are plain code: the AI never sees the floor and can't be talked below it.
//
// Tactics:
// - Reciprocity: concede no more than the buyer just moved (tit-for-tat).
// - Shrinking concessions: each step is no bigger than the last, which signals we're nearing our limit.
//   (INSEAD: moderately tapering concessions earned sellers the most; equal steps the least.)
// - Contingent trade: one extra step, only in exchange for a quick pickup the seller values.
// - Anchor on the buyer's best offer: retreating below it doesn't earn a concession.

export const MAX_ROUNDS = 6;
// Offers below this share of the floor are lowballs: declined without moving the price.
const LOWBALL_RATIO = 0.6;
// The first counter moves this share of the gap toward the buyer's offer.
const FIRST_CONCESSION = 0.4;
const MIN_STEP_CENTS = 500;
const CLOSE_ENOUGH_CENTS = 500;
const PICKUP_BONUS_CENTS = 500;

export type NegotiationState = {
  counterCents: number;
  floorCents: number;
  round: number;
  bestOfferCents: number | null; // the highest price this buyer has offered so far
  lastConcessionCents: number | null; // how much our previous counter came down
  pickupBonusUsed: boolean;
};

export type NegotiationResult =
  | { kind: "agree"; priceCents: number }
  | { kind: "counter"; priceCents: number; concessionCents: number; pickupBonus: boolean }
  | { kind: "hold"; priceCents: number } // buyer didn't move, so neither do we
  | { kind: "remind"; priceCents: number; bestOfferCents: number; repeated: boolean } // buyer went below their own earlier offer
  | { kind: "final"; priceCents: number; repeated: boolean; concessionCents: number; pickupBonus: boolean }
  | { kind: "lowball"; priceCents: number };

const roundTo5Dollars = (cents: number) => Math.round(cents / 500) * 500;

export function respondToOffer(
  state: NegotiationState,
  offerCents: number,
  opts: { quickPickup?: boolean } = {}
): NegotiationResult & { round: number } {
  const { counterCents, floorCents, bestOfferCents, lastConcessionCents } = state;
  // Rounds count only real moves by the buyer (a higher offer, or a pickup trade).
  // Repeats, retreats and lowballs don't use up the buyer's rounds.
  const raised = bestOfferCents === null || offerCents > bestOfferCents;
  const pickupTrade = Boolean(opts.quickPickup) && !state.pickupBonusUsed;
  const round = raised || pickupTrade ? state.round + 1 : state.round;

  // Buyer meets or beats our current price: take our price (never charge more than we asked).
  if (offerCents >= counterCents) return { kind: "agree", priceCents: counterCents, round };

  // Past the round limit our price is final: no more shaving, even by $5.
  if (state.round >= MAX_ROUNDS) {
    return { kind: "final", priceCents: counterCents, repeated: true, concessionCents: 0, pickupBonus: false, round };
  }

  // Within $5 of our price and above the floor: not worth another round.
  if (counterCents - offerCents <= CLOSE_ENOUGH_CENTS && offerCents >= floorCents) {
    return { kind: "agree", priceCents: offerCents, round };
  }

  // Buyer went below what they already offered: don't reward the retreat.
  // Offer to meet halfway between our price and their earlier best offer.
  if (bestOfferCents !== null && offerCents < bestOfferCents) {
    const middle = Math.min(counterCents, Math.max(floorCents, Math.ceil((counterCents + bestOfferCents) / 2 / 500) * 500));
    return { kind: "remind", priceCents: middle, bestOfferCents, repeated: middle === counterCents, round };
  }

  if (offerCents < floorCents * LOWBALL_RATIO) return { kind: "lowball", priceCents: counterCents, round };

  // Already at the floor: stand firm.
  if (counterCents === floorCents) {
    if (offerCents >= floorCents) return { kind: "agree", priceCents: offerCents, round };
    return { kind: "final", priceCents: floorCents, repeated: true, concessionCents: 0, pickupBonus: false, round };
  }

  // Out of rounds: our current price becomes final (repeating an offer doesn't unlock the floor).
  if (round >= MAX_ROUNDS) {
    return { kind: "final", priceCents: counterCents, repeated: round > MAX_ROUNDS, concessionCents: 0, pickupBonus: false, round };
  }

  // Buyer repeated their best offer without giving anything new: hold our price.
  if (!raised && !pickupTrade) return { kind: "hold", priceCents: counterCents, round };

  const target = Math.max(offerCents, floorCents);
  let step: number;
  if (!raised) {
    // Same price, but they now offer a quick pickup: that alone earns the pickup step.
    step = 0;
  } else if (bestOfferCents === null || lastConcessionCents === null) {
    // First counter: the biggest step, part of the way toward the buyer.
    step = Math.max(MIN_STEP_CENTS, roundTo5Dollars((counterCents - target) * FIRST_CONCESSION));
  } else {
    // Match the buyer's move, but never step down more than last time.
    step = Math.max(MIN_STEP_CENTS, roundTo5Dollars(Math.min(offerCents - bestOfferCents, lastConcessionCents)));
  }

  // A quick pickup is worth one extra step to a seller who needs it gone.
  const pickupBonus = pickupTrade;
  if (pickupBonus) step += PICKUP_BONUS_CENTS;

  const next = Math.max(floorCents, target, counterCents - step);
  if (offerCents >= next) return { kind: "agree", priceCents: offerCents, round };
  // The pickup bonus is a one-off trade, so it doesn't count toward the shrinking-steps pattern.
  // If the only step was the pickup trade, keep the previous step size for tapering.
  const concessionCents = raised
    ? Math.max(MIN_STEP_CENTS, counterCents - next - (pickupBonus ? PICKUP_BONUS_CENTS : 0))
    : (lastConcessionCents ?? MIN_STEP_CENTS);
  return next === floorCents
    ? { kind: "final", priceCents: next, repeated: false, concessionCents, pickupBonus, round }
    : { kind: "counter", priceCents: next, concessionCents, pickupBonus, round };
}
