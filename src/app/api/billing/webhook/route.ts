import { NextResponse } from "next/server";
import { priceMapFromEnv } from "@/lib/billing/catalog";
import { handleStripeWebhook } from "@/lib/billing/handleWebhook";
import { persistBillingEffect } from "@/lib/billing/persist";
import { claimStripeEvent, releaseStripeEvent } from "@/lib/billing/webhookStore";
import { getServiceClient } from "@/lib/supabase/serviceClient";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = getServiceClient();
  if (!admin) {
    return NextResponse.json({ error: "billing_not_configured" }, { status: 500 });
  }
  const rawBody = await req.text();
  const result = await handleStripeWebhook({
    rawBody,
    signature: req.headers.get("stripe-signature"),
    secret: process.env.STRIPE_WEBHOOK_SECRET?.trim() || undefined,
    priceMap: priceMapFromEnv(process.env),
    claim: (eventId, eventType) => claimStripeEvent(admin, eventId, eventType),
    apply: (effect) => persistBillingEffect(admin, effect),
    release: (eventId) => releaseStripeEvent(admin, eventId),
  });
  return NextResponse.json(result.body, { status: result.status });
}
