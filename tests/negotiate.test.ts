import { test } from "node:test";
import assert from "node:assert/strict";
import { respondToOffer, type NegotiationState } from "../lib/negotiate.ts";
import { suggestPrices } from "../lib/pricing.ts";

// The demo sofa: asking $150, Maya's private lowest price $110.
const start: NegotiationState = {
  counterCents: 15000,
  floorCents: 11000,
  round: 0,
  bestOfferCents: null,
  lastConcessionCents: null,
  pickupBonusUsed: false,
  closed: false,
};
const $ = (dollars: number) => dollars * 100;

// Plays a buyer's offers in order, carrying the state the way lib/agent.ts does.
function play(offers: (number | { offer: number; quickPickup?: boolean })[], state = start) {
  const results = [];
  let s = { ...state };
  for (const o of offers) {
    const { offer, quickPickup } = typeof o === "number" ? { offer: o, quickPickup: false } : o;
    const r = respondToOffer(s, $(offer), { quickPickup });
    results.push(r);
    if (r.kind === "agree") break;
    s = {
      ...s,
      counterCents: r.priceCents,
      round: r.round,
      bestOfferCents: r.kind === "overpay" ? s.bestOfferCents : Math.max(s.bestOfferCents ?? 0, $(offer)),
      lastConcessionCents: r.kind === "counter" ? r.concessionCents : s.lastConcessionCents,
      pickupBonusUsed: s.pickupBonusUsed || ("pickupBonus" in r && r.pickupBonus),
      closed: s.closed || r.kind === "split",
    };
  }
  return results;
}

test("a lowball is declined and the price doesn't move", () => {
  const [r] = play([50]);
  assert.equal(r.kind, "lowball");
  assert.equal(r.priceCents, $(150));
});

test("the opening counter moves part of the way, not to the floor", () => {
  const [r] = play([90]);
  assert.equal(r.kind, "counter");
  assert.equal(r.priceCents, $(135));
});

test("repeating the same offer doesn't move the price", () => {
  const [, r] = play([90, 90]);
  assert.equal(r.kind, "hold");
  assert.equal(r.priceCents, $(135));
});

test("going below your own earlier offer earns nothing", () => {
  const [, r] = play([100, 95]);
  assert.equal(r.kind, "remind");
  assert.equal(r.priceCents, $(135));
});

test("an offer far above the price is confirmed, not taken", () => {
  const [r] = play([220]);
  assert.equal(r.kind, "overpay");
  assert.equal(r.priceCents, $(150));
});

test("meeting the price closes at the price, never more", () => {
  const [r] = play([150]);
  assert.deepEqual([r.kind, r.priceCents], ["agree", $(150)]);
});

test("the second move offers a better price for a quick pickup", () => {
  const [, r] = play([90, 100]);
  assert.equal(r.kind, "counter");
  assert.ok(r.kind === "counter" && r.pickupOfferCents !== null && r.pickupOfferCents < r.priceCents);
});

test("a quick pickup earns a better price", () => {
  const [plain] = play([120]);
  const [pickup] = play([{ offer: 120, quickPickup: true }]);
  assert.ok(pickup.priceCents < plain.priceCents);
});

test("after the meet-in-the-middle offer, the price is final", () => {
  const results = play([90, 100, 110, 112, 113]);
  const split = results.findIndex((r) => r.kind === "split");
  assert.ok(split >= 0, "expected a split offer");
  for (const r of results.slice(split + 1)) assert.equal(r.kind, "final");
});

test("within $5 of the price (and above the floor) just agrees", () => {
  const [, r] = play([90, 132]);
  assert.equal(r.kind, "agree");
});

// Thousands of random buyers: whatever they do, Maya's limits hold.
test("random buyers never get below the floor, and the price never goes up", () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = 0; i < 5000; i++) {
    const offers = Array.from({ length: 2 + Math.floor(rand() * 8) }, () => ({
      offer: Math.round(30 + rand() * 200),
      quickPickup: rand() < 0.2,
    }));
    let last = start.counterCents;
    for (const r of play(offers)) {
      assert.ok(r.priceCents >= start.floorCents, `below floor: ${JSON.stringify(offers)}`);
      if (r.kind !== "agree") {
        assert.ok(r.priceCents <= last, `price went up: ${JSON.stringify(offers)}`);
        last = r.priceCents;
      }
    }
  }
});

test("suggested prices: ask above fair, floor below, rounded to $5", () => {
  const p = suggestPrices($(400), "good", 1); // keeps 55% → fair $220
  assert.deepEqual(p, { askCents: $(255), floorCents: $(200), fairCents: $(220) });
  const older = suggestPrices($(400), "good", 3);
  assert.ok(older.askCents < p.askCents);
});
