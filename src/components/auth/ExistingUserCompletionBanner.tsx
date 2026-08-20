"use client";

/**
 * ExistingUserCompletionBanner — Signup v2 Phase 4 (§11.4), 2026-08-19.
 *
 * Nudges existing users whose `profiles.profile_completed_at IS NULL`
 * to finish the new Signup v2 Step 3 (full_name / age_band /
 * main_role). Only rendered when:
 *
 *   1. `NEXT_PUBLIC_SIGNUP_V2` is enabled — no point pointing users at
 *      `/signup?step=3` while the wizard is still off.
 *   2. A session exists (unauth landing pages have nothing to nudge).
 *   3. `profile_completed_at IS NULL` (Signup v2 stamps this via
 *      `upsert_my_profile('profile_completed_at' => 'now')` in Step 3).
 *   4. The user hasn't dismissed the banner this session — dismissal is
 *      stored in `sessionStorage:signup:v2:completionBannerDismissed`,
 *      so it re-appears on next login (per §11.4).
 *   5. The current path is not an auth / signup / legal surface — those
 *      views already own the CTA elsewhere.
 *
 * Wizard seed: on CTA click we pre-fill the wizard sessionStorage draft
 * from the current profile row (username, display_name, avatar_url) so
 * Step 3 lands with populated fields instead of an empty form.
 *
 * Kept intentionally lightweight — direct Supabase select for
 * `profile_completed_at, username, display_name, avatar_url` rather
 * than plumbing a new field through the existing `Profile` selector
 * (which would touch every consumer). We only need those four columns
 * and only when the flag is on.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/useT";
import { isSignupV2Enabled } from "@/lib/featureFlags/signupV2";
import {
  clearSignupDraft,
  saveSignupDraft,
  type SignupV2Draft,
} from "@/lib/auth/signupWizardState";

const DISMISS_KEY = "signup:v2:completionBannerDismissed";

// Auth-flow surfaces where the banner would be redundant or distracting.
const HIDDEN_PATH_PREFIXES = [
  "/signup",
  "/login",
  "/legal",
  "/auth",
  "/onboarding",
  "/set-password",
];

function isHiddenPath(pathname: string | null): boolean {
  if (!pathname) return true;
  return HIDDEN_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

type MinimalProfile = {
  profile_completed_at: string | null;
  full_name: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

export function ExistingUserCompletionBanner() {
  const { t } = useT();
  const pathname = usePathname();
  const flagOn = useMemo(() => isSignupV2Enabled(), []);

  const [mounted, setMounted] = useState(false);
  const [profile, setProfile] = useState<MinimalProfile | null>(null);
  // Start dismissed=true so nothing paints during SSR. The mount effect
  // synchronises the real value from sessionStorage on the client.
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
    // Targeted select — no need to widen PROFILE_ME_SELECT for a single
    // one-off banner. If either column doesn't exist yet the row simply
    // comes back with NULL, which the guard below handles.
    const { data, error } = await supabase
      .from("profiles")
      .select("profile_completed_at, full_name, username, display_name, avatar_url")
      .eq("id", session.user.id)
      .maybeSingle();
    if (error) {
      // Fail closed — don't nag on a transient read failure.
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
    // Signup v2 dispatches this custom event after Step 3 completes so
    // the banner disappears the moment the profile is filled in without
    // waiting for the next full-page navigation.
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

  const handleCta = useCallback(() => {
    if (!profile) return;
    // Seed the wizard sessionStorage so Step 3 renders with the user's
    // existing data instead of an empty form. The wizard resolver in
    // `SignupWizardShell` will pick this up when the user lands on
    // `/signup?step=3`. We intentionally clear any stale draft first
    // so we don't merge with an aborted flow.
    try {
      clearSignupDraft();
      const patch: Partial<Omit<SignupV2Draft, "version" | "savedAt">> = {
        step: 3,
        fullName: profile.full_name ?? "",
        username: profile.username ?? "",
        usernameSeed: profile.username ?? "",
      };
      saveSignupDraft(patch);
    } catch {
      /* sessionStorage may be blocked (private mode) — the wizard just
         starts from an empty draft, which is still fine. */
    }
  }, [profile]);

  if (!mounted || !flagOn) return null;
  if (dismissed) return null;
  if (isHiddenPath(pathname)) return null;
  if (!profile) return null;
  // The gate: banner shows only when the new completion timestamp is
  // still NULL. Legacy profiles from before the Signup v2 migration
  // fall into this bucket automatically.
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
          href="/signup?step=3"
          onClick={handleCta}
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
