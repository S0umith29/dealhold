"use client";

import { useEffect, useState } from "react";

// The one line the seller pastes into their Facebook Marketplace post.
export function CopyLink({ listingId }: { listingId: string }) {
  const [line, setLine] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLine(`Message, haggle and reserve here, payment held by PayPal: ${window.location.origin}/l/${listingId}`);
  }, [listingId]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(line);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  return (
    <div className="flex items-center gap-2">
      <p className="flex-1 truncate rounded-lg bg-paper px-3 py-2 text-sm text-muted">{line}</p>
      <button onClick={copy} className="rounded-lg border border-line px-3 py-2 text-sm hover:border-brand">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
