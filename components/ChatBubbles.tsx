"use client";

import { useEffect, useRef, useState } from "react";
import { REACTIONS } from "@/lib/reactions";

export type ChatMessage = { id: number; sender: "buyer" | "agent"; text: string; reaction: string | null };

type Props = {
  messages: ChatMessage[];
  typing: boolean;
  onReact: (messageId: number, emoji: string) => void;
};

// Message-app style bubbles: grouped by sender, tail on the last bubble of a group,
// new bubbles spring in, a typing indicator while the assistant replies. No sounds.
export function ChatBubbles({ messages, typing, onReact }: Props) {
  // Messages already on screen when the chat loaded don't animate; new ones do.
  const keys = keysFor(messages);
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) seen.current = new Set(keys);
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages.length, typing]);

  // Mark rendered messages as seen after they've had their entrance.
  useEffect(() => {
    for (const k of keys) seen.current!.add(k);
  });

  // Close the reaction picker on outside tap.
  useEffect(() => {
    if (pickerFor === null) return;
    const close = () => setPickerFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [pickerFor]);

  return (
    <div className="max-h-[440px] min-h-[260px] overflow-x-hidden overflow-y-auto bg-white px-4 pt-6 pb-3">
      {messages.map((m, i) => {
        const me = m.sender === "buyer";
        const next = messages[i + 1];
        const lastOfGroup = !next || next.sender !== m.sender;
        const isNew = !seen.current!.has(keys[i]);
        return (
          <div
            key={keys[i]}
            className={`relative flex ${me ? "justify-end" : "justify-start"} ${lastOfGroup ? "mb-2" : "mb-0.5"} ${
              m.reaction ? "mt-4" : ""
            }`}
          >
            <div
              role="button"
              tabIndex={0}
              aria-label="React to this message"
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (m.id > 0) setPickerFor(m.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (m.id > 0) setPickerFor(m.id);
              }}
              className={`bubble select-text ${me ? "bubble-me" : "bubble-them"} ${lastOfGroup ? "bubble-tail" : ""} ${
                isNew ? (me ? "animate-in-me" : "animate-in-them") : ""
              }`}
            >
              <span className="relative z-10 whitespace-pre-wrap">{m.text}</span>

              {m.reaction && (
                <span
                  key={m.reaction}
                  className={`animate-pop absolute -top-4 z-20 flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-white px-1 text-sm shadow-sm ${
                    me ? "-left-3 bg-[#e9e9eb]" : "-right-3 bg-[#0a7cff]"
                  }`}
                >
                  {m.reaction}
                </span>
              )}

              {pickerFor === m.id && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className={`animate-pop absolute -top-12 z-30 flex gap-1 rounded-full bg-white px-2 py-1 shadow-lg ring-1 ring-black/5 ${
                    me ? "right-0" : "left-0"
                  }`}
                >
                  {REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => {
                        onReact(m.id, emoji);
                        setPickerFor(null);
                      }}
                      className={`h-8 w-8 rounded-full text-lg transition-transform hover:scale-125 ${
                        m.reaction === emoji ? "bg-[#0a7cff]/15" : ""
                      }`}
                      aria-label={`React ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {typing && (
        <div className="mb-2 flex justify-start">
          <div className="bubble bubble-them bubble-tail animate-in-them flex items-center gap-1 py-3" aria-label="Assistant is typing">
            <span className="typing-dot relative z-10" />
            <span className="typing-dot relative z-10" />
            <span className="typing-dot relative z-10" />
          </div>
        </div>
      )}

      {messages.length > 1 && (
        <p className="mt-1 text-center text-[11px] text-[#8e8e93]">Double-click or right-click a message to react</p>
      )}
      <div ref={bottom} />
    </div>
  );
}

// Stable key: the message's position among its sender's messages. Chats only grow, and the
// buyer's message shown instantly (temporary id) keeps the same key when the server's copy arrives,
// so it doesn't animate twice.
function keysFor(messages: ChatMessage[]) {
  const count = { buyer: 0, agent: 0 };
  return messages.map((m) => `${m.sender}-${count[m.sender]++}`);
}
