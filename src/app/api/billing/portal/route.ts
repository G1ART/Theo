import { NextResponse } from "next/server";
import { publicAppOrigin } from "@/lib/billing/catalog";
import { isStripeHostedUrl, stripeRequest, withtheoPortalConfiguration } from "@/lib/billing/stripeApi";
import { requireUserFromRequest } from "@/lib/websiteImport/supabaseServer";

export const runtime = "nodejs";

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

  let locale: "ko" | "en" | null = null;
  try {
    const body = (await req.json()) as { locale?: unknown };
    if (body.locale === "ko" || body.locale === "en") locale = body.locale;
  } catch {
    locale = null;
  }

  const { data } = await auth.supabase
    .from("entitlements")
    .select("stripe_customer_id")
    .eq("user_id", auth.userId)
    .maybeSingle();
  const customerId = (data as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? null;
  if (!customerId) return json(409, { error: "no_customer" });

  const configuration = await withtheoPortalConfiguration(secret);
  if (!configuration) return json(502, { error: "stripe_rejected" });

  const fields: Record<string, string> = {
    customer: customerId,
    return_url: `${origin}/settings/billing`,
    configuration,
  };
  if (locale) fields.locale = locale;

  const created = await stripeRequest(secret, "POST", "/billing_portal/sessions", fields);
  if (!created.ok) return json(502, { error: "stripe_rejected" });
  const url = typeof created.body.url === "string" ? created.body.url : "";
  if (!isStripeHostedUrl(url, "portal")) return json(502, { error: "stripe_rejected" });
  return json(200, { url });
}
