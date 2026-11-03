import { DealError } from "./deals";

// The live demo is public and every chat message can cost an AI call (and every new listing a
// Channel3 search), so cap how fast one visitor, and everyone together, can spend.
// In memory: fine for one server; it resets when the server restarts.

type Window = { limit: number; ms: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const LIMITS = {
  messagePerVisitor: { limit: 20, ms: MINUTE },
  messagePerChat: { limit: 60, ms: DAY },
  messageEveryone: { limit: 2000, ms: DAY },
  chatPerVisitor: { limit: 15, ms: HOUR },
  draftPerVisitor: { limit: 8, ms: HOUR },
  draftEveryone: { limit: 150, ms: DAY },
  simulatePerVisitor: { limit: 4, ms: HOUR },
  simulateEveryone: { limit: 60, ms: DAY },
} satisfies Record<string, Window>;

const hits = new Map<string, number[]>();

function take(key: string, w: Window) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < w.ms);
  if (recent.length >= w.limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

// Throws a 429 the first time any of the given windows is full.
export function limit(checks: [string, Window][], message = "Slow down a little and try again in a minute.") {
  for (const [key, w] of checks) {
    if (!take(key, w)) throw new DealError(message, 429);
  }
}

// Render (and most hosts) put the visitor's address first in x-forwarded-for.
export function visitor(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}
