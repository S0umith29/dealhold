import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getListing, holdPriceFor, publicListing } from "@/lib/deals";
import { money } from "@/lib/format";
import { SofaArt } from "@/components/SofaArt";
import { HoldPanel } from "@/components/HoldPanel";

export default async function ListingPage({ params }: PageProps<"/l/[id]">) {
  await connection();
  const { id } = await params;
  const row = getListing(id);
  if (!row) notFound();
  const listing = publicListing(row);

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <article className="space-y-4">
        <div className="aspect-[16/9] overflow-hidden rounded-xl border border-line">
          <SofaArt />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{listing.title}</h1>
          <p className="text-xl font-semibold">{money(listing.askCents)}</p>
          <p className="mt-2 text-muted">{listing.description}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-line bg-white p-4 text-sm">
          {Object.entries(listing.facts).map(([k, v]) => (
            <div key={k}>
              <dt className="text-muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        <section className="rounded-xl border border-dashed border-line bg-white p-4 text-sm text-muted">
          <p className="font-medium text-ink">Chat with {listing.sellerName}&apos;s agent</p>
          <p>Coming next: ask questions and make offers here. The agent replies for {listing.sellerName}.</p>
        </section>
      </article>

      <aside>
        <HoldPanel
          listingId={listing.id}
          sellerName={listing.sellerName}
          priceCents={holdPriceFor(row)}
          status={listing.status}
          paypalClientId={process.env.PAYPAL_CLIENT_ID ?? ""}
        />
      </aside>
    </div>
  );
}
