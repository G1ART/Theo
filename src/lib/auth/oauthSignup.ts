/**
 * Google sign-up is an identity login, not a calendar connection.
 *
 * The browser asks Supabase Auth to start Google with these scopes.
 * GoTrue puts the scopes saved on the Google provider in front of
 * them, and this module cannot remove a scope added there. Leave that
 * Supabase field empty or set to `email profile`. Do not add calendar.
 *
 * A separate calendar connect, if one is added later, must not reuse
 * this helper.
 */

export const OAUTH_SIGNUP_SCOPES = "openid email profile";

export type OAuthSurface = "login" | "signup" | "onboarding";

export type OAuthCallbackKind = "org_blocked" | "cancelled" | "error";

const SURFACES = new Set<OAuthSurface>(["login", "signup", "onboarding"]);
const ATTEMPT_MAX_AGE_MS = 15 * 60 * 1000;
export const OAUTH_ATTEMPT_KEY = "theo.oauth.attempt";

export type OAuthAttempt = {
  provider: "google" | "apple";
  from: OAuthSurface;
  next: string | null;
};

/** Google signup requests a profile. Apple keeps the provider default. */
export function oauthProviderScopes(
  provider: "google" | "apple",
): string | undefined {
  if (provider === "google") return OAUTH_SIGNUP_SCOPES;
  return undefined;
}

export function buildOAuthCallbackUrl(
  origin: string,
  opts: {
    provider: "google" | "apple";
    next?: string | null;
    from?: OAuthSurface | null;
  },
): string {
  const base = origin.replace(/\/$/, "");
  const params = new URLSearchParams();
  params.set("provider", opts.provider);
  if (opts.from && SURFACES.has(opts.from)) params.set("from", opts.from);
  if (opts.next) params.set("next", opts.next);
  return `${base}/auth/callback?${params.toString()}`;
}

function paramsFrom(searchOrHash: string): URLSearchParams {
  return new URLSearchParams(searchOrHash.replace(/^[?#]/, ""));
}

/**
 * OAuth failures that should leave the callback and return to the
 * form. Email-link errors (no provider, and not org_internal) stay
 * on the callback's existing "link didn't open" screen.
 */
export function classifyOAuthCallbackFailure(
  search: string,
  hash: string,
): OAuthCallbackKind | null {
  const query = paramsFrom(search);
  const fragment = paramsFrom(hash);
  const provider = query.get("provider");
  const isOAuth = provider === "google" || provider === "apple";
  const error = (query.get("error") || fragment.get("error") || "").toLowerCase();
  const description = (
    query.get("error_description") ||
    fragment.get("error_description") ||
    query.get("error_code") ||
    fragment.get("error_code") ||
    ""
  ).toLowerCase();
  const blob = `${error} ${description}`;
  if (blob.includes("org_internal") || blob.includes("org internal")) {
    return "org_blocked";
  }
  if (!isOAuth || (!error && !description)) return null;
  if (error === "access_denied" || blob.includes("cancel")) return "cancelled";
  return "error";
}

export function oauthFailureHref(opts: {
  from?: string | null;
  next?: string | null;
  kind: OAuthCallbackKind;
}): string {
  const surface =
    opts.from === "signup"
      ? "/signup"
      : opts.from === "onboarding"
        ? "/onboarding"
        : "/login";
  const params = new URLSearchParams();
  params.set("oauth", opts.kind);
  if (opts.next) params.set("next", opts.next);
  return `${surface}?${params.toString()}`;
}

export function oauthKindFromParam(raw: string | null): OAuthCallbackKind | null {
  if (raw === "org_blocked" || raw === "cancelled" || raw === "error") return raw;
  return null;
}

export function messageKeyForOAuthCode(code: string): string {
  switch (code) {
    case "provider_not_configured":
      return "auth.loginV2.oauth.notConfigured";
    case "org_blocked":
    case "unfinished":
      return "auth.loginV2.oauth.orgBlocked";
    case "cancelled":
      return "auth.loginV2.oauth.cancelled";
    default:
      return "auth.loginV2.oauth.error";
  }
}

export function parseOAuthAttempt(raw: string, now = Date.now()): OAuthAttempt | null {
  try {
    const parsed = JSON.parse(raw) as {
      provider?: unknown;
      from?: unknown;
      next?: unknown;
      at?: unknown;
    };
    if (parsed.provider !== "google" && parsed.provider !== "apple") return null;
    if (typeof parsed.at !== "number" || now - parsed.at > ATTEMPT_MAX_AGE_MS) return null;
    const from: OAuthSurface =
      parsed.from === "signup" || parsed.from === "onboarding" || parsed.from === "login"
        ? parsed.from
        : "login";
    const next =
      typeof parsed.next === "string" &&
      parsed.next.startsWith("/") &&
      !parsed.next.startsWith("//")
        ? parsed.next
        : null;
    return { provider: parsed.provider, from, next };
  } catch {
    return null;
  }
}

export function markOAuthAttempt(attempt: OAuthAttempt): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(
    OAUTH_ATTEMPT_KEY,
    JSON.stringify({ ...attempt, at: Date.now() }),
  );
}

export function clearOAuthAttempt(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(OAUTH_ATTEMPT_KEY);
}

export function consumeOAuthAttempt(now = Date.now()): OAuthAttempt | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(OAUTH_ATTEMPT_KEY);
  sessionStorage.removeItem(OAUTH_ATTEMPT_KEY);
  if (!raw) return null;
  return parseOAuthAttempt(raw, now);
}

let mountCache: { ready: boolean; value: OAuthAttempt | null } = {
  ready: false,
  value: null,
};

/** First paint of a returned page. Strict-mode remounts reuse the value. */
export function consumeOAuthAttemptForMount(): OAuthAttempt | null {
  if (mountCache.ready) return mountCache.value;
  const value = consumeOAuthAttempt();
  mountCache = { ready: true, value };
  return value;
}

export function resetOAuthAttemptMountCache(): void {
  mountCache = { ready: false, value: null };
}
