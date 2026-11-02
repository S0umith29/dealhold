import type { Message } from "@/lib/agent";

const HANDLED_BY: Record<string, string> = { ai: "AI", rules: "no AI", seller: "you" };

// Read-only view of a buyer's chat for the seller, with who handled each reply.
export function ChatTranscript({ messages, buyerName }: { messages: Message[]; buyerName: string }) {
  return (
    <div className="space-y-1 border-t border-line bg-white px-4 py-3">
      {messages.map((m, i) => {
        const buyer = m.sender === "buyer";
        const lastOfGroup = messages[i + 1]?.sender !== m.sender;
        return (
          <div key={m.id} className={`flex flex-col ${buyer ? "items-start" : "items-end"} ${lastOfGroup ? "mb-2" : ""}`}>
            <div
              className={`bubble ${buyer ? "bubble-them" : "bubble-me"} ${lastOfGroup ? "bubble-tail" : ""} ${
                m.reaction ? "mt-3" : ""
              }`}
            >
              <span className="relative z-10 whitespace-pre-wrap">{m.text}</span>
              {m.reaction && (
                <span
                  className={`absolute -top-4 z-20 flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-white px-1 text-sm shadow-sm ${
                    buyer ? "-right-3 bg-brand-soft" : "-left-3 bg-paper"
                  }`}
                >
                  {m.reaction}
                </span>
              )}
            </div>
            {lastOfGroup && (
              <span className="mt-0.5 px-1 text-[11px] text-muted">
                {buyer ? buyerName : `Your assistant${m.handled_by ? ` · ${HANDLED_BY[m.handled_by]}` : ""}`}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
