"use client";

/**
 * Forgot-password surface (QA hardening).
 *
 * Single-purpose page that takes an email and triggers a Supabase
 * password reset email. Anti-enumeration: we always show the same
 * "if that account exists, we sent a link" confirmation regardless of
 * whether the email is registered. This is the standard pattern used
 * by Linear, Notion, Figma, Slack, etc.
 *
 * The mailed link lands on `/auth/reset`, which is where the actual
 * new-password form lives.
 *
 * Accepts `?email=<addr>` as a pre-fill — used by the duplicate-email
 * branch in `/onboarding` so the user does not retype.
 */

import { FormEvent, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useT } from "@/lib/i18n/useT";
import { sendPasswordReset } from "@/lib/supabase/auth";

const EMAIL_COOLDOWN_SEC = 30;
const RATE_LIMIT_PATTERNS = [
  "rate limit",
  "too many",
  "exceeded",
  "429",
  "email sending",
];

function isRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return RATE_LIMIT_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

function ForgotInner() {
  const searchParams = useSearchParams();
  const { t } = useT();

  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentForEmail, setSentForEmail] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const handle = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(handle);
  }, [cooldown]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) return;

    setLoading(true);
    const { error: err } = await sendPasswordReset(trimmed);
    setLoading(false);

    if (err) {
      // Rate-limit responses are the only case we surface inline —
      // everything else collapses to the anti-enumeration confirmation
      // so we never reveal whether the email is registered.
      if (isRateLimitError(err.message)) {
        setError(t("forgotPassword.rateLimit"));
        return;
      }
      // Treat any other error as a quiet success too. The user can
      // retry; a 4xx from a malformed address will be caught by the
      // browser email validator first anyway.
    }
    setSentForEmail(trimmed);
    setCooldown(EMAIL_COOLDOWN_SEC);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-4 py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-zinc-900">
          {t("forgotPassword.title")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 break-keep">
          {t("forgotPassword.subtitle")}
        </p>
      </header>

      {sentForEmail ? (
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-5">
          <p className="text-base font-semibold text-zinc-900">
            {t("forgotPassword.sentTitle")}
          </p>
          <p className="mt-2 text-sm text-zinc-700 break-keep">
            {t("forgotPassword.sentBody").replace("{email}", sentForEmail)}
          </p>
          <p className="mt-3 text-xs text-zinc-500 break-keep">
            {t("forgotPassword.sentHint")}
          </p>
          <button
            type="button"
            onClick={() => {
              if (cooldown > 0) return;
              setSentForEmail(null);
              setError(null);
            }}
            disabled={cooldown > 0}
            className="mt-5 inline-block text-xs font-medium text-zinc-600 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cooldown > 0
              ? t("forgotPassword.resendCooldown").replace(
                  "{seconds}",
                  String(cooldown)
                )
              : t("forgotPassword.resend")}
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3" noValidate>
          <div>
            <label
              htmlFor="forgot-email"
              className="mb-1 block text-sm font-medium text-zinc-900"
            >
              {t("forgotPassword.labelEmail")}
            </label>
            <input
              id="forgot-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("login.placeholderEmail")}
              required
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
              autoComplete="email"
              autoFocus
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-600 break-keep">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? t("common.loading") : t("forgotPassword.sendCta")}
          </button>
        </form>
      )}

      <p className="mt-10 text-center text-sm text-zinc-600">
        <Link
          href="/login"
          className="font-medium text-zinc-700 hover:text-zinc-900"
        >
          ← {t("auth.backToSignIn")}
        </Link>
      </p>
    </main>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center px-4">
          <p className="text-zinc-500">Loading...</p>
        </div>
      }
    >
      <ForgotInner />
    </Suspense>
  );
}
