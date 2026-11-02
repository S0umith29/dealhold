// Day 1 test: can PayPal hold the buyer's money, then either pay the seller or release it?
// Flow: token -> create AUTHORIZE order (payee = our platform account) -> buyer approves in browser
//       -> authorize (money held) -> capture + payout to seller, or void (buyer keeps the money).
//
// Why not payee = seller: PayPal then treats the hold as the seller's, and our app gets
// PERMISSION_DENIED on void. Holding it on our own account lets us capture or void freely.
//
// Usage:
//   node scripts/hold-test.js capture   # pickup code entered: capture, then pay the seller
//   node scripts/hold-test.js void      # pickup failed: release the hold

require("dotenv").config();
const readline = require("node:readline/promises");

const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_API, SELLER_EMAIL } = process.env;
const MODE = process.argv[2];
const AMOUNT = "125.00";

if (!["capture", "void"].includes(MODE)) {
  console.error("Usage: node scripts/hold-test.js capture|void");
  process.exit(1);
}
for (const [name, value] of Object.entries({ PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_API, SELLER_EMAIL })) {
  if (!value) {
    console.error(`Missing ${name} in .env`);
    process.exit(1);
  }
}

async function getToken() {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  if (!res.ok) fail("Getting access token", res, data);
  return data.access_token;
}

async function paypal(token, method, path, body) {
  const res = await fetch(`${PAYPAL_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) fail(`${method} ${path}`, res, data);
  return data;
}

function fail(step, res, data) {
  console.error(`\n✗ ${step} failed (HTTP ${res.status})`);
  console.error(JSON.stringify(data, null, 2));
  if (data.debug_id) console.error(`PayPal debug_id: ${data.debug_id}`);
  process.exit(1);
}

async function main() {
  const token = await getToken();
  console.log("✓ Got access token");

  // 1. Create the order. intent AUTHORIZE = hold, don't take the money yet.
  const order = await paypal(token, "POST", "/v2/checkout/orders", {
    intent: "AUTHORIZE",
    purchase_units: [
      {
        description: "DealHold test: grey sofa",
        amount: { currency_code: "USD", value: AMOUNT },
        // No payee: the money is held on the account that owns these API credentials.
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          user_action: "CONTINUE",
          shipping_preference: "NO_SHIPPING",
          return_url: "https://example.com/approved",
          cancel_url: "https://example.com/cancelled",
        },
      },
    },
  });
  const approveLink = order.links.find((l) => l.rel === "payer-action" || l.rel === "approve");
  console.log(`✓ Created order ${order.id} for $${AMOUNT}, held on platform account ${order.purchase_units[0].payee?.email_address ?? ""}`);

  // 2. Buyer approves in the browser.
  console.log(`\nOpen this link and log in as the BUYER (Leo's sandbox account):\n\n  ${approveLink.href}\n`);
  console.log("After approving you'll land on example.com. That's expected.");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("Press Enter once you've approved... ");
  rl.close();

  // 3. Authorize = money is now held on Leo's account.
  const authorized = await paypal(token, "POST", `/v2/checkout/orders/${order.id}/authorize`, {});
  const auth = authorized.purchase_units[0].payments.authorizations[0];
  console.log(`✓ Authorized: ${auth.id}, status ${auth.status}, expires ${auth.expiration_time}`);
  if (auth.status !== "CREATED") {
    console.log("  (status isn't CREATED; check the details above before trusting the hold)");
  }

  // 4. Capture (pickup code entered) or void (pickup failed).
  if (MODE === "capture") {
    const capture = await paypal(token, "POST", `/v2/payments/authorizations/${auth.id}/capture`, {
      final_capture: true,
    });
    console.log(`✓ Captured: ${capture.id}, status ${capture.status}`);
    const breakdown = capture.seller_receivable_breakdown;
    const net = breakdown?.net_amount?.value ?? AMOUNT;
    console.log(`  Gross $${AMOUNT}, PayPal fee $${breakdown?.paypal_fee?.value ?? "?"}, net $${net}`);

    // Pay the seller their share from the platform account.
    const payout = await paypal(token, "POST", "/v1/payments/payouts", {
      sender_batch_header: {
        sender_batch_id: `dealhold-${auth.id}`,
        email_subject: "You've been paid for your DealHold sale",
      },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: SELLER_EMAIL,
          amount: { currency: "USD", value: net },
          note: "DealHold test: grey sofa",
          sender_item_id: auth.id,
        },
      ],
    });
    const batchId = payout.batch_header.payout_batch_id;
    console.log(`✓ Payout sent to ${SELLER_EMAIL}: batch ${batchId}, status ${payout.batch_header.batch_status}`);

    // Payouts finish asynchronously; check once after a short wait.
    await new Promise((r) => setTimeout(r, 5000));
    const batch = await paypal(token, "GET", `/v1/payments/payouts/${batchId}`);
    const item = batch.items?.[0];
    console.log(
      `  Payout now: batch ${batch.batch_header.batch_status}, item ${item?.transaction_status ?? "?"}, fee $${item?.payout_item_fee?.value ?? "?"}`
    );
  } else {
    await paypal(token, "POST", `/v2/payments/authorizations/${auth.id}/void`);
    console.log("✓ Voided: hold released, buyer keeps the money");
  }

  // 5. Read back the authorization to confirm final state.
  const final = await paypal(token, "GET", `/v2/payments/authorizations/${auth.id}`);
  console.log(`\nFinal authorization status: ${final.status}`);
  console.log(
    MODE === "capture"
      ? "Now check Maya's sandbox account: the payout should be there."
      : "Now check Leo's sandbox account: no payment should be taken."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
