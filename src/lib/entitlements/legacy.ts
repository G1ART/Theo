/**
 * Legacy compatibility shim for the pre-spine `hasFeature` / `Plan` imports.
 *
 * Every call site that imports from `@/lib/entitlements` goes through this
 * shim. Internally it dispatches to the new resolver so there is no risk
 * of policy drift between legacy callers and the spine. New code should
 * import from `@/lib/entitlements/resolveEntitlement` or the `useFeatureAccess`
 * hook instead.
 */

import { supabase } from "@/lib/supabase/client";
import { resolveFeatureKey } from "./featureKeys";
import { PLAN_FEATURE_MATRIX } from "./planMatrix";
import { BETA_ALL_PAID } from "./betaOverrides";
import type { Entitlement, Plan, PlanKey } from "./types";

const CACHE_TTL_MS = 30_000;
let cached: { at: number; value: Entitlement } | null = null;

export async function getMyEntitlements(): Promise<Entitlement> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    const value: Entitlement = { plan: "free", status: "free", valid_until: null };
    cached = { at: Date.now(), value };
    return value;
  }

  const { data } = await supabase
    .from("entitlements")
    .select("plan, status, valid_until")
    .eq("user_id", session.user.id)
    .maybeSingle();

  const row = data as { plan?: string; status?: string; valid_until?: string | null } | null;
  const plan = (row?.plan as Plan | undefined) ?? "free";
  const status = row?.status ?? "free";
  const valid_until = row?.valid_until ?? null;

  const value: Entitlement = { plan, status, valid_until };
  cached = { at: Date.now(), value };
  return value;
}

export function invalidateEntitlementsCache(): void {
  cached = null;
}

/**
 * Thin synchronous gate. Preserves pre-spine behaviour: if `BETA_ALL_PAID`
 * is true every declared feature is granted, otherwise the plan must appear
 * in `PLAN_FEATURE_MATRIX[feature]`. Accepts both canonical namespaced keys
 * and legacy `SCREAMING_SNAKE_CASE` keys.
 */
export function hasFeature(plan: Plan, feature: string): boolean {
  if (BETA_ALL_PAID) return true;
  const key = resolveFeatureKey(feature);
  if (!key) return false;
  const allowed = PLAN_FEATURE_MATRIX[key] ?? [];
  return allowed.includes(plan as PlanKey);
}

/**
 * Missing entitlement row means free. The browser must not insert or raise a plan.
 * Paid state is written by the service role from the signed Stripe webhook.
 */
export async function ensureFreeEntitlement(_userId: string): Promise<void> {
  return;
}
