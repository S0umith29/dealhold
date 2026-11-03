// Demo of agent-to-agent buying: a buyer's own Claude assistant shops through DealHold's MCP
// server and haggles with Maya's assistant, staying inside the budget its human gave it.
// It never pays: when a price is agreed it hands back the checkout link for the human to approve.
//
// Usage: npm run ai-buyer -- [server URL] ["what to buy"]
//   npm run ai-buyer
//   npm run ai-buyer -- https://dealhold.onrender.com "a sofa, up to $125, I can pick up tomorrow"

require("dotenv").config();
const Anthropic = require("@anthropic-ai/sdk").default;

const server = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const wish = process.argv[3] ?? "a sofa for my new apartment. My budget is $125 at most, and I can pick it up tomorrow.";
const MODEL = process.env.BUYER_MODEL ?? process.env.AGENT_MODEL ?? "claude-haiku-5-5";

let rpcId = 0;
async function mcp(method, params = {}) {
  const res = await fetch(`${server}/api/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`${method}: ${data.error.message}`);
  return data.result;
}

async function main() {
  const init = await mcp("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "dealhold-ai-buyer", version: "1.0.0" },
  });
  const { tools } = await mcp("tools/list");
  const claudeTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));

  const client = new Anthropic();
  const system =
    `You are Leo's personal shopping assistant. Leo wants: ${wish}\n` +
    `Never agree to more than Leo's budget. Haggle like a polite, direct person: ask one useful question about condition, ` +
    `make a fair opening offer below budget, and mention pickup timing if it helps. Send one short message at a time. ` +
    `Stop when a price is agreed (give Leo the checkout link) or when the seller won't come within budget (tell Leo where it ended).\n\n` +
    `About this store: ${init.instructions}`;
  const messages = [{ role: "user", content: "Go ahead and try to buy it for me." }];

  console.log(`Leo's assistant (${MODEL}) shopping at ${server}\nWish: ${wish}\n`);
  for (let turn = 0; turn < 20; turn++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      output_config: { effort: "low" },
      system,
      tools: claudeTools,
      messages,
    });
    messages.push({ role: "assistant", content: response.content });

    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) console.log(`\n🤖 Leo's assistant: ${block.text.trim()}`);
    }
    if (response.stop_reason !== "tool_use") {
      if (response.stop_reason === "refusal") console.log("(the model declined to continue)");
      return;
    }

    // Run every tool call through DealHold's MCP server and send all results back in one message.
    const results = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      if (block.name === "send_message") console.log(`\n🧑 Leo's assistant → Maya's: ${block.input.message}`);
      const result = await mcp("tools/call", { name: block.name, arguments: block.input });
      const text = result.content.map((c) => c.text).join("\n");
      if (block.name === "send_message" && !result.isError) {
        const r = JSON.parse(text);
        console.log(`🛋️  Maya's assistant: ${r.assistant_reply}   [price ${r.current_price}, ${r.status}]`);
      }
      results.push({ type: "tool_result", tool_use_id: block.id, content: text, is_error: Boolean(result.isError) });
    }
    messages.push({ role: "user", content: results });
  }
  console.log("\nStopped after 20 turns.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
