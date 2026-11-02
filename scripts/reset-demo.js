// Developer tool: reset the demo so the whole flow can be run again.
// Puts sold listings back on sale and clears buyer chats and seller questions.
// Deal history is kept. Listings with an open deal (reserved) are left alone.
//
// Usage: npm run reset-demo

const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");

const dbPath = process.env.DATABASE_PATH ?? path.join(__dirname, "..", "data", "dealhold.db");
const db = new DatabaseSync(dbPath, { timeout: 5000 });

const { changes } = db.prepare("UPDATE listings SET status = 'active' WHERE status = 'sold'").run();
const chats = db.prepare("SELECT COUNT(*) AS n FROM chats").get().n;
// Past deals keep their buyer name and price but lose the link to the deleted chat.
db.exec(
  "UPDATE deals SET chat_id = NULL; DELETE FROM seller_questions; DELETE FROM messages; DELETE FROM chats;"
);

console.log(`Put ${changes} sold listing(s) back on sale and cleared ${chats} buyer chat(s).`);
