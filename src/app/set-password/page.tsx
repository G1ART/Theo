"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { AuthGate } from "@/components/AuthGate";
import { useT } from "@/lib/i18n/useT";
// Signup v2 Phase 5 (2026-08-19): shared 12-char floor via
// `passwordPolicy.ts`. See docs/SIGNUP_REDESIGN_SPEC.md §5 #8.
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/passwordPolicy";

export default function SetPasswordPage() {
  const router = useRouter();
  const { t } = useT();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(
        t("setPassword.errorMinLength").replace(
          "{min}",
          String(MIN_PASSWORD_LENGTH),
        ),
      );
      return;
    }
    if (password !== confirm) {
      setError(t("setPassword.errorMismatch"));
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

  return (
    <AuthGate>
      <main className="mx-auto max-w-sm px-4 py-12">
        <h1 className="mb-2 text-xl font-semibold text-zinc-900">
          {t("setPassword.title")}
        </h1>
        <p className="mb-6 text-sm text-zinc-600">
          {t("setPassword.hint")}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-zinc-700"
            >
              {t("setPassword.newPassword")}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("setPassword.placeholderPassword")}
              className="w-full rounded border border-zinc-300 px-3 py-2"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
            />
          </div>
          <div>
            <label
              htmlFor="confirm"
              className="mb-1 block text-sm font-medium text-zinc-700"
            >
              {t("setPassword.confirm")}
            </label>
            <input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={t("setPassword.placeholderConfirm")}
              className="w-full rounded border border-zinc-300 px-3 py-2"
              autoComplete="new-password"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600">{String(error)}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading ? t("setPassword.settingButton") : t("setPassword.setButton")}
          </button>
        </form>
      </main>
    </AuthGate>
  );
}
