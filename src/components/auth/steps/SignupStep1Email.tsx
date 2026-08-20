"use client";

/**
 * Signup v2 · Step 1 (Email).
 *
 * Wireframe (2026-08-20): Email* oval, black "Sign up", then
 * "Already have an account? Log in". Duplicate-account copy is a red
 * line under that row. OAuth lives on `/login` (Google-only), not here.
 *
 * Anti-enumeration: we still do NOT probe existence on this step.
 * Duplicate detection stays at Step 3 submit; on a hit the wizard
 * snaps back here so the red line can sit in the wireframe slot.
 */

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { OvalInput } from "@/components/auth/primitives/OvalInput";
import { PillButton } from "@/components/auth/primitives/PillButton";
import { useT } from "@/lib/i18n/useT";
import { sanitizeUsernameSeed } from "@/lib/auth/signupWizardState";
import type { SignupStepApi } from "../SignupWizardShell";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignupStep1Email({ api }: { api: SignupStepApi }) {
  const { t } = useT();
  const [email, setEmail] = useState(api.state.email);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = email.trim();
  const isValid = useMemo(() => EMAIL_REGEX.test(trimmed), [trimmed]);
  const showError = touched && !isValid;
  const duplicate =
    api.state.duplicateEmail &&
    api.state.duplicateEmail.toLowerCase() === trimmed.toLowerCase();

  const loginHref = api.nextPath
    ? `/login?next=${encodeURIComponent(api.nextPath)}`
    : "/login";

  function handleEmailChange(next: string) {
    setEmail(next);
    if (
      api.state.duplicateEmail &&
      next.trim().toLowerCase() !== api.state.duplicateEmail.toLowerCase()
    ) {
      api.updateState({ duplicateEmail: null });
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!isValid) return;
    setSubmitting(true);
    const seed = sanitizeUsernameSeed(trimmed);
    api.updateState({
      email: trimmed,
      usernameSeed: seed,
      username: api.state.username || seed,
      duplicateEmail: null,
    });
    api.persistDraft({
      email: trimmed,
      usernameSeed: seed,
      step: 2,
    });
    api.goToStep(2);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8" noValidate>
      <OvalInput
        labelStyle="outer"
        label={t("auth.signupV2.step1.emailLabel")}
        type="email"
        value={email}
        onChange={handleEmailChange}
        onBlur={() => setTouched(true)}
        error={showError ? t("auth.signupV2.step1.emailInvalid") : undefined}
        autoComplete="email"
        autoFocus
        inputMode="email"
        required
      />

      <div className="space-y-3">
        <PillButton type="submit" variant="primary" fullWidth loading={submitting}>
          {t("auth.signupV2.step1.continueCta")}
        </PillButton>

        <p className="text-center text-sm text-zinc-500">
          {t("auth.signupV2.haveAccount")}{" "}
          <Link
            href={loginHref}
            className="font-medium text-zinc-900 underline-offset-2 hover:underline"
          >
            {t("auth.signupV2.logInCta")}
          </Link>
        </p>

        {duplicate ? (
          <p role="alert" className="text-center text-xs text-red-600">
            {t("auth.signupV2.step1.duplicateInline")}
          </p>
        ) : null}
      </div>
    </form>
  );
}
