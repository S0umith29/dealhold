import { readPhoto } from "@/lib/listing-ai";

// Serves a listing photo.
export async function GET(_req: Request, ctx: RouteContext<"/api/photos/[draftId]/[file]">) {
  const { draftId, file } = await ctx.params;
  const photo = readPhoto(draftId, file);
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(photo.data), {
    headers: { "Content-Type": photo.type, "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
