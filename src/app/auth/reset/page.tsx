"use client";

/**
 * Reset-password landing surface.
 *
 * Reached via the link in the password-reset email triggered from
 * `/auth/forgot`. Supabase exchanges the token for a session as soon
 * as the page loads, so we just check `getSession()` and let the user
 * pick a new password.
 *
 * On success we route to `/feed` (default signed-in surface). The
 * session is already authenticated, so no further sign-in step.
 */

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getSession } from "@/lib/supabase/auth";
import { useT } from "@/lib/i18n/useT";

const MIN_PASSWORD_LENGTH = 8;

export default function ResetPasswordPage() {
  const router = useRouter();
  const { t } = useT();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const res1 = await getSession();
      if (cancelled) return;
      if (res1.data.session) {
        setHasSession(true);
        return;
      }
      // Brief wait so the Supabase recovery-link exchange has time to
      // settle when the user landed here a fraction of a second ago.
      await new Promise((r) => setTimeout(r, 1500));
      if (cancelled) return;
      const res2 = await getSession();
      setHasSession(!!res2.data.session);
    }
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t("resetPassword.errorMin"));
      return;
    }
    if (password !== confirm) {
      setError(t("resetPassword.errorMismatch"));
      return;
    }

    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (err) {
      setError(err.message);
      return;
    }

    router.replace("/feed?tab=all&sort=latest");
  }

  if (hasSession === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-zinc-600">{t("common.loading")}</p>
      </div>
    );
  }

  if (!hasSession) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-4 py-12">
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
          <p className="text-base font-semibold text-zinc-900">
            {t("resetPassword.expiredTitle")}
          </p>
          <p className="mt-2 text-sm text-zinc-700 break-keep">
            {t("resetPassword.expiredBody")}
          </p>
          <Link
            href="/auth/forgot"
            className="mt-5 inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-800"
          >
            {t("resetPassword.expiredCta")}
          </Link>
        </div>
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

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-4 py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-zinc-900">
          {t("resetPassword.title")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 break-keep">
          {t("resetPassword.subtitle")}
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-3" noValidate>
        <div>
          <label
            htmlFor="reset-password"
            className="mb-1 block text-sm font-medium text-zinc-900"
          >
            {t("setPassword.newPassword")}
          </label>
          <input
            id="reset-password"
            type="password"
            placeholder={t("resetPassword.placeholderNew")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
            autoComplete="new-password"
            autoFocus
          />
        </div>
        <div>
          <label
            htmlFor="reset-password-confirm"
            className="mb-1 block text-sm font-medium text-zinc-900"
          >
            {t("setPassword.confirm")}
          </label>
          <input
            id="reset-password-confirm"
            type="password"
            placeholder={t("resetPassword.placeholderConfirm")}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
            autoComplete="new-password"
          />
          <p className="mt-1 text-xs text-zinc-500">
            {t("onboarding.passwordHint")}
          </p>
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
          {loading ? t("resetPassword.submitting") : t("resetPassword.submit")}
        </button>
      </form>
    </main>
  );
}
