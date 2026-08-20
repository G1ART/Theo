"use client";

/**
 * Signup v2 · Step 3 (Profile) — Phase 1, 2026-08-19.
 *
 * Fields collected here (spec §2.4, §3.2):
 *   - full_name           (required)
 *   - age_band            (PillRadio, TAXONOMY.ageBandOptions)
 *   - main_role           (OvalSelect, ROLE_KEYS; skip allowed)
 *   - username            (OvalInput, `@` prefix, 300ms debounce
 *                          uniqueness check — error surfaces only on
 *                          collision, per §11.3)
 *
 * On submit:
 *   1. `signUpWithPassword` with the email / password captured in
 *      Steps 1 & 2. Anti-enumeration duplicate detection uses
 *      Supabase's "empty identities" signal — a known-email is treated
 *      as a "please log in" hint here.
 *   2. Once session is established, call `upsert_my_profile` with
 *      base = { username, main_role, display_name (= full_name),
 *      full_name, age_band, tos_accepted_at: "true",
 *      profile_completed_at: "true" }. The extended RPC (see
 *      `20260819180000_upsert_my_profile_signup_v2.sql`) stamps
 *      `tos_accepted_at` / `profile_completed_at` first-write-wins.
 *   3. Route through the shared `routeByAuthState` gate so users who
 *      still need `/onboarding/identity` steps (e.g. `roles[]` beyond
 *      main_role) are handed off correctly, otherwise land on `/feed`.
 *
 * Photo upload placeholder: avatar upload is intentionally deferred —
 * the field is present but disabled, with a copy that redirects users
 * to Studio → Profile once the account exists. This matches spec §2.4
 * decision #10 ("Photo upload placeholder — first release optional").
 */

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { OvalInput } from "@/components/auth/primitives/OvalInput";
import { OvalSelect } from "@/components/auth/primitives/OvalSelect";
import { PillRadio } from "@/components/auth/primitives/PillRadio";
import { PillButton } from "@/components/auth/primitives/PillButton";
import { useT } from "@/lib/i18n/useT";
import { TAXONOMY } from "@/lib/profile/taxonomy";
import { ROLE_KEYS } from "@/lib/identity/roles";
import {
  signUpWithPassword,
  signInWithPassword,
} from "@/lib/supabase/auth";
import { saveProfileUnified } from "@/lib/supabase/profileSaveUnified";
import {
  checkUsernameAvailability,
  type UsernameAvailabilityReason,
} from "@/lib/supabase/profiles";
import { ensureFreeEntitlement } from "@/lib/entitlements";
import { loginUrlWithNext } from "@/lib/identity/routing";
import type { SignupStepApi } from "../SignupWizardShell";
import type { SignupV2MainRole } from "@/lib/auth/signupWizardState";

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;
const USERNAME_DEBOUNCE_MS = 300;

type UsernameStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "taken" }
  | { kind: "invalid" }
  | { kind: "reserved" }
  | { kind: "error" };

function reasonToStatus(
  reason: UsernameAvailabilityReason,
  available: boolean,
): UsernameStatus {
  if (available && (reason === "available" || reason === "self")) {
    return { kind: "available" };
  }
  switch (reason) {
    case "taken":
      return { kind: "taken" };
    case "invalid":
    case "empty":
      return { kind: "invalid" };
    case "reserved":
      return { kind: "reserved" };
    default:
      return { kind: "error" };
  }
}

