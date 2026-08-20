/**
 * Single SSOT for profile save. All writes go through upsert_my_profile RPC.
 * No direct PATCH/UPDATE/INSERT to profiles table from app.
 */

import { supabase } from "./client";
import type { ProfileSaveError, ProfileSaveResult } from "./profileSaveTypes";

export type ProfileSaveUnifiedArgs = {
  basePatch: Record<string, unknown>;
  detailsPatch: Record<string, unknown>;
  completeness: number | null;
};

/** Whitelist for base. Include username only when caller explicitly sets a non-empty value (e.g. onboarding). */
const BASE_KEYS = new Set([
  "display_name",
  // QA 2026-07-28 bilingual — the 240004 trigger keeps legacy display_name /
  // bio / artist_statement in sync when any of these are written.
  "display_name_ko",
  "display_name_en",
  "bio",
  "bio_ko",
  "bio_en",
  "location",
  "website",
  "avatar_url",
  "is_public",
  "main_role",
  "roles",
  "education",
  "username",
  // P1-0 identity surface (mirrors BASE_PROFILE_KEYS in profiles.ts)
  "cover_image_url",
  "cover_image_position_y",
  "artist_statement",
  "artist_statement_ko",
  "artist_statement_en",
  "artist_statement_hero_image_url",
  // Signup v2 Phase 1 (2026-08-19) — new physical columns exposed
  // through the extended `upsert_my_profile` RPC. `tos_accepted_at`
  // and `profile_completed_at` are boolean-like ("true" / "now")
  // triggers: the RPC first-write-wins the timestamp. `full_name` /
  // `age_band` are plain strings (nullable, `nullif(trim(...), '')`).
  "full_name",
  "age_band",
  "tos_accepted_at",
  "profile_completed_at",
  // Signup v2 wireframe pass (2026-08-20) — optional self-declared
  // gender. Free-form text column with a closed-set UI. Cleared via
  // the same `nullif(trim(...), '')` shape as age_band / full_name.
  "gender",
]);

/**
 * Keys for which `null` / `""` is meaningful to forward to the RPC as an
 * explicit clear. The RPC uses `nullif(trim(...), '')` for these, so the
 * column actually becomes NULL in the row. Anything else still gets stripped
 * by compactPatch (preserving the existing 23502 / "do not clobber" behavior
 * for required base fields like display_name, education, roles, etc.).
 */
const NULLABLE_BASE_KEYS = new Set([
  "cover_image_url",
  "artist_statement",
  "artist_statement_hero_image_url",
  // avatar_url existed before P1-0 but had no remove-UI affordance; we make
  // its clear path safe now too so future "Remove photo" works.
  "avatar_url",
  // QA P0.5-A (rows 26–29, 32): /settings 의 [소개], [위치], [웹사이트] 는
  // 사용자가 명시적으로 비우는 것이 정상 흐름이다. 이전에는 compactPatch 가
  // null/"" 을 그대로 잘라버려 RPC 까지 도달하지 못했고, 결과적으로
  // (a) 입력란을 비워도 DB 가 갱신되지 않거나 (b) 다른 필드 변경분이 없을 때
  // "저장할 변경 사항이 없습니다" 로 분기되는 버그가 있었다. RPC 의
  // upsert_my_profile 은 nullif(trim(...), '') 으로 이 키들을 안전히 NULL 처리하므로
  // NULLABLE 으로 승격해도 23502 위험이 없다.
  "bio",
  "bio_ko",
  "bio_en",
  "location",
  "website",
  // QA 2026-07-28 bilingual: allow explicit clear of KO/EN name/statement
  // slots. Legacy display_name / artist_statement stay in sync via trigger.
  "display_name_ko",
  "display_name_en",
  "artist_statement_ko",
  "artist_statement_en",
  // Signup v2 (2026-08-19): full_name / age_band can be re-cleared by
  // a user editing their profile later (e.g. Studio → Profile). The
  // "true" / "now" trigger keys for `tos_accepted_at` /
  // `profile_completed_at` are NEVER cleared via this path — they are
  // stamp-only fields (see the RPC's coalesce() clause).
  "full_name",
  "age_band",
  // Signup v2 wireframe pass (2026-08-20).
  "gender",
]);

