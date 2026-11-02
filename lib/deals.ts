import crypto from "node:crypto";
import { db } from "./db";
import { authorizeOrder, captureHold, createHoldOrder, getOrder, payoutToSeller, voidHold } from "./paypal";

export type Listing = {
  id: string;
  seller_name: string;
  seller_paypal_email: string;
  title: string;
  description: string;
  facts: string;
  ask_cents: number;
  floor_cents: number;
  status: "active" | "reserved" | "sold";
};

export type DealStatus = "held" | "approved" | "completed" | "cancelled" | "locked";

export type Deal = {
  id: string;
  listing_id: string;
  chat_id: string | null;
  buyer_name: string;
  price_cents: number;
  status: DealStatus;
  cancel_reason: string | null;
  paypal_order_id: string;
  paypal_auth_id: string;
  paypal_capture_id: string | null;
  payout_batch_id: string | null;
  payout_cents: number | null;
  pickup_code_hash: string;
  code_attempts: number;
  hold_expires_at: string;
  created_at: string;
  updated_at: string;
};

export const MAX_CODE_ATTEMPTS = 5;

// A request the user can fix (wrong code, wrong state). Routes turn it into a 4xx.
export class DealError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function getListing(id: string) {
  return db().prepare("SELECT * FROM listings WHERE id = ?").get(id) as Listing | undefined;
}

export function getDeal(id: string) {
  return db().prepare("SELECT * FROM deals WHERE id = ?").get(id) as Deal | undefined;
}

export function listDeals() {
  return db()
    .prepare(
      `SELECT * FROM deals ORDER BY
         CASE status WHEN 'held' THEN 0 WHEN 'approved' THEN 1 WHEN 'locked' THEN 2 ELSE 3 END,
         created_at DESC`
    )
    .all() as Deal[];
}

export function listListings() {
  return db().prepare("SELECT * FROM listings ORDER BY title").all() as Listing[];
}

// What buyers may see: never the floor or the seller's PayPal email.
export function publicListing(l: Listing) {
  return {
    id: l.id,
    sellerName: l.seller_name,
    title: l.title,
    description: l.description,
    facts: JSON.parse(l.facts) as Record<string, string>,
    askCents: l.ask_cents,
    status: l.status,
  };
}

export function publicDeal(d: Deal) {
  return {
    id: d.id,
    listingId: d.listing_id,
    buyerName: d.buyer_name,
    priceCents: d.price_cents,
    status: d.status,
    cancelReason: d.cancel_reason,
    codeAttemptsLeft: Math.max(0, MAX_CODE_ATTEMPTS - d.code_attempts),
    payoutCents: d.payout_cents,
    holdExpiresAt: d.hold_expires_at,
    createdAt: d.created_at,
  };
}

function hashCode(dealId: string, code: string) {
  return crypto.createHash("sha256").update(`${dealId}:${code}`).digest("hex");
}

