/**
 * Sellable plans already named in the entitlement matrix.
 * collector_pro is legacy and is not a Stripe product.
 * Amounts are not in code. A price id is used only when it looks like
 * Stripe's price_… id. Test and live values share these names and
 * differ by environment later.
 */

export const SELLABLE_PLANS = [
  "artist_pro",
  "discovery_pro",
  "hybrid_pro",
  "gallery_workspace",
] as const;

export type SellablePlan = (typeof SELLABLE_PLANS)[number];
export type BillingInterval = "month" | "year";
export type BillingCurrency = "usd" | "krw";

const PRICE_ID = /^price_[A-Za-z0-9_]+$/;

export function isSellablePlan(value: string): value is SellablePlan {
  return (SELLABLE_PLANS as readonly string[]).includes(value);
}

export function isBillingInterval(value: string): value is BillingInterval {
  return value === "month" || value === "year";
}

export function isBillingCurrency(value: string): value is BillingCurrency {
  return value === "usd" || value === "krw";
}

export function priceEnvName(
  plan: SellablePlan,
  interval: BillingInterval,
  currency: BillingCurrency,
): string {
  const intervalPart = interval === "month" ? "MONTH" : "YEAR";
  return `STRIPE_PRICE_${plan.toUpperCase()}_${intervalPart}_${currency.toUpperCase()}`;
}

export function allPriceEnvNames(): string[] {
  const names: string[] = [];
  for (const plan of SELLABLE_PLANS) {
    for (const interval of ["month", "year"] as const) {
      for (const currency of ["usd", "krw"] as const) {
        names.push(priceEnvName(plan, interval, currency));
      }
    }
  }
  return names;
}

export function readPriceId(
  env: Record<string, string | undefined>,
  plan: SellablePlan,
  interval: BillingInterval,
  currency: BillingCurrency,
): string | null {
  const raw = env[priceEnvName(plan, interval, currency)]?.trim() ?? "";
  return PRICE_ID.test(raw) ? raw : null;
}

export type PriceBinding = {
  plan: SellablePlan;
  interval: BillingInterval;
  currency: BillingCurrency;
};

export function priceMapFromEnv(
  env: Record<string, string | undefined>,
): Map<string, PriceBinding> {
  const map = new Map<string, PriceBinding>();
  for (const plan of SELLABLE_PLANS) {
    for (const interval of ["month", "year"] as const) {
      for (const currency of ["usd", "krw"] as const) {
        const id = readPriceId(env, plan, interval, currency);
        if (id) map.set(id, { plan, interval, currency });
      }
    }
  }
  return map;
}

export function priceAvailability(
  env: Record<string, string | undefined>,
): Record<SellablePlan, Record<BillingInterval, Record<BillingCurrency, boolean>>> {
  const out = {} as Record<
    SellablePlan,
    Record<BillingInterval, Record<BillingCurrency, boolean>>
  >;
  for (const plan of SELLABLE_PLANS) {
    out[plan] = {
      month: {
        usd: readPriceId(env, plan, "month", "usd") != null,
        krw: readPriceId(env, plan, "month", "krw") != null,
      },
      year: {
        usd: readPriceId(env, plan, "year", "usd") != null,
        krw: readPriceId(env, plan, "year", "krw") != null,
      },
    };
  }
  return out;
}

/**
 * Korea is won. Any other country, or a missing country, is dollars.
 * Screen language is not an input.
 */
export function currencyFromCountryHeader(
  country: string | null | undefined,
): BillingCurrency {
  return (country ?? "").trim().toUpperCase() === "KR" ? "krw" : "usd";
}

export function publicAppOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export type EntitlementBillingRow = {
  plan: string;
  status: string;
  stripe_subscription_id: string | null;
  billing_currency: string | null;
};

export type CheckoutBlock =
  | "currency_locked"
  | "already_subscribed"
  | "checkout_pending";

/**
 * An open Stripe subscription keeps its currency.
 * A canceled row can start again, and the plan screen may pick either currency.
 */
export function checkoutBlock(
  row: EntitlementBillingRow | null,
  requested: BillingCurrency,
): CheckoutBlock | null {
  if (!row?.stripe_subscription_id) return null;
  if (row.status === "canceled") return null;
  const stored = isBillingCurrency(row.billing_currency ?? "")
    ? row.billing_currency
    : null;
  if (stored && stored !== requested) return "currency_locked";
  if (row.status === "free") return "checkout_pending";
  return "already_subscribed";
}
