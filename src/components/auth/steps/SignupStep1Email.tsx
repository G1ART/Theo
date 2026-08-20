"use client";

/**
 * Signup v2 · Step 1 (Email) — Phase 1, 2026-08-19.
 *
 * Anti-enumeration soft path (spec §5 #6): no existence check here.
 * The user always advances to Step 2. Duplicate detection lives at the
 * final submit via the Supabase "empty identities" signal (§6 Phase 1).
 *
 * Quick Start cluster (spec §5 #5, Phase 3 wiring 2026-08-19): Google
 * + Apple are wired to `signInWithOAuthProvider`. Kakao is rendered
 * disabled with a "coming soon" tooltip per the deferral decision.
 * If Supabase Dashboard OAuth providers are not yet configured, the
 * helper classifies the response and the UI surfaces a local
 * `notConfigured` message inline — no crash, no dead click.
 */

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { OvalInput } from "@/components/auth/primitives/OvalInput";
import { PillButton } from "@/components/auth/primitives/PillButton";
import { useT } from "@/lib/i18n/useT";
import { sanitizeUsernameSeed } from "@/lib/auth/signupWizardState";
import {
  signInWithOAuthProvider,
  type OAuthProvider,
} from "@/lib/supabase/oauth";
import type { SignupStepApi } from "../SignupWizardShell";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type QuickStartPill = {
  provider: OAuthProvider | "kakao";
  label: string;
  disabled?: boolean;
  disabledTooltip?: string;
};

export function SignupStep1Email({ api }: { api: SignupStepApi }) {
  const { t } = useT();
  const [email, setEmail] = useState(api.state.email);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [oauthMessage, setOauthMessage] = useState<{
    text: string;
    tone: "error" | "info";
  } | null>(null);

  const trimmed = email.trim();
  const isValid = useMemo(() => EMAIL_REGEX.test(trimmed), [trimmed]);
  const showError = touched && trimmed.length > 0 && !isValid;

  useEffect(() => {
    if (!oauthMessage) return;
    const handle = window.setTimeout(() => setOauthMessage(null), 6000);
    return () => window.clearTimeout(handle);
  }, [oauthMessage]);

  const handleOAuth = useCallback(
    async (provider: OAuthProvider) => {
      setOauthLoading(provider);
      setOauthMessage(null);
      const { error } = await signInWithOAuthProvider(provider, {
        next: api.nextPath,
      });
      if (error) {
        setOauthLoading(null);
        const key: string =
          error.code === "provider_not_configured"
            ? "auth.loginV2.oauth.notConfigured"
            : error.code === "cancelled"
            ? "auth.loginV2.oauth.cancelled"
            : "auth.loginV2.oauth.error";
        setOauthMessage({ text: t(key), tone: "error" });
      }
      // Success = full-page redirect; leave loading truthy so the
      // button stays visually engaged until the browser navigates away.
    },
    [api.nextPath, t],
  );

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

  // 2026-08-20 (OAuth cluster trim): only Google is currently
  // configured in Supabase Auth. Apple + Kakao are hidden to avoid
  // dead clicks / "not configured" toasts. Re-add each provider as
  // it comes online (see /login page.tsx for the same treatment).
  const quickStartPills: QuickStartPill[] = [
    { provider: "google", label: t("auth.loginV2.quickStart.google") },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <p className="-mt-2 mb-6 text-sm text-zinc-500">
        {t("auth.signupV2.step1.subtitle")}
      </p>
      <OvalInput
        labelStyle="outer"
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

      <div>
        <p className="mb-3 text-center text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-500">
          {t("auth.loginV2.quickStart.label")}
        </p>
        {/* 2026-08-20: flex-center while OAuth cluster is Google-only.
            Swap back to `grid grid-cols-3 gap-2` when Apple + Kakao
            come online. */}
        <div className="flex flex-wrap justify-center gap-2">
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
        {oauthMessage && (
          <p
            role="status"
            aria-live="polite"
            className={`mt-3 rounded-2xl px-4 py-2 text-center text-xs ${
              oauthMessage.tone === "error"
                ? "bg-red-50 text-red-700"
                : "bg-zinc-50 text-zinc-600"
            }`}
          >
            {oauthMessage.text}
          </p>
        )}
      </div>
    </form>
  );
}
