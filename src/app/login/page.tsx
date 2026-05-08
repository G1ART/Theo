"use client";

/**
 * Existing-user login surface (Onboarding Front Door Finalization).
 *
 * Non-members never need to see this page — `/` and marketing links
 * route cold traffic to `/onboarding` (signup-first). This page is
 * dedicated to returning users; the passwordless option is retained
 * only as a quiet, collapsed secondary path behind a disclosure.
 *
 * Surface contract:
 *   - Primary: email + password sign-in (dominant form, single CTA)
 *   - Secondary: "Sign in without a password" disclosure → email-only
 *     form that sends a one-time sign-in link
 *   - Tertiary: "No account yet? Get started" link to `/onboarding`
 *
 * Copy rule (Track F): the word "매직링크" / "magic link" must not
 * appear in user-facing strings. Use "비밀번호 없이 로그인" and
 * "이메일 로그인 링크" instead.
 */

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useT } from "@/lib/i18n/useT";
import {
  getSession,
  getMyAuthState,
  sendMagicLink,
  signInWithPassword,
} from "@/lib/supabase/auth";
import { routeByAuthState, safeNextPath, ONBOARDING_PATH } from "@/lib/identity/routing";

const EMAIL_COOLDOWN_SEC = 30;
const RATE_LIMIT_PATTERNS = ["rate limit", "too many", "exceeded", "429", "email sending"];

function isRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return RATE_LIMIT_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const { t, locale } = useT();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Passwordless path is hidden by default — a returning user who
  // knows they want it can expand it, but cold traffic and new
  // members never trip over it.
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
    // Route through /auth/callback — same path as email link & magic link.
    // Calling getMyAuthState() immediately after signInWithPassword races
    // against the session being written to storage and returns null, which
    // falls back to /feed. /auth/callback loads with the session already
    // stored and makes the RPC call in a stable context.
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
        {/* KO: narrow measure + balanced wrapping. EN: full header width so
            "Enter your email and password to continue." stays one line on
            typical phones (no awkward break after "and"). */}
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