/**
 * Keys whose *empty array* is the user-meaningful "cleared" state. The
 * column is `jsonb not null default '[]'::jsonb`, so an empty array is
 * a valid stored value and must reach the RPC instead of being stripped.
 *
 * QA 2026-04-28 (학력 삭제 불가): without this, removing the last
 * education entry produced `education: []`, which compactPatch dropped,
 * which made the patch empty, which made saveProfileUnified return
 * "no changes" while the DB row kept the old value. Reload restored
 * the deleted row and users could not actually clear their education.
 */
const CLEARABLE_ARRAY_BASE_KEYS = new Set(["education"]);

/** Strip null/undefined/"" and empty []/{} so we never send education:null (prevents 23502). */
function compactPatch(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const isClearableNull =
      NULLABLE_BASE_KEYS.has(k) &&
      (v === null || (typeof v === "string" && v.trim() === ""));
    if (isClearableNull) {
      out[k] = null;
      continue;
    }
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0) {
      if (CLEARABLE_ARRAY_BASE_KEYS.has(k)) {
        out[k] = [];
        continue;
      }
      continue;
    }
    if (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out;
}

/** Readonly fields that must never be in base patch. */
const READONLY_BASE = new Set(["id", "profile_updated_at", "profile_completeness", "profile_details"]);

function toBasePatch(raw: Record<string, unknown>): Record<string, unknown> {
  const compact = compactPatch(raw);
  // education === null would violate the column's NOT NULL constraint
  // (23502). compactPatch already drops null; for symmetry we still
  // guard here in case a future caller hands us null directly.
  if (compact.education === null) delete compact.education;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(compact)) {
    if (READONLY_BASE.has(k)) continue;
    if (BASE_KEYS.has(k)) out[k] = v;
  }
  return out;
}

/**
 * Save base + details + completeness in one RPC. Verifies session before call.
 * Returns structured error for UI/debug; never throws on RPC failure.
 */
export async function saveProfileUnified(args: ProfileSaveUnifiedArgs): Promise<
  ProfileSaveResult<Record<string, unknown>>
> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    return { ok: false, message: "Not authenticated", step: "unified_upsert" };
  }

  const p_base = toBasePatch(args.basePatch);
  const p_details = args.detailsPatch && typeof args.detailsPatch === "object" ? args.detailsPatch : {};
  const p_completeness = args.completeness ?? null;

  const { data, error } = await supabase.rpc("upsert_my_profile", {
    p_base,
    p_details,
    p_completeness,
  });

  if (error) {
    const err: ProfileSaveError = {
      ok: false,
      code: (error as { code?: string }).code,
      message: error.message,
      details: (error as { details?: string }).details,
      hint: (error as { hint?: string }).hint,
      step: "unified_upsert",
    };
    console.error("saveProfileUnified failed", {
      rpc: "upsert_my_profile",
      argsKeys: { base: Object.keys(p_base), details: Object.keys(p_details) },
      ...err,
    });
    return err;
  }

  if (data == null || typeof data !== "object") {
    return { ok: false, message: "RPC returned no data", step: "unified_upsert" };
  }

  // Notify always-mounted shells (RandomIdBanner, Header) that the profile
  // changed so they re-read instead of showing stale onboarding state. Next.js
  // App Router does NOT remount the root layout on client navigation, so
  // without this the "한 단계만 더 남았어요" banner and the "내 스튜디오" link
  // keep their initial placeholder state after a successful onboarding save —
  // the loop QA reported on 2026-06-29.
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new Event("profile-updated"));
    } catch {
      /* best-effort */
    }
  }

  return { ok: true, data: data as Record<string, unknown> };
}

/**
 * Persist profile_completeness only (base+details empty). Best-effort init for null DB completeness.
 * Call once per session per user; set sessionStorage flag to avoid loops.
 */
export async function persistCompletenessOnly(
  score: number
): Promise<ProfileSaveResult<Record<string, unknown>>> {
  return saveProfileUnified({
    basePatch: {},
    detailsPatch: {},
    completeness: score,
  });
}
