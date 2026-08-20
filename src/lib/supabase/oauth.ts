/**
 * OAuth sign-in helper — Signup v2 Phase 3 (2026-08-19).
 *
 * Thin wrapper over `supabase.auth.signInWithOAuth` that:
 *   - Builds the `/auth/callback` redirect URL using the same
 *     `getAuthOrigin()` helper as the password + magic-link flows so
 *     Vercel preview URLs never leak into provider consent screens.
 *   - Preserves the caller's `?next=` deep-link (invite token flows,
 *     onboarding resume, etc.) exactly the way `sendMagicLink` does.
 *   - Adds a `provider` marker to the callback URL so the auth callback
 *     page can distinguish "this session just came back from OAuth"
 *     from "this session just came back from an email confirmation
 *     link" and seed `profiles.full_name` from provider metadata.
 *   - Normalizes Supabase's "provider disabled" / "provider not
 *     configured" errors into a machine-readable `provider_not_configured`
 *     code so the UI can render the "이 로그인 방식은 아직 준비 중입니다."
 *     toast without pattern-matching English strings.
 *
 * This helper is intentionally *not* feature-flag gated — it's a plain
 * utility. Only the pill buttons that call it live behind
 * `isSignupV2Enabled()` (see login page + SignupStep1Email).
 *
 * Kakao is deliberately omitted (spec §5 #5 — deferred).
 */

import { supabase } from "./client";
import { getAuthOrigin } from "./auth";
import { safeNextPath } from "@/lib/identity/routing";

export type OAuthProvider = "google" | "apple";

export type SignInWithOAuthProviderOptions = {
  /** In-app path to land on after the auth callback resolves. Only
   *  relative single-slash paths are honored — anything else falls back
   *  to the default post-auth destination. */
  next?: string | null;
};

/** Machine-readable error codes surfaced to the UI. */
export type OAuthErrorCode =
  | "provider_not_configured"
  | "cancelled"
  | "network"
  | "unknown";

export type OAuthError = Error & { code: OAuthErrorCode };

/** Substrings Supabase / GoTrue return when a provider is disabled or
 *  missing client credentials in the dashboard. Kept lowercased and
 *  loose because the exact wording changes across GoTrue versions. */
const PROVIDER_DISABLED_PATTERNS = [
  "provider is not enabled",
  "provider not enabled",
  "unsupported provider",
  "provider_not_configured",
  "provider disabled",
  "not enabled",
  "not configured",
];

const CANCELLED_PATTERNS = [
  "cancel",
  "cancelled",
  "canceled",
  "access_denied",
  "user denied",
];

const NETWORK_PATTERNS = [
  "network",
  "fetch failed",
  "failed to fetch",
  "networkerror",
];

function classifyError(raw: unknown): OAuthError {
  const message =
    (raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "")
      ?.toString()
      .trim() || "OAuth request failed";
  const lower = message.toLowerCase();
  let code: OAuthErrorCode = "unknown";
  if (PROVIDER_DISABLED_PATTERNS.some((p) => lower.includes(p))) {
    code = "provider_not_configured";
  } else if (CANCELLED_PATTERNS.some((p) => lower.includes(p))) {
    code = "cancelled";
  } else if (NETWORK_PATTERNS.some((p) => lower.includes(p))) {
    code = "network";
  }
  const err = new Error(message) as OAuthError;
  err.code = code;
  return err;
}

/** Kick off an OAuth redirect. Resolves with `{ error }` where the
 *  error (if any) carries a machine-readable `.code`. Success is a
 *  full-page redirect to the provider — the calling component should
 *  keep a `loading` state until the browser navigates away. */
export async function signInWithOAuthProvider(
  provider: OAuthProvider,
  opts: SignInWithOAuthProviderOptions = {},
): Promise<{ error: OAuthError | null }> {
  const safeNext = safeNextPath(opts.next);
  // The `provider` query param lets `/auth/callback` route OAuth
  // sessions through the "seed full_name / send to Step 3" branch
  // without probing every session for identities on every callback.
  const callbackParams = new URLSearchParams();
  callbackParams.set("provider", provider);
  if (safeNext) callbackParams.set("next", safeNext);
  const redirectTo = `${getAuthOrigin()}/auth/callback?${callbackParams.toString()}`;

  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    });
    if (error) return { error: classifyError(error) };
    return { error: null };
  } catch (raw) {
    return { error: classifyError(raw) };
  }
}
