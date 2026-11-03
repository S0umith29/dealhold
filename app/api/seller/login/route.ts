import { DealError } from "@/lib/deals";
import { handle } from "@/lib/http";
import { limit, visitor } from "@/lib/limits";
import { signIn, signOut } from "@/lib/seller-auth";

const MINUTE = 60_000;

// Seller signs in with SELLER_PASSWORD. Guessing is slowed down per visitor and overall.
export async function POST(req: Request) {
  return handle(async () => {
    limit(
      [
        [`login:${visitor(req)}`, { limit: 5, ms: MINUTE }],
        ["login-all", { limit: 60, ms: MINUTE }],
      ],
      "Too many tries. Wait a minute."
    );
    const { password } = (await req.json().catch(() => ({}))) as { password?: string };
    if (!(await signIn(String(password ?? "").slice(0, 200)))) throw new DealError("Wrong password.", 401);
  });
}

export async function DELETE() {
  return handle(async () => {
    await signOut();
  });
}
