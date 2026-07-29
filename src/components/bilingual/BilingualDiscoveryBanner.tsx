"use client";

/**
 * QA 2026-07-29 (Track β) — Layer 2 이중언어 발견 배너.
 *
 * 홈 대시보드 (`/feed?tab=all|foryou`) 상단에 얹혀서, 기존 사용자가 자기
 * 프로필/작품/전시를 두 언어로 등록할 수 있다는 사실을 딱 한 번 (또는
 * "나중에" 스누즈 후 최대 3회) 안내한다.
 *
 * Dismiss 정책
 * ------------
 *   * "지금 정리하기"  → `/settings/bilingual` 로 이동 + 스누즈 없음 dismiss
 *     (다시 등장하지 않음).
 *   * "나중에"        → 7일 스누즈. `dismiss_count` 3회를 넘으면 자동으로
 *     영구 dismiss (더 이상 조르지 않음).
 *   * "숨기기"        → 영구 dismiss.
 *
 * 오너십: 전적으로 사용자 트리거. 세션 부트 시 dismissal row 를 한 번 읽고,
 * 조건에 맞을 때만 렌더. 렌더 자체가 dismissable — 상태를 미리 클라이언트에
 * 캐싱하지 않고, RLS 로 보호된 상태를 신뢰한다.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import {
  DISMISSAL_KEYS,
  isDismissed,
  readDismissal,
  recordDismissal,
} from "@/lib/i18n/dismissals";

const MAX_REAPPEARANCES = 3;
const SNOOZE_DAYS = 7;
const BILINGUAL_SETTINGS_HREF = "/settings/bilingual";

export function BilingualDiscoveryBanner() {
  const { t } = useT();
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const row = await readDismissal(DISMISSAL_KEYS.bilingualDiscoveryBanner);
      if (cancelled) return;
      // 3회 이상 dismiss (스누즈 포함) 됐으면 영구 dismiss 로 취급.
      if (row && (row.dismiss_count ?? 0) >= MAX_REAPPEARANCES && !row.snoozed_until) {
        setVisible(false);
      } else if (isDismissed(row)) {
        setVisible(false);
      } else {
        setVisible(true);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLater = useCallback(async () => {
    setVisible(false);
    await recordDismissal(DISMISSAL_KEYS.bilingualDiscoveryBanner, {
      snoozeDays: SNOOZE_DAYS,
    });
  }, []);

  const handleHide = useCallback(async () => {
    setVisible(false);
    await recordDismissal(DISMISSAL_KEYS.bilingualDiscoveryBanner);
  }, []);

  const handleSetUp = useCallback(async () => {
    // 사용자가 배너에서 곧장 대시보드로 이동한 경우엔 영구 dismiss 로 기록
    // (동일한 안내를 다시 보고 싶어하지 않는다). 대시보드에서 다시 필요해
    // 지면 언제든 링크를 통해 재방문 가능.
    await recordDismissal(DISMISSAL_KEYS.bilingualDiscoveryBanner);
    setVisible(false);
  }, []);

  if (!ready || !visible) return null;

  return (
    <div
      role="region"
      aria-label={t("bilingual.discovery.title")}
      className="mb-6 rounded-xl border border-zinc-200 bg-gradient-to-br from-white via-white to-zinc-50 p-4 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-900">
            {t("bilingual.discovery.title")}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-600">
            {t("bilingual.discovery.body")}
          </p>
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          <Link
            href={BILINGUAL_SETTINGS_HREF}
            onClick={() => void handleSetUp()}
            className="inline-flex items-center rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
          >
            {t("bilingual.discovery.ctaSetUp")}
          </Link>
          <button
            type="button"
            onClick={() => void handleLater()}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
          >
            {t("bilingual.discovery.ctaLater")}
          </button>
          <button
            type="button"
            onClick={() => void handleHide()}
            className="rounded-md px-2 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-800"
          >
            {t("bilingual.discovery.ctaHide")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default BilingualDiscoveryBanner;
