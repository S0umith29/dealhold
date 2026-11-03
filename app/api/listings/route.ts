import { createListing, DealError } from "@/lib/deals";
import { handle } from "@/lib/http";
import { requireSeller } from "@/lib/seller-auth";

type Body = {
  title?: string;
  description?: string;
  facts?: { label: string; value: string }[];
  photos?: string[];
  askCents?: number;
  floorCents?: number;
  newPriceCents?: number | null;
  productUrl?: string | null;
};

// Seller publishes a listing.
export async function POST(req: Request) {
  return handle(async () => {
    await requireSeller(req);
    const b = (await req.json().catch(() => ({}))) as Body;
    const title = b.title?.trim().slice(0, 80);
    if (!title) throw new DealError("Add a title.");
    const ask = Math.round(Number(b.askCents));
    const floor = Math.round(Number(b.floorCents));
    if (!(ask > 0)) throw new DealError("Set an asking price.");
    if (!(floor > 0) || floor > ask) throw new DealError("Your lowest price must be above $0 and not above the asking price.");
    const photos = (b.photos ?? []).filter((p) => /^[a-f0-9-]{8}\/\d\.(jpg|png|webp|gif)$/.test(p)).slice(0, 4);
    const facts = Object.fromEntries(
      (b.facts ?? []).filter((f) => f.label?.trim() && f.value?.trim()).slice(0, 8).map((f) => [f.label.trim().slice(0, 30), f.value.trim().slice(0, 80)])
    );
    const id = createListing({
      title,
      description: (b.description ?? "").trim().slice(0, 600),
      facts,
      photos,
      askCents: ask,
      floorCents: floor,
      newPriceCents: Number(b.newPriceCents) > 0 && Number(b.newPriceCents) < 10_000_000 ? Math.round(Number(b.newPriceCents)) : null,
      productUrl: typeof b.productUrl === "string" && /^https:\/\/[^\s]{1,500}$/.test(b.productUrl) ? b.productUrl : null,
    });
    return { id };
  });
}
