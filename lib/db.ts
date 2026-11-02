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

-- One chat per buyer per listing, run by the seller's agent.
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  buyer_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',   -- open | agreed | reserved | closed
  round INTEGER NOT NULL DEFAULT 0,      -- buyer offers so far
  counter_cents INTEGER NOT NULL,        -- the agent's current price
  agreed_cents INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL REFERENCES chats(id),
  sender TEXT NOT NULL,                  -- buyer | agent
  text TEXT NOT NULL,
  handled_by TEXT,                       -- rules | ai | seller (agent messages only)
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Questions the agent couldn't answer from the facts. Asked once, answer reused.
CREATE TABLE IF NOT EXISTS seller_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  chat_id TEXT NOT NULL REFERENCES chats(id),
  question TEXT NOT NULL,
  answer TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at TEXT
);
`;

// Columns added after the first version; ALTER fails harmlessly if already there.
const MIGRATIONS = [
  "ALTER TABLE deals ADD COLUMN chat_id TEXT REFERENCES chats(id)",
  "ALTER TABLE chats ADD COLUMN last_offer_cents INTEGER",
];

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
  for (const sql of MIGRATIONS) {
    try {
      d.exec(sql);
    } catch {}
  }
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
