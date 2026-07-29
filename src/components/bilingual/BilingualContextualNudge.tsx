"use client";

/**
 * QA 2026-07-29 (Track γ) — Layer 3 이중언어 컨텍스트 넛지.
 *
 * 사용자 본인이 자기 프로필/작품을 볼 때, UI 로케일에 해당하는 언어 슬롯이
 * 비어 있는 필드 옆에 조용히 붙는 안내 chip. 예:
 *   * 한국어만 등록된 display_name 을 EN 로케일에서 본인이 볼 때 →
 *     "영어권에서 다르게 불리는 이름이 있나요?" chip
 *   * bio 가 KO 만 있고 UI 는 EN 일 때 → "영어 버전을 두시겠어요?" chip
 *
 * 원칙
 * ----
 *   * **오너 전용** — 방문자에게는 절대 노출되지 않는다 (`viewerIsOwner`
 *     프롭이 반드시 true 여야 함). 이는 사용자 프라이버시 (자기 편집
 *     상태를 남들에게 노출하지 않음) 를 지킨다.
 *   * **현재 슬롯 비었을 때만** — `sourceValue` (같은 필드의 다른 언어)
 *     가 채워져 있고, `currentValue` (현재 UI 로케일 슬롯) 가 비어
 *     있을 때만 렌더. 두 조건 중 하나라도 무너지면 아무 것도 그리지 않음.
 *   * **세션 + 크로스세션 dismiss** — 한 세션 안에서 dismiss 하면
 *     sessionStorage 로 즉시 숨김. 30일 크로스세션 dismiss 는
 *     `user_ui_dismissals` 에 스누즈 기록.
 *   * **비강제** — CTA 를 눌러도 modal 이 뜨지 않고, 사용자가 자기 편한
 *     편집 페이지 (`editHref`) 로 이동만 한다.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import {
  DISMISSAL_KEYS,
  isDismissed,
  readDismissal,
  recordDismissal,
} from "@/lib/i18n/dismissals";

/** 이번 세션에서 dismiss 한 것을 즉시 숨기기 위한 sessionStorage 키. */
const SESSION_DISMISS_PREFIX = "bilingual_ctx_nudge_dismissed:";
const CROSS_SESSION_SNOOZE_DAYS = 30;

export type BilingualNudgeField =
  | "display_name"
  | "bio"
  | "statement"
  | "title"
  | "medium"
  | "story";

type Props = {
  /** 어떤 필드에 붙는 넛지인지 (i18n 및 dismiss 스코프 판단에 사용). */
  field: BilingualNudgeField;
  /** 이미 채워진 반대 언어 값. 이게 비어 있으면 넛지 자체가 무의미. */
  sourceValue: string | null | undefined;
  /**
   * 현재 UI 로케일에 대응하는 값. 이게 이미 채워져 있으면 이 필드는 이미
   * 두 언어가 완성 — 넛지 노출 안 함. 부모가 pickLocalized* 대신 slot
   * 값을 직접 넘기는 편이 낫다 (fallback 이 아니라 진짜 슬롯 상태를
   * 봐야 하므로).
   */
  currentValue: string | null | undefined;
  /** 현재 UI 로케일 — 넛지 문구 톤을 결정 (KO 슬롯 채우기 vs EN 슬롯). */
  uiLocale: "ko" | "en";
  /**
   * 뷰어가 실제 오너인지. false 면 절대 렌더 안 함. 부모는 이 값을
   * 반드시 명시적으로 검증해 넘긴다 (기본값 false 가능한 실수).
   */
  viewerIsOwner: boolean;
  /**
   * CTA 링크 목적지. 프로필 필드는 `/settings#...`, 작품 필드는
   * `/artwork/{id}/edit#...` 처럼 딥링크. `#bilingual-focus` 등 앵커가
   * 있으면 편집 페이지가 스크롤하도록 부모가 결정.
   */
  editHref: string;
  /**
   * dismiss 를 어느 스코프로 기록할지. profile 필드는
   * `bilingualContextualNudgeProfile` 하나로 묶고, artwork 필드는
   * `bilingualContextualNudgeArtwork` 하나로 묶는다. 필드별로 나누지
   * 않는 이유: "이 종류의 넛지는 이제 그만 보고 싶다" 는 결정이
   * 실제로는 한 축이기 때문 — 필드 단위로 쪼개면 사용자가 여러 번
   * dismiss 를 반복해야 조용해진다.
   */
  scope: "profile" | "artwork";
  /** 같은 세션 내 세밀한 dismiss 를 위해 필드별 세션 키에 붙일 hint. */
  sessionScopeHint?: string;
  className?: string;
};

