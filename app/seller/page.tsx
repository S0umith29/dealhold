import { connection } from "next/server";
import { getListing, listDeals, listListings, publicDeal } from "@/lib/deals";
import { agentStats, chatMessages, getChat, listChats, openQuestions } from "@/lib/agent";
import { ChatTranscript } from "@/components/ChatTranscript";
import { money } from "@/lib/format";
import { SellerDealCard } from "@/components/SellerDealCard";
import { CopyLink } from "@/components/CopyLink";
import { QuestionCard } from "@/components/QuestionCard";

// Demo has a single seller (Maya), so no login yet.
export default async function SellerPage() {
  await connection();
  const deals = listDeals();
  const listings = listListings();
  const questions = openQuestions();
  const chats = listChats();
  const stats = agentStats();
  const open = deals.filter((d) => ["held", "approved", "locked"].includes(d.status));
  const past = deals.filter((d) => !open.includes(d));

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Hi Maya</h1>
        {open.length === 0 && questions.length === 0 && (
          <p className="text-muted">Nothing needs you right now. Your assistant is handling buyers.</p>
        )}
        {open.map((d) => (
          <SellerDealCard key={d.id} deal={publicDeal(d)} title={getListing(d.listing_id)!.title} />
        ))}
        {questions.map((q) => (
          <QuestionCard key={q.id} id={q.id} question={q.question} buyerName={getChat(q.chat_id)?.buyer_name ?? "A buyer"} />
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Your assistant</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Buyers", chats.length],
            ["Buyer messages", stats.buyer_messages ?? 0],
            ["Handled without AI", stats.by_rules ?? 0],
            ["AI calls", stats.ai_calls ?? 0],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-line bg-white p-3">
              <p className="text-2xl font-semibold">{value}</p>
              <p className="text-xs text-muted">{label}</p>
            </div>
          ))}
        </div>
        {chats.length > 0 && (
          <div className="divide-y divide-line rounded-xl border border-line bg-white text-sm">
            {chats.map((c) => (
              // Maya can open any buyer's chat to see exactly what her assistant said for her.
              <details key={c.id} className="group">
                <summary className="flex cursor-pointer list-none justify-between p-3 hover:bg-paper">
                  <span>
                    <span className="mr-2 inline-block text-muted transition-transform group-open:rotate-90">›</span>
                    {c.buyer_name}
                  </span>
                  <span className="text-muted">
                    {c.status === "agreed" && c.agreed_cents
                      ? `agreed ${money(c.agreed_cents)}, waiting for hold`
                      : c.status === "open"
                        ? `talking · offered ${money(c.counter_cents)}`
                        : c.status}
                  </span>
                </summary>
                <ChatTranscript messages={chatMessages(c.id)} buyerName={c.buyer_name} />
              </details>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Your listings</h2>
        {listings.map((l) => (
          <div key={l.id} className="space-y-2 rounded-xl border border-line bg-white p-4">
            <div className="flex justify-between">
              <span className="font-medium">{l.title}</span>
              <span className="text-sm text-muted">
                {money(l.ask_cents)} ask · {money(l.floor_cents)} floor · {l.status}
              </span>
            </div>
            <CopyLink listingId={l.id} />
          </div>
        ))}
      </section>

      {past.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Past deals</h2>
          {past.map((d) => (
            <div key={d.id} className="flex justify-between rounded-xl border border-line bg-white p-3 text-sm">
              <span>
                {d.buyer_name} · {money(d.price_cents)}
              </span>
              <span className="text-muted">
                {d.status === "completed" && d.payout_cents
                  ? `Paid ${money(d.payout_cents)}`
                  : (d.cancel_reason ?? d.status)}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
