import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingEffect } from "./events";

type Admin = SupabaseClient;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function userIdForStripe(
  admin: Admin,
  customerId: string | null,
  subscriptionId: string | null,
): Promise<string | null> {
  if (subscriptionId) {
    const { data } = await admin
      .from("entitlements")
      .select("user_id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();
    const id = (data as { user_id?: string } | null)?.user_id;
    if (id) return id;
  }
  if (customerId) {
    const { data } = await admin
      .from("entitlements")
      .select("user_id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    const id = (data as { user_id?: string } | null)?.user_id;
    if (id) return id;
  }
  return null;
}

function resolveUser(metaUser: string | null, rowUser: string | null): string | null {
  if (rowUser && metaUser && rowUser !== metaUser) return rowUser;
  return rowUser ?? metaUser;
}

/**
 * Writes subscription state only. Never writes a card number.
 * checkout bind does not raise the plan. invoice.paid does.
 */
export async function persistBillingEffect(admin: Admin, effect: BillingEffect): Promise<void> {
  if (effect.type === "ignore") return;

  const metaUser = effect.userId && UUID.test(effect.userId) ? effect.userId : null;
  const rowUser = await userIdForStripe(
    admin,
    "customerId" in effect ? effect.customerId : null,
    "subscriptionId" in effect ? effect.subscriptionId : null,
  );
  const userId = resolveUser(metaUser, rowUser);
  if (!userId) throw new Error("billing_user_missing");

  const now = new Date().toISOString();

  if (effect.type === "bind") {
    const { data: existing } = await admin
      .from("entitlements")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!existing) {
      const { error } = await admin.from("entitlements").insert({
        user_id: userId,
        plan: "free",
        status: "free",
        plan_source: "stripe",
        stripe_customer_id: effect.customerId,
        stripe_subscription_id: effect.subscriptionId,
        billing_currency: effect.currency,
        billing_interval: effect.interval,
        cancel_at_period_end: false,
        updated_at: now,
      });
      if (error) throw new Error(error.message);
      return;
    }
    const { error } = await admin
      .from("entitlements")
      .update({
        stripe_customer_id: effect.customerId,
        stripe_subscription_id: effect.subscriptionId,
        billing_currency: effect.currency,
        billing_interval: effect.interval,
        updated_at: now,
      })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return;
  }

  if (effect.type === "activate") {
    const row: Record<string, unknown> = {
      user_id: userId,
      plan: effect.planKey,
      status: "active",
      plan_source: "stripe",
      billing_currency: effect.currency,
      billing_interval: effect.interval,
      updated_at: now,
    };
    if (effect.validUntil) row.valid_until = effect.validUntil;
    if (effect.customerId) row.stripe_customer_id = effect.customerId;
    if (effect.subscriptionId) row.stripe_subscription_id = effect.subscriptionId;
    const { error } = await admin.from("entitlements").upsert(row, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return;
  }

  if (effect.type === "past_due") {
    const { error } = await admin
      .from("entitlements")
      .update({ status: "past_due", plan_source: "stripe", updated_at: now })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return;
  }

  if (effect.type === "sync") {
    const patch: Record<string, unknown> = {
      status: effect.status,
      cancel_at_period_end: effect.cancelAtPeriodEnd,
      plan_source: "stripe",
      stripe_subscription_id: effect.subscriptionId,
      updated_at: now,
    };
    if (effect.customerId) patch.stripe_customer_id = effect.customerId;
    if (effect.planKey) patch.plan = effect.planKey;
    if (effect.interval) patch.billing_interval = effect.interval;
    if (effect.currency) patch.billing_currency = effect.currency;
    if (effect.validUntil) patch.valid_until = effect.validUntil;
    const { data: existing } = await admin
      .from("entitlements")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!existing) {
      const { error } = await admin.from("entitlements").insert({
        user_id: userId,
        plan: effect.planKey ?? "free",
        ...patch,
      });
      if (error) throw new Error(error.message);
      return;
    }
    const { error } = await admin.from("entitlements").update(patch).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await admin
    .from("entitlements")
    .update({
      plan: "free",
      status: "canceled",
      cancel_at_period_end: false,
      plan_source: "stripe",
      updated_at: now,
    })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}
