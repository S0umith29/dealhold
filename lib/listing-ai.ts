import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Creating a listing: one AI call reads the photos, Channel3 finds today's new price,
// and a plain formula suggests the asking price and the floor.

const MODEL = process.env.AGENT_MODEL ?? "claude-haiku-5-5";
const UPLOADS = process.env.UPLOADS_PATH ?? path.join(process.cwd(), "data", "uploads");
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 4_500_000; // stays under the model's per-image limit

type ImageType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
const IMAGE_TYPES: ImageType[] = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const EXT: Record<ImageType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

export type Photo = { data: Buffer; type: ImageType };

export function validatePhotos(files: File[]) {
  const photos = files.filter((f) => f.size > 0).slice(0, MAX_PHOTOS);
  if (photos.length === 0) throw new Error("Add at least one photo.");
  for (const f of photos) {
    if (!IMAGE_TYPES.includes(f.type as ImageType)) throw new Error("Photos must be JPG, PNG, WebP or GIF.");
    if (f.size > MAX_PHOTO_BYTES) throw new Error("Each photo must be under 4.5 MB.");
  }
  return photos;
}

export async function savePhotos(files: File[]) {
  const draftId = crypto.randomUUID().slice(0, 8);
  const dir = path.join(UPLOADS, draftId);
  fs.mkdirSync(dir, { recursive: true });
  const photos: Photo[] = [];
  const paths: string[] = [];
  for (const [i, f] of files.entries()) {
    const data = Buffer.from(await f.arrayBuffer());
    const type = f.type as ImageType;
    const name = `${i}.${EXT[type]}`;
    fs.writeFileSync(path.join(dir, name), data);
    photos.push({ data, type });
    paths.push(`${draftId}/${name}`);
  }
  return { draftId, photos, paths };
}

// Serve a stored photo. Paths are "<draftId>/<n>.<ext>"; anything else is refused.
export function readPhoto(draftId: string, file: string) {
  if (!/^[a-f0-9-]{8}$/.test(draftId) || !/^\d\.(jpg|png|webp|gif)$/.test(file)) return null;
  const full = path.join(UPLOADS, draftId, file);
  if (!fs.existsSync(full)) return null;
  const ext = file.split(".")[1];
  const type = Object.entries(EXT).find(([, e]) => e === ext)![0];
  return { data: fs.readFileSync(full), type };
}

// ---------- AI: photos + the seller's note → listing text and facts ----------

const Draft = z.object({
  title: z.string(),
  description: z.string(),
  facts: z.array(z.object({ label: z.string(), value: z.string() })),
  search_phrase: z.string(),
  condition: z.enum(["like_new", "good", "fair", "worn"]),
  age_years: z.number().nullable(),
  mismatch_notes: z.array(z.string()),
});
export type Draft = z.infer<typeof Draft>;

const DRAFT_INSTRUCTIONS = `You help someone sell a used item locally. From their photos and short note, write the listing.

- title: short and plain, e.g. "Grey 3-seat sofa". Include the brand/model only if the note or photos clearly show it.
- description: 1-2 sentences in the seller's voice, honest and specific. No hype.
- facts: 4-6 short label/value pairs a buyer would ask about (e.g. Size, Age, Condition, Pets, Smoking, Pickup). Use only what the note says or the photos clearly show; if unknown, leave that fact out.
- search_phrase: what to search in a store to find this item new today (brand, model, type, color), e.g. "IKEA Kivik 3-seat sofa grey".
- condition: like_new, good, fair, or worn, judged from the photos and note.
- age_years: from the note, or null if not stated.
- mismatch_notes: anything in the photos that contradicts the note (e.g. note says "like new" but a photo shows a stain), as short sentences. Empty if none.`;

const anthropic = new Anthropic();

export async function draftListing(photos: Photo[], note: string) {
  const response = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 2048,
    output_config: { effort: "low", format: zodOutputFormat(Draft) },
    system: DRAFT_INSTRUCTIONS,
    messages: [
      {
        role: "user",
        content: [
          ...photos.map((p) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: p.type, data: p.data.toString("base64") },
          })),
          { type: "text" as const, text: `Seller's note: ${note || "(none)"}` },
        ],
      },
    ],
  });
  if (!response.parsed_output) throw new Error(`Couldn't read the photos (stop: ${response.stop_reason})`);
  return response.parsed_output;
}

// ---------- Channel3: find the item new today ----------

export type Candidate = { title: string; brand: string | null; imageUrl: string | null; priceCents: number; url: string; store: string };

type C3Product = {
  title: string;
  brands?: { name: string }[];
  images?: { url: string; cleaned_url?: string; is_main_image?: boolean }[];
  offers?: { url: string; domain: string; price: { price: number; currency: string } }[];
};

async function channel3Search(body: Record<string, unknown>) {
  const res = await fetch("https://api.trychannel3.com/v1/search", {
    method: "POST",
    headers: { "x-api-key": process.env.CHANNEL3_API_KEY ?? "", "Content-Type": "application/json" },
    // US stores and prices in dollars only.
    body: JSON.stringify({ limit: 8, config: { country: "US", currency: "USD" }, ...body }),
  });
  if (!res.ok) throw new Error(`Channel3 search failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { products: C3Product[] }).products;
}

function toCandidate(p: C3Product): Candidate | null {
  // US stores only: foreign stores (e.g. ikea.gr) can still come back labelled USD.
  const offer = p.offers?.find((o) => o.price?.currency === "USD" && /\.(com|us)$/.test(o.domain));
  if (!offer?.price?.price) return null;
  const image = p.images?.find((i) => i.is_main_image) ?? p.images?.[0];
  return {
    title: p.title,
    brand: p.brands?.[0]?.name ?? null,
    imageUrl: image?.cleaned_url || image?.url || null,
    priceCents: Math.round(offer.price.price * 100),
    url: offer.url,
    store: offer.domain,
  };
}

// Search with the seller's photo and the AI's search phrase together; fall back to text only.
export async function findNewPrices(searchPhrase: string, photo?: Photo) {
  let products: C3Product[] = [];
  if (photo) {
    try {
      products = await channel3Search({ query: searchPhrase, base64_image: photo.data.toString("base64") });
    } catch (err) {
      console.warn("Channel3 photo search failed, trying text only", err);
    }
  }
  if (products.length === 0) products = await channel3Search({ query: searchPhrase });
  const seen = new Set<string>();
  return products
    .map(toCandidate)
    .filter((c): c is Candidate => c !== null && !seen.has(c.title) && Boolean(seen.add(c.title)))
    .slice(0, 6);
}
