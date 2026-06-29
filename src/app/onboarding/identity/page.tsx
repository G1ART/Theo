"use client";

/**
 * Identity-finish surface (Onboarding Identity Overhaul + Smoothness
 * Follow-up, Track D).
 *
 * Single authoritative source for public identity completion. All
 * signup flavors (password, magic-link, invite) are routed here by
 * `routeByAuthState` whenever `needs_identity_setup` is true.
 *
 * Visual rhythm:
 *   - "Step 2 of 2" eyebrow frames this as a finite, one-time setup
 *   - Grouped sections separate the three intents: identity, role,
 *     visibility
 *   - Live preview collapses the mental model of "how will this look"
 *
 * Field scope (intentionally narrow):
 *   - display_name, username  → identity
 *   - main_role, roles        → role
 *   - is_public               → visibility (optional)
 * Everything else (bio, website, themes, cover) is left to Studio.
 */

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSession, getMyAuthState } from "@/lib/supabase/auth";
import { ensureFreeEntitlement } from "@/lib/entitlements";
import { getMyProfile, updateMyProfileBase } from "@/lib/supabase/profiles";
import { saveProfileUnified } from "@/lib/supabase/profileSaveUnified";
import { useT } from "@/lib/i18n/useT";
import { routeByAuthState, safeNextPath, LOGIN_PATH } from "@/lib/identity/routing";
import { ROLE_KEYS, type RoleKey } from "@/lib/identity/roles";
import { isPlaceholderUsername } from "@/lib/identity/placeholder";
import { UsernameField } from "@/components/onboarding/UsernameField";
import { IdentityPreview } from "@/components/onboarding/IdentityPreview";
import { SectionFrame, SectionTitle } from "@/components/ds";

const MAIN_ROLES = ROLE_KEYS;
const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

type LoadState = "loading" | "ready" | "redirecting";

function IdentityInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const { t } = useT();

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [mainRole, setMainRole] = useState<string>("");
  const [roles, setRoles] = useState<string[]>([]);
  const [isPublic, setIsPublic] = useState(true);

  const [usernameReady, setUsernameReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      // Already complete: short-circuit through the shared gate.
      if (state && !state.needs_identity_setup && !state.needs_onboarding) {
        setLoadState("redirecting");
        const { to } = routeByAuthState(state, { nextPath, sessionPresent: true });
        router.replace(to);
        return;
      }

      // QA P0.5-D (rows 30, 35): defensive check — even when the auth-state
      // RPC reports `needs_identity_setup=true`, an immediately-fresh
      // profile row read can show that the user actually finished setup
      // (we have seen brief inconsistencies right after upsert_my_profile
      // commits). If the profile is concretely complete, mirror the
      // "already complete" branch so the user does NOT get stuck on the
      // "Step 2 of 2" screen on every visit to /my.
      if (state?.needs_identity_setup) {
        const { data: profileNow } = await getMyProfile();
        if (cancelled) return;
        const pn = profileNow as
          | {
              username?: string | null;
              display_name?: string | null;
              roles?: string[] | null;
              main_role?: string | null;
            }
          | null;
        const completeNow =
          !!pn &&
          !!pn.username &&
          !isPlaceholderUsername(pn.username) &&
          !!pn.display_name?.trim() &&
          Array.isArray(pn.roles) &&
          pn.roles.length > 0 &&
          !!pn.main_role?.trim();
        if (completeNow) {
          setLoadState("redirecting");
          router.replace(nextPath ?? "/feed?tab=all&sort=latest");
          return;
        }
      }

      setUserEmail(session.user.email ?? null);

      const { data: profile } = await getMyProfile();
      if (cancelled) return;
      const prof = profile as
        | {
            username?: string | null;
            display_name?: string | null;
            main_role?: string | null;
            roles?: string[] | null;
            is_public?: boolean | null;
          }
        | null;
      if (prof) {
        const u = (prof.username ?? "").trim().toLowerCase();
        setUsername(isPlaceholderUsername(u) ? "" : u);
        setDisplayName((prof.display_name ?? "").trim());
        setMainRole((prof.main_role ?? "").trim());
        setRoles(
          Array.isArray(prof.roles)
            ? prof.roles.filter((r): r is string => typeof r === "string")
            : []
        );
        if (typeof prof.is_public === "boolean") setIsPublic(prof.is_public);
      } else {
        // First render with no profile row yet — seed what we can from
        // auth user_metadata so the user isn't facing a blank form.
        const meta = session.user.user_metadata as
          | {
              username?: string | null;
              display_name?: string | null;
              main_role?: string | null;
              roles?: string[] | null;
            }
          | undefined;
        if (meta?.username) setUsername(String(meta.username).toLowerCase());
        if (meta?.display_name) setDisplayName(String(meta.display_name));
        if (meta?.main_role) setMainRole(String(meta.main_role));
        if (Array.isArray(meta?.roles))
          setRoles(meta.roles.filter((r): r is string => typeof r === "string"));
      }
      setLoadState("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [router, nextPath]);

  const suggestionInput = useMemo(
    () => ({ displayName, email: userEmail }),
    [displayName, userEmail]
  );

  const handleUsernameValidity = useCallback((isReady: boolean) => {
    setUsernameReady(isReady);
  }, []);

  function toggleRole(role: string) {
    const isRemoving = roles.includes(role);
    // Invariant: main_role must always be a member of roles. The only
    // way to lose the current primary is to promote another role from
    // the <select> above. Blocking the chip here is less noisy than
    // auto-clearing main_role behind the user's back.
    if (isRemoving && role === mainRole) {
      setError(t("identity.finish.primaryLockHint"));
      return;
    }
    setError((prev) =>
      prev === t("identity.finish.primaryLockHint") ? null : prev
    );
    setRoles((prev) => {
      const next = isRemoving ? prev.filter((r) => r !== role) : [...prev, role];
      // Pick the first selected role as primary if none is chosen yet —
      // this removes the "I picked a role but the primary is still
      // blank" confusion without stealing a deliberate choice.
      if (!mainRole && !prev.includes(role)) setMainRole(role);
      return next;
    });
  }

  const normalizedUsername = username.trim().toLowerCase();
  const trimmedDisplay = displayName.trim();
  const canSubmit =
    !saving &&
    usernameReady &&
    USERNAME_REGEX.test(normalizedUsername) &&
    !isPlaceholderUsername(normalizedUsername) &&
    trimmedDisplay.length > 0 &&
    roles.length >= 1 &&
    mainRole.length > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!trimmedDisplay) {
      setError(t("identity.finish.missingDisplayName"));
      return;
    }
    if (roles.length < 1 || !mainRole) {
      setError(t("identity.finish.missingRoles"));
      return;
    }
    // Defensive last line of defense: even if toggleRole is somehow
    // bypassed (race, keyboard, future refactor), the payload must not
    // ship a primary that isn't one of the selected roles.
    if (!roles.includes(mainRole)) {
      setError(t("identity.finish.primaryDesync"));
      return;
    }
    if (!USERNAME_REGEX.test(normalizedUsername) || isPlaceholderUsername(normalizedUsername)) {
      setError(t("identity.username.live.invalid"));
      return;
    }

    setSaving(true);
    const {
      data: { session },
    } = await getSession();
    if (!session?.user?.id) {
      setSaving(false);
      router.replace(LOGIN_PATH);
      return;
    }

    // Username goes through the unified save (username is outside
    // updateMyProfileBase's whitelist); the remaining fields go
    // through the standard base update so existing validators apply.
    const usernameRes = await saveProfileUnified({
      basePatch: { username: normalizedUsername },
      detailsPatch: {},
      completeness: null,
    });
    if (!usernameRes.ok) {
      setSaving(false);
      setError(
        usernameRes.message?.trim()
          ? `${usernameRes.message} (${usernameRes.code ?? "Error"})`
          : t("identity.finish.error")
      );
      return;
    }

    const baseRes = await updateMyProfileBase({
      display_name: trimmedDisplay,
      main_role: mainRole,
      roles,
      is_public: isPublic,
    });
    if (baseRes.error) {
      setSaving(false);
      setError(t("identity.finish.error"));
      return;
    }

    await ensureFreeEntitlement(session.user.id);
    const freshState = await getMyAuthState();
    setSaving(false);

    // Defensive: the auth-state RPC can briefly lag a just-committed
    // upsert_my_profile (read-after-write), which would bounce the user right
    // back to this screen. If the profile row itself is concretely complete,
    // trust that and proceed — mirrors the load-time guard above.
    if (freshState?.needs_identity_setup) {
      const { data: profileNow } = await getMyProfile();
      const pn = profileNow as
        | {
            username?: string | null;
            display_name?: string | null;
            roles?: string[] | null;
            main_role?: string | null;
          }
        | null;
      const completeNow =
        !!pn &&
        !!pn.username &&
        !isPlaceholderUsername(pn.username) &&
        !!pn.display_name?.trim() &&
        Array.isArray(pn.roles) &&
        pn.roles.length > 0 &&
        !!pn.main_role?.trim();
      if (completeNow) {
        router.replace(nextPath ?? "/feed?tab=all&sort=latest");
        return;
      }
    }

    const { to } = routeByAuthState(freshState, { nextPath, sessionPresent: true });
    router.replace(to);
  }

  if (loadState !== "ready") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <p className="text-lg font-semibold text-zinc-900">Theo</p>
        <p className="text-zinc-600">{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg px-4 py-10">
      <header className="mb-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          {t("identity.finish.stepEyebrow")}
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-900">
          {t("identity.finish.title")}
        </h1>
        <p className="mt-2 text-sm text-zinc-600">{t("identity.finish.subtitle")}</p>
        <p className="mt-1 text-xs text-zinc-500">{t("identity.finish.oneTime")}</p>
      </header>

      <div className="mb-6">
        <IdentityPreview
          displayName={displayName}
          username={normalizedUsername}
          mainRole={mainRole}
          roles={roles}
          isPublic={isPublic}
        />
      </div>

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <SectionFrame padding="md" noMargin>
          <SectionTitle
            eyebrow={t("identity.finish.sectionYouEyebrow")}
            size="sm"
          >
            {t("identity.finish.sectionYou")}
          </SectionTitle>
          <div className="space-y-4">
            <div className="space-y-1">
              <label
                htmlFor="identity-display-name"
                className="block text-sm font-medium text-zinc-900"
              >
                {t("identity.finish.labelDisplayName")}
              </label>
              <input
                id="identity-display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t("identity.finish.placeholderDisplayName")}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
                autoComplete="name"
                maxLength={80}
                required
              />
              <p className="text-xs text-zinc-500">
                {t("identity.finish.displayNameHint")}
              </p>
            </div>

            <UsernameField
              value={username}
              onChange={setUsername}
              suggestionInput={suggestionInput}
              onValidityChange={handleUsernameValidity}
              inputId="identity-username"
            />
          </div>
        </SectionFrame>

        <SectionFrame padding="md" noMargin>
          <SectionTitle
            eyebrow={t("identity.finish.sectionRoleEyebrow")}
            size="sm"
          >
            {t("identity.finish.sectionRole")}
          </SectionTitle>
          <div className="space-y-4">
            <div className="space-y-1">
              <label
                htmlFor="identity-main-role"
                className="block text-sm font-medium text-zinc-900"
              >
                {t("identity.finish.labelPrimaryRole")}
              </label>
              <select
                id="identity-main-role"
                value={mainRole}
                onChange={(e) => {
                  const next = e.target.value;
                  setMainRole(next);
                  if (next && !roles.includes(next)) {
                    setRoles((prev) => [...prev, next]);
                  }
                }}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
                required
              >
                <option value="">{t("common.selectOption")}</option>
                {MAIN_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`role.${r}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <span className="block text-sm font-medium text-zinc-900">
                {t("identity.finish.labelRoles")}
              </span>
              <p className="text-xs text-zinc-500">
                {t("identity.finish.rolesHint")}
              </p>
              <div className="flex flex-wrap gap-2">
                {MAIN_ROLES.map((r: RoleKey) => {
                  const active = roles.includes(r);
                  const isPrimary = mainRole === r;
                  return (
                    <button
                      type="button"
                      key={r}
                      onClick={() => toggleRole(r)}
                      aria-pressed={active}
                      title={isPrimary ? t("identity.finish.primaryLockHint") : undefined}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        active
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400"
                      }`}
                    >
                      {t(`role.${r}`)}
                      {isPrimary && (
                        <span className="ml-1.5 rounded bg-white/20 px-1 text-[10px] font-semibold uppercase tracking-wide">
                          {t("role.primarySuffix")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </SectionFrame>

        <SectionFrame padding="md" tone="muted" noMargin>
          <SectionTitle
            eyebrow={t("identity.finish.sectionVisibilityEyebrow")}
            size="sm"
          >
            {t("identity.finish.sectionVisibility")}
          </SectionTitle>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-zinc-900">
                {t("identity.finish.labelPublic")}
              </p>
              <p className="text-xs text-zinc-500">
                {isPublic
                  ? t("identity.finish.publicHint")
                  : t("identity.finish.privateHint")}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isPublic}
              aria-label={t("identity.finish.labelPublic")}
              onClick={() => setIsPublic((v) => !v)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                isPublic ? "bg-emerald-500" : "bg-zinc-300"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  isPublic ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </SectionFrame>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="sticky bottom-0 -mx-4 border-t border-zinc-100 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-md bg-zinc-900 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? t("identity.finish.saving") : t("identity.finish.primaryCta")}
          </button>
          <p className="mt-2 text-center text-[11px] text-zinc-500">
            {t("identity.finish.studioNext")}
          </p>
        </div>
      </form>
    </main>
  );
}

export default function OnboardingIdentityPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center gap-3">
          <p className="text-lg font-semibold text-zinc-900">Theo</p>
          <p className="text-zinc-600">Loading...</p>
        </div>
      }
    >
      <IdentityInner />
    </Suspense>
  );
}
