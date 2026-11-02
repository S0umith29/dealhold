"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function QuestionCard({ id, question, buyerName }: { id: number; question: string; buyerName: string }) {
  const router = useRouter();
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/questions/${id}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) setError(data.error);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl border border-amber-300 bg-white p-4">
      <p className="text-sm text-muted">{buyerName} asked your assistant:</p>
      <p className="font-medium">{question}</p>
      <div className="flex gap-2">
        <input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Your answer (saved for every buyer)"
          maxLength={300}
          className="flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <button
          disabled={busy || !answer.trim()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Answer
        </button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </form>
  );
}
