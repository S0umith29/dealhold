// Developer tool: put sold demo listings back on sale so the flow can be run again.
// Deal history is kept. Listings with an open deal (reserved) are left alone.
//
// Usage: npm run reset-demo

const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");

const dbPath = process.env.DATABASE_PATH ?? path.join(__dirname, "..", "data", "dealhold.db");
const db = new DatabaseSync(dbPath, { timeout: 5000 });

const { changes } = db.prepare("UPDATE listings SET status = 'active' WHERE status = 'sold'").run();
console.log(`Put ${changes} sold listing(s) back on sale.`);
