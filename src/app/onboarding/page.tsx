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

import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSession, getMyAuthState, signUpWithPassword, signInWithPassword, isUnconfirmedAuthError, deliverSignupConfirmation } from "@/lib/supabase/auth";
import { ensureFreeEntitlement } from "@/lib/entitlements";
import { useT } from "@/lib/i18n/useT";
import { routeByAuthState, safeNextPath, loginUrlWithNext } from "@/lib/identity/routing";
import {
  fetchSignupEmailStep,
  loginUrlForFinishedSignup,
} from "@/lib/auth/signupEmailStep";
import { TheoLoadingMark } from "@/components/brand/TheoLoadingMark";
import { EmailConfirmWait } from "@/components/auth/EmailConfirmWait";
// Signup v2 Phase 5 (2026-08-19): legacy pages now share the same
// 12-char floor as the new /signup wizard. SSOT lives in
// `src/lib/auth/passwordPolicy.ts` so future bumps only touch one file.
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/passwordPolicy";

type Mode = "check" | "signup";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function destinationAfterAccount(to: string, nextPath: string | null): string {
  // A session that still needs a profile must not land back on this
  // page. That bounce keeps the "check your email" screen up after the
  // link already worked.
  if (to === "/onboarding" || to.startsWith("/onboarding?")) {
    const q = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
    return `/onboarding/identity${q}`;
  }
  return to;
}

function OnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const { t } = useT();

  const [mode, setMode] = useState<Mode>("check");
  const presetEmail = searchParams.get("email")?.trim() ?? "";
  const [email, setEmail] = useState(presetEmail);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [emailReadyFor, setEmailReadyFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signupEmailSent, setSignupEmailSent] = useState(false);
  const [duplicateEmailFor, setDuplicateEmailFor] = useState<string | null>(null);
  const appliedQueryEmail = useRef(false);

  // Invite mail lands on /onboarding?email=. Copy it in once the
  // anonymous form is up (the query can miss the first paint), then
  // run the same Step 1 rule so a finished account does not sit on
  // the password fields.
  useEffect(() => {
    if (mode !== "signup" || appliedQueryEmail.current) return;
    const fromQuery = searchParams.get("email")?.trim() ?? "";
    if (!fromQuery) return;
    appliedQueryEmail.current = true;
    setEmail(fromQuery);
    if (!EMAIL_RE.test(fromQuery)) return;
    setCheckingEmail(true);
    void fetchSignupEmailStep(fromQuery).then((result) => {
      setCheckingEmail(false);
      if (result.action === "login") {
        router.push(loginUrlForFinishedSignup(fromQuery, nextPath));
        return;
      }
      setEmailReadyFor(fromQuery);
    });
  }, [mode, searchParams, router, nextPath]);

  const emailPassed =
    !!emailReadyFor &&
    emailReadyFor.toLowerCase() === email.trim().toLowerCase();

  // Signed-in arrivals short-circuit through the unified gate. This
  // page is intentionally only rendered for anonymous visitors; anyone
  // who already has a session is handed off to identity-finish or the
  // destination they were heading to.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
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
        router.replace(destinationAfterAccount(to, nextPath));
      } catch {
        // Mobile Safari private mode / storage partitioning / flaky network
        // can make getSession throw. Fall back to the signup form rather
        // than staying stuck on the loading mark (mode === "check").
        if (cancelled) return;
        setMode("signup");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, nextPath]);

  async function handleEmailContinue(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError(t("onboarding.emailInvalid"));
      return;
    }
    setCheckingEmail(true);
    const result = await fetchSignupEmailStep(trimmed);
    setCheckingEmail(false);
    if (result.action === "login") {
      router.push(loginUrlForFinishedSignup(trimmed, nextPath));
      return;
    }
    setEmailReadyFor(trimmed);
  }

  async function handleSignUp(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!EMAIL_RE.test(trimmedEmail)) {
      setError(t("onboarding.emailInvalid"));
      return;
    }
    // The email step already ran. Check again so a finished address
    // cannot slip through by editing the field after the gate.
    const gate = await fetchSignupEmailStep(trimmedEmail);
    if (gate.action === "login") {
      router.push(loginUrlForFinishedSignup(trimmedEmail, nextPath));
      return;
    }
    setEmailReadyFor(trimmedEmail);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(
        t("onboarding.errorPasswordMin").replace(
          "{min}",
          String(MIN_PASSWORD_LENGTH),
        ),
      );
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
      trimmedEmail,
      password,
      undefined,
      nextPath
    );
    setLoading(false);

    if (err) {
      setError(err.message);
      return;
    }

    // Supabase anti-enumeration: an existing email returns a user
    // whose `identities` array is empty, and no mail is sent. Step 1
    // already sent finished accounts to login. This branch is the
    // leftover: sign in if the password matches, keep an unconfirmed
    // or unfinished invite on the mail step, and only then show the
    // "already registered" panel.
    const identities = (data?.user as { identities?: unknown } | null)?.identities;
    const isDuplicateEmail =
      !!data?.user && Array.isArray(identities) && identities.length === 0;
    if (isDuplicateEmail) {
      const { data: loginData, error: loginErr } = await signInWithPassword(
        trimmedEmail,
        password,
      );
      if (!loginErr && loginData?.session?.user?.id) {
        await ensureFreeEntitlement(loginData.session.user.id);
        const state = await getMyAuthState();
        const { to } = routeByAuthState(state, { nextPath, sessionPresent: true });
        router.replace(destinationAfterAccount(to, nextPath));
        return;
      }
      if (isUnconfirmedAuthError(loginErr)) {
        setSignupEmailSent(true);
        void deliverSignupConfirmation(trimmedEmail, nextPath);
        return;
      }
      // Password did not match. A finished account belongs on login.
      // An unfinished invite or half-done profile must keep going:
      // the mail link opens the same account and attaches invited works.
      const again = await fetchSignupEmailStep(trimmedEmail);
      if (again.checked && again.action === "continue") {
        setSignupEmailSent(true);
        void deliverSignupConfirmation(trimmedEmail, nextPath);
        return;
      }
      setDuplicateEmailFor(trimmedEmail);
      return;
    }

    // Email-confirmation mode: no session yet.
    if (data?.user && !data?.session) {
      setSignupEmailSent(true);
      void deliverSignupConfirmation(trimmedEmail, nextPath);
      return;
    }

    // Immediate-session mode: route through the gate so the user
    // lands on `/onboarding/identity` (or `next` if already complete).
    if (data?.session?.user?.id) {
      await ensureFreeEntitlement(data.session.user.id);
      const state = await getMyAuthState();
      const { to } = routeByAuthState(state, { nextPath, sessionPresent: true });
      router.replace(destinationAfterAccount(to, nextPath));
    }
  }

  if (mode === "check") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        <TheoLoadingMark />
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
        <>
          <EmailConfirmWait
            email={email}
            password={password}
            nextPath={nextPath}
            onConfirmed={async (userId) => {
              await ensureFreeEntitlement(userId);
              const state = await getMyAuthState();
              const { to } = routeByAuthState(state, { nextPath, sessionPresent: true });
              router.replace(destinationAfterAccount(to, nextPath));
            }}
          />
          <button
            type="button"
            onClick={() => setSignupEmailSent(false)}
            className="mt-3 block text-xs font-medium text-zinc-500 hover:text-zinc-700"
          >
            {t("onboarding.duplicateEmailUseDifferent")}
          </button>
          <Link
            href={loginHref}
            className="mt-3 inline-block text-sm font-medium text-zinc-700 hover:text-zinc-900"
          >
            ← {t("auth.backToSignIn")}
          </Link>
        </>
      ) : (
        <form
          onSubmit={emailPassed ? handleSignUp : handleEmailContinue}
          className="space-y-4"
          noValidate
        >
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
              readOnly={emailPassed}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 read-only:bg-zinc-50"
              autoComplete="email"
            />
            {emailPassed ? (
              <button
                type="button"
                onClick={() => {
                  setEmailReadyFor(null);
                  setPassword("");
                  setPasswordConfirm("");
                  setError(null);
                }}
                className="mt-2 text-xs font-medium text-zinc-500 hover:text-zinc-700"
              >
                {t("onboarding.editEmail")}
              </button>
            ) : null}
          </div>
          {emailPassed ? (
            <>
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
                  {t("onboarding.passwordHint").replace(
                    "{min}",
                    String(MIN_PASSWORD_LENGTH),
                  )}
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
            </>
          ) : null}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {emailPassed ? (
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? t("onboarding.creatingAccount") : t("onboarding.createAccountButton")}
            </button>
          ) : (
            <button
              type="submit"
              disabled={checkingEmail}
              className="w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checkingEmail ? t("onboarding.checkingEmail") : t("onboarding.emailContinue")}
            </button>
          )}

          {emailPassed ? (
            <p className="pt-2 text-center text-xs text-zinc-500">
              {t("onboarding.nextStepHint")}
            </p>
          ) : (
            <p className="pt-2 text-center text-xs text-zinc-500">
              {t("onboarding.emailStepHint")}
            </p>
          )}
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
        <div className="flex min-h-screen flex-col items-center justify-center">
          <TheoLoadingMark />
        </div>
      }
    >
      <OnboardingInner />
    </Suspense>
  );
}
