# DealHold

**An AI assistant that sells your used stuff for you. Buyers reserve with a PayPal hold, and you only hear about a deal once their money is held.**

Selling one sofa on a local marketplace means dozens of "is this still available?" messages, the same questions over and over, lowball offers, haggling, and buyers who agree and never show up. DealHold handles all of that for the seller:

1. **List in a minute.** Upload photos and a few words. The assistant writes the listing, finds today's new price (Channel3), and suggests an asking price and a private lowest price.
2. **Share one link.** Post on Facebook Marketplace as usual and add the DealHold link.
3. **The assistant talks to every buyer at once.** It answers from the listing facts, asks the seller only what it doesn't know (once, then remembers), turns down lowballs and haggles, never below the seller's floor.
4. **Only serious buyers get through.** A buyer who agrees approves a **PayPal hold**. Only then does the deal reach the seller.
5. **Pickup.** The buyer checks the item and reads a 4-digit code to the seller. The seller enters it, DealHold captures the payment and pays the seller with **PayPal Payouts**. If anything goes wrong, the hold is released and the buyer is never charged.

The seller's job: list, tap Approve, enter the code.

## Try it

- **Hosted demo:** https://dealhold.onrender.com (free hosting: the first load can take about a minute while it wakes up)
- **Buyer view:** open the demo listing at `/l/sofa-123`, enter a name, chat, haggle, and reserve with PayPal.
- **Seller view:** `/seller` shows deals to approve, questions from the assistant, the live buyer grid, and listings. "Reset demo" starts the demo fresh.
- **PayPal sandbox buyer login:** `<SANDBOX_BUYER_EMAIL>` / `<SANDBOX_BUYER_PASSWORD>` (sandbox only, no real money). Choose **Pay in full** in the PayPal window.

## How it uses PayPal

All PayPal calls are made by server code, never by the AI.

| Step | PayPal API |
|---|---|
| Buyer reserves at the agreed price | Orders v2 `POST /v2/checkout/orders` with `intent: AUTHORIZE`, approved in the PayPal JS SDK button |
| Money is held, not charged | `POST /v2/checkout/orders/{id}/authorize` |
| Correct pickup code entered | `POST /v2/payments/authorizations/{id}/capture` |
| Seller is paid | Payouts `POST /v1/payments/payouts` |
| Buyer cancels, seller declines, a race is lost, or no pickup within 3 days | `POST /v2/payments/authorizations/{id}/void` |

The hold sits on the platform account and the seller is paid out after capture, because PayPal (correctly) won't let a platform void a hold that belongs to the seller's own account. A real launch would use PayPal's marketplace (multiparty) setup instead.

## How it uses AI

**Code decides, AI talks.** Prices, limits and money are plain code; the AI only does what code can't.

| Job | How |
|---|---|
| Write the listing | One Claude call reads the seller's photos and note: title, description, facts, condition, age, a store search phrase, and anything in the photos that contradicts the note |
| Understand buyer messages | Claude reads each message into a small structured form: question, offer, accept, pickup timing, a question for the seller |
| Answer questions | From the listing facts and the seller's saved answers only; unknown questions go to the seller once |
| Word the replies | Claude writes each reply around a price decided by code; code checks every reply (right price only, no false "lowest price" claims, no other payment methods) and falls back to a fixed sentence if anything is off |

Model: **Claude Haiku 5.5** (`AGENT_MODEL` to change). Typical cost: about $0.0001–0.0002 per buyer message, about a cent per sale. Availability questions and bare-number offers skip the reading step.

**Negotiation (`lib/negotiate.ts`)** follows a short, human arc instead of trading $5 steps: an opening counter, a second move that offers a better price for a quick pickup, then a meet-in-the-middle final offer. It never moves when the buyer doesn't, never rewards going below the buyer's own earlier offer, confirms offers above the price instead of taking them, and never goes below the seller's floor. The AI never sees the floor.

## Sponsor tools

- **AG Grid** (Community): the seller's live buyer-activity grid (`components/BuyerActivity.tsx`).
- **Channel3**: finds the item new today by photo and search phrase to suggest a fair price (`lib/listing-ai.ts`).
- **Render**: hosting (`render.yaml`).

## Run it locally

Requirements: Node 22.13+ (uses the built-in `node:sqlite`), a PayPal Developer sandbox app, an Anthropic API key, a Channel3 API key.

```bash
npm install
cp .env.example .env   # then fill it in (see below)
npm run dev            # http://localhost:3000
```

`.env`:

| Variable | What |
|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Sandbox app credentials (developer.paypal.com → Apps & Credentials → Sandbox) |
| `PAYPAL_API` | `https://api-m.sandbox.paypal.com` |
| `SELLER_EMAIL` | A sandbox **business** account's email; payouts go here |
| `ANTHROPIC_API_KEY` | Claude API key |
| `CHANNEL3_API_KEY` | Channel3 API key |
| `AGENT_MODEL` | Optional, defaults to `claude-haiku-5-5` |
| `DEMO_MODE` | `1` shows the "Reset demo" button |
| `CRON_SECRET` | Secret for `POST /api/cron/expire-holds` |

Also create a sandbox **personal** account (with a balance) to act as the buyer.

Useful scripts:

- `npm run reset-demo`: put sold listings back on sale and clear buyer chats.
- `npm run hold-test capture|void`: the standalone PayPal hold test script.

## Project layout

```
app/                 pages (listing /l/[id], buyer deal /d/[id], seller /seller, /seller/new) and API routes
components/          chat, PayPal button, seller grid, forms
lib/negotiate.ts     pricing decisions (plain code)
lib/agent.ts         buyer chat: rules, Claude reading and wording, wording checks
lib/listing-ai.ts    listing from photos (Claude) and new prices (Channel3)
lib/paypal.ts        PayPal REST calls
lib/deals.ts         holds, pickup codes, capture, payout, void, expiry
lib/db.ts            SQLite schema
```

## Known limits

- One demo seller and no sign-in.
- Free hosting forgets chats and deals when it restarts; the demo listing is re-created on start.
- A buyer could file a PayPal dispute after pickup; DealHold records when the code was entered, but doesn't resolve disputes.
- Used-price suggestions use a rule of thumb (share of the new price by condition and age), not real resale data.

## License

MIT
