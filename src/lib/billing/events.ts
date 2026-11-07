import {
  isBillingCurrency,
  isBillingInterval,
  isSellablePlan,
  type BillingCurrency,
  type BillingInterval,
  type PriceBinding,
  type SellablePlan,
} from "./catalog";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BillingEffect =
  | { type: "ignore" }
  | {
      type: "bind";
      userId: string;
      customerId: string;
      subscriptionId: string;
      planKey: SellablePlan;
      interval: BillingInterval;
      currency: BillingCurrency;
    }
  | {
      type: "activate";
      userId: string | null;
      customerId: string | null;
      subscriptionId: string | null;
      planKey: SellablePlan;
      interval: BillingInterval;
      currency: BillingCurrency;
      validUntil: string | null;
    }
  | {
      type: "past_due";
      userId: string | null;
      customerId: string | null;
      subscriptionId: string | null;
    }
  | {
      type: "sync";
      userId: string | null;
      customerId: string | null;
      subscriptionId: string;
      planKey: SellablePlan | null;
      interval: BillingInterval | null;
      currency: BillingCurrency | null;
      status: "active" | "past_due";
      cancelAtPeriodEnd: boolean;
      validUntil: string | null;
    }
  | {
      type: "end";
      userId: string | null;
      customerId: string | null;
      subscriptionId: string | null;
    };

type Obj = Record<string, unknown>;

function asObj(value: unknown): Obj | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Obj;
}

function stripeId(value: unknown, prefix: "cus" | "sub"): string | null {
  if (typeof value === "string" && value.startsWith(`${prefix}_`)) return value;
  const obj = asObj(value);
  const id = obj?.id;
  if (typeof id === "string" && id.startsWith(`${prefix}_`)) return id;
  return null;
}

export function unixToIso(value: unknown): string | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 10_000_000_000 ? n : n * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function userIdOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return UUID.test(id) ? id : null;
}

function metaOf(source: Obj | null): Obj | null {
  if (!source) return null;
  return asObj(source.metadata);
}

function readChoice(meta: Obj | null, price: PriceBinding | null): {
  planKey: SellablePlan;
  interval: BillingInterval;
  currency: BillingCurrency;
} | null {
  if (price) {
    return { planKey: price.plan, interval: price.interval, currency: price.currency };
  }
  if (!meta) return null;
  const plan = typeof meta.plan_key === "string" ? meta.plan_key : "";
  const interval = typeof meta.interval === "string" ? meta.interval : "";
  const currency = typeof meta.currency === "string" ? meta.currency : "";
  if (!isSellablePlan(plan) || !isBillingInterval(interval) || !isBillingCurrency(currency)) {
    return null;
  }
  return { planKey: plan, interval, currency };
}

function priceIdOf(subscription: Obj): string | null {
  const items = asObj(subscription.items);
  const data = items?.data;
  if (!Array.isArray(data) || !data.length) return null;
  const first = asObj(data[0]);
  const price = first?.price;
  if (typeof price === "string" && price.startsWith("price_")) return price;
  const priceObj = asObj(price);
  const id = priceObj?.id;
  return typeof id === "string" && id.startsWith("price_") ? id : null;
}

function periodEndOfSubscription(subscription: Obj): string | null {
  const top = unixToIso(subscription.current_period_end);
  if (top) return top;
  const items = asObj(subscription.items);
  const data = items?.data;
  if (!Array.isArray(data) || !data.length) return null;
  const first = asObj(data[0]);
  return unixToIso(first?.current_period_end);
}

function invoiceMeta(invoice: Obj): Obj | null {
  return (
    metaOf(asObj(invoice.subscription_details)) ??
    metaOf(asObj(asObj(invoice.parent)?.subscription_details)) ??
    metaOf(invoice)
  );
}

function invoiceSubscriptionId(invoice: Obj): string | null {
  return (
    stripeId(invoice.subscription, "sub") ??
    stripeId(asObj(invoice.subscription_details)?.subscription, "sub") ??
    stripeId(asObj(asObj(invoice.parent)?.subscription_details)?.subscription, "sub")
  );
}

function invoicePeriodEnd(invoice: Obj): string | null {
  const lines = asObj(invoice.lines);
  const data = lines?.data;
  if (Array.isArray(data) && data.length) {
    const period = asObj(asObj(data[0])?.period);
    const fromLine = unixToIso(period?.end);
    if (fromLine) return fromLine;
  }
  return unixToIso(invoice.period_end);
}

