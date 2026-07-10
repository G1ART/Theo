"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSession, getMyAuthState } from "@/lib/supabase/auth";
import { getMyProfile } from "@/lib/supabase/profiles";
import { isPlaceholderUsername } from "@/lib/identity/placeholder";
import {
  IDENTITY_FINISH_PATH,
  ONBOARDING_PATH,
  SET_PASSWORD_PATH,
  LOGIN_PATH,
} from "@/lib/identity/routing";
import { useT } from "@/lib/i18n/useT";

/**
 * Client-side gate that guards protected product surfaces. It only
 * redirects when there is a concrete gap (no session, identity
 * incomplete, missing password); otherwise it lets the wrapped page
 * render in place. This keeps URLs like `/feed?tab=all` and
 * `/artwork/123` sticky instead of bouncing them through the router.
 *
 * Precedence (Onboarding Identity Overhaul, Track D):
 *   1. no session            → /login
 *   2. needs_identity_setup  → /onboarding/identity?next=<current>
 *   3. needs_onboarding      → /onboarding
 *   4. !has_password         → /set-password
 */
function currentPathWithQuery(): string | null {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname;
  const search = window.location.search;
  if (!path) return null;
  return search ? `${path}${search}` : path;
}

type ProfileIdentityFields = {
  username?: string | null;
  display_name?: string | null;
  roles?: string[] | null;
  main_role?: string | null;
};

/**
 * Positive incompleteness check against a *loaded* profile row. Mirrors the
 * server SSOT (get_my_auth_state.needs_identity_setup). Callers must only
 * invoke this with a row that was actually fetched — a null/errored fetch is
 * treated as "cannot confirm" (see call sites) so a transient mobile network
 * blip during token refresh never bounces a complete user to identity setup.
 */
function profileIsIncomplete(p: ProfileIdentityFields): boolean {
  const username = p.username ?? null;
  return (
    !username ||
    isPlaceholderUsername(username) ||
    !p.display_name?.trim() ||
    !p.roles?.length ||
    !p.main_role?.trim()
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useT();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await getSession();
      if (cancelled) return;
      if (!session) {
        router.replace(LOGIN_PATH);
        return;
      }
      const state = await getMyAuthState();
      if (cancelled) return;
      if (!state) {
        // RPC failed transiently (schema cache miss, migration lag, token
        // refresh in flight, flaky mobile network). Fall back to a direct
        // profile read — but FAIL SAFE. If that read also fails or returns no
        // row we CANNOT confirm a real gap, so we let the page render instead
        // of bouncing a complete user to /onboarding/identity. Bouncing on a
        // transient null was the mobile "re-login → identity setup" leak; a
        // genuinely-incomplete user still has a real row with empty fields and
        // is caught below (and on the next navigation).
        const { data: profile, error } = await getMyProfile();
        if (cancelled) return;
        if (
          !error &&
          profile &&
          profileIsIncomplete(profile as ProfileIdentityFields)
        ) {
          const next = currentPathWithQuery();
          const isAlreadyFinish =
            pathname === IDENTITY_FINISH_PATH ||
            (pathname?.startsWith(`${IDENTITY_FINISH_PATH}/`) ?? false);
          if (!isAlreadyFinish) {
            const q = next ? `?next=${encodeURIComponent(next)}` : "";
            router.replace(`${IDENTITY_FINISH_PATH}${q}`);
            return;
          }
        }
        setReady(true);
        return;
      }

      if (state.needs_identity_setup) {
        // QA P0.5-D (rows 30, 35): get_my_auth_state RPC has shown stale
        // `needs_identity_setup=true` for some users right after they
        // finished /onboarding/identity (re-login fixed it for them).
        // The RPC reads directly from `public.profiles`, so the most
        // likely cause is supabase-js auth.uid() being momentarily
        // unbound after a write→read round-trip. We add a defensive
        // double-check: if the actual profile row already has a clean
        // username + display_name + roles + main_role, treat the
        // identity gate as satisfied. This prevents the "/my →
        // /onboarding/identity → /feed → /my (loop)" pattern.
        //
        // FAIL SAFE: only honor the redirect when we can *positively* confirm
        // the loaded profile is still incomplete. If the double-check read
        // errors or returns no row (transient token-refresh race, common on
        // mobile), we do NOT bounce — a stale `needs_identity_setup=true`
        // combined with a transient null must not trap a complete user.
        const { data: profile, error } = await getMyProfile();
        if (cancelled) return;
        const confirmedIncomplete =
          !error &&
          !!profile &&
          profileIsIncomplete(profile as ProfileIdentityFields);
        if (confirmedIncomplete) {
          const next = currentPathWithQuery();
          const isAlreadyFinish =
            pathname === IDENTITY_FINISH_PATH ||
            (pathname?.startsWith(`${IDENTITY_FINISH_PATH}/`) ?? false);
          if (!isAlreadyFinish) {
            const q = next ? `?next=${encodeURIComponent(next)}` : "";
            router.replace(`${IDENTITY_FINISH_PATH}${q}`);
            return;
          }
        }
      } else if (state.needs_onboarding) {
        const isAlreadyOnboarding =
          pathname === ONBOARDING_PATH ||
          (pathname?.startsWith(`${ONBOARDING_PATH}/`) ?? false);
        if (!isAlreadyOnboarding) {
          router.replace(ONBOARDING_PATH);
          return;
        }
      } else if (!state.has_password) {
        if (pathname !== SET_PASSWORD_PATH) {
          router.replace(SET_PASSWORD_PATH);
          return;
        }
      }

      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, pathname]);

  if (!ready) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <p className="text-lg font-semibold text-zinc-900">Theo</p>
        <p className="text-zinc-600">{t("common.loading")}</p>
      </div>
    );
  }

  return <>{children}</>;
}
