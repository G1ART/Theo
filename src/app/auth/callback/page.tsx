"use client";

/**
 * Auth callback — the single landing page for every session-bearing
 * redirect (password sign-in, email confirmation link, magic link, and
 * OAuth Google / Apple as of Signup v2 Phase 3).
 *
 * OAuth branch (2026-08-19):
 *   - Callback is recognized via the `?provider=` query param that
 *     `signInWithOAuthProvider` stamps onto its `redirectTo`. As a
 *     defensive fallback we also inspect `session.user.identities[]`
 *     for a matching provider (identities is populated for OAuth-issued
 *     sessions but empty/undefined for email/password flows).
 *   - When the OAuth-issued session has no `profiles.full_name` yet,
 *     we seed it from `user_metadata.full_name || user_metadata.name`
 *     via the extended `upsert_my_profile` RPC. We deliberately DO NOT
 *     touch `profile_completed_at` — the Step 3 wizard is the sole
 *     owner of that stamp so the "Complete your profile" banner
 *     (spec §11.4) continues to surface until the user finishes Step 3.
 *   - After the seed, first-time OAuth users are routed to Signup v2
 *     Step 3 (`/signup?step=3`) so the wizard can collect username,
 *     age, role, visibility. If the v2 flag is OFF we fall back to the
 *     legacy `/onboarding/identity` gate via `routeByAuthState`.
 *
 * Every non-OAuth session path is unchanged — session existence is
 * verified, `getMyAuthState` decides the destination, and
 * `routeByAuthState` produces the final URL.
 */

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSession, getMyAuthState } from "@/lib/supabase/auth";
import { supabase } from "@/lib/supabase/client";
import { saveProfileUnified } from "@/lib/supabase/profileSaveUnified";
import { routeByAuthState, safeNextPath } from "@/lib/identity/routing";
import { isSignupV2Enabled } from "@/lib/featureFlags/signupV2";
import { useT } from "@/lib/i18n/useT";
import type { Session } from "@supabase/supabase-js";

const OAUTH_PROVIDERS = new Set(["google", "apple"]);

function detectOAuthProvider(
  session: Session,
  providerParam: string | null,
): string | null {
  if (providerParam && OAUTH_PROVIDERS.has(providerParam)) return providerParam;
  // Fallback: inspect identities. GoTrue populates `identities` for
  // sessions minted from an OAuth flow (each row has a `provider`
  // slug). Email/password sessions typically have an empty or
  // "email"-only identities array, so a matching OAuth provider here
  // is a strong signal.
  const identities = (session.user?.identities ?? []) as Array<{
    provider?: string | null;
  }>;
  for (const id of identities) {
    if (id.provider && OAUTH_PROVIDERS.has(id.provider)) return id.provider;
  }
  return null;
}

function pickOAuthFullName(session: Session): string | null {
  const meta = session.user?.user_metadata ?? {};
  const candidates = [
    typeof meta.full_name === "string" ? meta.full_name : null,
    typeof meta.name === "string" ? meta.name : null,
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const trimmed = raw.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/** Best-effort seed of `profiles.full_name` for a first-time OAuth
 *  session. Returns `true` when a seed was actually attempted (used to
 *  decide whether to route the user to Step 3 for the remaining
 *  wizard fields). Never throws — a failure just means the user will
 *  fill their name on the Step 3 form. */
async function maybeSeedFullNameFromOAuth(
  session: Session,
): Promise<boolean> {
  const suggested = pickOAuthFullName(session);
  if (!suggested) return false;

  // Read-only probe — the `createGuardedFetch` guard in
  // `src/lib/supabase/client.ts` only blocks writes on `/rest/v1/profiles`,
  // so this select is fine.
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", session.user.id)
    .maybeSingle();
  if (error) return false;

  const existing =
    data && typeof data.full_name === "string" ? data.full_name.trim() : "";
  if (existing) return false; // already set — respect user-owned value

  const res = await saveProfileUnified({
    basePatch: { full_name: suggested },
    detailsPatch: {},
    completeness: null,
  });
  // We intentionally ignore `res.ok === false` here — the account
  // exists, the session is live, and the wizard's Step 3 form will
  // let the user retry. Silent seed failure must not block sign-in.
  return res.ok === true;
}

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = safeNextPath(searchParams.get("next"));
  const providerParam = searchParams.get("provider");
  const { t } = useT();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await getSession();
      if (cancelled) return;
      if (!session) {
        router.replace("/");
        return;
      }

      const oauthProvider = detectOAuthProvider(session, providerParam);
      if (oauthProvider) {
        // Fire-and-forget the seed: it either succeeds silently or
        // leaves the field empty for Step 3 to collect. We await it so
        // the subsequent auth-state read reflects the write (the RPC
        // does not affect `needs_identity_setup`, so the wait is short
        // and does not gate the redirect on schema-cache staleness).
        await maybeSeedFullNameFromOAuth(session);
      }

      const state = await getMyAuthState();
      if (cancelled) return;

      // Route via the shared gate. `sessionPresent` prevents the
      // "RPC blipped → bounce to /login → login re-forwards here"
      // loop that used to happen when `get_my_auth_state` failed
      // transiently right after a fresh sign-in.
      const decision = routeByAuthState(state, {
        nextPath: nextParam,
        sessionPresent: true,
      });

      // First-time OAuth users still need to fill username / role /
      // age / visibility. When Signup v2 is enabled, hand them to
      // Step 3 of the new wizard instead of the legacy
      // `/onboarding/identity` screen the shared gate would otherwise
      // pick. Existing OAuth-linked accounts (identity already
      // complete) fall through to the normal destination.
      const needsWizard =
        !!state?.needs_identity_setup || !!state?.needs_onboarding;
      if (oauthProvider && needsWizard && isSignupV2Enabled()) {
        const query = new URLSearchParams();
        query.set("step", "3");
        if (nextParam) query.set("next", nextParam);
        router.replace(`/signup?${query.toString()}`);
        return;
      }

      router.replace(decision.to);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, nextParam, providerParam]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-zinc-600">{t("auth.signingIn")}</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-zinc-600">Loading...</p>
        </div>
      }
    >
      <AuthCallbackInner />
    </Suspense>
  );
}
