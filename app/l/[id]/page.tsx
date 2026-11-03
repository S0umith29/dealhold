import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getListing, publicListing } from "@/lib/deals";
import { money } from "@/lib/format";
import { SofaArt } from "@/components/SofaArt";
import { BuyerChat } from "@/components/BuyerChat";
import { ChatJumpBar } from "@/components/ChatJumpBar";

export default async function ListingPage({ params }: PageProps<"/l/[id]">) {
  await connection();
  const { id } = await params;
  const row = getListing(id);
  if (!row) notFound();
  const listing = publicListing(row);

  return (
    <div className="grid gap-6 pb-24 md:grid-cols-[1fr_360px] md:pb-0">
      <article className="space-y-4">
        <div className="aspect-[16/9] overflow-hidden rounded-xl border border-line bg-paper">
          {listing.photos.length > 0 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={listing.photos[0]} alt={listing.title} className="h-full w-full object-cover" />
          ) : (
            <SofaArt />
          )}
        </div>
        {listing.photos.length > 1 && (
          <div className="flex gap-2">
            {listing.photos.slice(1).map((src) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} alt="" className="h-16 w-16 rounded-lg border border-line object-cover" />
            ))}
          </div>
        )}
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
        <ul className="space-y-1 text-sm text-muted">
          <li>• PayPal holds your money when you reserve. You aren&apos;t charged yet.</li>
          <li>• At pickup, check the item, then give {listing.sellerName} your 4-digit code.</li>
          <li>• Not as described? Cancel, and the hold is released.</li>
        </ul>
      </article>

      <aside id="chat" className="scroll-mt-4">
        <BuyerChat
          listingId={listing.id}
          sellerName={listing.sellerName}
          askCents={listing.askCents}
          listingStatus={listing.status}
          paypalClientId={process.env.PAYPAL_CLIENT_ID ?? ""}
        />
      </aside>

      {/* Phones: the chat sits below the details, so keep a way to it on screen. */}
      {listing.status === "active" && (
        <ChatJumpBar label={`💬 Chat with ${listing.sellerName}'s assistant · ${money(listing.askCents)}`} />
      )}
    </div>
  );
}
