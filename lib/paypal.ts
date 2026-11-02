// Server-only PayPal REST calls. The hold sits on DealHold's platform account (no payee),
// because PayPal refuses to let us void a hold that belongs to the seller.

const API = process.env.PAYPAL_API ?? "https://api-m.sandbox.paypal.com";

export class PayPalError extends Error {
  constructor(public step: string, public status: number, public details: unknown) {
    super(`PayPal ${step} failed (HTTP ${status})`);
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${API}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  if (!res.ok) throw new PayPalError("token", res.status, data);
  // Refresh a minute early.
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.value;
}

async function call<T>(step: string, method: string, path: string, body?: unknown, requestId?: string): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await getToken()}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  // Same request id = PayPal won't do the action twice (safe retries).
  if (requestId) headers["PayPal-Request-Id"] = requestId;
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new PayPalError(step, res.status, data);
  return data as T;
}

const dollars = (cents: number) => (cents / 100).toFixed(2);
export const toCents = (value: string) => Math.round(Number(value) * 100);

type Order = {
  id: string;
  status: string;
  purchase_units: {
    custom_id?: string;
    amount: { value: string };
    payments?: { authorizations?: { id: string; status: string; expiration_time: string }[] };
  }[];
};

export async function createHoldOrder(opts: { listingId: string; title: string; priceCents: number }) {
  const order = await call<Order>("create order", "POST", "/v2/checkout/orders", {
    intent: "AUTHORIZE",
    purchase_units: [
      {
        custom_id: opts.listingId,
        description: `DealHold: ${opts.title}`.slice(0, 127),
        amount: { currency_code: "USD", value: dollars(opts.priceCents) },
      },
    ],
    application_context: { shipping_preference: "NO_SHIPPING", brand_name: "DealHold" },
  });
  return order.id;
}

export async function getOrder(orderId: string) {
  const order = await call<Order>("get order", "GET", `/v2/checkout/orders/${orderId}`);
  const unit = order.purchase_units[0];
  return { status: order.status, listingId: unit.custom_id, amountCents: toCents(unit.amount.value) };
}

export async function authorizeOrder(orderId: string) {
  const order = await call<Order>("authorize", "POST", `/v2/checkout/orders/${orderId}/authorize`, {});
  const unit = order.purchase_units[0];
  const auth = unit.payments?.authorizations?.[0];
  if (!auth) throw new PayPalError("authorize", 200, order);
  return {
    authId: auth.id,
    status: auth.status,
    expiresAt: auth.expiration_time,
    listingId: unit.custom_id,
    amountCents: toCents(unit.amount.value),
  };
}

export async function captureHold(authId: string, dealId: string) {
  const capture = await call<{
    id: string;
    status: string;
    seller_receivable_breakdown?: { net_amount: { value: string }; paypal_fee?: { value: string } };
  }>("capture", "POST", `/v2/payments/authorizations/${authId}/capture`, { final_capture: true }, `capture-${dealId}`);
  return {
    captureId: capture.id,
    status: capture.status,
    netCents: capture.seller_receivable_breakdown ? toCents(capture.seller_receivable_breakdown.net_amount.value) : null,
  };
}

export async function voidHold(authId: string) {
  await call("void", "POST", `/v2/payments/authorizations/${authId}/void`);
}

export async function payoutToSeller(opts: { dealId: string; email: string; amountCents: number; note: string }) {
  const payout = await call<{ batch_header: { payout_batch_id: string; batch_status: string } }>(
    "payout",
    "POST",
    "/v1/payments/payouts",
    {
      // sender_batch_id is unique per deal, so a retry can't pay twice.
      sender_batch_header: { sender_batch_id: `deal-${opts.dealId}`, email_subject: "You've been paid for your DealHold sale" },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: opts.email,
          amount: { currency: "USD", value: dollars(opts.amountCents) },
          note: opts.note,
          sender_item_id: opts.dealId,
        },
      ],
    }
  );
  return { batchId: payout.batch_header.payout_batch_id, status: payout.batch_header.batch_status };
}
