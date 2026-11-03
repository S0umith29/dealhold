import { NextResponse } from "next/server";
import { draftListing, findNewPrices, savePhotos, validatePhotos } from "@/lib/listing-ai";
import { handle } from "@/lib/http";
import { isSeller } from "@/lib/seller-auth";
import { limit, LIMITS, visitor } from "@/lib/limits";

// Seller uploads photos and a note: the AI writes the listing and Channel3 finds it new today.
export async function POST(req: Request) {
  if (!(await isSeller())) return NextResponse.json({ error: "Sign in as the seller first." }, { status: 401 });
  try {
    limit(
      [
        [`draft:${visitor(req)}`, LIMITS.draftPerVisitor],
        ["draft-all", LIMITS.draftEveryone],
      ],
      "Too many listings drafted for now. Try again later."
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 429 });
  }
  const form = await req.formData();
  let files: File[];
  try {
    files = validatePhotos(form.getAll("photos").filter((f): f is File => f instanceof File));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  const note = String(form.get("note") ?? "").slice(0, 500);
  return handle(async () => {
    const { draftId, photos, paths } = await savePhotos(files);
    const draft = await draftListing(photos, note);
    const candidates = await findNewPrices(draft.search_phrase, photos[0]).catch((err) => {
      console.error(err);
      return [];
    });
    return { draftId, photos: paths, draft, candidates };
  });
}
