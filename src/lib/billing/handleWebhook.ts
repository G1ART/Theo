import { effectFromStripeEvent, type BillingEffect } from "./events";
import type { PriceBinding } from "./catalog";
import { verifyStripeSignature } from "./signature";

export type StripeEventRecord = {
  id: string;
  type: string;
  data?: unknown;
};

export type WebhookResult = {
  status: number;
  body: Record<string, unknown>;
};

/**
 * Verifies the signature before any plan write.
 * A duplicate event id is acknowledged and not applied again.
 * A handler failure releases the id so Stripe can retry.
 */
export async function handleStripeWebhook(args: {
  rawBody: string;
  signature: string | null;
  secret: string | undefined;
  nowSec?: number;
  priceMap?: Map<string, PriceBinding>;
  claim: (eventId: string, eventType: string) => Promise<"claimed" | "duplicate" | "error">;
  apply: (effect: BillingEffect) => Promise<void>;
  release: (eventId: string) => Promise<void>;
  parse?: (raw: string) => StripeEventRecord;
}): Promise<WebhookResult> {
  const verified = verifyStripeSignature(
    args.rawBody,
    args.signature,
    args.secret,
    args.nowSec,
  );
  if (!verified.ok) {
    return { status: 400, body: { error: "invalid_signature" } };
  }

  let event: StripeEventRecord;
  try {
    event = args.parse
      ? args.parse(args.rawBody)
      : (JSON.parse(args.rawBody) as StripeEventRecord);
  } catch {
    return { status: 400, body: { error: "invalid_payload" } };
  }
  if (!event || typeof event.id !== "string" || typeof event.type !== "string") {
    return { status: 400, body: { error: "invalid_payload" } };
  }

  const claim = await args.claim(event.id, event.type);
  if (claim === "duplicate") {
    return { status: 200, body: { received: true, duplicate: true } };
  }
  if (claim === "error") {
    return { status: 500, body: { error: "claim_failed" } };
  }

  try {
    const effect = effectFromStripeEvent(event, args.priceMap ?? new Map());
    await args.apply(effect);
  } catch {
    await args.release(event.id);
    return { status: 500, body: { error: "apply_failed" } };
  }
  return { status: 200, body: { received: true } };
}