function setDeal(id: string, fields: Partial<Deal>) {
  const keys = Object.keys(fields);
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => fields[k as keyof Deal] as string | number | null);
  db().prepare(`UPDATE deals SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
}

function setListingStatus(id: string, status: Listing["status"]) {
  db().prepare("UPDATE listings SET status = ? WHERE id = ?").run(status, id);
}

type AgreedChat = { id: string; listing_id: string; buyer_name: string; status: string; agreed_cents: number | null };

function getAgreedChat(chatId: string) {
  const chat = db().prepare("SELECT id, listing_id, buyer_name, status, agreed_cents FROM chats WHERE id = ?").get(chatId) as
    | AgreedChat
    | undefined;
  if (!chat) throw new DealError("Chat not found.", 404);
  if (chat.status !== "agreed" || !chat.agreed_cents) throw new DealError("Agree on a price in the chat first.", 409);
  return chat;
}

function setChatStatus(chatId: string | null, status: string) {
  if (chatId) db().prepare("UPDATE chats SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, chatId);
}

// Buyer tapped the PayPal button: an AUTHORIZE order for the price agreed in their chat.
export async function createOrderForChat(chatId: string) {
  const chat = getAgreedChat(chatId);
  const listing = getListing(chat.listing_id)!;
  if (listing.status !== "active") throw new DealError("Sorry, this item was just reserved by someone else.", 409);
  return createHoldOrder({ customId: `${listing.id}:${chat.id}`, title: listing.title, priceCents: chat.agreed_cents! });
}

// Buyer approved in PayPal: place the hold and open a deal. Returns the pickup code once.
export async function openDealFromOrder(orderId: string) {
  const existing = db().prepare("SELECT id FROM deals WHERE paypal_order_id = ?").get(orderId);
  if (existing) throw new DealError("This payment already has a deal.", 409);

  const order = await getOrder(orderId);
  const [listingId, chatId] = (order.customId ?? "").split(":");
  const listing = listingId ? getListing(listingId) : undefined;
  if (!listing || !chatId) throw new DealError("Unknown listing for this payment.", 404);
  const chat = getAgreedChat(chatId);

  const auth = await authorizeOrder(orderId);

  // Someone else reserved it while this buyer was in PayPal, or the amount doesn't match the deal.
  if (listing.status !== "active" || auth.amountCents !== chat.agreed_cents) {
    await voidHold(auth.authId);
    throw new DealError(
      listing.status !== "active"
        ? "Sorry, this item was just reserved by someone else. You weren't charged."
        : "The amount doesn't match your agreed price. You weren't charged.",
      409
    );
  }

  const id = crypto.randomUUID();
  const code = String(crypto.randomInt(1000, 10000));
  db().prepare(
    `INSERT INTO deals (id, listing_id, chat_id, buyer_name, price_cents, status, paypal_order_id, paypal_auth_id, pickup_code_hash, hold_expires_at)
     VALUES (?, ?, ?, ?, ?, 'held', ?, ?, ?, ?)`
  ).run(id, listing.id, chat.id, chat.buyer_name, auth.amountCents, orderId, auth.authId, hashCode(id, code), auth.expiresAt);
  setListingStatus(listing.id, "reserved");
  setChatStatus(chat.id, "reserved");
  return { dealId: id, code };
}

function requireDeal(id: string, allowed: DealStatus[]) {
  const deal = getDeal(id);
  if (!deal) throw new DealError("Deal not found.", 404);
  if (!allowed.includes(deal.status)) throw new DealError(`This deal is ${deal.status}.`, 409);
  return deal;
}

export function approveDeal(id: string) {
  requireDeal(id, ["held"]);
  setDeal(id, { status: "approved" });
}

// Seller declines or buyer cancels: release the hold, put the item back on sale.
export async function cancelDeal(id: string, reason: string) {
  const deal = requireDeal(id, ["held", "approved", "locked"]);
  await voidHold(deal.paypal_auth_id);
  setDeal(id, { status: "cancelled", cancel_reason: reason });
  setListingStatus(deal.listing_id, "active");
  setChatStatus(deal.chat_id, "closed");
}

// Seller types the buyer's code: capture the hold, then pay the seller.
export async function completePickup(id: string, code: string) {
  const deal = requireDeal(id, ["approved"]);
  if (hashCode(id, code.trim()) !== deal.pickup_code_hash) {
    const attempts = deal.code_attempts + 1;
    const locked = attempts >= MAX_CODE_ATTEMPTS;
    setDeal(id, { code_attempts: attempts, ...(locked ? { status: "locked" as const } : {}) });
    throw new DealError(
      locked ? "Too many wrong codes. The deal is locked." : `Wrong code. ${MAX_CODE_ATTEMPTS - attempts} tries left.`,
      locked ? 423 : 400
    );
  }

  const listing = getListing(deal.listing_id)!;
  const capture = await captureHold(deal.paypal_auth_id, id);
  setDeal(id, { paypal_capture_id: capture.captureId });

  const payoutCents = capture.netCents ?? deal.price_cents;
  const payout = await payoutToSeller({
    dealId: id,
    email: listing.seller_paypal_email,
    amountCents: payoutCents,
    note: `DealHold sale: ${listing.title}`,
  });
  setDeal(id, { status: "completed", payout_batch_id: payout.batchId, payout_cents: payoutCents });
  setListingStatus(listing.id, "sold");
}
