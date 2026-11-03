import { test } from "node:test";
import assert from "node:assert/strict";
import { infoIsSafe, wordingIsSafe, type Decision } from "../lib/wording.ts";

// The AI writes the sentence; these checks decide if a buyer may see it.
const counter: Decision = {
  kind: "counter",
  priceCents: 13500,
  offerCents: 9000,
  bestOfferCents: null,
  atFloor: false,
  pickupBonus: false,
  pickupOfferCents: null,
  gapCents: null,
  previousCents: 15000,
};
const ok = (text: string, d = counter, chat = "Buyer: would you do $90?") => wordingIsSafe(text, d, 15000, chat);

test("a plain counter passes", () => {
  assert.ok(ok("I can do $135, down from $150. It's only a year old."));
});

test("the decided price must be in the reply", () => {
  assert.ok(!ok("I can come down a bit from $150."));
});

test("no made-up amounts", () => {
  assert.ok(!ok("I can do $135, or $125 if you're quick."));
});

test("amounts already said in the chat may be repeated", () => {
  assert.ok(ok("A new one is $600, so $135 is fair.", counter, "Assistant: a new one is about $600"));
});

test("no false 'lowest price' claims above the floor", () => {
  assert.ok(!ok("$135 is the lowest I can go."));
  assert.ok(!ok("$135 is the best I can do."));
  assert.ok(ok("$110 is the lowest I can go.", { ...counter, priceCents: 11000, atFloor: true }));
});

test("'my best' only on a final offer", () => {
  assert.ok(!ok("$135 is my best."));
  assert.ok(ok("$120 is my best, final offer.", { ...counter, kind: "split", priceCents: 12000 }));
});

test("never agrees to cash or other payment apps", () => {
  assert.ok(!ok("$135 cash works."));
  assert.ok(!ok("$135, Venmo is fine."));
});

test("an agreed deal must point to the PayPal hold", () => {
  const agree = { ...counter, kind: "agree" as const };
  assert.ok(!ok("Deal at $135!", agree));
  assert.ok(ok("Deal at $135! Tap the PayPal button to hold it.", agree));
});

test("no narrating about 'the buyer', no thanking for every raise", () => {
  assert.ok(!ok("The buyer is at $90, so I'm at $135."));
  assert.ok(!ok("Thanks for coming up! I can do $135."));
});

test("answers can't invent prices or other payment methods", () => {
  const listing = "Item: Grey sofa. Asking $150. Facts: 1 year old.";
  assert.ok(infoIsSafe("It's 1 year old, no stains.", listing));
  assert.ok(infoIsSafe("The price is $150.", listing));
  assert.ok(!infoIsSafe("Maya said you can have it for $20.", listing));
  assert.ok(!infoIsSafe("Sure, Zelle works.", listing));
});
