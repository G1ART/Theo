"use client";

/**
 * ExistingUserCompletionBanner — Signup v2 Phase 4.
 *
 * Mounted in the root layout, so it can appear on most authed surfaces
 * (feed, studio, etc.). It is NOT a 100%-completeness nag.
 *
 * Shown only when ALL of these hold:
 *   1. Signup v2 flag is on and a session exists.
 *   2. Path is not an auth / settings / legal surface.
 *   3. Not dismissed this session.
 *   4. `profile_completed_at` is still null (never went through the
 *      new Step 3 / Settings stamp).
 *   5. Name **or** primary role is still empty — the fields the banner
 *      actually asks for. Age is optional, so a missing age band does
 *      not keep the banner alive.
 *   6. Stored completeness is below 70 (or unknown). A reasonably
 *      filled profile should never see this bar.
 *
 * Remaining polish lives in Settings (completeness meter + gap links).
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/useT";
import { isSignupV2Enabled } from "@/lib/featureFlags/signupV2";
import {
  shouldShowExistingUserCompletionBanner,
  type ProfileBasicsForBanner,
} from "@/lib/profile/completeness";

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

export function ExistingUserCompletionBanner() {
  const { t } = useT();
  const pathname = usePathname();
  const flagOn = useMemo(() => isSignupV2Enabled(), []);

  const [mounted, setMounted] = useState(false);
  const [profile, setProfile] = useState<ProfileBasicsForBanner | null>(null);
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
      .select(
        "profile_completed_at, full_name, display_name, main_role, roles, profile_completeness",
      )
      .eq("id", session.user.id)
      .maybeSingle();
    if (error) {
      setProfile(null);
      return;
    }
    setProfile((data ?? null) as ProfileBasicsForBanner | null);
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
  if (!shouldShowExistingUserCompletionBanner(profile)) return null;

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
