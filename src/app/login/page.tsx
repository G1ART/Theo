"use client";

/**
 * Login surface — Signup v2 Phase 1 gap-fill + Phase 3 OAuth wiring
 * (2026-08-19).
 *
 * Two implementations coexist behind `NEXT_PUBLIC_SIGNUP_V2`:
 *
 *   - **LoginLegacyInner** — the pre-redesign returning-user surface.
 *     Preserved verbatim (form, copy, passwordless disclosure, `?next=`
 *     handling) so a flag flip back to OFF restores every existing
 *     behaviour without a code revert.
 *
 *   - **LoginV2Inner** — the wireframe front-door (spec §2.1). Uses the
 *     Signup v2 primitives (`AuthShell`, `OvalInput`, `PillButton`),
 *     ships the Quick Start OAuth cluster (Google + Apple wired via
 *     `signInWithOAuthProvider`; Kakao rendered disabled per spec §5 #5),
 *     and reuses the exact same auth capabilities as the legacy screen:
 *     `signInWithPassword`, `sendMagicLink`, `routeByAuthState`,
 *     `?next=` preservation.
 *
 * The Quick Start pills are safe to ship live even when the Supabase
 * Dashboard OAuth providers are not yet configured — the helper
 * classifies `provider_not_configured` responses into a machine-readable
 * code and the UI surfaces the `auth.loginV2.oauth.notConfigured` toast
 * without crashing.
 *
 * Copy rule (Track F): the word "매직링크" / "magic link" is never
 * user-facing. Use "비밀번호 없이 로그인" and "이메일 로그인 링크".
 */

import { FormEvent, Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useT } from "@/lib/i18n/useT";
import {
  getSession,
  getMyAuthState,
  sendMagicLink,
  signInWithPassword,
} from "@/lib/supabase/auth";
import {
  signInWithOAuthProvider,
  type OAuthProvider,
} from "@/lib/supabase/oauth";
import {
  routeByAuthState,
  safeNextPath,
  ONBOARDING_PATH,
} from "@/lib/identity/routing";
import { isSignupV2Enabled } from "@/lib/featureFlags/signupV2";
import { AuthShell } from "@/components/auth/primitives/AuthShell";
import { OvalInput } from "@/components/auth/primitives/OvalInput";
import { PillButton } from "@/components/auth/primitives/PillButton";

const EMAIL_COOLDOWN_SEC = 30;
const RATE_LIMIT_PATTERNS = ["rate limit", "too many", "exceeded", "429", "email sending"];

function isRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return RATE_LIMIT_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

// ─────────────────────────────────────────────────────────────────────
// Legacy screen (flag OFF)
// ─────────────────────────────────────────────────────────────────────

function LoginLegacyInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const { t, locale } = useT();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [passwordlessOpen, setPasswordlessOpen] = useState(false);
  const [passwordlessEmail, setPasswordlessEmail] = useState("");
  const [passwordlessSent, setPasswordlessSent] = useState(false);
  const [passwordlessCooldown, setPasswordlessCooldown] = useState(0);
  const [passwordlessError, setPasswordlessError] = useState<string | null>(null);
  const [passwordlessLoading, setPasswordlessLoading] = useState(false);

  const signupHref = nextPath
    ? `${ONBOARDING_PATH}?next=${encodeURIComponent(nextPath)}`
    : ONBOARDING_PATH;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await getSession();
      if (cancelled || !session) return;
      const state = await getMyAuthState();
      if (cancelled) return;
      const { to } = routeByAuthState(state, { nextPath, sessionPresent: true });
      router.replace(to);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, nextPath]);

  useEffect(() => {
    if (passwordlessCooldown <= 0) return;
    const handle = setInterval(() => setPasswordlessCooldown((c) => c - 1), 1000);
    return () => clearInterval(handle);
  }, [passwordlessCooldown]);

  async function handlePasswordSignIn(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: err } = await signInWithPassword(email, password);
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    const callbackUrl = nextPath
      ? `/auth/callback?next=${encodeURIComponent(nextPath)}`
      : `/auth/callback`;
    router.replace(callbackUrl);
  }

  async function handlePasswordlessLink(e: FormEvent) {
    e.preventDefault();
    setPasswordlessLoading(true);
    setPasswordlessError(null);
    const { error: err } = await sendMagicLink(
      passwordlessEmail,
      nextPath ?? undefined
    );
    setPasswordlessLoading(false);
    if (err) {
      setPasswordlessError(
        isRateLimitError(err.message)
          ? t("login.passwordlessRateLimit")
          : err.message
      );
      return;
    }
    setPasswordlessSent(true);
    setPasswordlessCooldown(EMAIL_COOLDOWN_SEC);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-4 py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-zinc-900">{t("login.title")}</h1>
        <p
          className={
            locale === "ko"
              ? "mt-2 max-w-[32ch] text-sm leading-relaxed text-zinc-600 [text-wrap:balance]"
              : "mt-2 w-full min-w-0 text-sm leading-relaxed text-zinc-600"
          }
        >
          <span className="block">{t("login.welcomeBackTitle")}</span>
          <span className="block">{t("login.welcomeBackHint")}</span>
        </p>
      </header>

      <form onSubmit={handlePasswordSignIn} className="space-y-3" noValidate>
        <div>
          <label
            htmlFor="login-email"
            className="mb-1 block text-sm font-medium text-zinc-900"
          >
            {t("login.placeholderEmail")}
          </label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("login.placeholderEmail")}
            required
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
            autoComplete="email"
          />
        </div>
        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <label
              htmlFor="login-password"
              className="block text-sm font-medium text-zinc-900"
            >
              {t("login.placeholderPassword")}
            </label>
            <Link
              href={
                email.trim()
                  ? `/auth/forgot?email=${encodeURIComponent(email.trim())}`
                  : "/auth/forgot"
              }
              className="text-xs font-medium text-zinc-500 hover:text-zinc-900"
            >
              {t("login.forgotPasswordCta")}
            </Link>
          </div>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("login.placeholderPassword")}
            required
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
            autoComplete="current-password"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? t("common.loading") : t("login.signIn")}
        </button>
      </form>

      <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
        <button
          type="button"
          onClick={() => setPasswordlessOpen((v) => !v)}
          aria-expanded={passwordlessOpen}
          aria-controls="login-passwordless"
          className="font-medium text-zinc-600 hover:text-zinc-900"
        >
          {passwordlessOpen ? t("login.passwordlessClose") : t("login.passwordlessOpen")}
        </button>
      </div>

      {passwordlessOpen && (
        <div
          id="login-passwordless"
          className="mt-3 rounded-md border border-zinc-200 bg-zinc-50/70 p-3"
        >
          <p className="text-xs text-zinc-600">{t("login.passwordlessHint")}</p>
          {passwordlessSent ? (
            <p className="mt-2 text-sm text-emerald-700">{t("login.passwordlessSent")}</p>
          ) : (
            <form onSubmit={handlePasswordlessLink} className="mt-2 space-y-2" noValidate>
              <input
                type="email"
                value={passwordlessEmail}
                onChange={(e) => setPasswordlessEmail(e.target.value)}
                placeholder={t("login.placeholderEmail")}
                required
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
                autoComplete="email"
              />
              {passwordlessError && (
                <p role="alert" className="text-xs text-red-600">
                  {passwordlessError}
                </p>
              )}
              <button
                type="submit"
                disabled={passwordlessLoading || passwordlessCooldown > 0}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {passwordlessCooldown > 0
                  ? `${t("login.passwordlessSend")} (${passwordlessCooldown}s)`
                  : t("login.passwordlessSend")}
              </button>
            </form>
          )}
        </div>
      )}

      <p className="mt-10 text-center text-sm text-zinc-600">
        {t("login.noAccount")}{" "}
        <Link
          href={signupHref}
          className="font-semibold text-zinc-900 underline underline-offset-4 hover:text-zinc-700"
        >
          {t("login.startSignup")}
        </Link>
      </p>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────
// V2 screen (flag ON, spec §2.1)
// ─────────────────────────────────────────────────────────────────────

/** Lightweight inline toast — mounted at the top of the AuthShell body.
 *  We deliberately avoid pulling in a global toast provider (none
 *  exists in this codebase yet); a simple auto-dismissing banner is
 *  enough for the OAuth error / passwordless success signals. */
