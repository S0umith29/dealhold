import { NextResponse } from "next/server";
import { expireStaleHolds } from "@/lib/deals";
import { sameSecret } from "@/lib/seller-auth";

// Called on a schedule (e.g. a Render cron job every hour). Protected by a shared secret.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !sameSecret(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ expired: await expireStaleHolds() });
}
