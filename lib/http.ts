import { NextResponse } from "next/server";
import { DealError } from "./deals";
import { PayPalError } from "./paypal";

// Wraps a route handler: known errors become clean JSON, everything else a 500.
export async function handle(fn: () => Promise<unknown>) {
  try {
    return NextResponse.json((await fn()) ?? { ok: true });
  } catch (err) {
    if (err instanceof DealError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof PayPalError) {
      console.error(err.message, JSON.stringify(err.details));
      return NextResponse.json({ error: `PayPal couldn't complete this (${err.step}). Try again.` }, { status: 502 });
    }
    console.error(err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
