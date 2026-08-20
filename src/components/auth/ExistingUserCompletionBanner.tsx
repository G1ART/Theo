"use client";

/**
 * ExistingUserCompletionBanner — Signup v2 Phase 4.
 *
 * Nudges existing (already-activated) users whose
 * `profiles.profile_completed_at IS NULL` to finish the new profile
 * fields (name · age · role). CTA goes to `/settings`, not `/signup`:
 * the signup wizard is for creating an account, and sending a signed-in
 * user there re-runs `signUpWithPassword` and surfaces a duplicate-email
 * dead end.
 *
 * Shown when:
 *   1. `NEXT_PUBLIC_SIGNUP_V2` is enabled.
 *   2. A session exists.
 *   3. `profile_completed_at IS NULL`.
 *   4. The user hasn't dismissed the banner this session
 *      (`sessionStorage:signup:v2:completionBannerDismissed`).
 *   5. The current path is not an auth / settings / legal surface.
 *
 * Saving Settings stamps `profile_completed_at` (idempotent RPC) and
 * dispatches `profile-updated` so this banner drops immediately.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/useT";
import { isSignupV2Enabled } from "@/lib/featureFlags/signupV2";

const DISMISS_KEY = "signup:v2:completionBannerDismissed";

const HIDDEN_PATH_PREFIXES = [
  "/signup",
  "/login",
  "/legal",
  "/auth",
  "/onboarding",
  "/set-password",
  "/settings",
];

function isHiddenPath(pathname: string | null): boolean {
  if (!pathname) return true;
  return HIDDEN_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

type MinimalProfile = {
  profile_completed_at: string | null;
};

export function ExistingUserCompletionBanner() {
  const { t } = useT();
  const pathname = usePathname();
  const flagOn = useMemo(() => isSignupV2Enabled(), []);

  const [mounted, setMounted] = useState(false);
  const [profile, setProfile] = useState<MinimalProfile | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    let initialDismissed = false;
    if (typeof window !== "undefined") {
      try {
        initialDismissed =
          window.sessionStorage.getItem(DISMISS_KEY) === "1";
      } catch {
        initialDismissed = false;
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    setDismissed(initialDismissed);
  }, []);

  const refresh = useCallback(async () => {
    if (!flagOn) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      setProfile(null);
      return;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("profile_completed_at")
      .eq("id", session.user.id)
      .maybeSingle();
    if (error) {
      setProfile(null);
      return;
    }
    setProfile((data ?? null) as MinimalProfile | null);
  }, [flagOn]);

  useEffect(() => {
    if (!mounted || !flagOn) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void refresh();
    });
    const onProfileUpdated = () => void refresh();
    window.addEventListener("profile-updated", onProfileUpdated);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("profile-updated", onProfileUpdated);
    };
  }, [mounted, flagOn, refresh]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* best-effort */
    }
  }, []);

  if (!mounted || !flagOn) return null;
  if (dismissed) return null;
  if (isHiddenPath(pathname)) return null;
  if (!profile) return null;
  if (profile.profile_completed_at) return null;

  return (
    <div
      role="region"
      aria-label={t("auth.signupV2.completionBanner.title")}
      className="flex items-start justify-between gap-3 border-b border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm sm:items-center"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <span className="font-semibold text-emerald-900">
          {t("auth.signupV2.completionBanner.title")}
        </span>
        <span className="text-emerald-800">
          {t("auth.signupV2.completionBanner.body")}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href="/settings#displayName"
          className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
        >
          {t("auth.signupV2.completionBanner.cta")}
        </Link>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t("auth.signupV2.completionBanner.dismissAria")}
          className="rounded-full px-2.5 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
        >
          {t("auth.signupV2.completionBanner.dismiss")}
        </button>
      </div>
    </div>
  );
}
