"use client";

/**
 * Signup v2 · Step 1 (Email) — Phase 1, 2026-08-19.
 *
 * Anti-enumeration soft path (spec §5 #6): no existence check here.
 * The user always advances to Step 2. Duplicate detection lives at the
 * final submit via the Supabase "empty identities" signal (§6 Phase 1).
 *
 * "Continue with Google / Apple" buttons are placeholder-disabled
 * (Phase 3 scope, spec §5 #5) — a tooltip surfaces "곧 지원 예정".
 */

import { FormEvent, useMemo, useState } from "react";
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
  const showError = touched && trimmed.length > 0 && !isValid;

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
    });
    api.persistDraft({
      email: trimmed,
      usernameSeed: seed,
      step: 2,
    });
    // Anti-enumeration: we deliberately do NOT check whether the email
    // already exists here. Duplicate accounts are surfaced at the final
    // `signUpWithPassword` submit (Step 2 → account create).
    api.goToStep(2);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <OvalInput
        label={t("auth.signupV2.step1.emailLabel")}
        type="email"
        value={email}
        onChange={setEmail}
        onBlur={() => setTouched(true)}
        hint={t("auth.signupV2.step1.emailHint")}
        error={showError ? t("auth.signupV2.step1.emailInvalid") : undefined}
        autoComplete="email"
        autoFocus
        inputMode="email"
        required
      />

      <PillButton
        type="submit"
        variant="primary"
        fullWidth
        loading={submitting}
        disabled={!isValid}
      >
        {t("auth.signupV2.step1.continueCta")}
      </PillButton>

      <div className="relative py-2">
        <span
          aria-hidden
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-zinc-100"
        />
        <span className="relative mx-auto block w-fit bg-white px-3 text-[11px] uppercase tracking-[0.22em] text-zinc-400">
          {t("auth.signupV2.step1.orDivider")}
        </span>
      </div>

      <div className="space-y-2">
        <PillButton
          variant="secondary"
          fullWidth
          disabled
          title={t("auth.signupV2.step1.oauthComingSoon")}
          aria-disabled
        >
          {t("auth.signupV2.step1.continueWithGoogle")}
        </PillButton>
        <PillButton
          variant="secondary"
          fullWidth
          disabled
          title={t("auth.signupV2.step1.oauthComingSoon")}
          aria-disabled
        >
          {t("auth.signupV2.step1.continueWithApple")}
        </PillButton>
        <p className="pt-1 text-center text-[11px] text-zinc-400">
          {t("auth.signupV2.step1.oauthComingSoon")}
        </p>
      </div>
    </form>
  );
}
