import { NextResponse } from "next/server";
import {
  currencyFromCountryHeader,
  isBillingCurrency,
  priceAvailability,
  type BillingCurrency,
} from "@/lib/billing/catalog";
import { requireUserFromRequest } from "@/lib/websiteImport/supabaseServer";

export const runtime = "nodejs";

type Row = {
  plan: string;
  status: string;
  valid_until: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  billing_currency: string | null;
  billing_interval: string | null;
  cancel_at_period_end: boolean | null;
};

export async function GET(req: Request) {
  const auth = await requireUserFromRequest(req);
  if (!auth.ok) return auth.response;

  const { data } = await auth.supabase
    .from("entitlements")
    .select(
      "plan, status, valid_until, stripe_customer_id, stripe_subscription_id, billing_currency, billing_interval, cancel_at_period_end",
    )
    .eq("user_id", auth.userId)
    .maybeSingle();
  const row = (data as Row | null) ?? null;
  const billingCurrency: BillingCurrency | null =
    row?.billing_currency && isBillingCurrency(row.billing_currency) ? row.billing_currency : null;
  const currencyLocked = Boolean(row?.stripe_subscription_id) && row?.status !== "canceled";

  return NextResponse.json({
    plan: row?.plan ?? "free",
    status: row?.status ?? "free",
    validUntil: row?.valid_until ?? null,
    cancelAtPeriodEnd: row?.cancel_at_period_end === true,
    billingCurrency,
    billingInterval: row?.billing_interval === "year" ? "year" : row?.billing_interval === "month" ? "month" : null,
    suggestedCurrency: currencyFromCountryHeader(req.headers.get("x-vercel-ip-country")),
    currencyLocked,
    hasCustomer: Boolean(row?.stripe_customer_id),
    checkoutConfigured: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
    prices: priceAvailability(process.env),
  });
}
