"use client";

/**
 * Login — the front door users actually hit.
 *
 * Password sign-in, the passwordless disclosure, unconfirmed-email
 * wait, and Google OAuth all stay on the helpers this page already
 * used. The layout follows the login comp: logo, two short lines, a
 * longer line, oval fields, black Log in, then Quick Start.
 */

import { FormEvent, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { EmailConfirmWait } from "@/components/auth/EmailConfirmWait";
import { GoogleStartButton } from "@/components/auth/GoogleStartButton";
import { AuthShell } from "@/components/auth/primitives/AuthShell";
import { OvalInput } from "@/components/auth/primitives/OvalInput";
import { PillButton } from "@/components/auth/primitives/PillButton";
import { useT } from "@/lib/i18n/useT";
import {
  getSession,
  getMyAuthState,
  sendMagicLink,
  signInWithPassword,
  isUnconfirmedAuthError,
  deliverSignupConfirmation,
} from "@/lib/supabase/auth";
import { signInWithOAuthProvider } from "@/lib/supabase/oauth";
import { routeByAuthState, safeNextPath } from "@/lib/identity/routing";
import { isSignupV2Enabled } from "@/lib/featureFlags/signupV2";

const EMAIL_COOLDOWN_SEC = 30;
const RATE_LIMIT_PATTERNS = ["rate limit", "too many", "exceeded", "429", "email sending"];

function isRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return RATE_LIMIT_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

function useLoginEmail(searchParams: { get: (key: string) => string | null }) {
  const seeded = searchParams.get("email")?.trim() ?? "";
  const [email, setEmail] = useState(seeded);
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current) return;
    const fromQuery = searchParams.get("email")?.trim() ?? "";
    if (!fromQuery) return;
    applied.current = true;
    setEmail((prev) => (prev.trim() ? prev : fromQuery));
  }, [searchParams]);
  return [email, setEmail] as const;
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const { t } = useT();

  const [email, setEmail] = useLoginEmail(searchParams);
  const finishedNotice = searchParams.get("notice") === "finished";
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);

  const [passwordlessOpen, setPasswordlessOpen] = useState(false);
  const [passwordlessSent, setPasswordlessSent] = useState(false);
  const [passwordlessCooldown, setPasswordlessCooldown] = useState(0);
  const [passwordlessError, setPasswordlessError] = useState<string | null>(null);
  const [passwordlessLoading, setPasswordlessLoading] = useState(false);

  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const signupBase = isSignupV2Enabled() ? "/signup" : "/onboarding";
  const signupHref = nextPath
    ? `${signupBase}?next=${encodeURIComponent(nextPath)}`
    : signupBase;

  const forgotHref = email.trim()
    ? `/auth/forgot?email=${encodeURIComponent(email.trim())}`
    : "/auth/forgot";

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

  const goToCallback = useCallback(() => {
    const callbackUrl = nextPath
      ? `/auth/callback?next=${encodeURIComponent(nextPath)}`
      : `/auth/callback`;
    router.replace(callbackUrl);
  }, [nextPath, router]);

  async function handlePasswordSignIn(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: err } = await signInWithPassword(email.trim(), password);
    setLoading(false);
    if (err) {
      if (isUnconfirmedAuthError(err)) {
        setUnconfirmed(true);
        setError(null);
        void deliverSignupConfirmation(email.trim(), nextPath);
        return;
      }
      setUnconfirmed(false);
      setError(err.message);
      return;
    }
    goToCallback();
  }

  async function handlePasswordlessLink(e: FormEvent) {
    e.preventDefault();
    setPasswordlessLoading(true);
    setPasswordlessError(null);
    const { error: err } = await sendMagicLink(email.trim(), nextPath ?? undefined);
    setPasswordlessLoading(false);
    if (err) {
      setPasswordlessError(
        isRateLimitError(err.message) ? t("login.passwordlessRateLimit") : err.message,
      );
      return;
    }
    setPasswordlessSent(true);
    setPasswordlessCooldown(EMAIL_COOLDOWN_SEC);
  }

  async function handleGoogle() {
    setOauthLoading(true);
    setOauthError(null);
    const { error: err } = await signInWithOAuthProvider("google", { next: nextPath });
    if (err) {
      setOauthLoading(false);
      const messageKey =
        err.code === "provider_not_configured"
          ? "auth.loginV2.oauth.notConfigured"
          : err.code === "cancelled"
            ? "auth.loginV2.oauth.cancelled"
            : "auth.loginV2.oauth.error";
      setOauthError(t(messageKey));
    }
  }

  return (
    <AuthShell brandPlacement="hero" contentWidth="sm">
      <div className="mb-10 text-sm leading-relaxed text-zinc-800">
        <p>{t("auth.loginV2.tagline1")}</p>
        <p>{t("auth.loginV2.tagline2")}</p>
        <p className="mt-4">{t("auth.loginV2.subhead")}</p>
      </div>

      {finishedNotice ? (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-zinc-800">
          {t("login.finishedAccountNotice")}
        </p>
      ) : null}

      <form onSubmit={handlePasswordSignIn} className="space-y-4" noValidate>
        <OvalInput
          labelStyle="outer"
          density="compact"
          label={t("auth.loginV2.email")}
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          inputMode="email"
          required
          hideRequiredMark
        />
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 px-1">
            <label htmlFor="login-password" className="text-xs text-zinc-600">
              {t("auth.loginV2.password")}
            </label>
            <Link
              href={forgotHref}
              className="text-xs text-zinc-500 hover:text-zinc-900"
            >
              {t("login.forgotPasswordCta")}
            </Link>
          </div>
          <OvalInput
            id="login-password"
            labelStyle="outer"
            density="compact"
            label={null}
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            required
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <PillButton type="submit" variant="primary" fullWidth loading={loading}>
          {loading ? t("auth.loginV2.submitting") : t("auth.loginV2.submit")}
        </PillButton>
      </form>

      <div className="mt-4 flex items-center justify-between gap-3 text-[13px] text-zinc-700">
        <button
          type="button"
          onClick={() => setPasswordlessOpen((v) => !v)}
          aria-expanded={passwordlessOpen}
          aria-controls="login-passwordless"
          className="text-left hover:text-zinc-900"
        >
          {t("auth.loginV2.passwordless.link")}
        </button>
        <span className="text-right">
          {t("auth.loginV2.newToTheo")}{" "}
          <Link href={signupHref} className="font-semibold text-zinc-900 hover:text-zinc-700">
            {t("auth.loginV2.signUpCta")}
          </Link>
        </span>
      </div>

      {passwordlessOpen && (
        <div id="login-passwordless" className="mt-3">
          <p className="text-xs text-zinc-600">{t("auth.loginV2.passwordless.subhead")}</p>
          {passwordlessSent ? (
            <p className="mt-2 text-sm text-emerald-700">{t("auth.loginV2.passwordless.sent")}</p>
          ) : (
            <form onSubmit={handlePasswordlessLink} className="mt-2 space-y-2" noValidate>
              {passwordlessError ? (
                <p role="alert" className="text-xs text-red-600">
                  {passwordlessError}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={passwordlessLoading || passwordlessCooldown > 0 || !email.trim()}
                className="text-xs font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {passwordlessCooldown > 0
                  ? `${t("auth.loginV2.passwordless.submit")} (${passwordlessCooldown}s)`
                  : t("auth.loginV2.passwordless.submit")}
              </button>
            </form>
          )}
        </div>
      )}

      <div className="mt-12 text-center">
        <p className="mb-3 text-[13px] text-zinc-700">{t("auth.loginV2.quickStart.label")}</p>
        <GoogleStartButton onClick={() => void handleGoogle()} loading={oauthLoading} />
        {oauthError ? (
          <p role="alert" className="mt-3 text-xs text-red-600">
            {oauthError}
          </p>
        ) : null}
      </div>

      {unconfirmed ? (
        <EmailConfirmWait
          email={email}
          password={password}
          nextPath={nextPath}
          onConfirmed={() => goToCallback()}
        />
      ) : null}
    </AuthShell>
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
