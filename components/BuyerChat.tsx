"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";
import { PICKER_EMOJIS } from "@/lib/reactions";
import { ChatBubbles, type ChatMessage } from "./ChatBubbles";
import { PayPalHoldButton } from "./PayPalHoldButton";

type ChatView = {
  id: string;
  buyerName: string;
  status: "open" | "agreed" | "reserved" | "closed";
  agreedCents: number | null;
  messages: ChatMessage[];
};

type Props = {
  listingId: string;
  sellerName: string;
  askCents: number;
  listingStatus: "active" | "reserved" | "sold";
  paypalClientId: string;
};

async function call<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
  return data as T;
}

const storageKey = (listingId: string) => `dealhold-chat-${listingId}`;

export function BuyerChat({ listingId, sellerName, askCents, listingStatus, paypalClientId }: Props) {
  const router = useRouter();
  const [chat, setChat] = useState<ChatView | null>(null);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [holding, setHolding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close the emoji picker on an outside tap.
  useEffect(() => {
    if (!emojiOpen) return;
    const close = () => setEmojiOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [emojiOpen]);

  async function react(messageId: number, emoji: string) {
    if (!chat) return;
    // Show it immediately; the server's copy replaces it.
    setChat({
      ...chat,
      messages: chat.messages.map((m) =>
        m.id === messageId ? { ...m, reaction: m.reaction === emoji ? null : emoji } : m
      ),
    });
    try {
      setChat(await call<ChatView>(`/api/chats/${chat.id}/messages/${messageId}/reaction`, "POST", { emoji }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Resume this device's chat for the listing, if any.
  useEffect(() => {
    let saved: string | null = null;
    try {
      // A checkout link from the buyer's AI assistant (?chat=...) opens the chat it negotiated.
      const linked = new URLSearchParams(window.location.search).get("chat");
      if (linked) localStorage.setItem(storageKey(listingId), linked);
      saved = localStorage.getItem(storageKey(listingId));
    } catch {}
    if (saved) {
      call<ChatView>(`/api/chats/${saved}`)
        .then(setChat)
        .catch(() => {
          // The chat no longer exists (e.g. demo reset): start fresh.
          try {
            localStorage.removeItem(storageKey(listingId));
          } catch {}
        });
    }
  }, [listingId]);

  // Poll for answers the seller sends later.
  useEffect(() => {
    if (!chat || chat.status === "reserved" || chat.status === "closed") return;
    const t = setInterval(() => call<ChatView>(`/api/chats/${chat.id}`).then(setChat).catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [chat?.id, chat?.status]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try {
      const c = await call<ChatView>(`/api/listings/${listingId}/chats`, "POST", { buyerName: name });
      try {
        localStorage.setItem(storageKey(listingId), c.id);
      } catch {}
      setChat(c);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!chat || !draft.trim() || sending) return;
    const text = draft;
    setDraft("");
    setSending(true);
    setError(null);
    // Show the buyer's message right away.
    setEmojiOpen(false);
    setChat({ ...chat, messages: [...chat.messages, { id: -Date.now(), sender: "buyer", text, reaction: null }] });
    try {
      setChat(await call<ChatView>(`/api/chats/${chat.id}/messages`, "POST", { text }));
    } catch (err) {
      setError((err as Error).message);
      call<ChatView>(`/api/chats/${chat.id}`).then(setChat).catch(() => {});
    } finally {
      setSending(false);
    }
  }

  if (listingStatus !== "active" && !chat) {
    return (
      <div className="rounded-xl border border-line bg-white p-4">
        <p className="font-medium">{listingStatus === "sold" ? "Sold" : "Reserved"}</p>
        <p className="text-sm text-muted">
          {listingStatus === "sold" ? "This item has been sold." : "Someone has reserved this item. Check back later."}
        </p>
      </div>
    );
  }

  if (!chat) {
    return (
      <form onSubmit={start} className="space-y-3 rounded-xl border border-line bg-white p-4">
        <div>
          <p className="text-sm text-muted">Asking price</p>
          <p className="text-2xl font-semibold">{money(askCents)}</p>
        </div>
        <p className="text-sm text-muted">
          Chat with {sellerName}&apos;s assistant: ask questions, make an offer, then reserve with a PayPal hold.
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={40}
          className="w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-brand"
        />
        <button
          disabled={!name.trim()}
          className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Start chatting
        </button>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </form>
    );
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-white">
      <div className="border-b border-line px-4 py-3">
        <p className="font-medium">{sellerName}&apos;s assistant</p>
        <p className="text-xs text-muted">
          Replies for {sellerName}. Asks {sellerName} when it doesn&apos;t know. {sellerName} can read this chat.
        </p>
      </div>

      <ChatBubbles messages={chat.messages} typing={sending} onReact={react} />

      {error && <p className="mx-4 mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {chat.status === "agreed" && chat.agreedCents && listingStatus === "active" && (
        <div className="space-y-2 border-t border-line bg-brand-soft/40 p-4">
          <p className="text-sm">
            Reserve for <span className="font-semibold">{money(chat.agreedCents)}</span>. PayPal holds it; you&apos;re
            only charged after pickup.
          </p>
          {holding && <p className="text-sm text-muted">Placing your hold…</p>}
          <PayPalHoldButton
            clientId={paypalClientId}
            createOrder={async () => {
              setError(null);
              const { orderId } = await call<{ orderId: string }>(`/api/chats/${chat.id}/order`, "POST");
              return orderId;
            }}
            onApprove={async (orderId) => {
              setHolding(true);
              try {
                const { dealId, code } = await call<{ dealId: string; code: string }>(
                  `/api/orders/${orderId}/authorize`,
                  "POST"
                );
                // The code is shown once; keep it on this device for the deal page.
                try {
                  localStorage.setItem(`dealhold-code-${dealId}`, code);
                } catch {}
                router.push(`/d/${dealId}`);
              } catch (err) {
                setError((err as Error).message);
                setHolding(false);
              }
            }}
            onError={setError}
          />
        </div>
      )}

      {(chat.status === "open" || chat.status === "agreed") && (
        <form onSubmit={send} className="relative flex items-center gap-2 border-t border-line p-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setEmojiOpen((o) => !o);
            }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg transition-transform hover:scale-110"
            aria-label="Add an emoji"
          >
            😊
          </button>
          {emojiOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="animate-pop absolute bottom-14 left-3 z-30 grid grid-cols-6 gap-1 rounded-2xl bg-white p-2 shadow-lg ring-1 ring-black/5"
            >
              {PICKER_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    setDraft((d) => d + emoji);
                    inputRef.current?.focus();
                  }}
                  className="h-9 w-9 rounded-lg text-xl transition-transform hover:scale-125"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask a question or make an offer…"
            maxLength={500}
            className="flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button
            disabled={!draft.trim() || sending}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Send
          </button>
        </form>
      )}
    </div>
  );
}
