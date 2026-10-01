"use client";

/**
 * Account-creation surface. Live signup is this page
 * (`NEXT_PUBLIC_SIGNUP_V2` is off, and `/signup` redirects here).
 *
 * Step 1 collects email, password, and confirmation together. Submit
 * still asks `signup_email_step_facts` before creating an account:
 * a finished profile goes to login with the email filled in. Unknown,
 * unconfirmed, and invited-but-incomplete addresses continue, and the
 * screen does not say which of those it is.
 *
 * The verification modal is the cross-device wait. `/signup` renders
 * this same form when the flag is on.
 */

import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthLegalLine } from "@/components/auth/AuthLegalLine";
import { EmailConfirmWait } from "@/components/auth/EmailConfirmWait";
import { GoogleStartButton } from "@/components/auth/GoogleStartButton";
import { AuthShell } from "@/components/auth/primitives/AuthShell";
import { OvalInput } from "@/components/auth/primitives/OvalInput";
import { PillButton } from "@/components/auth/primitives/PillButton";
import { TheoLoadingMark } from "@/components/brand/TheoLoadingMark";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/passwordPolicy";
import {
  fetchSignupEmailStep,
  loginUrlForFinishedSignup,
} from "@/lib/auth/signupEmailStep";
import { pathAfterNewAccount } from "@/lib/auth/signupDestination";
import { useT } from "@/lib/i18n/useT";
import { loginUrlWithNext, routeByAuthState, safeNextPath } from "@/lib/identity/routing";
import { ensureFreeEntitlement } from "@/lib/entitlements";
import {
  deliverSignupConfirmation,
  getMyAuthState,
  getSession,
  isUnconfirmedAuthError,
  signInWithPassword,
  signUpWithPassword,
} from "@/lib/supabase/auth";
import { signInWithOAuthProvider } from "@/lib/supabase/oauth";