function nudgeMessageKey(
  field: BilingualNudgeField,
  uiLocale: "ko" | "en"
): string {
  // 슬롯 방향에 따라 문구가 다르다. UI 가 KO 이면 KO 슬롯이 비어 있는
  // 상황 → "한국어로 남겨 두시겠어요?" (toKo). 반대는 (toEn).
  const suffix = uiLocale === "ko" ? "ToKo" : "ToEn";
  switch (field) {
    case "display_name":
      return `bilingual.nudge.displayName${suffix}`;
    case "bio":
      return `bilingual.nudge.bio${suffix}`;
    case "statement":
      return `bilingual.nudge.statement${suffix}`;
    case "title":
      return `bilingual.nudge.title${suffix}`;
    case "medium":
      return `bilingual.nudge.medium${suffix}`;
    case "story":
      return `bilingual.nudge.story${suffix}`;
  }
}

export function BilingualContextualNudge({
  field,
  sourceValue,
  currentValue,
  uiLocale,
  viewerIsOwner,
  editHref,
  scope,
  sessionScopeHint,
  className,
}: Props) {
  const { t } = useT();
  // State only tracks async-DB dismiss (loaded from user_ui_dismissals) plus
  // an in-session dismiss trigger. The precondition ("conditionOk") is
  // derived from props each render — we never need to setState for that,
  // which keeps this effect single-purpose (async load only) and avoids
  // the cascading-render lint warning.
  const [dbDismissed, setDbDismissed] = useState<boolean | null>(null);
  const [sessionDismissed, setSessionDismissed] = useState(false);

  const dismissalKey =
    scope === "profile"
      ? DISMISSAL_KEYS.bilingualContextualNudgeProfile
      : DISMISSAL_KEYS.bilingualContextualNudgeArtwork;
  const sessionKey = useMemo(
    () =>
      `${SESSION_DISMISS_PREFIX}${scope}:${field}${
        sessionScopeHint ? `:${sessionScopeHint}` : ""
      }`,
    [scope, field, sessionScopeHint]
  );

  const hasSourceContent = (sourceValue ?? "").trim().length > 0;
  const hasCurrentContent = (currentValue ?? "").trim().length > 0;
  const conditionOk = viewerIsOwner && hasSourceContent && !hasCurrentContent;

  // A single mount-side effect handles both dismiss sources. sessionStorage
  // is read inside the async block (never synchronously in the effect body)
  // so we sidestep the "setState in effect" lint that fires whenever the
  // setter is called before yielding to the microtask queue.
  useEffect(() => {
    if (!conditionOk) return;
    let cancelled = false;
    void (async () => {
      let sessionHit = false;
      if (typeof window !== "undefined") {
        try {
          sessionHit = window.sessionStorage.getItem(sessionKey) === "1";
        } catch {
          /* private mode — fall through to DB check */
        }
      }
      if (cancelled) return;
      if (sessionHit) {
        setSessionDismissed(true);
        setDbDismissed(true);
        return;
      }
      const row = await readDismissal(dismissalKey);
      if (cancelled) return;
      setDbDismissed(isDismissed(row));
    })();
    return () => {
      cancelled = true;
    };
  }, [conditionOk, dismissalKey, sessionKey]);

  const handleDismiss = useCallback(async () => {
    setSessionDismissed(true);
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(sessionKey, "1");
      } catch {
        /* non-fatal */
      }
    }
    await recordDismissal(dismissalKey, {
      snoozeDays: CROSS_SESSION_SNOOZE_DAYS,
    });
  }, [dismissalKey, sessionKey]);

  if (!conditionOk) return null;
  if (sessionDismissed) return null;
  // Fail-quiet policy: while DB read is in flight (dbDismissed === null) we
  // wait to render so we don't briefly flash a chip that immediately
  // vanishes. Rendering nothing during that gap is preferable to flicker.
  if (dbDismissed === null) return null;
  if (dbDismissed) return null;

  return (
    <span
      role="note"
      className={
        className ??
        "mt-1 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900"
      }
    >
      <span aria-hidden className="text-amber-500">
        ✎
      </span>
      <span>{t(nudgeMessageKey(field, uiLocale))}</span>
      <Link
        href={editHref}
        className="rounded bg-white/70 px-2 py-0.5 text-[11px] font-medium text-amber-900 underline underline-offset-2 hover:bg-white"
      >
        {t("bilingual.nudge.cta")}
      </Link>
      <button
        type="button"
        onClick={() => void handleDismiss()}
        className="ml-1 rounded p-0.5 text-amber-700 hover:bg-white/70"
        aria-label={t("bilingual.nudge.dismiss")}
      >
        <span aria-hidden>×</span>
      </button>
    </span>
  );
}

export default BilingualContextualNudge;