function invoicePriceId(invoice: Obj): string | null {
  const lines = asObj(invoice.lines);
  const data = lines?.data;
  if (!Array.isArray(data)) return null;
  for (const line of data) {
    const row = asObj(line);
    const price = row?.price;
    if (typeof price === "string" && price.startsWith("price_")) return price;
    const priceId = asObj(price)?.id;
    if (typeof priceId === "string" && priceId.startsWith("price_")) return priceId;
    const details = asObj(asObj(row?.pricing)?.price_details);
    if (typeof details?.price === "string" && details.price.startsWith("price_")) {
      return details.price;
    }
  }
  return null;
}

function bindingForPrice(
  priceId: string | null,
  priceMap: Map<string, PriceBinding>,
): PriceBinding | null {
  if (!priceId) return null;
  return priceMap.get(priceId) ?? null;
}

/**
 * Maps one verified Stripe event onto an entitlement change.
 * checkout.session.completed stores ids only. The success URL is not an event.
 * collector_pro is never accepted.
 */
export function effectFromStripeEvent(
  event: unknown,
  priceMap: Map<string, PriceBinding> = new Map(),
): BillingEffect {
  const root = asObj(event);
  const type = typeof root?.type === "string" ? root.type : "";
  const object = asObj(asObj(root?.data)?.object);
  if (!object) return { type: "ignore" };

  if (type === "checkout.session.completed") {
    if (object.mode !== "subscription") return { type: "ignore" };
    const choice = readChoice(metaOf(object), null);
    const userId = userIdOf(metaOf(object)?.user_id);
    const customerId = stripeId(object.customer, "cus");
    const subscriptionId = stripeId(object.subscription, "sub");
    if (!choice || !userId || !customerId || !subscriptionId) return { type: "ignore" };
    return {
      type: "bind",
      userId,
      customerId,
      subscriptionId,
      planKey: choice.planKey,
      interval: choice.interval,
      currency: choice.currency,
    };
  }

  if (type === "invoice.paid") {
    const meta = invoiceMeta(object);
    const choice = readChoice(meta, bindingForPrice(invoicePriceId(object), priceMap));
    if (!choice) return { type: "ignore" };
    return {
      type: "activate",
      userId: userIdOf(meta?.user_id),
      customerId: stripeId(object.customer, "cus"),
      subscriptionId: invoiceSubscriptionId(object),
      planKey: choice.planKey,
      interval: choice.interval,
      currency: choice.currency,
      validUntil: invoicePeriodEnd(object),
    };
  }

  if (type === "invoice.payment_failed") {
    return {
      type: "past_due",
      userId: userIdOf(invoiceMeta(object)?.user_id),
      customerId: stripeId(object.customer, "cus"),
      subscriptionId: invoiceSubscriptionId(object),
    };
  }

  if (type === "customer.subscription.updated") {
    const subscriptionId = stripeId(object.id, "sub");
    if (!subscriptionId) return { type: "ignore" };
    const status = typeof object.status === "string" ? object.status : "";
    if (status === "canceled" || status === "incomplete_expired") {
      return {
        type: "end",
        userId: userIdOf(metaOf(object)?.user_id),
        customerId: stripeId(object.customer, "cus"),
        subscriptionId,
      };
    }
    const price = bindingForPrice(priceIdOf(object), priceMap);
    const choice = readChoice(metaOf(object), price);
    const open = status === "past_due" || status === "unpaid" || status === "incomplete";
    return {
      type: "sync",
      userId: userIdOf(metaOf(object)?.user_id),
      customerId: stripeId(object.customer, "cus"),
      subscriptionId,
      planKey: choice?.planKey ?? null,
      interval: choice?.interval ?? null,
      currency: choice?.currency ?? null,
      status: open ? "past_due" : "active",
      cancelAtPeriodEnd: object.cancel_at_period_end === true,
      validUntil: periodEndOfSubscription(object),
    };
  }

  if (type === "customer.subscription.deleted") {
    return {
      type: "end",
      userId: userIdOf(metaOf(object)?.user_id),
      customerId: stripeId(object.customer, "cus"),
      subscriptionId: stripeId(object.id, "sub"),
    };
  }

  return { type: "ignore" };
}
