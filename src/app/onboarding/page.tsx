"use client";

/**
 * Account-creation surface (Onboarding Smoothness Follow-up, Track A/B/C).
 *
 * Deliberately minimal: the only job here is to mint an auth session.
 * All public identity (display name, username, roles, visibility) is
 * completed at `/onboarding/identity`, which the unified gate enforces.
 *
 * Fields collected:
 *   - email
 *   - password
 *   - password confirmation
 *
 * Post-signup routing is delegated to `routeByAuthState` so password
 * signup, magic-link signup, and invite signup all converge through
 * the same identity-quality gate.
 */

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSession, getMyAuthState, signUpWithPassword } from "@/lib/supabase/auth";
import { ensureFreeEntitlement } from "@/lib/entitlements";
import { useT } from "@/lib/i18n/useT";
import { routeByAuthState, safeNextPath, loginUrlWithNext } from "@/lib/identity/routing";

const MIN_PASSWORD_LENGTH = 8;

type Mode = "check" | "signup";

function OnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const { t } = useT();

  const [mode, setMode] = useState<Mode>("check");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupEmailSent, setSignupEmailSent] = useState(false);
  const [duplicateEmailFor, setDuplicateEmailFor] = useState<string | null>(null);

  // Signed-in arrivals short-circuit through the unified gate. This
  // page is intentionally only rendered for anonymous visitors; anyone
  // who already has a session is handed off to identity-finish or the
  // destination they were heading to.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await getSession();
      if (cancelled) return;
      if (!session) {
        setMode("signup");
        return;
      }
      const state = await getMyAuthState();
      if (cancelled) return;
      await ensureFreeEntitlement(session.user.id);
      const { to } = routeByAuthState(state, { nextPath, sessionPresent: true });
      router.replace(to);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, nextPath]);

  async function handleSignUp(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t("onboarding.errorPasswordMin"));
      return;
    }
    if (password !== passwordConfirm) {
      setError(t("onboarding.errorPasswordMismatch"));
      return;
    }

    setLoading(true);
    // No identity metadata is passed at signup. Identity is completed
    // downstream at `/onboarding/identity`. This keeps the account-
    // creation step fast and low-cognitive-load.
    const { data, error: err } = await signUpWithPassword(
      email.trim(),
      password,
      undefined,
      nextPath
    );
    setLoading(false);

    if (err) {
      setError(err.message);
      return;
    }

    // QA #2 fix — Supabase anti-enumeration default behaviour. When
    // the email already exists, `auth.signUp()` does NOT throw an
    // error and returns a synthetic user payload whose `identities`
    // array is empty. No confirmation email is sent. Without this
    // guard the user would see the misleading "we sent you a
    // confirmation email" screen even though nothing was sent.
    //
    // We surface a clear duplicate state instead, with inline links
    // back to sign-in and password-reset. The enumeration trade-off
    // is acceptable here: `signInWithPassword` already returns
    // "Invalid login credentials" for unknown emails on the same
    // domain, so this does not widen the existing surface.
    const identities = (data?.user as { identities?: unknown } | null)?.identities;
    const isDuplicateEmail =
      !!data?.user && Array.isArray(identities) && identities.length === 0;
    if (isDuplicateEmail) {
      setDuplicateEmailFor(email.trim());
      return;
    }

    // Email-confirmation mode: no session yet.
    if (data?.user && !data?.session) {
      setSignupEmailSent(true);
      return;
    }

    // Immediate-session mode: route through the gate so the user
    // lands on `/onboarding/identity` (or `next` if already complete).
    if (data?.session?.user?.id) {
      await ensureFreeEntitlement(data.session.user.id);
      const state = await getMyAuthState();
      const { to } = routeByAuthState(state, { nextPath, sessionPresent: true });
      router.replace(to);
    }
  }

  if (mode === "check") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <p className="text-lg font-semibold text-zinc-900">Abstract</p>
        <p className="text-zinc-600">{t("common.loading")}</p>
      </div>
    );
  }

  const loginHref = loginUrlWithNext({ nextPath });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-12">
      <header className="mb-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          {t("onboarding.stepEyebrow")}
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-900">
          {t("onboarding.createAccount")}
        </h1>
        <p className="mt-2 text-sm text-zinc-600">{t("onboarding.signupHint")}</p>
      </header>

      {duplicateEmailFor ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
          <p className="text-base font-semibold text-zinc-900">
            {t("onboarding.duplicateEmailTitle")}
          </p>
          <p className="mt-2 text-sm text-zinc-700 break-keep">
            {t("onboarding.duplicateEmailBody").replace(
              "{email}",
              duplicateEmailFor
            )}
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <Link
              href={loginHref}
              className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-800"
            >
              {t("onboarding.duplicateEmailSignInCta")}
            </Link>
            <Link
              href={`/auth/forgot?email=${encodeURIComponent(duplicateEmailFor)}`}
              className="inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
            >
              {t("onboarding.duplicateEmailResetCta")}
            </Link>
          </div>
          <button
            type="button"
            onClick={() => setDuplicateEmailFor(null)}
            className="mt-4 inline-block text-xs font-medium text-zinc-500 hover:text-zinc-700"
          >
            {t("onboarding.duplicateEmailUseDifferent")}
          </button>
        </div>
      ) : signupEmailSent ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-5">
          <p className="text-base font-semibold text-zinc-900">
            {t("onboarding.checkEmailTitle")}
          </p>
          <p className="mt-2 text-sm text-zinc-600">{t("onboarding.checkEmailBody")}</p>
          <Link
            href={loginHref}
            className="mt-5 inline-block text-sm font-medium text-zinc-700 hover:text-zinc-900"
          >
            ← {t("auth.backToSignIn")}
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSignUp} className="space-y-4" noValidate>
          <div>
            <label htmlFor="signup-email" className="mb-1 block text-sm font-medium text-zinc-900">
              {t("onboarding.labelEmail")}
            </label>
            <input
              id="signup-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("onboarding.placeholderEmail")}
              required
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
              autoComplete="email"
            />
          </div>
          <div>
            <label htmlFor="signup-password" className="mb-1 block text-sm font-medium text-zinc-900">
              {t("onboarding.labelPassword")}
            </label>
            <input
              id="signup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("setPassword.placeholderPassword")}
              required
              minLength={MIN_PASSWORD_LENGTH}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
              autoComplete="new-password"
              aria-describedby="signup-password-hint"
            />
            <p id="signup-password-hint" className="mt-1 text-xs text-zinc-500">
              {t("onboarding.passwordHint")}
            </p>
          </div>
          <div>
            <label
              htmlFor="signup-password-confirm"
              className="mb-1 block text-sm font-medium text-zinc-900"
            >
              {t("onboarding.labelConfirmPassword")}
            </label>
            <input
              id="signup-password-confirm"
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              placeholder={t("onboarding.placeholderRepeatPassword")}
              required
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
              autoComplete="new-password"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? t("onboarding.creatingAccount") : t("onboarding.createAccountButton")}
          </button>

          <p className="pt-2 text-center text-xs text-zinc-500">
            {t("onboarding.nextStepHint")}
          </p>
        </form>
      )}

      <p className="mt-8 text-center text-sm text-zinc-500">
        {t("onboarding.alreadyHaveAccount")}{" "}
        <Link href={loginHref} className="font-medium text-zinc-700 hover:text-zinc-900">
          {t("auth.backToSignIn")}
        </Link>
      </p>
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center gap-3">
          <p className="text-lg font-semibold text-zinc-900">Abstract</p>
          <p className="text-zinc-600">Loading...</p>
        </div>
      }
    >
      <OnboardingInner />
    </Suspense>
  );
}
