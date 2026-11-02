import { connection } from "next/server";
import { getListing, listDeals, listListings, publicDeal } from "@/lib/deals";
import { money } from "@/lib/format";
import { SellerDealCard } from "@/components/SellerDealCard";
import { CopyLink } from "@/components/CopyLink";
// Demo has a single seller (Maya), so no login yet.
export default async function SellerPage() {
  await connection();
  const deals = listDeals();
  const listings = listListings();
  const open = deals.filter((d) => ["held", "approved", "locked"].includes(d.status));
  const past = deals.filter((d) => !open.includes(d));

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Hi Maya</h1>
        {open.length === 0 && <p className="text-muted">No deals waiting. Your agent is handling buyers.</p>}
        {open.map((d) => (
          <SellerDealCard key={d.id} deal={publicDeal(d)} title={getListing(d.listing_id)!.title} />
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Your listings</h2>
        {listings.map((l) => (
          <div key={l.id} className="space-y-2 rounded-xl border border-line bg-white p-4">
            <div className="flex justify-between">
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
