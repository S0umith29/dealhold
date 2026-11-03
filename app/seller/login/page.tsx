"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const res = await fetch("/api/seller/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        setBusy(false);
        if (!res.ok) return setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't sign in.");
        // Only go back to a page on this site.
        router.replace(next?.startsWith("/seller") ? next : "/seller");
        router.refresh();
      }}
      className="mx-auto max-w-sm space-y-3 rounded-xl border border-line bg-white p-5"
    >
      <h1 className="text-lg font-semibold">Seller sign-in</h1>
      <p className="text-sm text-muted">This is Maya&apos;s dashboard. Judges: the password is in the submission&apos;s testing instructions.</p>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        autoComplete="current-password"
        className="w-full rounded-lg border border-line px-3 py-2"
      />
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button disabled={busy || !password} className="w-full rounded-lg bg-brand px-3 py-2 font-medium text-white disabled:opacity-50">
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function SellerLogin() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
