"use client";

/**
 * Signup v2 · Step 3 (Profile card) — wireframe pixel-fidelity pass
 * (2026-08-20). Phase 1 behavior preserved with the field-set the
 * designer's updated wireframes ask for.
 *
 * Fields collected on Step 3 (Name moved to Step 2 in this pass):
 *   - avatar file       (optional — kept in memory as a `File`; uploaded
 *                        to `artworks/{userId}/profile/avatar/...` after
 *                        `signUpWithPassword` establishes a session)
 *   - gender            (OvalSelect, optional — woman / man / non_binary
 *                        / prefer_not_to_say; free-form text column)
 *   - age band          (OvalSelect, optional — reuses TAXONOMY.ageBandOptions;
 *                        wireframe switched this from PillRadio → select)
 *   - main_role         ("Primary Role" · OvalSelect, ROLE_KEYS; skip allowed)
 *   - secondary_role    ("Secondary Role" · OvalSelect, optional; must
 *                        differ from primary — dropped silently otherwise)
 *   - is_public         (WideRadio, Public / Private, defaults to Public)
 *   - username          (OvalInput, `@` prefix, 300ms debounce; error
 *                        only on collision per §11.3)
 *
 * On submit:
 *   1. `signUpWithPassword` with the email + password + full_name
 *      captured in Steps 1 / 2. Anti-enumeration duplicate detection
 *      uses Supabase's "empty identities" signal — a known-email
 *      falls back to `signInWithPassword` and, on failure, surfaces
 *      the "we found an account" hint.
 *   2. If a session is established, upload the avatar file (best-
 *      effort — a failure just skips avatar_url), then call
 *      `saveProfileUnified` with { username, display_name,
 *      full_name, main_role, roles: [main, secondary].filter(Boolean),
 *      age_band, gender, is_public, avatar_url, tos_accepted_at: "true",
 *      profile_completed_at: "true" }.
 *   3. Advance to Step 4 (optional artwork quick-start). Draft is
 *      NOT cleared yet — Step 4 still reads `mainRole` for its
 *      role-aware copy.
 */

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import {
  ProfileMediaValidationError,
  removeProfileMedia,
  uploadProfileMedia,
} from "@/lib/supabase/storage";
import type { SignupStepApi } from "../SignupWizardShell";
import type {
  SignupV2Gender,
  SignupV2MainRole,
} from "@/lib/auth/signupWizardState";

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;
const USERNAME_DEBOUNCE_MS = 300;

const GENDER_OPTIONS: readonly SignupV2Gender[] = [
  "woman",
  "man",
  "non_binary",
  "prefer_not_to_say",
];

