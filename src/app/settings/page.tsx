"use client";

import { FormEvent, useEffect, useMemo, useState, useRef, KeyboardEvent, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { getMyAuthState, signOut } from "@/lib/supabase/auth";
import { useT } from "@/lib/i18n/useT";
import { formatSupabaseError } from "@/lib/errors/supabase";
import { checkUsernameExists, getMyProfile, type EducationEntry, type Profile } from "@/lib/supabase/profiles";
import { supabase } from "@/lib/supabase/client";
import { requireSessionUid } from "@/lib/supabase/requireSessionUid";
import { saveProfileUnified } from "@/lib/supabase/profileSaveUnified";
import { profileDetailsFromProfile } from "@/lib/supabase/profileDetails";
import {
  computeProfileCompleteness,
  resolveDisplayedProfileCompleteness,
} from "@/lib/profile/completeness";
import { makePatch } from "@/lib/profile/diffPatch";
import {
  normalizeProfileBase,
  normalizeProfileDetails,
  type NormalizedBasePayload,
  type NormalizedDetailsPayload,
} from "@/lib/profile/normalizeProfilePayload";
import {
  TAXONOMY,
  TAXONOMY_LIMITS,
  type TaxonomyOption,
} from "@/lib/profile/taxonomy";
import { BuildStamp } from "@/components/BuildStamp";
import { BioDraftAssist } from "@/components/ai/BioDraftAssist";
import { ProfileMediaUploader } from "@/components/profile/ProfileMediaUploader";
import { StatementDraftAssist } from "@/components/profile/StatementDraftAssist";
import { TourTrigger, TourHelpButton } from "@/components/tour";
import { TOUR_IDS } from "@/lib/tours/tourRegistry";
import { updateMyProfileBasePatch } from "@/lib/supabase/profiles";
import { isArtistRole } from "@/lib/identity/roles";
import { useActingAs } from "@/context/ActingAsContext";

const MAIN_ROLES = ["artist", "collector", "curator", "gallerist"] as const;
const ROLES = [...MAIN_ROLES];
const PROFILE_UPDATED_KEY = "profile_updated";
const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

function payloadEqual(a: Record<string, unknown> | null, b: Record<string, unknown> | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Remove undefined keys; keep null. */
function omitUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

function TestRpcButton() {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const run = async () => {
    setTesting(true);
    setResult(null);
    const res = await saveProfileUnified({ basePatch: {}, detailsPatch: {}, completeness: null });
    setTesting(false);
    setResult(res.ok ? "RPC OK" : `${res.code ?? ""} ${res.message}`);
  };
  return (
    <div className="mt-2 flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={testing}
        className="rounded border border-zinc-400 px-2 py-1 text-xs hover:bg-zinc-200 disabled:opacity-50"
      >
        {testing ? "Testing..." : "Test RPC"}
      </button>
      {result && <span className="text-xs text-zinc-600">{result}</span>}
    </div>
  );
}

function ChipInput({
  values,
  onChange,
  placeholder,
  max,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  max?: number;
}) {
  const [input, setInput] = useState("");
  const addChip = useCallback(() => {
    const v = input.trim();
    if (v && !values.includes(v)) {
      const limit = max ?? 999;
      if (values.length >= limit) return;
      onChange([...values, v]);
      setInput("");
    }
  }, [input, values, onChange, max]);
  const removeChip = (i: number) => {
    onChange(values.filter((_, idx) => idx !== i));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addChip();
    } else if (e.key === "Backspace" && !input && values.length > 0) {
      removeChip(values.length - 1);
    }
  };
  return (
    <div className="flex flex-wrap gap-2 rounded border border-zinc-300 bg-white px-3 py-2">
      {values.map((v, i) => (
        <span
          key={`${v}-${i}`}
          className="inline-flex items-center gap-1 rounded-full bg-zinc-200 px-2 py-0.5 text-sm"
        >
          {v}
          <button
            type="button"
            onClick={() => removeChip(i)}
            className="text-zinc-500 hover:text-zinc-800"
            aria-label="Remove"
          >
            ×
          </button>
        </span>
      ))}
      {(max == null || values.length < max) && (
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={addChip}
          placeholder={placeholder}
          className="min-w-[120px] flex-1 border-0 bg-transparent px-0 py-0 text-sm focus:outline-none focus:ring-0"
        />
      )}
    </div>
  );
}

function TaxonomyChipSelect({
  options,
  value,
  onChange,
  max,
  t,
  onMaxReached,
}: {
  options: readonly TaxonomyOption[];
  value: string[];
  onChange: (v: string[]) => void;
  max: number;
  t: (key: string) => string;
  onMaxReached: () => void;
}) {
  const toggle = (slug: string) => {
    if (value.includes(slug)) {
      onChange(value.filter((x) => x !== slug));
    } else {
      if (value.length >= max) {
        onMaxReached();
        return;
      }
      onChange([...value, slug]);
    }
  };
  const others = value.filter((v) => !options.some((o) => o.value === v));
  const removeOther = (i: number) => {
    const list = value.filter((x) => !options.some((o) => o.value === x));
    const removed = list[i];
    onChange(value.filter((x) => x !== removed));
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const selected = value.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggle(opt.value)}
              className={`rounded-full px-2.5 py-1 text-sm ${
                selected
                  ? "bg-zinc-900 text-white"
                  : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
              }`}
            >
              {t(opt.labelKey)}
            </button>
          );
        })}
      </div>
      {others.length < 2 && value.length < max && (
        <ChipInput
          values={others}
          onChange={(otherList) => {
            const fromOpts = value.filter((v) => options.some((o) => o.value === v));
            onChange([...fromOpts, ...otherList].slice(0, max));
          }}
          placeholder={t("settings.placeholderOtherChip")}
          max={2}
        />
      )}
      {others.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {others.map((v, i) => (
            <span
              key={`o-${v}-${i}`}
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-sm"
            >
              {v}
              <button type="button" onClick={() => removeOther(i)} className="text-zinc-500 hover:text-zinc-800" aria-label="Remove">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { t, locale } = useT();
  // Settings is operator-locked by product decision (account / security /
  // billing / personal). When acting-as is active we still want the user
  // to be able to manage their own settings without surprise — the
  // existing save flow already keys on the operator's session uid, so we
  // only need to surface a clear notice that the delegated context does
  // not apply here.
  const { actingAsProfileId, actingAsLabel } = useActingAs();
  const [username, setUsername] = useState<string | null>(null);
  const usernameInputRef = useRef<HTMLInputElement>(null);
  const initialUsernameRef = useRef<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [website, setWebsite] = useState("");
  const [mainRole, setMainRole] = useState<string>("");
  const [roles, setRoles] = useState<string[]>([]);
  const [isPublic, setIsPublic] = useState(true);
  const [careerStage, setCareerStage] = useState<string>("");
  const [ageBand, setAgeBand] = useState<string>("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [country, setCountry] = useState("");
  const [themes, setThemes] = useState<string[]>([]);
  const [mediums, setMediums] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  /**
   * "AI가 작가의 말을 쓸 때 어떤 결을 살리고 싶은지" 자유 서술 필드.
   * 칩 슬러그만으로는 전달이 어려운 어조·관심사·계기를 한 단락으로 적어두면
   * statement 초안 품질이 눈에 띄게 올라간다. 현재 DB 컬럼이 없어
   * device-local 로만 저장한다(`localStorage`). 같은 디바이스에서는 재진입
   * 시에도 유지되지만, 다른 기기에서는 비어 있다.
   */
  const [themesDetail, setThemesDetail] = useState<string>("");
  /**
   * 페이지 마운트 시점의 칩 스냅샷. 사용자가 어떤 칩을 *방금* 빼냈는지
   * 차집합으로 추적해서 statement 프롬프트의 `excluded_keywords` 채널로
   * 보낸다. 칩을 다시 추가하면 자동으로 negative list 에서도 제외된다.
   */
  const initialChipsRef = useRef<{
    themes: Set<string>;
    mediums: Set<string>;
    styles: Set<string>;
  }>({ themes: new Set(), mediums: new Set(), styles: new Set() });
  const initialChipsSeededRef = useRef(false);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [education, setEducation] = useState<EducationEntry[]>([{ school: "", program: "", year: "", type: null }]);
  const [priceBand, setPriceBand] = useState<string[]>([]);
  const [acquisitionChannels, setAcquisitionChannels] = useState<string[]>([]);
  const [affiliation, setAffiliation] = useState("");
  const [programFocus, setProgramFocus] = useState<string[]>([]);
  // P1-0 identity surface state. Image paths + cover focus + statement text.
  // Image paths and cover focus persist immediately on change (auto-save) so
  // the upload UX is snappy; statement text saves with the main form Save.
  const [coverImagePath, setCoverImagePath] = useState<string | null>(null);
  const [coverPositionY, setCoverPositionY] = useState<number>(50);
  const [statement, setStatement] = useState<string>("");
  const [statementHeroPath, setStatementHeroPath] = useState<string | null>(null);
  const [identityNotice, setIdentityNotice] = useState<string | null>(null);
  const [identityErr, setIdentityErr] = useState<string | null>(null);
  const [statementSaving, setStatementSaving] = useState(false);
  const [statementSavedAt, setStatementSavedAt] = useState<number | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [profileDetailsOpen, setProfileDetailsOpen] = useState(false);
  const [hasOpenedDetails, setHasOpenedDetails] = useState(false);
  const profileDetailsRef = useRef<HTMLDivElement>(null);
  const initialBaseRef = useRef<Record<string, unknown> | null>(null);
  const initialDetailsRef = useRef<Record<string, unknown> | null>(null);
  const [maxSelectMessage, setMaxSelectMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dbProfileCompleteness, setDbProfileCompleteness] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isSavingRef = useRef(false);
  const [lastError, setLastError] = useState<{
    step: "base_update" | "details_rpc" | "unified_upsert";
    supabaseError: { code?: string; message?: string; details?: string; hint?: string };
    normalizedPayload: Record<string, unknown>;
    durationMs?: number;
  } | null>(null);
  const [showRetryDetails, setShowRetryDetails] = useState(false);
  // QA P0.5-C (row 25): /settings 의 비밀번호 섹션은 이미 비밀번호가 설정된
  // 사용자에게도 동일한 "비밀번호 설정 — 이메일과 비밀번호로 로그인…" 카피를
  // 보여주고 있어서, 같은 사용자가 매번 자신이 비번을 안 정한 줄 알고
  // 클릭하게 만든다. has_password 상태로 카피를 분기한다.
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);

  const isDev = process.env.NODE_ENV === "development";

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem("ab_focus_username_field") !== "1") return;
    window.sessionStorage.removeItem("ab_focus_username_field");
    setTimeout(() => usernameInputRef.current?.focus(), 60);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getMyAuthState().then((state) => {
      if (cancelled) return;
      setHasPassword(state?.has_password ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (maxSelectMessage) {
      const tid = setTimeout(() => setMaxSelectMessage(null), 3000);
      return () => clearTimeout(tid);
    }
  }, [maxSelectMessage]);

  useEffect(() => {
    getMyProfile().then((profileRes) => {
      setLoading(false);
      const err = profileRes.error;
      if (err) {
        setError(formatSupabaseError(err, t, "errors.failedLoadProfile"));
        return;
      }
      const p = profileRes.data as Profile | null;
      const d = profileDetailsFromProfile(p);
        const pc = (p as { profile_completeness?: number | null } | null)?.profile_completeness;
        if (pc != null) setDbProfileCompleteness(pc);
        if (p) {
          setUsername(p.username ?? null);
          initialUsernameRef.current = (p.username ?? "").trim().toLowerCase();
          setAvatarUrl(p.avatar_url ?? null);
          setDisplayName(p.display_name ?? "");
          setBio(p.bio ?? "");
          setLocation(p.location ?? "");
          setWebsite(p.website ?? "");
          setMainRole(p.main_role ?? "");
          setRoles((p.roles as string[]) ?? []);
          setIsPublic(p.is_public ?? true);
          const ed = (p.education as EducationEntry[] | null) ?? [];
          setEducation(ed.length ? ed : [{ school: "", program: "", year: "", type: null }]);
          setUid(p.id ?? null);
          setCoverImagePath(p.cover_image_url ?? null);
          const cy = p.cover_image_position_y;
          setCoverPositionY(typeof cy === "number" && Number.isFinite(cy) ? cy : 50);
          setStatement(p.artist_statement ?? "");
          setStatementHeroPath(p.artist_statement_hero_image_url ?? null);
        }
        if (d) {
          setCareerStage(d.career_stage ?? "");
          setAgeBand(d.age_band ?? "");
          setCity(d.city ?? "");
          setRegion(d.region ?? "");
          setCountry(d.country ?? "");
          const dThemes = d.themes ?? [];
          const dMediums = d.mediums ?? [];
          const dStyles = d.styles ?? [];
          setThemes(dThemes);
          setMediums(dMediums);
          setStyles(dStyles);
          // 칩 negative-list 추적용 초기 스냅샷. 두 번 들어와도 한 번만 박힌다.
          if (!initialChipsSeededRef.current) {
            initialChipsRef.current = {
              themes: new Set(dThemes),
              mediums: new Set(dMediums),
              styles: new Set(dStyles),
            };
            initialChipsSeededRef.current = true;
          }
          setKeywords(d.keywords ?? []);
          setPriceBand(Array.isArray(d.collector_price_band) ? d.collector_price_band : (d.collector_price_band ? [d.collector_price_band] : []));
          setAcquisitionChannels(d.collector_acquisition_channels ?? []);
          setAffiliation(d.affiliation ?? "");
          setProgramFocus(d.program_focus ?? []);
        } else if (p) {
          setCareerStage((p as Profile).career_stage ?? "");
          setAgeBand((p as Profile).age_band ?? "");
          setCity((p as Profile).city ?? "");
          setRegion((p as Profile).region ?? "");
          setCountry((p as Profile).country ?? "");
          const pThemes = (p as Profile).themes ?? [];
          const pMediums = (p as Profile).mediums ?? [];
          const pStyles = (p as Profile).styles ?? [];
          setThemes(pThemes);
          setMediums(pMediums);
          setStyles(pStyles);
          if (!initialChipsSeededRef.current) {
            initialChipsRef.current = {
              themes: new Set(pThemes),
              mediums: new Set(pMediums),
              styles: new Set(pStyles),
            };
            initialChipsSeededRef.current = true;
          }
          setKeywords((p as Profile).keywords ?? []);
          setPriceBand((() => {
          const v = (p as Profile).price_band;
          if (v == null) return [];
          return Array.isArray(v) ? v : [v];
        })());
          setAcquisitionChannels((p as Profile).acquisition_channels ?? []);
          setAffiliation((p as Profile).affiliation ?? "");
          setProgramFocus((p as Profile).program_focus ?? []);
        }

        const baseForNorm = {
          display_name: (p as Profile)?.display_name ?? "",
          bio: (p as Profile)?.bio ?? "",
          location: (p as Profile)?.location ?? "",
          website: (p as Profile)?.website ?? "",
          main_role: (p as Profile)?.main_role ?? "",
          roles: (p as Profile)?.roles ?? [],
          is_public: (p as Profile)?.is_public ?? true,
          education: (p as Profile)?.education ?? [],
        };
        const normalizedInitialBase = normalizeProfileBase(baseForNorm) as unknown as Record<string, unknown>;
        // QA P0.5-A: artist_statement 도 메인 폼 diff 의 baseline 에 포함시켜
        // textarea 값이 onBlur 없이 곧장 [저장] 으로 이어져도 변경분이
        // 정확히 detect 되도록 한다.
        normalizedInitialBase.artist_statement = (p as Profile)?.artist_statement ?? null;
        initialBaseRef.current = normalizedInitialBase;

        const src = d ?? (p as Profile);
        const detailsForNorm = {
          career_stage: src?.career_stage ?? "",
          age_band: src?.age_band ?? "",
          city: src?.city ?? "",
          region: src?.region ?? "",
          country: src?.country ?? "",
          themes: src?.themes ?? [],
          mediums: src?.mediums ?? [],
          styles: src?.styles ?? [],
          keywords: src?.keywords ?? [],
          price_band: (() => {
          const v = (d as { collector_price_band?: string | string[] } | undefined)?.collector_price_band ?? (p as Profile)?.price_band;
          if (v == null) return [];
          return Array.isArray(v) ? v : [v];
        })(),
          acquisition_channels: (d as { collector_acquisition_channels?: string[] } | undefined)?.collector_acquisition_channels ?? (p as Profile)?.acquisition_channels ?? [],
          affiliation: src?.affiliation ?? "",
          program_focus: src?.program_focus ?? [],
        };
        initialDetailsRef.current = normalizeProfileDetails(detailsForNorm) as unknown as Record<string, unknown>;
    });
  }, []);

  const { score: completeness } = computeProfileCompleteness(
    {
      username: username ?? undefined,
      display_name: displayName,
      avatar_url: avatarUrl ?? undefined,
      bio,
      main_role: mainRole,
      roles,
      city: city || undefined,
      region: region || undefined,
      country: country || undefined,
      themes,
      mediums,
      styles,
      education,
      price_band: priceBand.length > 0 ? priceBand : undefined,
      acquisition_channels: acquisitionChannels,
      affiliation: affiliation || undefined,
      program_focus: programFocus,
    },
    { hasDetailsLoaded: true }
  );

  const profileCompletenessForDisplay = resolveDisplayedProfileCompleteness(
    { profile_completeness: dbProfileCompleteness },
    completeness
  );

  function toggleRole(role: string) {
    setRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  }

  async function handleRetryDetails() {
    if (isSavingRef.current) return;
    setError(null);
    setWarning(null);
    setLastError(null);
    let uid: string;
    try {
      uid = await requireSessionUid(supabase);
    } catch {
      setError("Session expired. Please log in again.");
      router.push("/login");
      return;
    }
    const { data: currentProfile } = await getMyProfile();
    if (currentProfile?.id && currentProfile.id !== uid) {
      setError("Session/profile mismatch. Reloaded; try again.");
      router.refresh();
      return;
    }
    isSavingRef.current = true;
    setSaving(true);
    const normalizedDetails = normalizeProfileDetails({
      career_stage: careerStage,
      age_band: ageBand,
      city,
      region,
      country,
      themes,
      mediums,
      styles,
      keywords,
      price_band: priceBand,
      acquisition_channels: acquisitionChannels,
      affiliation,
      program_focus: programFocus,
    });
    const fullProfile = {
      username: username ?? undefined,
      display_name: displayName,
      avatar_url: avatarUrl ?? undefined,
      bio,
      main_role: mainRole,
      roles,
      city: normalizedDetails.city ?? undefined,
      region: normalizedDetails.region ?? undefined,
      country: normalizedDetails.country ?? undefined,
      themes: normalizedDetails.themes ?? undefined,
      mediums: normalizedDetails.mediums ?? undefined,
      styles: normalizedDetails.styles ?? undefined,
      education,
      price_band: normalizedDetails.price_band ?? undefined,
      acquisition_channels: normalizedDetails.acquisition_channels ?? undefined,
      affiliation: normalizedDetails.affiliation ?? undefined,
      program_focus: normalizedDetails.program_focus ?? undefined,
    };
    const { score, confidence } = computeProfileCompleteness(fullProfile, { hasDetailsLoaded: true });
    const computedScore = confidence === "high" && score !== null ? score : null;
    const detailsSnap = { ...normalizedDetails } as Record<string, unknown>;
    const detailsPatch = omitUndefined(makePatch(initialDetailsRef.current, detailsSnap) as Record<string, unknown>);
    if (Object.keys(detailsPatch).length === 0) {
      setInfo(t("common.noChanges"));
      isSavingRef.current = false;
      setSaving(false);
      return;
    }
    const res = await saveProfileUnified({ basePatch: {}, detailsPatch, completeness: computedScore });
    if (!res.ok) {
      setLastError({
        step: "unified_upsert",
        supabaseError: { code: res.code, message: res.message, details: res.details, hint: res.hint },
        normalizedPayload: detailsPatch as Record<string, unknown>,
        durationMs: 0,
      });
      setError(`Save failed: ${res.code ?? ""} ${res.message}`);
      setWarning(isDev ? "Retry failed" : t("settings.savePartialWarning"));
      isSavingRef.current = false;
      setSaving(false);
      return;
    }
    try {
      const { data: row } = await getMyProfile();
      const rowTyped = row as { profile_completeness?: number | null; profile_details?: Record<string, unknown> | null } | null;
      if (rowTyped?.profile_completeness != null) setDbProfileCompleteness(rowTyped.profile_completeness);
      const pd = rowTyped?.profile_details;
      if (pd && typeof pd === "object") {
        initialDetailsRef.current = {
          career_stage: (pd.career_stage as string) ?? null,
          age_band: (pd.age_band as string) ?? null,
          city: (pd.city as string) ?? null,
          region: (pd.region as string) ?? null,
          country: (pd.country as string) ?? null,
          themes: (pd.themes as string[]) ?? null,
          mediums: (pd.mediums as string[]) ?? null,
          styles: (pd.styles as string[]) ?? null,
          keywords: (pd.keywords as string[]) ?? null,
          price_band: (() => {
          const v = pd.price_band;
          if (v == null) return null;
          return Array.isArray(v) ? v : [v];
        })(),
          acquisition_channels: (pd.acquisition_channels as string[]) ?? null,
          affiliation: (pd.affiliation as string) ?? null,
          program_focus: (pd.program_focus as string[]) ?? null,
        } as unknown as Record<string, unknown>;
      }
      setShowRetryDetails(false);
      setLastError(null);
      const profileUsername = (row as Profile | null)?.username?.trim().toLowerCase() ?? "";
      if (profileUsername) {
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(PROFILE_UPDATED_KEY, "true");
          const nextPath = window.sessionStorage.getItem("ab_username_fix_next_path");
          if (nextPath) {
            window.sessionStorage.removeItem("ab_username_fix_next_path");
            router.push(nextPath);
            return;
          }
        }
        router.push(`/u/${profileUsername}`);
      } else {
        setSaved(true);
      }
    } catch (saveErr) {
      console.error("settings_retry_details_refresh_failed", saveErr);
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  }

  // ── P1-0 identity auto-save ────────────────────────────────────────────
  // Persist a single base field via the unified RPC. Used for media path
  // changes (avatar/cover/statement-hero) and the cover focal slider —
  // anywhere we want immediate feedback rather than waiting on Save.
  // Persists a single base field via the unified RPC and **throws** on
  // failure so child uploaders can switch into their own "save failed"
  // branch (the previous bool-return API kept errors hidden from the
  // ProfileMediaUploader, which was the source of the silent "no changes
  // to save" UX). Section-level identityErr/identityNotice are still set
  // for the slider + statement on-blur paths that don't have their own
  // inline feedback strip.
  const persistIdentityField = useCallback(
    async (patch: Partial<{
      avatar_url: string | null;
      cover_image_url: string | null;
      cover_image_position_y: number | null;
      artist_statement: string | null;
      artist_statement_hero_image_url: string | null;
    }>) => {
      setIdentityErr(null);
      const { error: e } = await updateMyProfileBasePatch(patch);
      if (e) {
        const msg =
          (e as { message?: string } | null)?.message ?? "save failed";
        setIdentityErr(msg);
        throw new Error(msg);
      }
      setIdentityNotice(t("settings.saveSuccess"));
      setTimeout(() => setIdentityNotice(null), 1500);
    },
    [t]
  );

  const handleAvatarChange = useCallback(
    async (nextPath: string | null) => {
      await persistIdentityField({ avatar_url: nextPath });
      setAvatarUrl(nextPath);
    },
    [persistIdentityField]
  );

  const handleCoverChange = useCallback(
    async (nextPath: string | null) => {
      await persistIdentityField({ cover_image_url: nextPath });
      setCoverImagePath(nextPath);
    },
    [persistIdentityField]
  );

  const handleStatementHeroChange = useCallback(
    async (nextPath: string | null) => {
      await persistIdentityField({
        artist_statement_hero_image_url: nextPath,
      });
      setStatementHeroPath(nextPath);
    },
    [persistIdentityField]
  );

  // Slider commit (mouseUp / touchEnd / keyUp) — debounced auto-save.
  // identityErr is already set inside persistIdentityField on failure, so we
  // just swallow the rejection here to avoid an unhandled promise rejection.
  const handleCoverPositionCommit = useCallback(
    async (value: number) => {
      const clamped = Math.min(100, Math.max(0, Math.round(value)));
      setCoverPositionY(clamped);
      try {
        await persistIdentityField({ cover_image_position_y: clamped });
      } catch {
        /* surfaced via identityErr badge below */
      }
    },
    [persistIdentityField]
  );

  // Statement: save on blur. Compares to last-loaded value to skip no-op writes.
  const statementInitialRef = useRef<string>("");
  useEffect(() => {
    statementInitialRef.current = statement;
    // Only initialize once on first load — not on every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // themesDetail: device-local persistence. Keyed by uid so multiple
  // accounts on the same browser don't collide. We avoid DB schema churn
  // for now — this field is a prompt-only signal for the statement
  // assistant, not a published profile attribute.
  const themesDetailStorageKey = uid ? `abstract:profile:themesDetail:${uid}` : null;
  useEffect(() => {
    if (!themesDetailStorageKey) return;
    try {
      const v = window.localStorage.getItem(themesDetailStorageKey);
      if (typeof v === "string") setThemesDetail(v);
    } catch {
      // Storage may be disabled (private mode); silently fall back to empty.
    }
  }, [themesDetailStorageKey]);
  useEffect(() => {
    if (!themesDetailStorageKey) return;
    try {
      if (themesDetail.trim().length === 0) {
        window.localStorage.removeItem(themesDetailStorageKey);
      } else {
        window.localStorage.setItem(themesDetailStorageKey, themesDetail);
      }
    } catch {
      // Quota / disabled storage — non-fatal.
    }
  }, [themesDetail, themesDetailStorageKey]);

  /**
   * 사용자가 페이지 마운트 후 빼낸 칩 슬러그들을 합쳐서 statement 프롬프트의
   * `excluded_keywords` 채널로 보낸다. 다시 추가한 칩은 자연스럽게 제외된다.
   * 빈 문자열/중복은 제거한다.
   */
  const excludedKeywords = useMemo<string[]>(() => {
    if (!initialChipsSeededRef.current) return [];
    const present = new Set<string>([...themes, ...mediums, ...styles]);
    const removed: string[] = [];
    const push = (slug: string) => {
      if (!slug) return;
      const v = slug.trim();
      if (!v) return;
      if (present.has(v)) return;
      if (removed.includes(v)) return;
      removed.push(v);
    };
    initialChipsRef.current.themes.forEach(push);
    initialChipsRef.current.mediums.forEach(push);
    initialChipsRef.current.styles.forEach(push);
    return removed;
  }, [themes, mediums, styles]);

  const handleStatementBlur = useCallback(async () => {
    const next = statement.trim();
    const prev = (statementInitialRef.current ?? "").trim();
    if (next === prev) return;
    setStatementSaving(true);
    try {
      await persistIdentityField({
        artist_statement: next.length > 0 ? next : null,
      });
      statementInitialRef.current = next;
      setStatementSavedAt(Date.now());
      setTimeout(() => setStatementSavedAt(null), 2000);
    } catch {
      /* surfaced via identityErr badge below */
    } finally {
      setStatementSaving(false);
    }
  }, [statement, persistIdentityField]);

  function addEducation() {
    setEducation((prev) => [...prev, { school: "", program: "", year: "", type: null }]);
  }
  function removeEducation(i: number) {
    // Allow removing the last entry too. We collapse to a single empty
    // placeholder row so the form keeps a usable input — but the empty
    // row is normalized to nothing on save (and the patch path now
    // forwards `education: []` to the RPC instead of dropping it, so
    // the DB actually clears the column instead of silently restoring
    // the previous value).
    setEducation((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      if (next.length === 0) {
        return [{ school: "", program: "", year: "", type: null }];
      }
      return next;
    });
  }
  function updateEducation(i: number, field: keyof EducationEntry, value: string | null) {
    setEducation((prev) =>
      prev.map((e, idx) => (idx === i ? { ...e, [field]: value } : e))
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isSavingRef.current) return;
    setError(null);
    setWarning(null);
    setInfo(null);
    setSaved(false);
    setLastError(null);
    setShowRetryDetails(false);

    let uid: string;
    try {
      uid = await requireSessionUid(supabase);
    } catch {
      setError("Session expired. Please log in again.");
      router.push("/login");
      return;
    }

    const { data: currentProfile } = await getMyProfile();
    if (currentProfile?.id && currentProfile.id !== uid) {
      const { data: refetched } = await getMyProfile();
      if (refetched?.id && refetched.id !== uid) {
        console.error("UID mismatch", { profileId: refetched.id, uid });
        setError("Session/profile mismatch. Reloaded; try again.");
        router.refresh();
        return;
      }
    }

    try {
    let finalRoles: string[] = Array.isArray(roles) ? [...roles] : [];
    if (mainRole && mainRole.trim()) {
      if (!finalRoles.includes(mainRole)) finalRoles.push(mainRole);
    }
    if (finalRoles.length < 1) {
      setError(t("common.selectRole"));
      return;
    }
    const normalizedUsername = (username ?? "").trim().toLowerCase();
    if (!USERNAME_REGEX.test(normalizedUsername)) {
      setError(t("settings.usernameInvalid"));
      return;
    }
    if (normalizedUsername !== initialUsernameRef.current) {
      const { exists } = await checkUsernameExists(normalizedUsername, uid);
      if (exists) {
        setError(t("settings.usernameTaken"));
        return;
      }
    }

    const normalizedBase: NormalizedBasePayload = normalizeProfileBase({
      display_name: displayName,
      bio,
      location,
      website,
      main_role: mainRole,
      roles: finalRoles,
      is_public: isPublic,
      education,
    });

    const normalizedDetails: NormalizedDetailsPayload = normalizeProfileDetails({
      career_stage: careerStage,
      age_band: ageBand,
      city,
      region,
      country,
      themes,
      mediums,
      styles,
      keywords,
      price_band: priceBand,
      acquisition_channels: acquisitionChannels,
      affiliation,
      program_focus: programFocus,
    });

    // QA P0.5-A: 메인 Save 시점에 artist_statement 도 함께 diff 하도록
    // baseSnap 에 statement 값을 포함한다. onBlur 자동 저장 경로는 그대로
    // 유지되지만, blur 가 발생하지 않은 채 [저장] 을 누르더라도 statement
    // 변경분이 누락되지 않는다 (또한 "저장할 변경 사항이 없습니다" 오분기 차단).
    const trimmedStatement = (statement ?? "").trim();
    const statementForPatch = trimmedStatement.length > 0 ? trimmedStatement : null;
    const baseSnap = { ...normalizedBase, artist_statement: statementForPatch } as Record<string, unknown>;
    const detailsSnap = { ...normalizedDetails } as Record<string, unknown>;
    let basePatch = makePatch(initialBaseRef.current, baseSnap) as Record<string, unknown>;
    if (normalizedUsername !== initialUsernameRef.current) {
      basePatch.username = normalizedUsername;
    }
    const detailsPatchRaw = hasOpenedDetails ? makePatch(initialDetailsRef.current, detailsSnap) as Record<string, unknown> : {};
    let detailsPatch = omitUndefined(detailsPatchRaw);

    const fullProfile = {
      username: username ?? undefined,
      display_name: normalizedBase.display_name ?? undefined,
      avatar_url: avatarUrl ?? undefined,
      bio: normalizedBase.bio ?? undefined,
      main_role: normalizedBase.main_role ?? undefined,
      roles: normalizedBase.roles,
      city: normalizedDetails.city ?? undefined,
      region: normalizedDetails.region ?? undefined,
      country: normalizedDetails.country ?? undefined,
      themes: normalizedDetails.themes ?? undefined,
      mediums: normalizedDetails.mediums ?? undefined,
      styles: normalizedDetails.styles ?? undefined,
      education: normalizedBase.education ?? undefined,
      price_band: normalizedDetails.price_band ?? undefined,
      acquisition_channels: normalizedDetails.acquisition_channels ?? undefined,
      affiliation: normalizedDetails.affiliation ?? undefined,
      program_focus: normalizedDetails.program_focus ?? undefined,
    };
    const { score, confidence } = computeProfileCompleteness(fullProfile, {
      hasDetailsLoaded: true,
    });
    const computedScore = confidence === "high" && score !== null ? score : null;

    basePatch = omitUndefined(basePatch);

    if (Object.keys(basePatch).length === 0 && Object.keys(detailsPatch).length === 0) {
      setInfo(t("common.noChanges"));
      return;
    }

    isSavingRef.current = true;
    setSaving(true);

    if (process.env.NODE_ENV === "development") {
      console.info("[save] uid", uid);
      console.info("[save] patchKeys", { base: Object.keys(basePatch), details: Object.keys(detailsPatch) });
    }

    const res = await saveProfileUnified({
      basePatch,
      detailsPatch,
      completeness: computedScore,
    });
    if (!res.ok) {
      setLastError({
        step: "unified_upsert",
        supabaseError: { code: res.code, message: res.message, details: res.details, hint: res.hint },
        normalizedPayload: { base: basePatch, details: detailsPatch },
        durationMs: 0,
      });
      setError(`Save failed: ${res.code ?? ""} ${res.message}`);
      isSavingRef.current = false;
      setSaving(false);
      return;
    }
    try {
      const { data: refreshed } = await getMyProfile();
      const ref = refreshed;
      const pc = ref?.profile_completeness;
      if (pc != null) setDbProfileCompleteness(pc);
      if (ref) {
        initialBaseRef.current = {
          display_name: ref.display_name ?? null,
          bio: ref.bio ?? null,
          location: ref.location ?? null,
          website: ref.website ?? null,
          main_role: ref.main_role ?? null,
          roles: ref.roles ?? [],
          is_public: ref.is_public ?? true,
          education: ref.education ?? null,
          // QA P0.5-A: statement 도 baseline 에 포함 (재편집 시 diff 정확성).
          artist_statement: ref.artist_statement ?? null,
        } as Record<string, unknown>;
        // QA P0.5-A: blur 자동 저장 경로의 baseline 도 동기화한다.
        statementInitialRef.current = ref.artist_statement ?? "";
        const pd = profileDetailsFromProfile(ref);
        initialDetailsRef.current = pd
          ? {
              career_stage: pd.career_stage ?? undefined,
              age_band: pd.age_band ?? undefined,
              city: pd.city ?? undefined,
              region: pd.region ?? undefined,
              country: pd.country ?? undefined,
              themes: pd.themes ?? undefined,
              mediums: pd.mediums ?? undefined,
              styles: pd.styles ?? undefined,
              keywords: pd.keywords ?? undefined,
              price_band: (() => {
              const v = pd.collector_price_band;
              if (v == null) return undefined;
              return Array.isArray(v) ? v : [v];
            })(),
              acquisition_channels: pd.collector_acquisition_channels ?? undefined,
              affiliation: pd.affiliation ?? undefined,
              program_focus: pd.program_focus ?? undefined,
            }
          : ({} as Record<string, unknown>);
      }
      const profileUsername = ref?.username?.trim().toLowerCase() ?? "";
      initialUsernameRef.current = profileUsername;
      if (profileUsername) {
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(PROFILE_UPDATED_KEY, "true");
          const nextPath = window.sessionStorage.getItem("ab_username_fix_next_path");
          if (nextPath) {
            window.sessionStorage.removeItem("ab_username_fix_next_path");
            router.push(nextPath);
            return;
          }
        }
        router.push(`/u/${profileUsername}`);
      } else {
        setSaved(true);
      }
    } catch (saveErr) {
      console.error("settings_save_failed", saveErr);
      setError(formatSupabaseError(saveErr, t, "errors.failedSaveSettings"));
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
    } catch (err) {
      console.error("settings_save_failed", err);
      setError(formatSupabaseError(err, t, "errors.failedSaveSettings"));
      isSavingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <AuthGate>
      <main className="mx-auto max-w-xl px-4 py-8">
        <TourTrigger tourId={TOUR_IDS.profileIdentity} />
        <div className="mb-6 flex items-start justify-between gap-4">
          <h1 className="min-w-0 flex-1 pr-2 text-xl font-semibold">{t("settings.title")}</h1>
          <div className="flex items-center gap-2">
            <TourHelpButton tourId={TOUR_IDS.profileIdentity} />
            <BuildStamp />
          </div>
        </div>

        {/* Acting-as operator-lock notice. The page intentionally edits
            the operator's own profile/security regardless of the active
            delegation, so we surface a clear contextual notice instead
            of silently mismatching the global banner. The notice is
            keyed on actingAsProfileId so solo users see no banner. */}
        {actingAsProfileId && (
          <div
            role="status"
            className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <p className="font-medium">{t("acting.lock.notice.title")}</p>
            <p className="mt-1 text-xs text-amber-800">
              {t("acting.lock.notice.body").replace(
                "{name}",
                actingAsLabel ?? t("acting.lock.notice.fallbackName")
              )}
            </p>
          </div>
        )}

        {/* QA P0.5-C (row 25, follow-up²): 비밀번호 재설정은 자주 쓰는
            기능이 아니라 [프로필 편집] 최상단을 차지할 만큼 중요하지
            않다. 페이지 최하단 [로그아웃] 옆으로 옮겨 "쓸 일이 있을 때
            찾을 수 있는" 위치에 둔다. 비밀번호 미설정 사용자(주로
            매직링크 가입) 의 경우엔 같은 버튼이 "비밀번호 설정" 으로
            라벨링되며, 그 케이스에 한해서만 안내 문구가 표시된다. */}

        {loading ? (
          <p className="text-zinc-600">{t("common.loading")}</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
              <p className="mb-2 text-sm font-medium text-zinc-700">
                {t("profile.completeness")}:{" "}
                {profileCompletenessForDisplay != null
                  ? `${profileCompletenessForDisplay}/100`
                  : "—"}
              </p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
                <div
                  className="h-full bg-zinc-900 transition-all"
                  style={{ width: `${profileCompletenessForDisplay ?? 0}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-zinc-500">{t("profile.completenessHint")}</p>
            </div>

            {/* P1-0 Profile identity surface (auto-save for media + slider, on-blur for statement). */}
            {uid && (
              <section
                id="statement"
                className="space-y-5 rounded-lg border border-zinc-200 bg-white p-4"
              >
                <header>
                  <h2 className="text-sm font-semibold text-zinc-900">
                    {t("settings.identity.title")}
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    {t("settings.identity.intro")}
                  </p>
                </header>

                <div data-tour="profile-identity-avatar">
                  <ProfileMediaUploader
                    kind="avatar"
                    value={avatarUrl}
                    onChange={handleAvatarChange}
                    userId={uid}
                    label={t("settings.identity.avatar")}
                    hint={t("settings.identity.avatarHint")}
                    shape="square"
                  />
                </div>

                <div data-tour="profile-identity-cover" className="space-y-3">
                  <ProfileMediaUploader
                    kind="cover"
                    value={coverImagePath}
                    onChange={handleCoverChange}
                    userId={uid}
                    label={t("settings.identity.cover")}
                    hint={t("settings.identity.coverHint")}
                    shape="wide"
                    objectPositionY={coverPositionY}
                    previewCaption={t("settings.identity.coverPreviewCaption")}
                  />
                  {coverImagePath && (
                    <div>
                      <label
                        htmlFor="coverPositionY"
                        className="mb-1 block text-xs font-medium text-zinc-700"
                      >
                        {t("settings.identity.coverReposition")}
                      </label>
                      <input
                        id="coverPositionY"
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={coverPositionY}
                        onChange={(e) => setCoverPositionY(Number(e.target.value))}
                        onMouseUp={(e) =>
                          handleCoverPositionCommit(Number((e.target as HTMLInputElement).value))
                        }
                        onTouchEnd={(e) =>
                          handleCoverPositionCommit(Number((e.target as HTMLInputElement).value))
                        }
                        onKeyUp={(e) =>
                          handleCoverPositionCommit(Number((e.target as HTMLInputElement).value))
                        }
                        className="w-full max-w-md"
                        aria-describedby="coverPositionYHint"
                      />
                      <p id="coverPositionYHint" className="text-xs text-zinc-500">
                        {t("settings.identity.coverRepositionHint")}
                      </p>
                    </div>
                  )}
                </div>

                {/* Artist Statement (작가의 말) is only relevant for users
                    who identify as artists — including hybrid users that hold
                    "artist" alongside other roles. For curators / collectors /
                    gallerists, hide the editor, the AI draft assist, and the
                    statement-hero uploader entirely so the surface stays calm. */}
                {isArtistRole({ main_role: mainRole, roles }) && (
                  <>
                    <div data-tour="profile-identity-statement" className="space-y-2">
                      <label
                        htmlFor="artistStatement"
                        className="block text-sm font-medium text-zinc-800"
                      >
                        {t("settings.identity.statement")}
                      </label>
                      <textarea
                        id="artistStatement"
                        value={statement}
                        onChange={(e) => setStatement(e.target.value)}
                        onBlur={handleStatementBlur}
                        placeholder={t("profile.statement.placeholder")}
                        rows={6}
                        maxLength={4000}
                        className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                      />
                      <div className="flex items-center justify-between text-xs text-zinc-500">
                        <span>
                          {t("profile.statement.lengthHint")
                            .replace("{count}", String(statement.length))
                            .replace("{max}", "4000")}
                        </span>
                        <span aria-live="polite">
                          {statementSaving
                            ? t("profile.media.uploading")
                            : statementSavedAt
                              ? t("settings.saveSuccess")
                              : ""}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500">
                        {t("settings.identity.statementHint")}
                      </p>

                      {/* AI 초안에만 쓰이는 자유 서술. 칩 슬러그만으론 잡히지
                          않는 어조/관심사를 한 단락으로 풀어 적으면 초안
                          품질이 눈에 띄게 좋아진다. 같은 기기에서만 보존되며
                          공개 프로필에는 노출되지 않는다. */}
                      <details
                        className="rounded border border-zinc-200 bg-white p-3 text-sm"
                        open={themesDetail.trim().length > 0}
                      >
                        <summary className="cursor-pointer select-none text-xs font-medium text-zinc-700">
                          {t("profile.statement.themesDetail.title")}
                        </summary>
                        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                          {t("profile.statement.themesDetail.hint")}
                        </p>
                        <textarea
                          value={themesDetail}
                          onChange={(e) => setThemesDetail(e.target.value)}
                          placeholder={t(
                            "profile.statement.themesDetail.placeholder"
                          )}
                          rows={4}
                          maxLength={1200}
                          className="mt-2 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                        />
                        <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-500">
                          <span>{themesDetail.length} / 1200</span>
                          {themesDetail.trim().length > 0 && (
                            <button
                              type="button"
                              onClick={() => setThemesDetail("")}
                              className="text-zinc-500 hover:text-zinc-800"
                            >
                              {t("profile.statement.themesDetail.clear")}
                            </button>
                          )}
                        </div>
                      </details>

                      <StatementDraftAssist
                        profileInput={{
                          display_name: displayName || null,
                          role: mainRole || null,
                          bio: bio || null,
                          themes,
                          mediums,
                          // QA P0.5-B (row 24): /settings 의 스타일 칩을
                          // statement 프롬프트로 그대로 전달한다.
                          styles,
                          city: city || null,
                          locale,
                          currentStatement: statement || null,
                          // 자유 서술. 칩 슬러그만으론 모자란 어조/관심사를 한 단락으로.
                          themesDetail: themesDetail.trim() ? themesDetail : null,
                          // 이번 세션에 칩에서 빼낸 슬러그들 — current_statement 의
                          // 옛 어휘가 그대로 다시 끌려 들어오는 것을 막는다.
                          excludedKeywords:
                            excludedKeywords.length > 0 ? excludedKeywords : null,
                        }}
                        onUseDraft={(draft) => {
                          setStatement(draft);
                        }}
                      />
                    </div>

                    <ProfileMediaUploader
                      kind="statement"
                      value={statementHeroPath}
                      onChange={handleStatementHeroChange}
                      userId={uid}
                      label={t("settings.identity.statementHero")}
                      hint={t("settings.identity.statementHeroHint")}
                      shape="wide"
                    />
                  </>
                )}

                {identityErr && (
                  <p className="text-xs text-red-600" role="alert">
                    {identityErr}
                  </p>
                )}
                {identityNotice && (
                  <p className="text-xs text-green-700" aria-live="polite">
                    {identityNotice}
                  </p>
                )}
              </section>
            )}

            {/* QA P0.5-E (row 31): /settings 의 프라이버시 토글이 한 줄짜리
                체크박스로만 노출되어 있어, 한 번 비공개로 전환한 사용자가
                "다시 공개로 돌릴 곳이 없다"고 잘못 판단하는 사례가 보고됨.
                섹션 형태(제목 + 설명 + 명시적 라벨)로 끌어올려서, 어느 페이지
                (온보딩 / 설정) 에서나 같은 결정을 다시 내릴 수 있다는 점을
                선명하게 한다. */}
            <section className="space-y-3 border-t border-zinc-200 pt-6">
              <div>
                <h2 className="text-sm font-medium text-zinc-900">
                  {t("settings.visibility.title")}
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  {t("settings.visibility.hint")}
                </p>
              </div>
              <label
                htmlFor="isPublic"
                className="flex items-start justify-between gap-4 rounded-md border border-zinc-200 px-3 py-3 text-sm"
              >
                <span className="flex flex-col">
                  <span className="font-medium text-zinc-900">
                    {t("settings.publicToggle")}
                  </span>
                  <span className="mt-1 text-xs text-zinc-500">
                    {isPublic
                      ? t("settings.visibility.publicHint")
                      : t("settings.visibility.privateHint")}
                  </span>
                </span>
                <input
                  id="isPublic"
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded"
                />
              </label>
              <Link
                href="/my/visibility"
                className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 py-3 text-sm hover:bg-zinc-50"
              >
                <span className="flex flex-col">
                  <span className="font-medium text-zinc-900">
                    {t("nav.visibility")} · {t("visibility.page.title")}
                  </span>
                  <span className="mt-1 text-xs text-zinc-500">
                    {t("visibility.page.subtitle")}
                  </span>
                </span>
                <span aria-hidden className="text-zinc-400">
                  →
                </span>
              </Link>
            </section>

            <div>
              <label htmlFor="username" className="mb-1 block text-sm font-medium">
                {t("settings.username")}
              </label>
              <input
                id="username"
                ref={usernameInputRef}
                type="text"
                value={username ?? ""}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                placeholder={t("settings.placeholderUsername")}
                className="w-full rounded border border-zinc-300 px-3 py-2"
                autoComplete="username"
              />
              <p className="mt-1 text-xs text-zinc-500">{t("settings.usernameHint")}</p>
            </div>

            <div>
              <label htmlFor="displayName" className="mb-1 block text-sm font-medium">
                {t("settings.displayName")}
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t("settings.placeholderDisplayName")}
                className="w-full rounded border border-zinc-300 px-3 py-2"
                autoComplete="name"
              />
            </div>

            <div data-tour="profile-identity-bio">
              <label htmlFor="bio" className="mb-1 block text-sm font-medium">
                {t("settings.bio")}
              </label>
              <textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder={t("settings.placeholderBio")}
                rows={3}
                className="w-full rounded border border-zinc-300 px-3 py-2"
              />
              <BioDraftAssist
                currentBio={bio}
                displayName={displayName}
                role={mainRole || roles[0] || null}
                themes={themes}
                mediums={mediums}
                city={city || location}
                onApply={(text) => setBio(text)}
              />
            </div>

            <div>
              <label htmlFor="location" className="mb-1 block text-sm font-medium">
                {t("settings.location")}
              </label>
              <input
                id="location"
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={t("settings.placeholderLocation")}
                className="w-full rounded border border-zinc-300 px-3 py-2"
              />
            </div>

            <div>
              <label htmlFor="website" className="mb-1 block text-sm font-medium">
                {t("settings.website")}
              </label>
              {/* type="text" (not "url") on purpose: browsers reject bare
                  domains like "example.com" with a stock validation message,
                  but our normalizer accepts and prefixes them. The server
                  remains the source of truth for url validity. */}
              <input
                id="website"
                type="text"
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder={t("settings.placeholderWebsite")}
                className="w-full rounded border border-zinc-300 px-3 py-2"
              />
            </div>

            <div>
              <label htmlFor="mainRole" className="mb-1 block text-sm font-medium">
                {t("settings.mainRole")}
              </label>
              <select
                id="mainRole"
                value={mainRole}
                onChange={(e) => setMainRole(e.target.value)}
                className="w-full rounded border border-zinc-300 px-3 py-2"
              >
                <option value="">Select</option>
                {MAIN_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="mb-2 block text-sm font-medium">{t("settings.roles")}</span>
              <div className="flex flex-wrap gap-3">
                {ROLES.map((r) => (
                  <label key={r} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={roles.includes(r)}
                      onChange={() => toggleRole(r)}
                      className="rounded"
                    />
                    <span className="text-sm">
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Profile details accordion */}
            <div ref={profileDetailsRef} className="border-t border-zinc-200 pt-6">
              {(() => {
                const hasDetailsContent = Boolean(
                  (careerStage && careerStage.trim()) ||
                  (ageBand && ageBand.trim()) ||
                  (city && city.trim()) ||
                  (region && region.trim()) ||
                  (country && country.trim()) ||
                  (themes?.length ?? 0) > 0 ||
                  (mediums?.length ?? 0) > 0 ||
                  (styles?.length ?? 0) > 0 ||
                  (keywords?.length ?? 0) > 0 ||
                  (priceBand?.length ?? 0) > 0 ||
                  (acquisitionChannels?.length ?? 0) > 0 ||
                  (affiliation && affiliation.trim()) ||
                  (programFocus?.length ?? 0) > 0
                );
                return (
                  <button
                    type="button"
                    onClick={() => {
                      const next = !profileDetailsOpen;
                      setProfileDetailsOpen(next);
                      if (next) {
                        setHasOpenedDetails(true);
                        setTimeout(() => profileDetailsRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
                      }
                    }}
                    className={`inline-block rounded border px-4 py-2 text-sm font-medium transition-colors ${
                      hasDetailsContent
                        ? "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                        : "border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800"
                    }`}
                  >
                    {hasDetailsContent ? t("settings.editProfileDetails") : t("settings.addProfileDetails")}
                  </button>
                );
              })()}
              {profileDetailsOpen && (
                <div className="space-y-6 pt-2">
                  {maxSelectMessage && (
                    <p className="rounded bg-amber-100 px-3 py-2 text-sm text-amber-800">
                      {maxSelectMessage}
                    </p>
                  )}

                  {/* Core */}
                  <section>
                    <h3 className="mb-2 text-sm font-semibold text-zinc-800">
                      {t("profileDetails.core")}
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <label className="mb-1 block text-sm font-medium">{t("settings.careerStage")}</label>
                        <select
                          value={careerStage}
                          onChange={(e) => setCareerStage(e.target.value)}
                          className="w-full rounded border border-zinc-300 px-3 py-2"
                        >
                          <option value="">Select</option>
                          {TAXONOMY.careerStageOptions.map((o) => (
                            <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium">{t("settings.ageBand")}</label>
                        <select
                          value={ageBand}
                          onChange={(e) => setAgeBand(e.target.value)}
                          className="w-full rounded border border-zinc-300 px-3 py-2"
                        >
                          <option value="">Select</option>
                          {TAXONOMY.ageBandOptions.map((o) => (
                            <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-1">
                          <label className="mb-1 block text-sm font-medium">{t("settings.city")}</label>
                          <input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder={t("settings.placeholderCity")} className="w-full rounded border border-zinc-300 px-3 py-2 text-sm" />
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium">{t("settings.region")}</label>
                          <select value={region} onChange={(e) => setRegion(e.target.value)} className="w-full rounded border border-zinc-300 px-3 py-2 text-sm">
                            <option value="">Select</option>
                            {TAXONOMY.regionOptions.map((o) => (
                              <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium">{t("settings.country")}</label>
                          <input type="text" value={country} onChange={(e) => setCountry(e.target.value)} placeholder={t("settings.placeholderCountry")} className="w-full rounded border border-zinc-300 px-3 py-2 text-sm" />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium">{t("settings.themes")}</label>
                        <p className="mb-1 text-xs text-zinc-500">{t("profileDetails.themesHint")}</p>
                        <TaxonomyChipSelect
                          options={TAXONOMY.themeOptions}
                          value={themes}
                          onChange={setThemes}
                          max={TAXONOMY_LIMITS.themes}
                          t={t}
                          onMaxReached={() => setMaxSelectMessage(t("profileDetails.maxSelectHint").replace("{max}", String(TAXONOMY_LIMITS.themes)))}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium">{t("settings.keywords")} ({t("profileDetails.optional")})</label>
                        <ChipInput values={keywords} onChange={setKeywords} placeholder={t("settings.placeholderKeywordAdd")} max={TAXONOMY_LIMITS.keywords} />
                      </div>
                    </div>
                  </section>

                  {/* Artist module */}
                  {(roles.includes("artist") || mainRole === "artist") && (
                    <section>
                      <h3 className="mb-2 text-sm font-semibold text-zinc-800">
                        {t("profileDetails.artistModule")}{" "}
                        <span className="text-xs font-normal text-zinc-500">({t("profileDetails.recommended")})</span>
                      </h3>
                      <div className="space-y-4">
                        <div>
                          <label className="mb-1 block text-sm font-medium">{t("settings.mediums")} ({t("profileDetails.optional")})</label>
                          <TaxonomyChipSelect options={TAXONOMY.mediumOptions} value={mediums} onChange={setMediums} max={TAXONOMY_LIMITS.mediums} t={t} onMaxReached={() => setMaxSelectMessage(t("profileDetails.maxSelectHint").replace("{max}", String(TAXONOMY_LIMITS.mediums)))} />
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium">{t("settings.styles")} ({t("profileDetails.optional")})</label>
                          <TaxonomyChipSelect options={TAXONOMY.styleOptions} value={styles} onChange={setStyles} max={TAXONOMY_LIMITS.styles} t={t} onMaxReached={() => setMaxSelectMessage(t("profileDetails.maxSelectHint").replace("{max}", String(TAXONOMY_LIMITS.styles)))} />
                        </div>
                        <div>
                          <div className="mb-2 flex items-center justify-between">
                            <label className="text-sm font-medium">{t("settings.education")} ({t("profileDetails.optional")})</label>
                            <button type="button" onClick={addEducation} className="text-sm text-zinc-600 hover:text-zinc-900">{t("settings.addEducation")}</button>
                          </div>
                          <div className="space-y-3">
                            {education.map((e, i) => (
                              <div key={i} className="flex flex-wrap items-end gap-2 rounded border border-zinc-200 p-3">
                                <input type="text" value={e.school ?? ""} onChange={(ev) => updateEducation(i, "school", ev.target.value || null)} placeholder={t("settings.school")} className="min-w-[100px] flex-1 rounded border border-zinc-300 px-2 py-1.5 text-sm" />
                                <input type="text" value={e.program ?? ""} onChange={(ev) => updateEducation(i, "program", ev.target.value || null)} placeholder={t("settings.program")} className="min-w-[80px] flex-1 rounded border border-zinc-300 px-2 py-1.5 text-sm" />
                                <input type="text" value={typeof e.year === "number" ? String(e.year) : (e.year ?? "")} onChange={(ev) => updateEducation(i, "year", ev.target.value || null)} placeholder={t("settings.year")} className="w-16 rounded border border-zinc-300 px-2 py-1.5 text-sm" />
                                <select value={e.type ?? ""} onChange={(ev) => updateEducation(i, "type", ev.target.value || null)} className="rounded border border-zinc-300 px-2 py-1.5 text-sm">
                                  <option value="">Type</option>
                                  {TAXONOMY.educationTypeOptions.map((o) => (
                                    <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                                  ))}
                                </select>
                                <button type="button" onClick={() => removeEducation(i)} className="text-zinc-500 hover:text-zinc-800">{t("settings.remove")}</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Collector module */}
                  {(roles.includes("collector") || mainRole === "collector") && (
                    <section>
                      <h3 className="mb-2 text-sm font-semibold text-zinc-800">
                        {t("profileDetails.collectorModule")}{" "}
                        <span className="text-xs font-normal text-zinc-500">({t("profileDetails.recommended")})</span>
                      </h3>
                      <div className="space-y-4">
                        <div>
                          <label className="mb-1 block text-sm font-medium">{t("settings.labelPriceBand")} ({t("profileDetails.optional")})</label>
                          <TaxonomyChipSelect options={TAXONOMY.priceBandOptions} value={priceBand} onChange={setPriceBand} max={TAXONOMY_LIMITS.priceBand} t={t} onMaxReached={() => setMaxSelectMessage(t("profileDetails.maxSelectHint").replace("{max}", String(TAXONOMY_LIMITS.priceBand)))} />
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium">{t("settings.labelAcquisitionChannels")} ({t("profileDetails.optional")})</label>
                          <TaxonomyChipSelect options={TAXONOMY.acquisitionChannelOptions} value={acquisitionChannels} onChange={setAcquisitionChannels} max={TAXONOMY_LIMITS.acquisitionChannels} t={t} onMaxReached={() => setMaxSelectMessage(t("profileDetails.maxSelectHint").replace("{max}", String(TAXONOMY_LIMITS.acquisitionChannels)))} />
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Curator/Gallerist module */}
                  {(roles.includes("curator") || roles.includes("gallerist") || mainRole === "curator" || mainRole === "gallerist") && (
                    <section>
                      <h3 className="mb-2 text-sm font-semibold text-zinc-800">
                        {t("profileDetails.curatorModule")}
                      </h3>
                      <div className="space-y-4">
                        <div>
                          <label className="mb-1 block text-sm font-medium">{t("settings.labelAffiliation")} ({t("profileDetails.optional")})</label>
                          <select value={affiliation} onChange={(e) => setAffiliation(e.target.value)} className="w-full rounded border border-zinc-300 px-3 py-2">
                            <option value="">Select</option>
                            {TAXONOMY.affiliationOptions.map((o) => (
                              <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium">{t("settings.labelProgramFocus")} ({t("profileDetails.optional")})</label>
                          <TaxonomyChipSelect options={TAXONOMY.themeOptions} value={programFocus} onChange={setProgramFocus} max={TAXONOMY_LIMITS.programFocus} t={t} onMaxReached={() => setMaxSelectMessage(t("profileDetails.maxSelectHint").replace("{max}", String(TAXONOMY_LIMITS.programFocus)))} />
                        </div>
                      </div>
                    </section>
                  )}
                </div>
              )}
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {warning && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded">
                <span>{warning}</span>
                {showRetryDetails && (
                  <button
                    type="button"
                    onClick={handleRetryDetails}
                    disabled={saving}
                    className="rounded border border-amber-600 px-2 py-1 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                  >
                    {saving ? t("common.loading") : t("settings.retryDetails")}
                  </button>
                )}
              </div>
            )}
            {info && (
              <p className="text-sm text-zinc-600 bg-zinc-100 px-3 py-2 rounded">
                {info}
              </p>
            )}
            {saved && (
              <p className="text-sm text-green-600">{t("settings.saveSuccess")}</p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="rounded bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-800 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {saving && (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />
              )}
              {saving ? t("common.loading") : t("common.save")}
            </button>
          </form>
        )}

        {isDev && (
          <div className="mt-8 rounded-lg border border-zinc-300 bg-zinc-50 p-4 text-sm">
            <h3 className="mb-2 font-medium text-zinc-800">{t("settings.devDebug")}</h3>
            {lastError && (
              <>
                <p className="mb-1 text-xs text-zinc-600">
                  step: <strong>{lastError.step}</strong>
                  {lastError.durationMs != null && ` (${lastError.durationMs}ms)`}
                </p>
                {(lastError.step === "details_rpc" || lastError.step === "unified_upsert") && (
                  <p className="mb-1 text-xs text-zinc-600">RPC: {lastError.step === "unified_upsert" ? "upsert_my_profile" : "update_my_profile_base + update_my_profile_details"} (no PATCH)</p>
                )}
                <p className="mb-1 text-xs text-red-700">
                  code: {lastError.supabaseError.code ?? "—"} | message: {lastError.supabaseError.message ?? "—"}
                </p>
                {lastError.supabaseError.details && (
                  <p className="mb-1 text-xs text-zinc-700">details: {lastError.supabaseError.details}</p>
                )}
                {lastError.supabaseError.hint && (
                  <p className="mb-2 text-xs text-zinc-600">hint: {lastError.supabaseError.hint}</p>
                )}
                <pre className="mb-3 max-h-48 overflow-auto rounded bg-zinc-100 p-2 text-xs">
                  {JSON.stringify(lastError.normalizedPayload, null, 2)}
                </pre>
                <button
              type="button"
              onClick={() => {
                const json = JSON.stringify(
                  { step: lastError.step, supabaseError: lastError.supabaseError, normalizedPayload: lastError.normalizedPayload, ts: Date.now() },
                  null,
                  2
                );
                void navigator.clipboard.writeText(json);
              }}
              className="mr-2 rounded border border-zinc-400 px-2 py-1 text-xs hover:bg-zinc-200"
            >
              Copy debug
            </button>
              </>
            )}
            {process.env.NODE_ENV === "development" && <TestRpcButton />}
          </div>
        )}

        <div className="mt-12 border-t border-zinc-200 pt-8">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={async () => {
                await signOut();
                router.replace("/login");
              }}
              className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              {t("nav.logout")}
            </button>
            <Link
              href="/set-password"
              className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              {hasPassword === false
                ? t("settings.setPassword")
                : t("settings.changePassword")}
            </Link>
          </div>
          {hasPassword === false && (
            <p className="mt-2 text-xs text-zinc-500">
              {t("settings.setPasswordHint")}
            </p>
          )}
        </div>
      </main>
    </AuthGate>
  );
}
