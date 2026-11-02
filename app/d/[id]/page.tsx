import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getDeal, getListing, publicDeal } from "@/lib/deals";
import { BuyerDeal } from "@/components/BuyerDeal";

export default async function DealPage({ params }: PageProps<"/d/[id]">) {
  await connection();
  const { id } = await params;
  const deal = getDeal(id);
  if (!deal) notFound();
  const listing = getListing(deal.listing_id)!;

  return <BuyerDeal initial={publicDeal(deal)} title={listing.title} sellerName={listing.seller_name} />;
}
