"use client";

import { useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useT } from "@/lib/i18n/useT";
import { aiApi } from "@/lib/ai/browser";
import type {
  TranslateDraftFieldKind,
  TranslateDraftResult,
} from "@/lib/ai/types";

type Props = {
  sourceText: string;
  sourceLocale: "ko" | "en";
  targetLocale: "ko" | "en";
  fieldKind: TranslateDraftFieldKind;
  /** Optional prose excerpts (author's own writing) used as tone anchors
   *  for prose kinds. Ignored on short kinds. */
  styleAnchors?: string[];
  /** Callback fired when the user accepts the AI draft. The button just
   *  hands the text to the parent input; nothing is persisted. */
  onDraft: (text: string) => void;
  /** Optional custom label; defaults to i18n `bilingual.aiDraft`. */
  labelKey?: string;
  /** Compact rendering — smaller footprint for row-level inputs. */
  compact?: boolean;
  className?: string;
};

/**
 * QA 2026-07-28 (Track C) — 이중언어 인풋의 "AI 초안" 어시스트 버튼.
 * BilingualFieldPair 의 secondary slot 안(`renderSecondaryAssist`)에서
 * 사용하며, 원문(primary)을 targetLocale 로 옮긴 draft 를 fetch 해서
 * `onDraft(text)` 콜백으로 부모의 secondary 상태에 흘려보낸다. UI 는
 * 어디에도 자동 저장하지 않으며, 사용자가 폼 저장을 눌러야 반영된다.
 *
 * Failure modes:
 *   - source empty       → 버튼 disabled + 힌트
 *   - degraded (no_key)  → amber 문구 "잠시 후 다시 시도" 유지
 *   - unexpected throw   → ErrorBoundary 로 소프트 크래시 → 재시도 카드
 */
function AiTranslationDraftButtonInner({
  sourceText,
  sourceLocale,
  targetLocale,
  fieldKind,
  styleAnchors,
  onDraft,
  labelKey,
  compact,
  className,
}: Props) {
  const { t } = useT();
  const [loading, setLoading] = useState(false);
  const [errorReason, setErrorReason] = useState<TranslateDraftResult["reason"] | null>(null);

  const trimmedSource = sourceText.trim();
  const disabled = trimmedSource.length === 0 || loading;

  const handleClick = async () => {
    if (disabled) return;
    setLoading(true);
    setErrorReason(null);
    try {
      const res = await aiApi.translateDraft({
        translate: {
          fieldKind,
          sourceLocale,
          targetLocale,
          sourceText: trimmedSource,
          styleAnchors: styleAnchors ?? [],
        },
      });
      const draft = typeof res.draft === "string" ? res.draft.trim() : "";
      if (res.degraded || !draft) {
        setErrorReason(res.reason ?? "error");
        return;
      }
      onDraft(draft);
    } catch (err) {
      if (typeof console !== "undefined") {
        console.error("[AiTranslationDraftButton] fetch failed", err);
      }
      setErrorReason("error");
    } finally {
      setLoading(false);
    }
  };

  const buttonLabel = loading
    ? t("bilingual.aiDraftPending")
    : t(labelKey ?? "bilingual.aiDraft");

  const btnCls = compact
    ? "rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-600 hover:border-zinc-500 disabled:opacity-50"
    : "rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-500 disabled:opacity-50";

  return (
    <div className={className ?? "mt-1 flex items-center gap-2"}>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={disabled}
        className={btnCls}
        title={
          disabled && trimmedSource.length === 0
            ? t("bilingual.aiDraftDisabled")
            : undefined
        }
      >
        {buttonLabel}
      </button>
      {errorReason && !loading && (
        <span className="text-[11px] text-amber-700">
          {t(
            errorReason === "cap"
              ? "ai.error.softCap"
              : errorReason === "no_key"
                ? "ai.error.unavailable"
                : errorReason === "invalid_input"
                  ? "ai.error.invalidInput"
                  : "bilingual.aiDraftFailed",
          )}
        </span>
      )}
      {!errorReason && !loading && (
        <span className="text-[11px] text-zinc-400">
          {t("bilingual.aiDraftHint")}
        </span>
      )}
    </div>
  );
}

export function AiTranslationDraftButton(props: Props) {
  return (
    // Silent fallback: on soft crash we drop the assist entirely so the
    // parent input never white-screens. Users can still write the
    // translation manually — nothing else regresses.
    <ErrorBoundary fallback={() => null}>
      <AiTranslationDraftButtonInner {...props} />
    </ErrorBoundary>
  );
}

export default AiTranslationDraftButton;
