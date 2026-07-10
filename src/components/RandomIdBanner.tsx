"use client";

/**
 * Top-of-page banner for placeholder-username users.
 * Non-dismissable: AuthGate provides the hard redirect, but this banner
 * acts as a persistent, visible call-to-action even on pages that load
 * before the gate fires.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { getMyProfile } from "@/lib/supabase/profiles";
import { getMyAuthState } from "@/lib/supabase/auth";
import { useT } from "@/lib/i18n/useT";
import { isPlaceholderUsername } from "@/lib/identity/placeholder";
import { IDENTITY_FINISH_PATH } from "@/lib/identity/routing";

export function RandomIdBanner() {
  const { t } = useT();
  const [show, setShow] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const refresh = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      setShow(false);
      return;
    }

    // Authoritative source of truth: the server-side RPC. When it answers we
    // trust it verbatim — this is the same gate AuthGate / login routing use.
    const state = await getMyAuthState();
    if (state) {
      setShow(!!state.needs_identity_setup);
      return;
    }

    // RPC failed transiently (schema-cache miss, token refresh in flight,
    // flaky mobile network). Fall back to a direct profile read, but FAIL
    // SAFE: a null/errored fetch must NOT flip the banner on for an
    // already-complete account. On mobile, onAuthStateChange fires often
    // (TOKEN_REFRESHED / SIGNED_IN on app resume) and each fired read can
    // race the refreshing token, momentarily returning no row — treating
    // that as "needs setup" is exactly what made the orange banner leak
    // onto 92%-complete profiles. So on any uncertainty we leave the prior
    // state untouched instead of guessing.
    const { data, error } = await getMyProfile();
    if (error || !data) return;
    const profile = data as {
      username?: string | null;
      display_name?: string | null;
      roles?: string[] | null;
      main_role?: string | null;
    };
    const username = profile?.username ?? null;
    const displayName = profile?.display_name ?? null;
    const roles = profile?.roles ?? null;
    const mainRole = profile?.main_role ?? null;
    // Mirror the server SSOT (get_my_auth_state.needs_identity_setup): show
    // the banner when the username is missing/placeholder, OR display_name,
    // roles, or main_role are unset.
    const needsSetup =
      !username ||
      isPlaceholderUsername(username) ||
      !displayName?.trim() ||
      !roles?.length ||
      !mainRole?.trim();
    setShow(needsSetup);
  }, []);

  useEffect(() => {
    if (!mounted || typeof window === "undefined") return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      void refresh();
    };
    run();
    // Re-evaluate when the profile is saved (onboarding completion) or when the
    // auth session changes — the root layout never remounts on client
    // navigation, so a one-shot mount read would otherwise stay stale and
    // trap the user in the onboarding banner loop.
    window.addEventListener("profile-updated", run);
    const { data: sub } = supabase.auth.onAuthStateChange(() => run());
    return () => {
      cancelled = true;
      window.removeEventListener("profile-updated", run);
      sub.subscription.unsubscribe();
    };
  }, [mounted, refresh]);

  if (!show) return null;

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 border-b-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
        <span className="font-semibold text-amber-900">
          {t("banner.identityFinish.title")}
        </span>
        <span className="text-amber-800">{t("banner.identityFinish.cta")}</span>
      </div>
      <Link
        href={IDENTITY_FINISH_PATH}
        className="shrink-0 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
      >
        {t("banner.identityFinish.link")} →
      </Link>
    </div>
  );
}
