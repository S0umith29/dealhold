import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

// SQLite file for local dev and the demo. Money is stored in cents.
const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "dealhold.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  seller_name TEXT NOT NULL,
  seller_paypal_email TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  facts TEXT NOT NULL,             -- JSON object of known facts
  ask_cents INTEGER NOT NULL,
  floor_cents INTEGER NOT NULL,    -- private: never sent to buyers
  status TEXT NOT NULL DEFAULT 'active'  -- active | reserved | sold
);

CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  buyer_name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  status TEXT NOT NULL,            -- held | approved | completed | cancelled | locked
  cancel_reason TEXT,
  paypal_order_id TEXT NOT NULL UNIQUE,
  paypal_auth_id TEXT NOT NULL,
  paypal_capture_id TEXT,
  payout_batch_id TEXT,
  payout_cents INTEGER,
  pickup_code_hash TEXT NOT NULL,
  code_attempts INTEGER NOT NULL DEFAULT 0,
  hold_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function seed(d: DatabaseSync) {
  const exists = d.prepare("SELECT 1 FROM listings WHERE id = ?").get("sofa-123");
  if (exists) return;
  d.prepare(
    `INSERT INTO listings (id, seller_name, seller_paypal_email, title, description, facts, ask_cents, floor_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "sofa-123",
    "Maya",
    process.env.SELLER_EMAIL ?? "",
    "Grey 3-seat sofa",
    "Comfy grey fabric sofa, bought last year. Moving out, so it has to go this week.",
    JSON.stringify({
      Size: "80 in wide, 35 in deep",
      Age: "1 year",
      Condition: "Good, no stains or tears",
      Pets: "No pets",
      Smoking: "Non-smoking home",
      Pickup: "Buyer picks up, ground floor",
    }),
    15000,
    11000
  );
}

function open() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const d = new DatabaseSync(dbPath, { timeout: 5000 });
  d.exec("PRAGMA journal_mode = WAL;");
  d.exec(SCHEMA);
  seed(d);
  return d;
}

// Opened on first use (not at import, so parallel build workers don't fight over the file),
// and reused across hot reloads in dev.
const globalForDb = globalThis as unknown as { dealholdDb?: DatabaseSync };
export function db() {
  globalForDb.dealholdDb ??= open();
  return globalForDb.dealholdDb;
}