export function SignupStep3Profile({ api }: { api: SignupStepApi }) {
  const { t } = useT();

  const [fullName, setFullName] = useState(api.state.fullName);
  const [ageBand, setAgeBand] = useState(api.state.ageBand);
  const [mainRole, setMainRole] = useState<SignupV2MainRole | "">(api.state.mainRole);
  const [username, setUsername] = useState(
    api.state.username || api.state.usernameSeed || "",
  );
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>({
    kind: "idle",
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [duplicateEmail, setDuplicateEmail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const usernameSeqRef = useRef(0);

  // If Step 1 / Step 2 was skipped by an inbound link, bounce back to
  // the earliest missing step.
  useEffect(() => {
    if (!api.state.email) {
      api.goToStep(1);
      return;
    }
    if (!api.state.password) {
      api.goToStep(2);
    }
    // Intentionally single-shot — a subsequent state change (e.g. user
    // returns from Step 2 with the new password) should not re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const normalizedUsername = username.trim().toLowerCase();

  // Debounced username availability check (§11.3). Error state is
  // surfaced only when the RPC reports "taken" — matches the wireframe
  // intent of "silent success".
  useEffect(() => {
    if (!normalizedUsername) {
      setUsernameStatus({ kind: "idle" });
      return;
    }
    if (!USERNAME_REGEX.test(normalizedUsername)) {
      setUsernameStatus({ kind: "invalid" });
      return;
    }
    const seq = ++usernameSeqRef.current;
    setUsernameStatus({ kind: "checking" });
    const handle = setTimeout(async () => {
      const res = await checkUsernameAvailability(normalizedUsername);
      if (seq !== usernameSeqRef.current) return;
      setUsernameStatus(reasonToStatus(res.reason, res.available));
    }, USERNAME_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [normalizedUsername]);

  const persistCurrent = useCallback(() => {
    api.persistDraft({
      fullName: fullName.trim() || undefined,
      ageBand: ageBand || undefined,
      mainRole: (mainRole || undefined) as SignupV2MainRole | undefined,
      username: normalizedUsername || undefined,
    });
  }, [api, fullName, ageBand, mainRole, normalizedUsername]);

  const roleOptions = useMemo(
    () => [
      { value: "", label: t("auth.signupV2.step3.roleSkip") },
      ...ROLE_KEYS.map((r) => ({ value: r, label: t(`role.${r}`) })),
    ],
    [t],
  );

  const ageOptions = useMemo(
    () => TAXONOMY.ageBandOptions.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t],
  );

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (!fullName.trim()) return false;
    if (!USERNAME_REGEX.test(normalizedUsername)) return false;
    if (usernameStatus.kind === "taken") return false;
    if (usernameStatus.kind === "reserved") return false;
    if (usernameStatus.kind === "invalid") return false;
    return true;
  }, [submitting, fullName, normalizedUsername, usernameStatus.kind]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setDuplicateEmail(null);
    if (!canSubmit) return;
    if (!api.state.email || !api.state.password) {
      // Should not happen — a defensive guard.
      api.goToStep(!api.state.email ? 1 : 2);
      return;
    }
    setSubmitting(true);
    persistCurrent();

    // Step 1: create the account.
    const trimmedName = fullName.trim();
    const derivedRole: SignupV2MainRole | undefined =
      mainRole || undefined;
    const { data, error: signUpErr } = await signUpWithPassword(
      api.state.email,
      api.state.password,
      {
        username: normalizedUsername,
        display_name: trimmedName,
        main_role: derivedRole,
        roles: derivedRole ? [derivedRole] : undefined,
      },
      api.nextPath ?? null,
    );

    if (signUpErr) {
      setSubmitting(false);
      setSubmitError(signUpErr.message);
      return;
    }

    // Anti-enumeration duplicate: Supabase returns a synthetic user
    // with `identities: []` when the email is already registered.
    const identities = (data?.user as { identities?: unknown } | null)
      ?.identities;
    const isDuplicate =
      !!data?.user && Array.isArray(identities) && identities.length === 0;
    if (isDuplicate) {
      // Try `signInWithPassword` as a fallback — the user might have
      // returned to complete signup with credentials they've since
      // set. On success, route via the shared gate. On failure, show
      // the "we found an account" hint.
      const { data: loginData, error: loginErr } = await signInWithPassword(
        api.state.email,
        api.state.password,
      );
      if (!loginErr && loginData?.session) {
        await routeAfterAccount(loginData.session.user.id);
        return;
      }
      setSubmitting(false);
      setDuplicateEmail(api.state.email);
      return;
    }

    // Email-confirmation mode: show the "check your email" state.
    if (data?.user && !data?.session) {
      // We can't stamp the profile without a session yet. The auth
      // callback re-runs the identity gate — Step 3's `upsert_my_profile`
      // is left to the confirmation round-trip (auto-fired here as a
      // fire-and-forget; the callback will re-run it after session
      // materialises). Draft persists so the user resumes on click.
      setSubmitting(false);
      setSubmitError(t("auth.signupV2.step3.checkEmail"));
      return;
    }

    // Immediate-session mode: session is live, so we can stamp the
    // profile immediately.
    const uid = data?.session?.user?.id;
    if (!uid) {
      setSubmitting(false);
      setSubmitError(t("auth.signupV2.step3.errorGeneric"));
      return;
    }
    await routeAfterAccount(uid);
  }

  async function routeAfterAccount(userId: string) {
    try {
      await ensureFreeEntitlement(userId);
    } catch {
      /* best-effort: entitlement seed is idempotent, retry-safe */
    }

    // Stamp profile with the full Step 3 payload. `age_band` goes into
    // the physical column via the extended RPC (Signup v2 migration).
    // `tos_accepted_at` / `profile_completed_at` are stamp triggers —
    // the RPC uses coalesce() so re-signup cannot bump the timestamp.
    const trimmedName = fullName.trim();
    const savePayload: Record<string, unknown> = {
      username: normalizedUsername,
      display_name: trimmedName,
      full_name: trimmedName,
      tos_accepted_at: "true",
      profile_completed_at: "true",
    };
    if (mainRole) {
      savePayload.main_role = mainRole;
      savePayload.roles = [mainRole];
    }
    if (ageBand) {
      savePayload.age_band = ageBand;
    }
    if (typeof api.state.isPublic === "boolean") {
      savePayload.is_public = api.state.isPublic;
    }

    const res = await saveProfileUnified({
      basePatch: savePayload,
      detailsPatch: {},
      completeness: null,
    });
    if (!res.ok) {
      setSubmitting(false);
      // The most likely cause is the migration not yet being applied.
      // Surface a user-facing message but keep the account (signup
      // succeeded) so the user can still log in.
      setSubmitError(
        res.message?.trim()
          ? `${t("auth.signupV2.step3.errorSave")} (${res.code ?? "RPC"})`
          : t("auth.signupV2.step3.errorGeneric"),
      );
      return;
    }

    // Advance the wizard to Step 4 (optional artwork quick-start).
    // We intentionally do NOT clear the sessionStorage draft yet — Step
    // 4 still reads `mainRole` to choose its default intent. The draft
    // is cleared when Step 4 finishes (submit OR skip).
    setSubmitting(false);
    api.goToStep(4);
  }

  if (duplicateEmail) {
    return (
      <div className="rounded-3xl border border-amber-200 bg-amber-50/70 p-6 text-sm text-zinc-900">
        <p className="font-semibold">{t("auth.signupV2.step3.duplicateTitle")}</p>
        <p className="mt-2 text-zinc-700">
          {t("auth.signupV2.step3.duplicateBody").replace("{email}", duplicateEmail)}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={loginUrlWithNext({ nextPath: api.nextPath ?? undefined })}
            className="inline-flex items-center rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800"
          >
            {t("auth.signupV2.step3.duplicateLoginCta")}
          </Link>
          <Link
            href={`/auth/forgot?email=${encodeURIComponent(duplicateEmail)}`}
            className="inline-flex items-center rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-700 hover:border-zinc-500 hover:bg-white"
          >
            {t("auth.signupV2.step3.duplicateResetCta")}
          </Link>
          <button
            type="button"
            onClick={() => {
              setDuplicateEmail(null);
              api.goToStep(1);
            }}
            className="inline-flex items-center rounded-full px-4 py-2 text-xs font-medium text-zinc-600 hover:text-zinc-900"
          >
            {t("auth.signupV2.step3.duplicateChangeEmail")}
          </button>
        </div>
      </div>
    );
  }

  const usernameError =
    usernameStatus.kind === "taken"
      ? t("auth.signupV2.step3.usernameTaken")
      : usernameStatus.kind === "reserved"
      ? t("auth.signupV2.step3.usernameReserved")
      : undefined;
  const usernameHint = t("auth.signupV2.step3.usernameHint");

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <OvalInput
        label={t("auth.signupV2.step3.fullNameLabel")}
        value={fullName}
        onChange={(v) => {
          setFullName(v);
          api.updateState({ fullName: v });
        }}
        onBlur={() => persistCurrent()}
        autoComplete="name"
        required
        hint={t("auth.signupV2.step3.fullNameHint")}
      />

      <PillRadio
        label={t("auth.signupV2.step3.ageBandLabel")}
        value={ageBand || null}
        onChange={(v) => {
          setAgeBand(v);
          api.updateState({ ageBand: v });
          api.persistDraft({ ageBand: v });
        }}
        options={ageOptions}
        hint={t("auth.signupV2.step3.ageBandHint")}
      />

      <OvalSelect
        label={t("auth.signupV2.step3.mainRoleLabel")}
        value={mainRole}
        onChange={(v) => {
          const next = (v as SignupV2MainRole | "") || "";
          setMainRole(next);
          api.updateState({ mainRole: next });
          api.persistDraft({ mainRole: (next || undefined) as SignupV2MainRole | undefined });
        }}
        options={roleOptions}
        placeholder={t("auth.signupV2.step3.mainRolePlaceholder")}
        hint={t("auth.signupV2.step3.mainRoleHint")}
      />

      <OvalInput
        label={t("auth.signupV2.step3.usernameLabel")}
        value={username}
        onChange={(v) => setUsername(v.toLowerCase())}
        onBlur={() => persistCurrent()}
        autoComplete="username"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        leadingAdornment="@"
        hint={usernameHint}
        error={usernameError}
        loading={usernameStatus.kind === "checking"}
      />

      <div className="rounded-3xl border border-dashed border-zinc-200 px-5 py-4 text-xs text-zinc-500">
        {t("auth.signupV2.step3.avatarPlaceholder")}
      </div>

      {submitError && (
        <p role="alert" className="rounded-3xl border border-red-100 bg-red-50 px-5 py-3 text-xs text-red-700">
          {submitError}
        </p>
      )}

      <PillButton
        type="submit"
        variant="primary"
        fullWidth
        loading={submitting}
        disabled={!canSubmit}
      >
        {t("auth.signupV2.step3.createCta")}
      </PillButton>
      <p className="text-center text-[11px] text-zinc-400">
        {t("auth.signupV2.step3.nextHint")}
      </p>
    </form>
  );
}
