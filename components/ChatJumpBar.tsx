"use client";

import { useEffect, useState } from "react";

// Phones: a pinned shortcut to the chat, hidden while the chat itself is on screen.
export function ChatJumpBar({ label }: { label: string }) {
  const [chatVisible, setChatVisible] = useState(false);

  useEffect(() => {
    const chat = document.getElementById("chat");
    if (!chat) return;
    const observer = new IntersectionObserver(([entry]) => setChatVisible(entry.isIntersecting), { threshold: 0.15 });
    observer.observe(chat);
    return () => observer.disconnect();
  }, []);

  return (
    <a
      href="#chat"
      onClick={(e) => {
        e.preventDefault();
        document.getElementById("chat")?.scrollIntoView({ block: "start" });
      }}
      aria-hidden={chatVisible}
      className={`fixed inset-x-4 bottom-4 z-40 rounded-full bg-brand px-4 py-3 text-center text-sm font-medium text-white shadow-lg transition-all duration-300 md:hidden ${
        chatVisible ? "pointer-events-none translate-y-6 opacity-0" : "opacity-100"
      }`}
    >
      {label}
    </a>
  );
}
