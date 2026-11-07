import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  allPriceEnvNames,
  checkoutBlock,
  currencyFromCountryHeader,
  priceEnvName,
  readPriceId,
} from "../src/lib/billing/catalog";
import { effectFromStripeEvent, unixToIso } from "../src/lib/billing/events";
import { handleStripeWebhook } from "../src/lib/billing/handleWebhook";
import { verifyStripeSignature } from "../src/lib/billing/signature";
import { blockedBrowserWrite } from "../src/lib/supabase/browserWriteGuard";

const USER = "11111111-1111-4111-8111-111111111111";
const SECRET = "whsec_test_secret";

function sign(payload: string, secret: string, timestamp: number): string {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

const now = 1_700_000_000;

{
  const payload = "{}";
  assert.equal(verifyStripeSignature(payload, null, SECRET, now).ok, false);
  assert.equal(verifyStripeSignature(payload, sign(payload, "other", now), SECRET, now).ok, false);
  assert.equal(verifyStripeSignature(payload, sign(payload, SECRET, now - 10_000), SECRET, now).ok, false);
  assert.equal(verifyStripeSignature(payload, "t=1", SECRET, now).ok, false);
  const header = sign(payload, SECRET, now);
  assert.equal(verifyStripeSignature(payload, header, SECRET, now).ok, true);
  const wrong = header.replace("v1=", "v1=00");
  const bad = verifyStripeSignature(payload, `${wrong},${header}`, SECRET, now);
  assert.equal(bad.ok, true);
}

{
  assert.equal(currencyFromCountryHeader("KR"), "krw");
  assert.equal(currencyFromCountryHeader("kr"), "krw");
  assert.equal(currencyFromCountryHeader("US"), "usd");
  assert.equal(currencyFromCountryHeader(null), "usd");
  assert.equal(currencyFromCountryHeader(""), "usd");
  assert.equal(currencyFromCountryHeader("JP"), "usd");
}

{
  const names = allPriceEnvNames();
  assert.equal(names.length, 16);
  assert.equal(names.includes(priceEnvName("artist_pro", "month", "usd")), true);
  assert.equal(names.includes(priceEnvName("gallery_workspace", "year", "krw")), true);
  assert.equal(names.some((name) => name.includes("COLLECTOR")), false);
  assert.equal(readPriceId({ STRIPE_PRICE_ARTIST_PRO_MONTH_USD: "" }, "artist_pro", "month", "usd"), null);
  assert.equal(readPriceId({ STRIPE_PRICE_ARTIST_PRO_MONTH_USD: "1000" }, "artist_pro", "month", "usd"), null);
  assert.equal(
    readPriceId({ STRIPE_PRICE_ARTIST_PRO_MONTH_USD: "price_test_123" }, "artist_pro", "month", "usd"),
    "price_test_123",
  );
}

{
  assert.equal(
    checkoutBlock(
      { plan: "artist_pro", status: "active", stripe_subscription_id: "sub_1", billing_currency: "krw" },
      "usd",
    ),
    "currency_locked",
  );
  assert.equal(
    checkoutBlock(
      { plan: "artist_pro", status: "active", stripe_subscription_id: "sub_1", billing_currency: "usd" },
      "usd",
    ),
    "already_subscribed",
  );
  assert.equal(
    checkoutBlock(
      { plan: "free", status: "canceled", stripe_subscription_id: "sub_1", billing_currency: "krw" },
      "usd",
    ),
    null,
  );
  assert.equal(
    checkoutBlock(
      { plan: "free", status: "free", stripe_subscription_id: "sub_1", billing_currency: "usd" },
      "usd",
    ),
    "checkout_pending",
  );
}

const periodEnd = 1_800_000_000;
const meta = {
  user_id: USER,
  plan_key: "artist_pro",
  interval: "month",
  currency: "usd",
};

{
  const effect = effectFromStripeEvent({
    id: "evt_checkout",
    type: "checkout.session.completed",
    data: {
      object: {
        mode: "subscription",
        customer: "cus_1",
        subscription: "sub_1",
        metadata: meta,
      },
    },
  });
  assert.equal(effect.type, "bind");
  if (effect.type === "bind") {
    assert.equal(effect.planKey, "artist_pro");
    assert.equal("status" in effect, false);
  }
}

{
  const effect = effectFromStripeEvent({
    id: "evt_paid",
    type: "invoice.paid",
    data: {
      object: {
        customer: "cus_1",
        subscription: "sub_1",
        subscription_details: { metadata: meta },
        lines: { data: [{ period: { end: periodEnd } }] },
      },
    },
  });
  assert.equal(effect.type, "activate");
  if (effect.type === "activate") {
    assert.equal(effect.planKey, "artist_pro");
    assert.equal(effect.validUntil, unixToIso(periodEnd));
  }
}

{
  const effect = effectFromStripeEvent({
    id: "evt_fail",
    type: "invoice.payment_failed",
    data: {
      object: {
        customer: "cus_1",
        subscription: "sub_1",
        subscription_details: { metadata: meta },
      },
    },
  });
  assert.equal(effect.type, "past_due");
}

{
  const effect = effectFromStripeEvent({
    id: "evt_cancel_later",
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_1",
        customer: "cus_1",
        status: "active",
        cancel_at_period_end: true,
        current_period_end: periodEnd,
        metadata: { ...meta, plan_key: "discovery_pro", interval: "year", currency: "krw" },
      },
    },
  });
  assert.equal(effect.type, "sync");
  if (effect.type === "sync") {
    assert.equal(effect.status, "active");
    assert.equal(effect.cancelAtPeriodEnd, true);
    assert.equal(effect.planKey, "discovery_pro");
    assert.notEqual(effect.planKey, "free");
  }
}

