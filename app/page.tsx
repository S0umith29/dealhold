import Link from "next/link";
import { connection } from "next/server";
import { demoMode, listListings, publicListing } from "@/lib/deals";
import { money } from "@/lib/format";

const STEPS: [string, string][] = [
  ["List in a minute", "Photos and a few words. The assistant writes the listing and checks today's new price."],
  ["Share one link", "Paste it into your Facebook Marketplace post. Buyers chat with your assistant there."],
  ["It handles every buyer", "Answers, haggles and turns down lowballs, never below your private lowest price."],
  ["Only held money reaches you", "A buyer who agrees approves a PayPal hold. You just tap Approve."],
  ["Paid at pickup", "The buyer checks the item and gives you a 4-digit code. Enter it and you're paid."],
];

export default async function Home() {
  await connection();
  const listings = listListings().map(publicListing);
  const demoListing = listings.find((l) => l.id === "sofa-123") ?? listings[0];
  const buyerEmail = process.env.DEMO_BUYER_EMAIL;
  const buyerPassword = process.env.DEMO_BUYER_PASSWORD;

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Sell used stuff without the inbox.</h1>
        <p className="text-muted">
          Selling one sofa means dozens of &quot;is this still available?&quot;, the same questions again and again, lowball
          offers, and buyers who agree and never show up. DealHold&apos;s AI assistant talks to every buyer at once and
          haggles within your limits. You only hear about a deal once PayPal is holding the buyer&apos;s money.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {demoListing && (
          <Link href={`/l/${demoListing.id}`} className="rounded-xl border border-line bg-white p-5 hover:border-brand">
            <p className="text-xs font-medium uppercase tracking-wide text-brand">Try it as a buyer</p>
            <p className="mt-1 text-lg font-semibold">Haggle for the {demoListing.title.toLowerCase()}</p>
            <p className="mt-1 text-sm text-muted">
              Ask questions, make an offer, then reserve it with a PayPal hold. You aren&apos;t charged until pickup.
            </p>
          </Link>
        )}
        <Link href="/seller" className="rounded-xl border border-line bg-white p-5 hover:border-brand">
          <p className="text-xs font-medium uppercase tracking-wide text-brand">Try it as Maya, the seller</p>
          <p className="mt-1 text-lg font-semibold">Watch the assistant work</p>
          <p className="mt-1 text-sm text-muted">
            See every buyer live, answer the one question it couldn&apos;t, approve a held deal, and get paid with the
            pickup code.
          </p>
        </Link>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">How it works</h2>
        <ol className="grid gap-2 sm:grid-cols-5">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="rounded-xl border border-line bg-white p-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                {i + 1}
              </span>
              <p className="mt-2 text-sm font-medium">{title}</p>
              <p className="mt-1 text-xs text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {demoMode() && (
        <section className="space-y-3 rounded-xl border border-brand/30 bg-brand-soft/40 p-5">
          <h2 className="font-semibold">Judge&apos;s 3-minute tour</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              <Link href="/seller" className="font-medium text-brand underline">
                Open Maya&apos;s dashboard
              </Link>{" "}
              and press <b>▶ Simulate 5 buyers</b>. Five buyers message at once: a serious buyer, a lowballer, one who asks
              something only Maya knows, one who tries to trick the assistant, and one who ghosts. Tap any row to read the
              chat.
            </li>
            <li>
              Answer the buyer&apos;s question on the dashboard. The assistant replies to that buyer and reuses the answer for
              everyone after.
            </li>
            <li>
              {demoListing ? (
                <Link href={`/l/${demoListing.id}`} className="font-medium text-brand underline">
                  Open the sofa as a buyer
                </Link>
              ) : (
                "Open a listing as a buyer"
              )}{" "}
              in another tab. Try &quot;Would you take $90?&quot;, &quot;I can get one new for $120&quot;, or a pickup
              tomorrow. When you agree, reserve with PayPal.
              {buyerEmail && (
                <span className="mt-1 block rounded-lg bg-white px-3 py-2 text-xs">
                  PayPal sandbox buyer (no real money): <code>{buyerEmail}</code>
                  {buyerPassword && (
                    <>
                      {" "}
                      / <code>{buyerPassword}</code>
                    </>
                  )}
                  . Choose <b>Pay in full</b>.
                </span>
              )}
            </li>
            <li>
              Back as Maya: <b>Approve</b> the held deal, then type the 4-digit code from the buyer&apos;s page. PayPal
              captures the payment and pays Maya out.
            </li>
            <li>
              Optional:{" "}
              <Link href="/seller/new" className="font-medium text-brand underline">
                list a new item
              </Link>{" "}
              from a photo. <b>Reset demo</b> on the dashboard starts everything fresh.
            </li>
          </ol>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Listings</h2>
        {listings.map((l) => (
          <Link
            key={l.id}
            href={`/l/${l.id}`}
            className="flex items-center justify-between rounded-xl border border-line bg-white p-4 hover:border-brand"
          >
            <span>
              <span className="font-medium">{l.title}</span>
              <span className="ml-2 text-sm text-muted">{l.status}</span>
            </span>
            <span className="font-semibold">{money(l.askCents)}</span>
          </Link>
        ))}
      </section>
    </div>
  );
}
