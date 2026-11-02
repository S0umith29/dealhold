// Plain formula, shared by server and browser: today's new price -> suggested ask and floor.

export type Condition = "like_new" | "good" | "fair" | "worn";

// Share of the new price a used item typically keeps, by condition (rule of thumb).
const KEEPS: Record<Condition, number> = { like_new: 0.65, good: 0.55, fair: 0.4, worn: 0.25 };
const to5Dollars = (cents: number) => Math.round(cents / 500) * 500;

export function suggestPrices(newPriceCents: number, condition: Condition, ageYears: number | null) {
  // A little less for each year beyond the first.
  const ageCut = Math.max(0, (ageYears ?? 1) - 1) * 0.05;
  const keeps = Math.max(0.15, KEEPS[condition] - ageCut);
  const fair = newPriceCents * keeps;
  // Ask a bit above fair to leave room to haggle; the floor sits a bit below fair.
  return { askCents: to5Dollars(fair * 1.15), floorCents: to5Dollars(fair * 0.9), fairCents: to5Dollars(fair) };
}
