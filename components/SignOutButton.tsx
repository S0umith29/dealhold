"use client";

import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/seller/login", { method: "DELETE" });
        router.replace("/");
        router.refresh();
      }}
      className="rounded-lg px-2 py-1.5 text-xs text-muted hover:text-ink"
    >
      Sign out
    </button>
  );
}
