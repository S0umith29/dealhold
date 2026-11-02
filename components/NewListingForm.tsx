"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";
import { suggestPrices, type Condition } from "@/lib/pricing";

type Candidate = { title: string; brand: string | null; imageUrl: string | null; priceCents: number; url: string; store: string };
type Draft = {
  title: string;
  description: string;
  facts: { label: string; value: string }[];
  search_phrase: string;
  condition: Condition;
  age_years: number | null;
  mismatch_notes: string[];
};
type DraftResponse = { draftId: string; photos: string[]; draft: Draft; candidates: Candidate[] };

const CONDITION_LABEL: Record<Condition, string> = { like_new: "Like new", good: "Good", fair: "Fair", worn: "Worn" };
const dollarsToCents = (v: string) => Math.round(Number(v.replace(/[^0-9.]/g, "")) * 100);

// Maya's listing flow: 1) photos + note, 2) check the AI's listing and pick the matching product, 3) set prices.
export function NewListingForm() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [result, setResult] = useState<DraftResponse | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [facts, setFacts] = useState<{ label: string; value: string }[]>([]);
  const [picked, setPicked] = useState<Candidate | "none" | null>(null);
  const [ask, setAsk] = useState("");
  const [floor, setFloor] = useState("");

  async function analyze(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) return setError("Add at least one photo.");
    setBusy("Reading your photos and checking today's prices…");
    setError(null);
    const form = new FormData();
    files.forEach((f) => form.append("photos", f));
    form.append("note", note);
    const res = await fetch("/api/listings/draft", { method: "POST", body: form });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) return setError(data.error ?? "Something went wrong.");
    const r = data as DraftResponse;
    setResult(r);
    setTitle(r.draft.title);
    setDescription(r.draft.description);
    setFacts(r.draft.facts);
  }

  function pick(c: Candidate | "none") {
    setPicked(c);
    if (c !== "none" && result) {
      const s = suggestPrices(c.priceCents, result.draft.condition, result.draft.age_years);
      setAsk(String(s.askCents / 100));
      setFloor(String(s.floorCents / 100));
    }
  }

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    if (!result) return;
    setBusy("Publishing…");
    setError(null);
    const res = await fetch("/api/listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description,
        facts,
        photos: result.photos,
        askCents: dollarsToCents(ask),
        floorCents: dollarsToCents(floor),
        newPriceCents: picked && picked !== "none" ? picked.priceCents : null,
        productUrl: picked && picked !== "none" ? picked.url : null,
      }),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) return setError(data.error ?? "Something went wrong.");
    router.push(`/seller?created=${data.id}`);
  }

  // Step 1: photos and a note.
  if (!result) {
    return (
      <form onSubmit={analyze} className="space-y-4 rounded-xl border border-line bg-white p-5">
        <label className="block">
          <span className="text-sm font-medium">Photos (up to 4)</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 4))}
            className="mt-1 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-soft file:px-3 file:py-2 file:text-brand"
          />
        </label>
        {files.length > 0 && (
          <div className="flex gap-2">
            {files.map((f) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={f.name} src={URL.createObjectURL(f)} alt="" className="h-20 w-20 rounded-lg object-cover" />
            ))}
          </div>
        )}
        <label className="block">
          <span className="text-sm font-medium">A few words about it</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Grey sofa, bought last year for $280, no pets, has to go this week"
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>
        {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <button
          disabled={Boolean(busy) || files.length === 0}
          className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ?? "Write my listing"}
        </button>
      </form>
    );
  }

  const prices = result.candidates.map((c) => c.priceCents);
  const askCents = dollarsToCents(ask);
  const floorCents = dollarsToCents(floor);

  // Steps 2 and 3: check the listing, pick the product, set prices.
  return (
    <form onSubmit={publish} className="space-y-6">
      <section className="space-y-3 rounded-xl border border-line bg-white p-5">
        <div className="flex gap-2">
          {result.photos.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={p} src={`/api/photos/${p}`} alt="" className="h-20 w-20 rounded-lg object-cover" />
          ))}
        </div>
        <p className="text-xs text-muted">
          Written by your assistant from the photos. Condition: {CONDITION_LABEL[result.draft.condition]}. Edit anything.
        </p>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-line px-3 py-2 font-medium outline-none focus:border-brand"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <div className="grid grid-cols-2 gap-2">
          {facts.map((f, i) => (
            <label key={i} className="text-xs text-muted">
              {f.label}
              <input
                value={f.value}
                onChange={(e) => setFacts(facts.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                className="mt-0.5 w-full rounded-lg border border-line px-2 py-1 text-sm text-ink outline-none focus:border-brand"
              />
            </label>
          ))}
        </div>
        {result.draft.mismatch_notes.length > 0 && (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Worth mentioning to buyers:</p>
            {result.draft.mismatch_notes.map((n) => (
              <p key={n}>• {n}</p>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-white p-5">
        <div>
          <p className="font-medium">Which one is yours?</p>
          <p className="text-sm text-muted">Today&apos;s new prices, found by Channel3 from your photo. Pick the closest match.</p>
        </div>
        {result.candidates.length === 0 && (
          <p className="text-sm text-muted">No matches found. Set your own price below.</p>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {result.candidates.map((c) => (
            <button
              type="button"
              key={c.url}
              onClick={() => pick(c)}
              className={`rounded-xl border p-2 text-left text-sm transition ${
                picked === c ? "border-brand ring-2 ring-brand-soft" : "border-line hover:border-brand"
              }`}
            >
              {c.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.imageUrl} alt="" className="mb-2 aspect-square w-full rounded-lg bg-paper object-contain" />
              )}
              <p className="line-clamp-2 font-medium">{c.title}</p>
              <p className="text-muted">
                {money(c.priceCents)} new · {c.store}
              </p>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => pick("none")}
          className={`text-sm underline ${picked === "none" ? "text-brand" : "text-muted"}`}
        >
          None of these
        </button>
        {picked === "none" && prices.length > 0 && (
          <p className="text-sm text-muted">
            Similar items sell new for {money(Math.min(...prices))}–{money(Math.max(...prices))}. That&apos;s a wide range, so
            set the price you think is fair.
          </p>
        )}
      </section>

      {picked && (
        <section className="space-y-3 rounded-xl border border-line bg-white p-5">
          {picked !== "none" && (
            <p className="text-sm">
              It&apos;s <span className="font-semibold">{money(picked.priceCents)}</span> new today. For a{" "}
              {CONDITION_LABEL[result.draft.condition].toLowerCase()} one, we suggest asking{" "}
              <span className="font-semibold">{money(askCents)}</span>, with a lowest price of{" "}
              <span className="font-semibold">{money(floorCents)}</span>.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Asking price
              <input
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                inputMode="decimal"
                placeholder="150"
                className="mt-1 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-brand"
              />
            </label>
            <label className="text-sm">
              Lowest you&apos;ll take (private)
              <input
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                inputMode="decimal"
                placeholder="110"
                className="mt-1 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-brand"
              />
            </label>
          </div>
          <p className="text-xs text-muted">Buyers never see your lowest price. Your assistant won&apos;t go below it.</p>
          {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          <button
            disabled={Boolean(busy) || !ask || !floor}
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ?? "Publish listing"}
          </button>
        </section>
      )}
    </form>
  );
}
