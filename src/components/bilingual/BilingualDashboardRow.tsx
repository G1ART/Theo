"use client";

/**
 * QA 2026-07-29 (Track δ) — 벌크 이중언어 대시보드의 재사용 가능한 row.
 *
 * 프로필 / 작품 / 전시 세 그룹 모두 같은 구조로 렌더된다:
 *   [Field 레이블]  [status chip]
 *   [현재 언어 값 (readonly)]
 *   [상대 언어 입력창 (editable)]  [AI 초안]  [저장]
 *
 * 사용자가 저장 버튼을 눌러야만 반영되며, AI 초안은 입력창을 채우기만
 * 한다. 부모가 `sourceLocale`/`targetLocale` 을 결정한다 (KO 슬롯만 있는
 * row 는 EN 을 target 으로, EN 만 있는 row 는 KO 를 target 으로).
 */

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { AiTranslationDraftButton } from "@/components/i18n/AiTranslationDraftButton";
import type {
  TranslateDraftFieldKind,
  TranslateDraftResult,
} from "@/lib/ai/types";

export type BilingualRowStatus = "complete" | "one_side";

export type BilingualDashboardRowProps = {
  /** i18n 키 — 예: `bilingual.dashboard.field.displayName`. */
  labelKey: string;
  /** 상대 언어에 채워진 원본 (오너가 이미 등록한 primary 값). */
  sourceValue: string;
  /** 상대 언어 (원본이 있는 슬롯). */
  sourceLocale: "ko" | "en";
  /** 채워야 할 대상 언어 슬롯 (비어 있음). */
  targetLocale: "ko" | "en";
  /** AI 번역이 사용할 필드 종류. `title` 처럼 짧은 필드부터 `bio` 처럼
   *  긴 산문까지 커버. `medium` 은 문법상 짧지만 UI 상 `medium` 그대로. */
  fieldKind: TranslateDraftFieldKind;
  /** 초안 tone anchor (예: 같은 저자의 다른 산문). 짧은 필드에는 무시됨. */
  styleAnchors?: string[];
  /** 저장 실행. 부모가 실제 upsert 로직을 소유. */
  onSave: (targetValue: string) => Promise<{ error?: unknown }>;
  /** 초기 편집 값 (drafts / 이전 세션에서 남겨둔 임시 값). 없으면 빈 문자열. */
  initialTargetValue?: string;
  /** row 별 컨텍스트 (edit page 딥링크 등) — 오른쪽 상단에 소소한 링크로 노출. */
  contextHref?: string;
  contextLabel?: string;
  /** 대시보드가 이 row 의 draft 를 실제로 생성한 후 호출. quota UI 갱신용. */
  onDraftGenerated?: (result: TranslateDraftResult) => void;
};

export function BilingualDashboardRow({
  labelKey,
  sourceValue,
  sourceLocale,
  targetLocale,
  fieldKind,
  styleAnchors,
  onSave,
  initialTargetValue,
  contextHref,
  contextLabel,
  onDraftGenerated,
}: BilingualDashboardRowProps) {
  const { t } = useT();
  const [targetValue, setTargetValue] = useState<string>(initialTargetValue ?? "");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // initialTargetValue 가 후행으로 도착 (예: 부모가 fetch 후 세팅) 하는
    // 경우엔 로컬 값도 갱신. 이미 사용자가 입력 중이면 덮어쓰지 않기 위해
    // 로컬 값이 비어 있을 때만 반영한다.
    if (
      initialTargetValue !== undefined &&
      initialTargetValue.length > 0 &&
      targetValue.length === 0
    ) {
      setTargetValue(initialTargetValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTargetValue]);

  const isProse =
    fieldKind === "bio" ||
    fieldKind === "statement" ||
    fieldKind === "story" ||
    fieldKind === "preface";

  const status: BilingualRowStatus =
    targetValue.trim().length > 0 ? "complete" : "one_side";

  const handleSave = useCallback(async () => {
    const value = targetValue.trim();
    if (saving) return;
    setSaving(true);
    setError(null);
    const { error: err } = await onSave(value);
    setSaving(false);
    if (err) {
      setError(t("bilingual.dashboard.rowError"));
      return;
    }
    setSavedAt(Date.now());
    setTimeout(() => setSavedAt(null), 2000);
  }, [targetValue, saving, onSave, t]);

  const currentLangLabel = sourceLocale.toUpperCase();
  const targetLangLabel = targetLocale.toUpperCase();
  const currentValueLabel = t(
    "bilingual.dashboard.currentValueLabel"
  ).replace("{lang}", currentLangLabel);
  const targetInputLabel = t(
    "bilingual.dashboard.targetInputLabel"
  ).replace("{lang}", targetLangLabel);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-800">
            {t(labelKey)}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              status === "complete"
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            {status === "complete"
              ? t("bilingual.dashboard.statusComplete")
              : t("bilingual.dashboard.statusOneSide")}
          </span>
        </div>
        {contextHref && contextLabel && (
          <a
            href={contextHref}
            className="text-[11px] text-zinc-500 underline underline-offset-2 hover:text-zinc-800"
          >
            {contextLabel}
          </a>
        )}
      </div>
      <div className="space-y-2">
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            {currentValueLabel}
          </p>
          <p
            lang={sourceLocale}
            className={`rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 ${
              isProse ? "whitespace-pre-line" : ""
            }`}
          >
            {sourceValue}
          </p>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            {targetInputLabel}
          </p>
          {isProse ? (
            <textarea
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              lang={targetLocale}
              rows={4}
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm leading-relaxed"
            />
          ) : (
            <input
              type="text"
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              lang={targetLocale}
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AiTranslationDraftButton
            sourceText={sourceValue}
            sourceLocale={sourceLocale}
            targetLocale={targetLocale}
            fieldKind={fieldKind}
            styleAnchors={styleAnchors}
            onDraft={(text) => {
              setTargetValue(text);
              onDraftGenerated?.({
                fieldKind,
                sourceLocale,
                targetLocale,
                draft: text,
              });
            }}
            compact
          />
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || targetValue.trim().length === 0}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {saving
              ? t("bilingual.dashboard.saveRowPending")
              : t("bilingual.dashboard.saveRow")}
          </button>
          {savedAt && (
            <span className="text-[11px] font-medium text-emerald-700">
              {t("bilingual.dashboard.saveRowDone")}
            </span>
          )}
          {error && (
            <span className="text-[11px] text-red-600">{error}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default BilingualDashboardRow;
