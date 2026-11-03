import crypto from "node:crypto";
import { cookies } from "next/headers";
import { DealError } from "./deals";

// The seller's pages and actions (floor prices, every buyer's chat, approving deals, the pickup
// code, answering questions, listing) sit behind one password: SELLER_PASSWORD.
// The demo has one seller, so a signed cookie is enough; a real launch would use real accounts.
// Without SELLER_PASSWORD (local development) the seller side stays open.

export const SELLER_COOKIE = "dealhold_seller";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const password = () => process.env.SELLER_PASSWORD ?? "";
// The cookie value is a signature over the password, so changing the password logs everyone out.
const token = () => crypto.createHmac("sha256", password()).update("dealhold-seller-v1").digest("hex");

export function sameSecret(a: string, b: string) {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export const sellerLockOn = () => password() !== "";

export async function isSeller() {
  if (!sellerLockOn()) return true;
  const value = (await cookies()).get(SELLER_COOKIE)?.value ?? "";
  return sameSecret(value, token());
}

// For seller API routes: signed in, and (for changes) the request comes from this site.
export async function requireSeller(req?: Request) {
  if (req && req.method !== "GET") {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (origin && host && new URL(origin).host !== host) throw new DealError("Not allowed.", 403);
  }
  if (!(await isSeller())) throw new DealError("Sign in as the seller first.", 401);
}

export async function signIn(attempt: string) {
  if (!sellerLockOn() || !sameSecret(attempt, password())) return false;
  (await cookies()).set(SELLER_COOKIE, token(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  return true;
}

export async function signOut() {
  (await cookies()).delete(SELLER_COOKIE);
}
