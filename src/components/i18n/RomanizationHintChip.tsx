"use client";

import { useMemo, useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useT } from "@/lib/i18n/useT";
import { hasHangul, romanizeKorean } from "@/lib/search/queryVariants";

type Props = {
  /** The Korean-script source name (e.g. from `display_name_ko`). */
  sourceText: string;
  /** Current value of the target field. Used to hide the chip once the
   *  user already has something in the target slot. */
  currentTargetText: string;
  onApply: (text: string) => void;
  /** When true, render the chip in a small pill fitting inline under an input. */
  compact?: boolean;
  className?: string;
};

/**
 * QA 2026-07-28 (Track C) — 이름(display_name) 필드에서만 사용하는
 * 로마자 힌트 칩. AI 번역이 아닌, 검색용으로 이미 쓰던
 * `hangeul.enname` (queryVariants.romanizeKorean) 을 재사용해서
 * "김철수 → Kim Cheol-su" 같은 시드를 제안한다. 절대 자동 저장하지
 * 않고, 사용자가 칩을 클릭했을 때에만 secondary 입력창에 채워 넣는다.
 *
 * Design decisions:
 *   - Only offer Hangul → Latin. 반대 방향(영문 → 한글)은 이름 DB 없이는
 *     추측할 수 없으므로 아예 노출하지 않는다.
 *   - 이미 target 슬롯에 값이 있으면 chip 을 숨긴다 (덮어씌우기 유혹 방지).
 *   - Failure modes: `romanizeKorean` 이 빈 문자열 반환 or throw 하면
 *     ErrorBoundary + 정상 return null 로 UI 를 조용히 접는다.
 */
function RomanizationHintChipInner({
  sourceText,
  currentTargetText,
  onApply,
  compact,
  className,
}: Props) {
  const { t } = useT();
  const [dismissed, setDismissed] = useState(false);

  const romanized = useMemo(() => {
    const src = (sourceText ?? "").trim();
    if (!src) return "";
    if (!hasHangul(src)) return "";
    try {
      const roman = romanizeKorean(src);
      return roman ? roman.replace(/\s+/g, " ").trim() : "";
    } catch {
      return "";
    }
  }, [sourceText]);

  if (!romanized) return null;
  if (currentTargetText.trim().length > 0) return null;
  if (dismissed) return null;

  const label = t("bilingual.romanizeChip").replace("{romanized}", romanized);

  const btnCls = compact
    ? "inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-700 hover:border-zinc-500"
    : "inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-500";

  return (
    <div className={className ?? "mt-1 flex flex-wrap items-center gap-2"}>
      <button
        type="button"
        onClick={() => {
          onApply(romanized);
        }}
        className={btnCls}
      >
        {label}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-[11px] text-zinc-400 underline hover:text-zinc-600"
        aria-label={t("common.close")}
      >
        {t("common.dismiss")}
      </button>
    </div>
  );
}

export function RomanizationHintChip(props: Props) {
  return (
    <ErrorBoundary fallback={() => null}>
      <RomanizationHintChipInner {...props} />
    </ErrorBoundary>
  );
}

export default RomanizationHintChip;
