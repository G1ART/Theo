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

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSession, getMyAuthState } from "@/lib/supabase/auth";
import { ensureFreeEntitlement } from "@/lib/entitlements";
import { getMyProfile, updateMyProfileBase } from "@/lib/supabase/profiles";
import { saveProfileUnified } from "@/lib/supabase/profileSaveUnified";
import { useT } from "@/lib/i18n/useT";
import { routeByAuthState, safeNextPath, LOGIN_PATH } from "@/lib/identity/routing";
import { isRoleKey } from "@/lib/identity/roles";
import { isPlaceholderUsername } from "@/lib/identity/placeholder";
import { UsernameField } from "@/components/onboarding/UsernameField";
import { TheoLoadingMark } from "@/components/brand/TheoLoadingMark";
import { AuthShell } from "@/components/auth/primitives/AuthShell";
import { OvalInput } from "@/components/auth/primitives/OvalInput";
import { OvalSelect } from "@/components/auth/primitives/OvalSelect";
import { PillButton } from "@/components/auth/primitives/PillButton";

const STEP2_ROLES = ["artist", "curator", "collector"] as const;
const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

function splitPersonName(raw: string): { first: string; last: string } {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return { first: "", last: "" };
  const idx = trimmed.indexOf(" ");
  if (idx === -1) return { first: trimmed, last: "" };
  return { first: trimmed.slice(0, idx), last: trimmed.slice(idx + 1) };
}

function roleChoices(current: string): string[] {
  const keys: string[] = [...STEP2_ROLES];
  if (current && isRoleKey(current) && !keys.includes(current)) keys.push(current);
  return keys;
}

type LoadState = "loading" | "ready" | "redirecting";

function IdentityInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const { t, locale } = useT();

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [secondaryRole, setSecondaryRole] = useState("");
  const loadedNameRef = useRef("");
  /**
   * QA 2026-07-28 — 온보딩 이중언어. 큐레이터가 KO/EN 이름 쌍을 external_artists
   * 에 남겨두었으면 signup 트리거 (240005 SECTION 5) 가 새 profile 의
   * display_name_ko/en 로 상속한다. 여기서는 상속된 슬롯을 그대로 노출해
   * "큐레이터가 이렇게 등록했어요 — 이대로 사용하시겠어요?" 확정 flow 로 잇는다.
   * BilingualFieldPair 는 두 슬롯이 채워져 있으면 자동으로 secondary 를 펼친다.
   */
  const [displayNameKo, setDisplayNameKo] = useState("");
  const [displayNameEn, setDisplayNameEn] = useState("");
  const [username, setUsername] = useState("");
  const [mainRole, setMainRole] = useState<string>("");
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
        const rowKo = ((prof as { display_name_ko?: string | null }).display_name_ko ?? "").trim();
        const rowEn = ((prof as { display_name_en?: string | null }).display_name_en ?? "").trim();
        setDisplayNameKo(rowKo);
        setDisplayNameEn(rowEn);
        const source = (prof.display_name ?? "").trim() || rowKo || rowEn;
        const parts = splitPersonName(source);
        setFirstName(parts.first);
        setLastName(parts.last);
        loadedNameRef.current = source;
        const primary = (prof.main_role ?? "").trim() || "artist";
        setMainRole(primary);
        const loadedRoles = Array.isArray(prof.roles)
          ? prof.roles.filter((r): r is string => typeof r === "string")
          : [];
        if (!loadedRoles.includes(primary)) loadedRoles.push(primary);
        setSecondaryRole(loadedRoles.find((r) => r !== primary) ?? "");
        if (typeof prof.is_public === "boolean") setIsPublic(prof.is_public);
      } else {
        // First render with no profile row yet — seed what we can from
        // auth user_metadata so the user isn't facing a blank form.
        const meta = session.user.user_metadata as
          | {
              username?: string | null;
              display_name?: string | null;
              display_name_ko?: string | null;
              display_name_en?: string | null;
              main_role?: string | null;
              roles?: string[] | null;
            }
          | undefined;
        if (meta?.username) setUsername(String(meta.username).toLowerCase());
        if (meta?.display_name_ko) setDisplayNameKo(String(meta.display_name_ko));
        if (meta?.display_name_en) setDisplayNameEn(String(meta.display_name_en));
        const source = String(meta?.display_name ?? meta?.display_name_ko ?? meta?.display_name_en ?? "").trim();
        const parts = splitPersonName(source);
        setFirstName(parts.first);
        setLastName(parts.last);
        loadedNameRef.current = source;
        const primary = String(meta?.main_role ?? "").trim() || "artist";
        setMainRole(primary);
        const loadedRoles = Array.isArray(meta?.roles)
          ? meta.roles.filter((r): r is string => typeof r === "string")
          : [];
        if (!loadedRoles.includes(primary)) loadedRoles.push(primary);
        setSecondaryRole(loadedRoles.find((r) => r !== primary) ?? "");
      }
      setLoadState("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [router, nextPath]);

  const handleUsernameValidity = useCallback((isReady: boolean) => {
    setUsernameReady(isReady);
  }, []);

  const normalizedUsername = username.trim().toLowerCase();
  const trimmedFirst = firstName.trim();
  const trimmedLast = lastName.trim();
  const joinedName = [trimmedFirst, trimmedLast].filter(Boolean).join(" ");
  const suggestionInput = useMemo(
    () => ({ displayName: joinedName, email: userEmail }),
    [joinedName, userEmail]
  );
  const trimmedDisplayKo = displayNameKo.trim();
  const trimmedDisplayEn = displayNameEn.trim();
  const canSubmit =
    !saving &&
    usernameReady &&
    USERNAME_REGEX.test(normalizedUsername) &&
    !isPlaceholderUsername(normalizedUsername) &&
    trimmedFirst.length > 0 &&
    trimmedLast.length > 0 &&
    mainRole.length > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!trimmedFirst || !trimmedLast) {
      setError(t("auth.signupV2.step2.nameRequired"));
      return;
    }
    if (!mainRole) {
      setError(t("identity.finish.missingRoles"));
      return;
    }
    const rolesToSave = [mainRole];
    if (secondaryRole && secondaryRole !== mainRole) rolesToSave.push(secondaryRole);
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

    const nameChanged = joinedName !== loadedNameRef.current.trim();
    const nextKo = nameChanged && locale === "ko" ? joinedName : trimmedDisplayKo || null;
    const nextEn = nameChanged && locale === "en" ? joinedName : trimmedDisplayEn || null;
    const baseRes = await updateMyProfileBase({
      display_name: joinedName,
      display_name_ko: nextKo,
      display_name_en: nextEn,
      main_role: mainRole,
      roles: rolesToSave,
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
      <div className="flex min-h-screen flex-col items-center justify-center">
        <TheoLoadingMark />
      </div>
    );
  }

  const primaryOptions = roleChoices(mainRole).map((role) => ({
    value: role,
    label: t(`role.${role}`),
  }));
  const secondaryOptions = [
    ...roleChoices(secondaryRole).map((role) => ({
      value: role,
      label: t(`role.${role}`),
    })),
    { value: "", label: t("auth.signupV2.step2.chooseLater") },
  ];

  return (
    <AuthShell
      brandPlacement="none"
      title={t("auth.signupV2.stepLabel.step2")}
      subtitle={t("auth.signupV2.step2.subLabel")}
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <UsernameField
          variant="oval"
          label={t("auth.signupV2.step2.usernameLabel")}
          value={username}
          onChange={setUsername}
          suggestionInput={suggestionInput}
          onValidityChange={handleUsernameValidity}
          inputId="identity-username"
        />

        <div className="grid grid-cols-2 gap-3">
          <OvalInput
            labelStyle="outer"
            label={t("auth.signupV2.step2.firstNameLabel")}
            value={firstName}
            onChange={setFirstName}
            autoComplete="given-name"
            required
          />
          <OvalInput
            labelStyle="outer"
            label={t("auth.signupV2.step2.lastNameLabel")}
            value={lastName}
            onChange={setLastName}
            autoComplete="family-name"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <OvalSelect
            labelStyle="outer"
            label={t("auth.signupV2.step3.primaryRoleLabel")}
            required
            value={mainRole}
            onChange={setMainRole}
            options={primaryOptions}
          />
          <OvalSelect
            labelStyle="outer"
            label={t("auth.signupV2.step3.secondaryRoleLabel")}
            value={secondaryRole}
            onChange={setSecondaryRole}
            options={secondaryOptions}
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <PillButton type="submit" variant="primary" fullWidth loading={saving} disabled={!canSubmit}>
          {saving ? t("identity.finish.saving") : t("auth.signupV2.step2.finish")}
        </PillButton>
      </form>
    </AuthShell>
  );
}

export default function OnboardingIdentityPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center">
          <TheoLoadingMark />
        </div>
      }
    >
      <IdentityInner />
    </Suspense>
  );
}
