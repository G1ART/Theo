import { NextResponse } from "next/server";
import {
  checkoutBlock,
  currencyFromCountryHeader,
  isBillingCurrency,
  isBillingInterval,
  isSellablePlan,
  publicAppOrigin,
  readPriceId,
  type BillingCurrency,
} from "@/lib/billing/catalog";
import { isStripeHostedUrl, stripeRequest } from "@/lib/billing/stripeApi";
import { requireUserFromRequest } from "@/lib/websiteImport/supabaseServer";

export const runtime = "nodejs";

type BillingRow = {
  plan: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  billing_currency: string | null;
};

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  const auth = await requireUserFromRequest(req);
  if (!auth.ok) return auth.response;

  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) return json(503, { error: "billing_not_configured" });

  const origin = publicAppOrigin();
  if (!origin) return json(503, { error: "app_origin_missing" });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const plan = typeof record.plan_key === "string" ? record.plan_key : "";
  const interval = typeof record.interval === "string" ? record.interval : "";
  const requestedCurrency =
    typeof record.currency === "string" && record.currency
      ? record.currency
      : currencyFromCountryHeader(req.headers.get("x-vercel-ip-country"));
  const locale = record.locale === "ko" || record.locale === "en" ? record.locale : null;

  if (!isSellablePlan(plan)) return json(400, { error: "invalid_plan" });
  if (!isBillingInterval(interval)) return json(400, { error: "invalid_interval" });
  if (!isBillingCurrency(requestedCurrency)) return json(400, { error: "invalid_currency" });

  const price = readPriceId(process.env, plan, interval, requestedCurrency);
  if (!price) return json(503, { error: "price_not_configured" });

  const { data } = await auth.supabase
    .from("entitlements")
    .select("plan, status, stripe_customer_id, stripe_subscription_id, billing_currency")
    .eq("user_id", auth.userId)
    .maybeSingle();
  const row = (data as BillingRow | null) ?? null;
  const block = checkoutBlock(
    row
      ? {
          plan: row.plan,
          status: row.status,
          stripe_subscription_id: row.stripe_subscription_id,
          billing_currency: row.billing_currency,
        }
      : null,
    requestedCurrency as BillingCurrency,
  );
  if (block) return json(409, { error: block });

  const reuseCustomer =
    row?.stripe_customer_id &&
    (!row.billing_currency || row.billing_currency === requestedCurrency)
      ? row.stripe_customer_id
      : null;

  let email: string | null = null;
  if (!reuseCustomer) {
    const { data: userData } = await auth.supabase.auth.getUser();
    const candidate = userData.user?.email?.trim() ?? "";
    if (candidate.includes("@")) email = candidate;
  }

  const fields: Record<string, string> = {
    mode: "subscription",
    success_url: `${origin}/settings/billing?checkout=success`,
    cancel_url: `${origin}/settings/billing?checkout=cancel`,
    client_reference_id: auth.userId,
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    "metadata[user_id]": auth.userId,
    "metadata[plan_key]": plan,
    "metadata[interval]": interval,
    "metadata[currency]": requestedCurrency,
    "subscription_data[metadata][user_id]": auth.userId,
    "subscription_data[metadata][plan_key]": plan,
    "subscription_data[metadata][interval]": interval,
    "subscription_data[metadata][currency]": requestedCurrency,
    "payment_method_types[0]": "card",
  };
  if (requestedCurrency === "krw") fields["payment_method_types[1]"] = "kr_card";
  if (locale) fields.locale = locale;
  if (reuseCustomer) fields.customer = reuseCustomer;
  else if (email) fields.customer_email = email;

  const created = await stripeRequest(secret, "POST", "/checkout/sessions", fields);
  if (!created.ok) return json(502, { error: "stripe_rejected" });
  const url = typeof created.body.url === "string" ? created.body.url : "";
  if (!isStripeHostedUrl(url, "checkout")) return json(502, { error: "stripe_rejected" });
  return json(200, { url });
}
