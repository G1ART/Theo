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
import { TheoLoadingMark } from "@/components/brand/TheoLoadingMark";
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
 *
 * Safari with several withtheo.art tabs can hang inside supabase-js
 * `getSession()` (Navigator LockManager). Cap the wait and fail-open
 * so a refresh cannot strand the artist on a blank white canvas. After
 * fail-open, keep awaiting the same session promise and still apply
 * redirects if it later resolves.
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

const AUTH_WAIT_MS = 4000;
const SLOW_HINT_MS = 2000;
const AUTH_TIMEOUT = Symbol("auth-timeout");

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | typeof AUTH_TIMEOUT> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(AUTH_TIMEOUT), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(AUTH_TIMEOUT);
      },
    );
  });
}

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
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const slowTimer = window.setTimeout(() => {
      if (!cancelled) setSlow(true);
    }, SLOW_HINT_MS);

    async function afterSession(
      session: Awaited<ReturnType<typeof getSession>>["data"]["session"],
    ): Promise<void> {
      if (cancelled) return;
      if (!session) {
        router.replace(LOGIN_PATH);
        return;
      }
      const state = await withTimeout(getMyAuthState(), AUTH_WAIT_MS);
      if (cancelled) return;
      if (state === AUTH_TIMEOUT || !state) {
        // RPC failed transiently (schema cache miss, migration lag, token
        // refresh in flight, flaky mobile network). Fall back to a direct
        // profile read — but FAIL SAFE. If that read also fails or returns no
        // row we CANNOT confirm a real gap, so we let the page render instead
        // of bouncing a complete user to /onboarding/identity. Bouncing on a
        // transient null was the mobile "re-login → identity setup" leak; a
        // genuinely-incomplete user still has a real row with empty fields and
        // is caught below (and on the next navigation).
        const profileResult = await withTimeout(getMyProfile(), AUTH_WAIT_MS);
        if (cancelled) return;
        if (profileResult !== AUTH_TIMEOUT) {
          const { data: profile, error } = profileResult;
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
        const profileResult = await withTimeout(getMyProfile(), AUTH_WAIT_MS);
        if (cancelled) return;
        const profileBundle =
          profileResult === AUTH_TIMEOUT ? null : profileResult;
        const confirmedIncomplete =
          !!profileBundle &&
          !profileBundle.error &&
          !!profileBundle.data &&
          profileIsIncomplete(profileBundle.data as ProfileIdentityFields);
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
    }

    (async () => {
      // Keep the same promise so a hung getSession can still resolve in
      // the background after we fail-open the UI.
      const sessionPromise = getSession();
      const sessionResult = await withTimeout(sessionPromise, AUTH_WAIT_MS);
      if (cancelled) return;
      if (sessionResult === AUTH_TIMEOUT) {
        // Hung lock / flaky Safari — do not keep a blank canvas, and do
        // not bounce to /login (timeout is not "no session"). Retry the
        // same promise so a late session still redirects when needed.
        setReady(true);
        try {
          const late = await sessionPromise;
          if (cancelled) return;
          await afterSession(late.data.session);
        } catch {
          // Stay fail-open. A hung promise never settling is the
          // original Safari LockManager failure mode.
        }
        return;
      }
      await afterSession(sessionResult.data.session);
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
    };
  }, [router, pathname]);

  if (!ready) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 px-4 py-12">
        <TheoLoadingMark />
        {slow && (
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-sm text-zinc-500">{t("auth.gate.slow")}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
            >
              {t("common.retry")}
            </button>
          </div>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
