import { supabase } from "./client";

/** Returns the canonical app origin (NEXT_PUBLIC_APP_URL) for auth redirect URLs.
 *  Falls back to window.location.origin only in local dev (no env set).
 *  This prevents Vercel preview URLs from leaking into confirmation/magic-link emails. */
function getAuthOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  return typeof window !== "undefined" ? window.location.origin : "";
}

export async function signInWithPassword(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export type SignUpMetadata = {
  username?: string;
  display_name?: string;
  main_role?: string;
  roles?: string[];
};

export async function signUpWithPassword(
  email: string,
  password: string,
  metadata?: SignUpMetadata,
  /**
   * Optional in-app path to land on after the user clicks the
   * confirmation link. Critical for delegation invite signups so the
   * `?token=` parameter survives the email round-trip:
   *   /onboarding?next=/invites/delegation?token=ABC
   *     → confirmation email → /auth/callback?next=/invites/delegation?token=ABC
   *     → identity-finish (?next=…) → /invites/delegation?token=ABC
   * Only relative paths are honored (validated via `safeNextPath`
   * upstream).
   */
  nextPath?: string | null
) {
  const base = `${getAuthOrigin()}/auth/callback`;
  const emailRedirectTo = nextPath
    ? `${base}?next=${encodeURIComponent(nextPath)}`
    : base;
  return supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo,
      ...(metadata
        ? {
            data: {
              username: metadata.username?.trim().toLowerCase(),
              display_name: metadata.display_name?.trim() || null,
              main_role: metadata.main_role || null,
              roles: Array.isArray(metadata.roles) ? metadata.roles : null,
            },
          }
        : {}),
    },
  });
}

/** @param redirectTo - Optional path (or full URL) to redirect after auth (e.g. /invites/delegation?token=...) */
export async function sendMagicLink(email: string, redirectTo?: string) {
  let url = `${getAuthOrigin()}/auth/callback`;
  if (redirectTo && typeof redirectTo === "string" && redirectTo.startsWith("/")) {
    url += "?next=" + encodeURIComponent(redirectTo);
  }
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: url },
  });
}

export async function sendPasswordReset(email: string) {
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getAuthOrigin()}/auth/reset`,
  });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getSession() {
  return supabase.auth.getSession();
}

/** Server-authoritative auth/onboarding state. Reads auth.users via SECURITY
 *  DEFINER RPC so the client cannot lie (unlike the old localStorage
 *  HAS_PASSWORD_KEY gate that used to be here).
 *
 *  New fields (Onboarding Identity Overhaul, 2026-04-21):
 *  - `display_name`: current profiles.display_name (null if row missing).
 *  - `is_placeholder_username`: DB-side canonical placeholder check.
 *  - `needs_identity_setup`: `true` whenever the user is missing a row,
 *    still holds a placeholder username, has no display_name, or is
 *    missing roles/main_role. This is the single gate the app routes on.
 */
export type MyAuthState = {
  user_id: string;
  has_password: boolean;
  is_email_confirmed: boolean;
  needs_onboarding: boolean;
  username: string | null;
  display_name: string | null;
  is_placeholder_username: boolean;
  needs_identity_setup: boolean;
};

let _identitySqlWarningShown = false;

function warnMissingIdentitySql(row: Record<string, unknown>) {
  if (_identitySqlWarningShown) return;
  _identitySqlWarningShown = true;
  // Only noisy during development/staging. Production builds stay
  // silent on purpose because this is a "setup accident" detector,
  // not an end-user concern.
  const env =
    typeof process !== "undefined" ? process.env?.NODE_ENV : undefined;
  if (env === "production") return;
  const have = Object.keys(row).sort().join(", ");
  console.warn(
    "%c[Theo] get_my_auth_state() is missing `needs_identity_setup` / `is_placeholder_username`.",
    "color:#b45309;font-weight:600",
    "\nApply supabase/migrations/20260421120000_identity_completeness.sql before testing onboarding.",
    "\nReturned columns:",
    have
  );
}

export async function getMyAuthState(): Promise<MyAuthState | null> {
  const { data, error } = await supabase.rpc("get_my_auth_state");
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (!r.user_id) return null;
  const username = r.username == null ? null : String(r.username);
  const displayName = r.display_name == null ? null : String(r.display_name);
  const needsOnboarding = !!r.needs_onboarding;
  // Server may return the new fields; if an older migration is live
  // (pre-2026-04-21), fall back to safe client defaults so the routing
  // gate still behaves.
  const hasServerIdentityFlag = typeof r.needs_identity_setup === "boolean";
  const hasServerPlaceholderFlag = typeof r.is_placeholder_username === "boolean";
  if (!hasServerIdentityFlag || !hasServerPlaceholderFlag) {
    warnMissingIdentitySql(r);
  }
  return {
    user_id: String(r.user_id),
    has_password: !!r.has_password,
    is_email_confirmed: !!r.is_email_confirmed,
    needs_onboarding: needsOnboarding,
    username,
    display_name: displayName,
    is_placeholder_username: hasServerPlaceholderFlag
      ? !!r.is_placeholder_username
      : false,
    needs_identity_setup: hasServerIdentityFlag
      ? !!r.needs_identity_setup
      : needsOnboarding,
  };
}
