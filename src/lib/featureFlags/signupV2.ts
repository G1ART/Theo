/**
 * Signup v2 feature flag.
 *
 * Phase 0 (2026-08-20): env-driven boolean only. `NEXT_PUBLIC_SIGNUP_V2`
 * defaults to `"false"`; set to `"true"` in `.env.local` (dev) or
 * Vercel Production/Preview envs to expose the new signup wizard.
 *
 * TODO (Phase 6 rollout): extend with a cookie-based bucket split
 * (e.g. stable hash of `sb-visitor-id` cookie → 0..99) so we can
 * ramp to 10% → 50% → 100% of anonymous traffic without a redeploy.
 * Keep the return type as `boolean` so call-sites don't have to
 * change when the internal logic grows.
 *
 * Callers should treat this as UI-only gating. The Signup v2 schema
 * (full_name, tos_accepted_at, profile_completed_at) ships regardless
 * of the flag — legacy pages simply leave those columns NULL.
 */
export function isSignupV2Enabled(): boolean {
  return process.env.NEXT_PUBLIC_SIGNUP_V2 === "true";
}