type Mode = "check" | "signup";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function OnboardingAccountForm({
  initialEmail,
  nextPath,
  onAccountReady,
}: {
  initialEmail: string;
  nextPath: string | null;
  onAccountReady: (userId: string) => void | Promise<void>;
}) {
  const router = useRouter();
  const { t } = useT();

  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupEmailSent, setSignupEmailSent] = useState(false);
  const [duplicateEmailFor, setDuplicateEmailFor] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const appliedQueryEmail = useRef(false);

  useEffect(() => {
    const fromQuery = initialEmail.trim();
    if (!fromQuery || appliedQueryEmail.current) return;
    appliedQueryEmail.current = true;
    setEmail(fromQuery);
    if (!EMAIL_RE.test(fromQuery)) return;
    setCheckingEmail(true);
    void fetchSignupEmailStep(fromQuery).then((result) => {
      setCheckingEmail(false);
      if (result.action === "login") {
        router.push(loginUrlForFinishedSignup(fromQuery, nextPath));
      }
    });
  }, [initialEmail, nextPath, router]);

  const loginHref = loginUrlWithNext({ nextPath });

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

  async function handleSignUp(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!EMAIL_RE.test(trimmedEmail)) {
      setError(t("onboarding.emailInvalid"));
      return;
    }
    setCheckingEmail(true);
    const gate = await fetchSignupEmailStep(trimmedEmail);
    setCheckingEmail(false);
    if (gate.action === "login") {
      router.push(loginUrlForFinishedSignup(trimmedEmail, nextPath));
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(
        t("onboarding.errorPasswordMin").replace("{min}", String(MIN_PASSWORD_LENGTH)),
      );
      return;
    }
    if (password !== passwordConfirm) {
      setError(t("onboarding.errorPasswordMismatch"));
      return;
    }

    setLoading(true);
    const { data, error: err } = await signUpWithPassword(
      trimmedEmail,
      password,
      undefined,
      nextPath,
    );
    setLoading(false);

    if (err) {
      setError(err.message);
      return;
    }

    const identities = (data?.user as { identities?: unknown } | null)?.identities;
    const isDuplicateEmail =
      !!data?.user && Array.isArray(identities) && identities.length === 0;
    if (isDuplicateEmail) {
      const { data: loginData, error: loginErr } = await signInWithPassword(
        trimmedEmail,
        password,
      );
      if (!loginErr && loginData?.session?.user?.id) {
        await onAccountReady(loginData.session.user.id);
        return;
      }
      if (isUnconfirmedAuthError(loginErr)) {
        setSignupEmailSent(true);
        void deliverSignupConfirmation(trimmedEmail, nextPath);
        return;
      }
      const again = await fetchSignupEmailStep(trimmedEmail);
      if (again.checked && again.action === "continue") {
        setSignupEmailSent(true);
        void deliverSignupConfirmation(trimmedEmail, nextPath);
        return;
      }
      setDuplicateEmailFor(trimmedEmail);
      return;
    }

    if (data?.user && !data?.session) {
      setSignupEmailSent(true);
      void deliverSignupConfirmation(trimmedEmail, nextPath);
      return;
    }

    if (data?.session?.user?.id) {
      await onAccountReady(data.session.user.id);
    }
  }

  const passwordHint = t("auth.signupV2.step2.passwordHint").replace(
    "{min}",
    String(MIN_PASSWORD_LENGTH),
  );

  return (
    <>
      {duplicateEmailFor ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
          <p className="text-base font-semibold text-zinc-900">
            {t("onboarding.duplicateEmailTitle")}
          </p>
          <p className="mt-2 break-keep text-sm text-zinc-700">
            {t("onboarding.duplicateEmailBody").replace("{email}", duplicateEmailFor)}
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <Link
              href={loginHref}
              className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-800"
            >
              {t("onboarding.duplicateEmailSignInCta")}
            </Link>
            <Link
              href={`/auth/forgot?email=${encodeURIComponent(duplicateEmailFor)}`}
              className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
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
      ) : (
        <form onSubmit={handleSignUp} className="space-y-4" noValidate>
          <OvalInput
            labelStyle="outer"
            label={t("auth.signupV2.step1.emailLabel")}
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            inputMode="email"
            required
          />
          <OvalInput
            labelStyle="outer"
            label={t("auth.signupV2.step2.passwordLabel")}
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            hint={passwordHint}
            required
          />
          <OvalInput
            labelStyle="outer"
            label={t("auth.signupV2.step2.confirmPasswordLabel")}
            type="password"
            value={passwordConfirm}
            onChange={setPasswordConfirm}
            autoComplete="new-password"
            required
          />

          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <PillButton
            type="submit"
            variant="primary"
            fullWidth
            loading={loading || checkingEmail}
          >
            {loading
              ? t("onboarding.creatingAccount")
              : checkingEmail
                ? t("onboarding.checkingEmail")
                : t("auth.signupV2.step1.continueCta")}
          </PillButton>

          <p className="text-center text-sm text-zinc-600">
            {t("auth.signupV2.haveAccount")}{" "}
            <Link href={loginHref} className="font-semibold text-zinc-900 hover:text-zinc-700">
              {t("auth.signupV2.logInCta")}
            </Link>
          </p>

          <div className="pt-6 text-center">
            <p className="mb-3 text-[13px] text-zinc-700">
              {t("auth.loginV2.quickStart.label")}
            </p>
            <GoogleStartButton onClick={() => void handleGoogle()} loading={oauthLoading} />
            {oauthError ? (
              <p role="alert" className="mt-3 text-xs text-red-600">
                {oauthError}
              </p>
            ) : null}
          </div>
        </form>
      )}

      <div className="mt-10">
        <AuthLegalLine />
      </div>

      {signupEmailSent ? (
        <>
          <EmailConfirmWait
            email={email}
            password={password}
            nextPath={nextPath}
            onChangeEmail={() => setSignupEmailSent(false)}
            onConfirmed={(userId) => {
              void onAccountReady(userId);
            }}
          />
        </>
      ) : null}
    </>
  );
}

function OnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const { t } = useT();
  const [mode, setMode] = useState<Mode>("check");
  const presetEmail = searchParams.get("email")?.trim() ?? "";

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
        router.replace(pathAfterNewAccount(to, nextPath));
      } catch {
        if (cancelled) return;
        setMode("signup");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, nextPath]);

  if (mode === "check") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        <TheoLoadingMark />
      </div>
    );
  }

  return (
    <AuthShell
      brandPlacement="none"
      title={t("auth.signupV2.stepLabel.step1")}
      subtitle={t("auth.signupV2.step1.subLabel")}
    >
      <OnboardingAccountForm
        initialEmail={presetEmail}
        nextPath={nextPath}
        onAccountReady={async (userId) => {
          await ensureFreeEntitlement(userId);
          const state = await getMyAuthState();
          const { to } = routeByAuthState(state, { nextPath, sessionPresent: true });
          router.replace(pathAfterNewAccount(to, nextPath));
        }}
      />
    </AuthShell>
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
