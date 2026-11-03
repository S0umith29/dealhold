import Link from "next/link";
import { connection } from "next/server";
import { demoMode, expireStaleHolds, getListing, listDeals, listListings, publicDeal } from "@/lib/deals";
import { ResetDemoButton } from "@/components/ResetDemoButton";
import { NotificationsButton } from "@/components/NotificationsButton";
import { agentStats, getChat, openQuestions, sellerActivity } from "@/lib/agent";
import { BuyerActivity } from "@/components/BuyerActivity";
import { money } from "@/lib/format";
import { SellerDealCard } from "@/components/SellerDealCard";
import { CopyLink } from "@/components/CopyLink";
import { QuestionCard } from "@/components/QuestionCard";

// Demo has a single seller (Maya), so no login yet.
export default async function SellerPage() {
  await connection();
  // Also sweep on page load, so expiry works even without the scheduled job.
  await expireStaleHolds();
  const deals = listDeals();
  const listings = listListings();
  const questions = openQuestions();
  const stats = agentStats();
  const open = deals.filter((d) => ["held", "approved", "locked"].includes(d.status));
  const past = deals.filter((d) => !open.includes(d));

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Hi Maya</h1>
          <div className="flex items-center gap-2">
            <NotificationsButton publicKey={process.env.VAPID_PUBLIC_KEY ?? ""} />
            {demoMode() && <ResetDemoButton />}
          </div>
        </div>
        {open.length === 0 && questions.length === 0 && (
          <p className="text-muted">Nothing needs you right now. Your assistant is handling buyers.</p>
        )}
        {open.map((d) => (
          <SellerDealCard key={d.id} deal={publicDeal(d)} title={getListing(d.listing_id)!.title} />
        ))}
        {questions.map((q) => (
          <QuestionCard key={q.id} id={q.id} question={q.question} buyerName={getChat(q.chat_id)?.buyer_name ?? "A buyer"} />
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Buyers · live</h2>
        {/* SQLite rows are null-prototype objects; send plain copies to the client component. */}
        <BuyerActivity
          initialRows={JSON.parse(JSON.stringify(sellerActivity()))}
          initialStats={JSON.parse(JSON.stringify(stats))}
        />
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Your listings</h2>
          <Link href="/seller/new" className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white">
            + New listing
          </Link>
        </div>
        {listings.map((l) => (
          <div key={l.id} className="space-y-2 rounded-xl border border-line bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-medium">{l.title}</span>
              <span className="text-sm text-muted">
                {money(l.ask_cents)} ask · {money(l.floor_cents)} floor · {l.status}
              </span>
            </div>
            <CopyLink listingId={l.id} />
          </div>
        ))}
      </section>

      {past.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Past deals</h2>
          {past.map((d) => (
            <div key={d.id} className="flex justify-between rounded-xl border border-line bg-white p-3 text-sm">
              <span>
                {d.buyer_name} · {money(d.price_cents)}
              </span>
              <span className="text-muted">
                {d.status === "completed" && d.payout_cents
                  ? `Paid ${money(d.payout_cents)}`
                  : (d.cancel_reason ?? d.status)}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
