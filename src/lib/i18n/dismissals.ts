"use client";

/**
 * QA 2026-07-29 — Bilingual adoption UX 를 지탱하는 dismissal 헬퍼.
 *
 * `public.user_ui_dismissals` 테이블은 사용자별로 dismiss 상태 (스누즈 만료,
 * 누적 dismiss 횟수) 를 저장한다. Layer 2 배너와 Layer 3 컨텍스트 넛지가
 * 이 헬퍼로 상태를 읽고 쓴다. RPC (`record_ui_dismissal`) 로 upsert 하고,
 * SELECT 은 RLS 를 신뢰해 클라이언트에서 곧장 한다.
 *
 * 실패 정책: DB 읽기가 실패해도 UI 는 dismiss 안 된 것으로 간주해 노출
 * 한다. 사용자에게 "이거 뭔가 이상하다" 상태를 남기지 않기 위해서.
 */

import { supabase } from "@/lib/supabase/client";

/**
 * Layer 2 (홈 배너), Layer 3 (프로필/작품 컨텍스트 넛지) 가 사용하는
 * dismiss 키. 새 dismissible surface 를 추가할 때 여기에 상수를 더한다.
 */
export const DISMISSAL_KEYS = {
  bilingualDiscoveryBanner: "bilingual_discovery_banner_v1",
  bilingualContextualNudgeProfile: "bilingual_contextual_nudge_profile_v1",
  bilingualContextualNudgeArtwork: "bilingual_contextual_nudge_artwork_v1",
  /**
   * QA 2026-07-29 (Part B) — dashboard orphan-invites autoscan banner
   * (`OrphanInvitesBanner`). Dismissing snoozes the banner for
   * `ORPHAN_AUTOSCAN_SNOOZE_DAYS` (see the component) rather than
   * dismissing forever, since new orphan invitations can appear later.
   */
  orphanInvitesAutoscan: "orphan.invites.autoscan_v1",
} as const;

export type DismissalKey =
  (typeof DISMISSAL_KEYS)[keyof typeof DISMISSAL_KEYS];

export type DismissalRow = {
  user_id: string;
  dismissal_key: string;
  dismissed_at: string;
  snoozed_until: string | null;
  dismiss_count: number;
};

/**
 * 로그인된 사용자의 특정 dismiss row 를 읽는다. row 가 없거나 RLS 로
 * 걸리면 null 을 반환 (UI 는 dismiss 안 된 것으로 취급).
 */
export async function readDismissal(
  key: DismissalKey | string
): Promise<DismissalRow | null> {
  try {
    const { data, error } = await supabase
      .from("user_ui_dismissals")
      .select("user_id, dismissal_key, dismissed_at, snoozed_until, dismiss_count")
      .eq("dismissal_key", key)
      .maybeSingle();
    if (error || !data) return null;
    return data as DismissalRow;
  } catch {
    return null;
  }
}

/**
 * dismiss 기록. snoozeDays 를 주면 스누즈 만료를 그 이후로 미룬다. 반환
 * 값은 upsert 된 row 이며, 호출 측이 새 `dismiss_count` 를 즉시 사용
 * (예: "3회 넘으면 영구 dismiss 로 처리") 할 수 있다.
 *
 * 실패 시 null.
 */
export async function recordDismissal(
  key: DismissalKey | string,
  opts?: { snoozeDays?: number }
): Promise<DismissalRow | null> {
  try {
    const { data, error } = await supabase.rpc("record_ui_dismissal", {
      p_key: key,
      p_snooze_days: opts?.snoozeDays ?? null,
    });
    if (error || !data) return null;
    return data as DismissalRow;
  } catch {
    return null;
  }
}

/**
 * dismiss row 가 현재 시점에 실제로 "숨겨야 할" 상태인지 판단.
 * - `snoozed_until` 이 미래 → true (스누즈 중)
 * - `snoozed_until` 이 null → true (영구 dismiss)
 * - `snoozed_until` 이 과거 → false (다시 노출 가능)
 */
export function isDismissed(row: DismissalRow | null): boolean {
  if (!row) return false;
  if (!row.snoozed_until) return true;
  return new Date(row.snoozed_until).getTime() > Date.now();
}