const GENDER_LABEL_KEY: Record<SignupV2Gender, string> = {
  woman: "auth.signupV2.step3.gender.woman",
  man: "auth.signupV2.step3.gender.man",
  non_binary: "auth.signupV2.step3.gender.nonBinary",
  prefer_not_to_say: "auth.signupV2.step3.gender.preferNotToSay",
};

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

  const [ageBand, setAgeBand] = useState(api.state.ageBand);
  const [mainRole, setMainRole] = useState<SignupV2MainRole | "">(api.state.mainRole);
  const [secondaryRole, setSecondaryRole] = useState<SignupV2MainRole | "">(
    api.state.secondaryRole,
  );
  const [gender, setGender] = useState<SignupV2Gender | "">(api.state.gender);
  const [isPublic, setIsPublic] = useState<boolean>(api.state.isPublic);
  const [avatarFile, setAvatarFile] = useState<File | null>(api.state.avatarFile);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
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
  // the earliest missing step. `fullName` also lives at Step 2 now.
  useEffect(() => {
    if (!api.state.email) {
      api.goToStep(1);
      return;
    }
    if (!api.state.password || !api.state.fullName.trim()) {
      api.goToStep(2);
    }
    // Intentionally single-shot — a subsequent state change (e.g. user
    // returns from Step 2 with the new password) should not re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Object-URL hygiene for the avatar preview blob.
  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview(null);
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreview(url);
    return () => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* best-effort */
      }
    };
  }, [avatarFile]);

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
      ageBand: ageBand || undefined,
      mainRole: (mainRole || undefined) as SignupV2MainRole | undefined,
      secondaryRole:
        (secondaryRole || undefined) as SignupV2MainRole | undefined,
      gender: (gender || undefined) as SignupV2Gender | undefined,
      isPublic,
      username: normalizedUsername || undefined,
    });
  }, [
    api,
    ageBand,
    mainRole,
    secondaryRole,
    gender,
    isPublic,
    normalizedUsername,
  ]);

  const roleOptions = useMemo(
    () => [
      { value: "", label: t("auth.signupV2.step3.roleSkip") },
      ...ROLE_KEYS.map((r) => ({ value: r, label: t(`role.${r}`) })),
    ],
    [t],
  );

  const secondaryRoleOptions = useMemo(
    () => [
      { value: "", label: t("auth.signupV2.step3.secondaryRolePlaceholder") },
      // Suppress the primary from the secondary list so the "must
      // differ" invariant is expressed structurally rather than as a
      // post-hoc error.
      ...ROLE_KEYS.filter((r) => r !== mainRole).map((r) => ({
        value: r,
        label: t(`role.${r}`),
      })),
    ],
    [t, mainRole],
  );

  const ageOptions = useMemo(
    () => [
      { value: "", label: t("auth.signupV2.step3.ageBandPlaceholder") },
      ...TAXONOMY.ageBandOptions.map((o) => ({
        value: o.value,
        label: t(o.labelKey),
      })),
    ],
    [t],
  );

  const genderOptions = useMemo(
    () => [
      { value: "", label: t("auth.signupV2.step3.gender.placeholder") },
      ...GENDER_OPTIONS.map((g) => ({
        value: g,
        label: t(GENDER_LABEL_KEY[g]),
      })),
    ],
    [t],
  );

  const visibilityOptions = useMemo(
    () => [
      { value: "public", label: t("auth.signupV2.step3.visibility.public") },
      { value: "private", label: t("auth.signupV2.step3.visibility.private") },
    ],
    [t],
  );

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (!api.state.fullName.trim()) return false;
    if (!USERNAME_REGEX.test(normalizedUsername)) return false;
    if (usernameStatus.kind === "taken") return false;
    if (usernameStatus.kind === "reserved") return false;
    if (usernameStatus.kind === "invalid") return false;
    return true;
  }, [
    submitting,
    api.state.fullName,
    normalizedUsername,
    usernameStatus.kind,
  ]);

  function handleAvatarChange(next: File | null) {
    setAvatarFile(next);
    api.updateState({ avatarFile: next });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setDuplicateEmail(null);
    if (!canSubmit) return;
    if (!api.state.email || !api.state.password || !api.state.fullName.trim()) {
      // Should not happen — a defensive guard.
      if (!api.state.email) api.goToStep(1);
      else api.goToStep(2);
      return;
    }
    setSubmitting(true);
    persistCurrent();

    // Step 1: create the account.
    const trimmedName = api.state.fullName.trim();
    const derivedRole: SignupV2MainRole | undefined = mainRole || undefined;
    const rolesToWrite: SignupV2MainRole[] = [];
    if (derivedRole) rolesToWrite.push(derivedRole);
    if (secondaryRole && secondaryRole !== derivedRole) {
      rolesToWrite.push(secondaryRole);
    }
    const { data, error: signUpErr } = await signUpWithPassword(
      api.state.email,
      api.state.password,
      {
        username: normalizedUsername,
        display_name: trimmedName,
        main_role: derivedRole,
        roles: rolesToWrite.length > 0 ? rolesToWrite : undefined,
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
        await routeAfterAccount(loginData.session.user.id, rolesToWrite);
        return;
      }
      setSubmitting(false);
      setDuplicateEmail(api.state.email);
      return;
    }

    // Email-confirmation mode: show the "check your email" state.
    if (data?.user && !data?.session) {
      setSubmitting(false);
      setSubmitError(t("auth.signupV2.step3.checkEmail"));
      return;
    }

    const uid = data?.session?.user?.id;
    if (!uid) {
      setSubmitting(false);
      setSubmitError(t("auth.signupV2.step3.errorGeneric"));
      return;
    }
    await routeAfterAccount(uid, rolesToWrite);
  }

  async function routeAfterAccount(
    userId: string,
    rolesToWrite: SignupV2MainRole[],
  ) {
    try {
      await ensureFreeEntitlement(userId);
    } catch {
      /* best-effort: entitlement seed is idempotent, retry-safe */
    }

    // Best-effort avatar upload. A failure at this step should NOT
    // block wizard completion — the user can add an avatar later
    // from Studio → Profile. We only surface a message when
    // uploadProfileMedia raises a structural validation error the
    // user can act on (e.g. wrong mime).
    let avatarPath: string | null = null;
    if (avatarFile) {
      try {
        avatarPath = await uploadProfileMedia(avatarFile, "avatar", userId);
      } catch (err) {
        if (err instanceof ProfileMediaValidationError) {
          setSubmitting(false);
          setSubmitError(err.message);
          return;
        }
        // Any other failure (network, RLS, storage 500) — skip the
        // avatar_url column but continue with profile stamping.
        avatarPath = null;
      }
    }

    const trimmedName = api.state.fullName.trim();
    const savePayload: Record<string, unknown> = {
      username: normalizedUsername,
      display_name: trimmedName,
      full_name: trimmedName,
      tos_accepted_at: "true",
      profile_completed_at: "true",
      is_public: isPublic,
    };
    if (mainRole) savePayload.main_role = mainRole;
    if (rolesToWrite.length > 0) savePayload.roles = rolesToWrite;
    if (ageBand) savePayload.age_band = ageBand;
    if (gender) savePayload.gender = gender;
    if (avatarPath) savePayload.avatar_url = avatarPath;

    const res = await saveProfileUnified({
      basePatch: savePayload,
      detailsPatch: {},
      completeness: null,
    });
    if (!res.ok) {
      setSubmitting(false);
      // Roll back the avatar upload so we don't leave orphan bytes
      // when the RPC rejects the row.
      if (avatarPath) {
        void removeProfileMedia(avatarPath);
      }
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
      <p className="-mt-2 mb-4 whitespace-pre-line text-sm text-zinc-500">
        {t("auth.signupV2.step3.subtitle")}
      </p>

      <AvatarPickerRow
        file={avatarFile}
        previewUrl={avatarPreview}
        onChange={handleAvatarChange}
        label={t("auth.signupV2.step3.photoLabel")}
        uploadCta={t("auth.signupV2.step3.photoUpload")}
        removeAria={t("auth.signupV2.step3.photoRemove")}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <OvalSelect
          labelStyle="outer"
          label={t("auth.signupV2.step3.gender.label")}
          value={gender}
          onChange={(v) => {
            const next = (v as SignupV2Gender | "") || "";
            setGender(next);
            api.updateState({ gender: next });
            api.persistDraft({
              gender: (next || undefined) as SignupV2Gender | undefined,
            });
          }}
          options={genderOptions}
          placeholder={t("auth.signupV2.step3.gender.placeholder")}
          hint={t("auth.signupV2.step3.gender.hint")}
        />

        <OvalSelect
          labelStyle="outer"
          label={t("auth.signupV2.step3.ageBandLabel")}
          value={ageBand}
          onChange={(v) => {
            setAgeBand(v);
            api.updateState({ ageBand: v });
            api.persistDraft({ ageBand: v || undefined });
          }}
          options={ageOptions}
          placeholder={t("auth.signupV2.step3.ageBandPlaceholder")}
          hint={t("auth.signupV2.step3.ageBandHint")}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <OvalSelect
          labelStyle="outer"
          label={t("auth.signupV2.step3.primaryRoleLabel")}
          required
          value={mainRole}
          onChange={(v) => {
            const next = (v as SignupV2MainRole | "") || "";
            setMainRole(next);
            // If secondary equals the new primary, silently drop it.
            if (next && secondaryRole === next) {
              setSecondaryRole("");
              api.updateState({ mainRole: next, secondaryRole: "" });
              api.persistDraft({
                mainRole: (next || undefined) as SignupV2MainRole | undefined,
                secondaryRole: undefined,
              });
              return;
            }
            api.updateState({ mainRole: next });
            api.persistDraft({
              mainRole: (next || undefined) as SignupV2MainRole | undefined,
            });
          }}
          options={roleOptions}
          placeholder={t("auth.signupV2.step3.mainRolePlaceholder")}
          hint={t("auth.signupV2.step3.mainRoleHint")}
        />

        <OvalSelect
          labelStyle="outer"
          label={t("auth.signupV2.step3.secondaryRoleLabel")}
          value={secondaryRole}
          onChange={(v) => {
            const next = (v as SignupV2MainRole | "") || "";
            setSecondaryRole(next);
            api.updateState({ secondaryRole: next });
            api.persistDraft({
              secondaryRole:
                (next || undefined) as SignupV2MainRole | undefined,
            });
          }}
          options={secondaryRoleOptions}
          placeholder={t("auth.signupV2.step3.secondaryRolePlaceholder")}
          hint={t("auth.signupV2.step3.secondaryRoleHint")}
        />
      </div>

      <PillRadio
        variant="wide"
        labelStyle="outer"
        label={t("auth.signupV2.step3.visibility.label")}
        required
        value={isPublic ? "public" : "private"}
        onChange={(v) => {
          const next = v === "public";
          setIsPublic(next);
          api.updateState({ isPublic: next });
          api.persistDraft({ isPublic: next });
        }}
        options={visibilityOptions}
        hint={t("auth.signupV2.step3.visibility.hint")}
      />

      <OvalInput
        labelStyle="outer"
        label={t("auth.signupV2.step3.usernameLabel")}
        required
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

// ─────────────────────────────────────────────────────────────────────
// Avatar picker
// ─────────────────────────────────────────────────────────────────────

/** Signup v2 Step 3 avatar chooser (2026-08-20 wireframe). Renders the
 *  outer label above a row containing an "Upload photo" pill (opens the
 *  file picker) and, when a file is selected, a 40px circular thumbnail
 *  + an `×` remove button. Mimics the wireframe's compact one-row
 *  layout rather than the drop-zone tile used by Studio → Profile. */
function AvatarPickerRow({
  file,
  previewUrl,
  onChange,
  label,
  uploadCta,
  removeAria,
}: {
  file: File | null;
  previewUrl: string | null;
  onChange: (next: File | null) => void;
  label: string;
  uploadCta: string;
  removeAria: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div>
      <label className="mb-1.5 block px-1 text-xs font-medium text-zinc-600">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 transition-colors hover:border-zinc-500 hover:text-zinc-900"
        >
          <span aria-hidden className="text-base leading-none">＋</span>
          <span>{uploadCta}</span>
        </button>
        {file && previewUrl && (
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt=""
              className="h-10 w-10 rounded-full object-cover ring-1 ring-zinc-200"
            />
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label={removeAria}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300 text-sm text-zinc-500 transition-colors hover:border-zinc-500 hover:text-zinc-900"
            >
              ×
            </button>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const next = e.target.files?.[0] ?? null;
            e.target.value = "";
            if (next) onChange(next);
          }}
        />
      </div>
    </div>
  );
}