{
  const effect = effectFromStripeEvent(
    {
      id: "evt_price",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          cancel_at_period_end: false,
          metadata: meta,
          items: { data: [{ price: { id: "price_hybrid" } }] },
        },
      },
    },
    new Map([["price_hybrid", { plan: "hybrid_pro", interval: "year", currency: "krw" }]]),
  );
  assert.equal(effect.type, "sync");
  if (effect.type === "sync") assert.equal(effect.planKey, "hybrid_pro");
}

{
  const effect = effectFromStripeEvent({
    id: "evt_deleted",
    type: "customer.subscription.deleted",
    data: { object: { id: "sub_1", customer: "cus_1", metadata: meta } },
  });
  assert.equal(effect.type, "end");
}

{
  const effect = effectFromStripeEvent({
    id: "evt_legacy",
    type: "invoice.paid",
    data: {
      object: {
        customer: "cus_1",
        subscription: "sub_1",
        subscription_details: { metadata: { ...meta, plan_key: "collector_pro" } },
      },
    },
  });
  assert.equal(effect.type, "ignore");
}

async function webhookCases() {
  const payload = JSON.stringify({
    id: "evt_dup",
    type: "invoice.paid",
    data: {
      object: {
        customer: "cus_1",
        subscription: "sub_1",
        subscription_details: { metadata: meta },
        lines: { data: [{ period: { end: periodEnd } }] },
      },
    },
  });
  const seen = new Set<string>();
  let applied = 0;
  const args = {
    rawBody: payload,
    signature: sign(payload, SECRET, now),
    secret: SECRET,
    nowSec: now,
    claim: async (id: string) => {
      if (seen.has(id)) return "duplicate" as const;
      seen.add(id);
      return "claimed" as const;
    },
    apply: async () => {
      applied += 1;
    },
    release: async () => {
      seen.delete("evt_dup");
    },
  };
  const first = await handleStripeWebhook(args);
  const second = await handleStripeWebhook(args);
  assert.equal(first.status, 200);
  assert.equal(first.body.duplicate, undefined);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(applied, 1);

  let claims = 0;
  const bad = await handleStripeWebhook({
    ...args,
    signature: sign(payload, "nope", now),
    claim: async () => {
      claims += 1;
      return "claimed";
    },
  });
  assert.equal(bad.status, 400);
  assert.equal(claims, 0);

  assert.equal(blockedBrowserWrite("https://example.supabase.co/rest/v1/entitlements?on_conflict=user_id", "POST"), "entitlements");
  assert.equal(blockedBrowserWrite("https://example.supabase.co/rest/v1/entitlements?select=plan", "GET"), null);
  assert.equal(blockedBrowserWrite("https://example.supabase.co/rest/v1/profiles", "PATCH"), "profiles");

  const page = readFileSync("src/app/settings/billing/page.tsx", "utf8");
  const checkout = readFileSync("src/app/api/billing/checkout/route.ts", "utf8");
  const webhook = readFileSync("src/app/api/billing/webhook/route.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20261106180000_billing_subscription_state.sql", "utf8");
  assert.match(page, /get\("checkout"\)/);
  assert.match(page, /flag === "success"/);
  assert.equal(page.includes('from("entitlements")'), false);
  assert.equal(page.includes("plan_source"), false);
  assert.match(checkout, /checkout=success/);
  assert.match(checkout, /metadata\[user_id\]/);
  assert.match(checkout, /metadata\[currency\]/);
  assert.match(webhook, /verifyStripeSignature|handleStripeWebhook/);
  assert.equal(webhook.includes("searchParams"), false);
  assert.equal(migration.toLowerCase().includes("card_number"), false);
  assert.equal(migration.toLowerCase().includes("cvc"), false);
  const beta = readFileSync("src/lib/entitlements/betaOverrides.ts", "utf8");
  assert.match(beta, /BETA_ALL_PAID = true/);
}

webhookCases()
  .then(() => {
    console.log("billing-stripe.test.ts: ok");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
