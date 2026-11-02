import Link from "next/link";
import { connection } from "next/server";
import { listListings, publicListing } from "@/lib/deals";
import { money } from "@/lib/format";

export default async function Home() {
  await connection();
  const listings = listListings().map(publicListing);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sell used stuff without the inbox.</h1>
        <p className="text-muted">
          Your agent answers every buyer and haggles within your limits. You only hear about a deal once the buyer&apos;s
          money is held by PayPal.
        </p>
      </section>

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