function OAuthToast({
  message,
  onDismiss,
  tone,
}: {
  message: string;
  tone: "error" | "info";
  onDismiss: () => void;
}) {
  useEffect(() => {
    const handle = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(handle);
  }, [message, onDismiss]);
  const toneClass =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-zinc-200 bg-zinc-50 text-zinc-700";
  return (
    <div
      role="status"
      aria-live="polite"
      className={`mb-6 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${toneClass}`}
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-xs font-medium text-current opacity-70 hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}

type QuickStartPill = {
  provider: OAuthProvider | "kakao";
  label: string;
  disabled?: boolean;
  disabledTooltip?: string;
};

function LoginV2Inner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const { t } = useT();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Passwordless swap — mirrors the legacy disclosure pattern: click
  // "Log in without a password" and the password field is replaced by
  // an email-only magic-link submit. "Use password instead" returns.
  const [passwordless, setPasswordless] = useState(false);
  const [passwordlessSent, setPasswordlessSent] = useState(false);
  const [passwordlessCooldown, setPasswordlessCooldown] = useState(0);
  const [passwordlessLoading, setPasswordlessLoading] = useState(false);

  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    tone: "error" | "info";
  } | null>(null);

  const signupHref = nextPath ? `/signup?next=${encodeURIComponent(nextPath)}` : "/signup";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await getSession();
      if (cancelled || !session) return;
      const state = await getMyAuthState();
      if (cancelled) return;
      const { to } = routeByAuthState(state, { nextPath, sessionPresent: true });
      router.replace(to);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, nextPath]);

  useEffect(() => {
    if (passwordlessCooldown <= 0) return;
    const handle = setInterval(() => setPasswordlessCooldown((c) => c - 1), 1000);
    return () => clearInterval(handle);
  }, [passwordlessCooldown]);

  const dismissToast = useCallback(() => setToast(null), []);

  async function handlePasswordSignIn(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: err } = await signInWithPassword(email.trim(), password);
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    const callbackUrl = nextPath
      ? `/auth/callback?next=${encodeURIComponent(nextPath)}`
      : `/auth/callback`;
    router.replace(callbackUrl);
  }

  async function handleMagicLink(e: FormEvent) {
    e.preventDefault();
    setPasswordlessLoading(true);
    setError(null);
    const { error: err } = await sendMagicLink(email.trim(), nextPath ?? undefined);
    setPasswordlessLoading(false);
    if (err) {
      setError(
        isRateLimitError(err.message)
          ? t("login.passwordlessRateLimit")
          : err.message
      );
      return;
    }
    setPasswordlessSent(true);
    setPasswordlessCooldown(EMAIL_COOLDOWN_SEC);
  }

  async function handleOAuth(provider: OAuthProvider) {
    setOauthLoading(provider);
    setError(null);
    const { error: err } = await signInWithOAuthProvider(provider, {
      next: nextPath,
    });
    if (err) {
      setOauthLoading(null);
      const messageKey: string =
        err.code === "provider_not_configured"
          ? "auth.loginV2.oauth.notConfigured"
          : err.code === "cancelled"
          ? "auth.loginV2.oauth.cancelled"
          : "auth.loginV2.oauth.error";
      setToast({ message: t(messageKey), tone: "error" });
      return;
    }
    // Success = full-page redirect to provider. Keep loading state
    // truthy so the button stays disabled until the browser navigates
    // away. If the user comes back via the browser back button, the
    // page will re-mount and the state resets.
  }

  const quickStartPills: QuickStartPill[] = [
    { provider: "google", label: t("auth.loginV2.quickStart.google") },
    { provider: "apple", label: t("auth.loginV2.quickStart.apple") },
    {
      provider: "kakao",
      label: t("auth.loginV2.quickStart.kakao"),
      disabled: true,
      disabledTooltip: t("auth.loginV2.quickStart.disabledTooltip"),
    },
  ];

  const forgotHref = email.trim()
    ? `/auth/forgot?email=${encodeURIComponent(email.trim())}`
    : "/auth/forgot";

  return (
    <AuthShell
      title={
        // Wireframe polish (2026-08-19): the H1 bumped from
        // text-3xl/text-4xl → text-4xl/text-5xl. `max-w-[16ch]` on the
        // wrapper keeps the two taglines on their own lines even at
        // 48px on narrow viewports (both strings are ≤15 chars).
        <span className="block max-w-[16ch] leading-tight">
          <span className="block">{t("auth.loginV2.tagline1")}</span>
          <span className="block">{t("auth.loginV2.tagline2")}</span>
        </span>
      }
      subtitle={t("auth.loginV2.subhead")}
      footer={
        <p className="text-center text-[11px] leading-relaxed text-zinc-500">
          {t("auth.loginV2.footnote.consent")}
        </p>
      }
    >
      {toast && (
        <OAuthToast
          message={toast.message}
          tone={toast.tone}
          onDismiss={dismissToast}
        />
      )}

      {passwordless ? (
        <form onSubmit={handleMagicLink} className="space-y-5" noValidate>
          <p className="text-sm text-zinc-600">
            {t("auth.loginV2.passwordless.subhead")}
          </p>
          <OvalInput
            label={t("auth.loginV2.email")}
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            inputMode="email"
            required
            autoFocus
          />
          {passwordlessSent ? (
            <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {t("auth.loginV2.passwordless.sent")}
            </p>
          ) : null}
          {error && !passwordlessSent && (
            <p role="alert" className="px-5 text-sm text-red-600">
              {error}
            </p>
          )}
          <PillButton
            type="submit"
            variant="primary"
            fullWidth
            loading={passwordlessLoading}
            disabled={
              passwordlessSent ||
              passwordlessCooldown > 0 ||
              !email.trim()
            }
          >
            {passwordlessCooldown > 0
              ? `${t("auth.loginV2.passwordless.submit")} (${passwordlessCooldown}s)`
              : t("auth.loginV2.passwordless.submit")}
          </PillButton>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center text-xs text-zinc-500">
            <button
              type="button"
              onClick={() => {
                setPasswordless(false);
                setPasswordlessSent(false);
                setError(null);
              }}
              className="font-medium text-zinc-600 hover:text-zinc-900"
            >
              {t("auth.loginV2.passwordless.back")}
            </button>
            <span aria-hidden className="text-zinc-300">
              ·
            </span>
            <Link
              href={signupHref}
              className="font-medium text-zinc-900 underline-offset-2 hover:underline"
            >
              {t("auth.loginV2.signupLink")}
            </Link>
          </div>
        </form>
      ) : (
        <form onSubmit={handlePasswordSignIn} className="space-y-5" noValidate>
          <OvalInput
            label={t("auth.loginV2.email")}
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            inputMode="email"
            required
            autoFocus
          />
          <div>
            <OvalInput
              label={t("auth.loginV2.password")}
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              required
            />
            <div className="mt-1 flex justify-end px-5">
              <Link
                href={forgotHref}
                className="text-xs font-medium text-zinc-500 hover:text-zinc-900"
              >
                {t("auth.loginV2.forgot")}
              </Link>
            </div>
          </div>

          {error && (
            <p role="alert" className="px-5 text-sm text-red-600">
              {error}
            </p>
          )}

          <PillButton
            type="submit"
            variant="primary"
            fullWidth
            loading={loading}
            disabled={!email.trim() || !password}
          >
            {loading ? t("auth.loginV2.submitting") : t("auth.loginV2.submit")}
          </PillButton>

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center text-xs text-zinc-500">
            <button
              type="button"
              onClick={() => {
                setPasswordless(true);
                setError(null);
              }}
              className="font-medium text-zinc-600 hover:text-zinc-900"
            >
              {t("auth.loginV2.passwordless.link")}
            </button>
            <span aria-hidden className="text-zinc-300">
              ·
            </span>
            <Link
              href={signupHref}
              className="font-medium text-zinc-900 underline-offset-2 hover:underline"
            >
              {t("auth.loginV2.signupLink")}
            </Link>
          </div>
        </form>
      )}

      <div className="mt-10">
        <p className="mb-3 text-center text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-500">
          {t("auth.loginV2.quickStart.label")}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {quickStartPills.map((pill) => {
            if (pill.disabled) {
              return (
                <PillButton
                  key={pill.provider}
                  variant="secondary"
                  disabled
                  aria-disabled
                  title={pill.disabledTooltip}
                  className="!px-3 opacity-60"
                >
                  {pill.label}
                </PillButton>
              );
            }
            const provider = pill.provider as OAuthProvider;
            const isLoading = oauthLoading === provider;
            return (
              <PillButton
                key={pill.provider}
                variant="secondary"
                onClick={() => handleOAuth(provider)}
                loading={isLoading}
                disabled={oauthLoading !== null && !isLoading}
                className="!px-3"
              >
                {pill.label}
              </PillButton>
            );
          })}
        </div>
      </div>
    </AuthShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────────

function LoginInner() {
  // `NEXT_PUBLIC_SIGNUP_V2` is inlined at build time; the branch is
  // decided once per bundle, so the extra call is essentially free.
  const v2 = isSignupV2Enabled();
  return v2 ? <LoginV2Inner /> : <LoginLegacyInner />;
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center px-4">
          <h1 className="mb-6 text-xl font-semibold">Log in</h1>
          <p className="text-zinc-500">Loading...</p>
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}
