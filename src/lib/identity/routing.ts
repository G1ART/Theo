/**
 * Unified auth-state router (Onboarding Identity Overhaul, Track D).
 *
 * All entry points (`/`, `/login`, `/auth/callback`, `AuthGate`,
 * `/invites/delegation`, password-login success, etc.) must route
 * through this helper so the gate precedence stays identical
 * everywhere:
 *
 *   1. No session → /login (optionally preserving `next`).
 *   2. `needs_identity_setup` → /onboarding/identity?next=...
 *   3. `needs_onboarding`     → /onboarding
 *   4. `!has_password`        → /set-password
 *   5. else                   → `next` or /feed
 */

import type { MyAuthState } from "@/lib/supabase/auth";

export const DEFAULT_DESTINATION = "/feed?tab=all&sort=latest";
export const IDENTITY_FINISH_PATH = "/onboarding/identity";
export const ONBOARDING_PATH = "/onboarding";
export const SET_PASSWORD_PATH = "/set-password";
export const LOGIN_PATH = "/login";

export type RouteOpts = {
  nextPath?: string | null;
};

/** Only allow relative, single-slash-prefixed paths. Prevents open redirect. */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || typeof next !== "string") return null;
  const trimmed = next.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  return trimmed;
}

function pickNext(opts?: RouteOpts): string {
  const safe = safeNextPath(opts?.nextPath);
  return safe ?? DEFAULT_DESTINATION;
}

function identityFinishUrl(opts?: RouteOpts): string {
  const dest = pickNext(opts);
  return `${IDENTITY_FINISH_PATH}?next=${encodeURIComponent(dest)}`;
}

/** Build the path for an unauthenticated user, preserving `next`. */
export function loginUrlWithNext(opts?: RouteOpts): string {
  const safe = safeNextPath(opts?.nextPath);
  if (!safe) return LOGIN_PATH;
  return `${LOGIN_PATH}?next=${encodeURIComponent(safe)}`;
}

/**
 * Build the sign-up (onboarding) path for a cold visitor, preserving
 * `next`. Companion to `loginUrlWithNext` — the platform's cold-visitor
 * convention is sign-up-first, so gated actions on public surfaces
 * (inline auth gate, account-only nav rows) route here with the current
 * location as `next` so the user round-trips back after joining. `next`
 * is always run through `safeNextPath` to prevent open redirects.
 */
export function onboardingUrlWithNext(opts?: RouteOpts): string {
  const safe = safeNextPath(opts?.nextPath);
  if (!safe) return ONBOARDING_PATH;
  return `${ONBOARDING_PATH}?next=${encodeURIComponent(safe)}`;
}

export type RouteDecision = { to: string };

/**
 * Decide where a signed-in user with the given auth state should
 * land.
 *
 * `state = null` happens in two very different situations:
 *   (a) no session at all → user must go to /login.
 *   (b) session exists, but the `get_my_auth_state` RPC failed
 *       transiently (schema-cache mismatch after migration, network
 *       blip, etc.).
 *
 * Callers that already confirmed a session is present should pass
 * `opts.sessionPresent = true`. In that case we fall back to the
 * default destination instead of bouncing the user to /login — that
 * bounce would otherwise loop forever whenever the RPC is temporarily
 * unhappy (the login page would just re-route them back again).
 */
export function routeByAuthState(
  state: MyAuthState | null,
  opts?: RouteOpts & { sessionPresent?: boolean }
): RouteDecision {
  if (!state) {
    if (opts?.sessionPresent) return { to: pickNext(opts) };
    return { to: loginUrlWithNext(opts) };
  }

  if (state.needs_identity_setup) {
    return { to: identityFinishUrl(opts) };
  }

  if (state.needs_onboarding) {
    return { to: ONBOARDING_PATH };
  }

  if (!state.has_password) {
    return { to: SET_PASSWORD_PATH };
  }

  return { to: pickNext(opts) };
}
