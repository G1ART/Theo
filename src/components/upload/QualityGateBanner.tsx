"use client";

import { useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/messages";
import type {
  ArtworkQualityGateIssue,
  ArtworkQualityGateResult,
  ArtworkQualityGateSeverity,
} from "@/lib/ai/types";

/**
 * 2026-08-19 — Yellow / red banner shown above the single-upload
 * preview when the pre-flight vision quality gate flags a photo.
 *
 * Contract
 * --------
 *   - `warn`  → yellow banner. `[재촬영]` clears the file (via
 *     `onReshoot`), `[계속 진행]` dismisses the banner and keeps
 *     Save enabled (`onProceed`).
 *   - `block` → red banner. `[재촬영]` clears the file. The secondary
 *     `[그래도 계속]` link records an override (`onUseAnyway`) so QA
 *     can slice on `enhancement_meta.qualityGate.override = true` for
 *     systemic false-block regressions.
 *   - `ok` / `degraded` → the parent should not render this banner at
 *     all. The component still guards against it (returns `null`).
 */

const ISSUE_LABEL_KEYS: Record<ArtworkQualityGateIssue, MessageKey> = {
  blur: "enhancement.quality.issue.blur",
  motion_blur: "enhancement.quality.issue.motion_blur",
  glare: "enhancement.quality.issue.glare",
  highlight_clip: "enhancement.quality.issue.highlight_clip",
  shadow_clip: "enhancement.quality.issue.shadow_clip",
  low_resolution: "enhancement.quality.issue.low_resolution",
  moire: "enhancement.quality.issue.moire",
  reproduction: "enhancement.quality.issue.reproduction",
  occlusion: "enhancement.quality.issue.occlusion",
  poor_framing: "enhancement.quality.issue.poor_framing",
};

type Props = {
  severity: ArtworkQualityGateSeverity;
  issues: ArtworkQualityGateIssue[];
  result: ArtworkQualityGateResult;
  locale: "ko" | "en";
  /** Called when the user clicks "재촬영" / "Reshoot". */
  onReshoot: () => void;
  /** Called when the user clicks "계속 진행" (warn banner only). */
  onProceed?: () => void;
  /** Called when the user clicks the "그래도 계속" escape hatch
   *  (block banner only). Records `override = true` upstream. */
  onUseAnyway?: () => void;
};

export function QualityGateBanner({
  severity,
  issues,
  result,
  locale,
  onReshoot,
  onProceed,
  onUseAnyway,
}: Props) {
  const { t } = useT();
  if (severity === "ok") return null;

  const isBlock = severity === "block";
  const wrapperCls = isBlock
    ? "rounded-lg border border-red-300 bg-red-50 p-3"
    : "rounded-lg border border-amber-300 bg-amber-50 p-3";
  const titleCls = isBlock ? "text-red-900" : "text-amber-900";
  const bodyCls = isBlock ? "text-red-800" : "text-amber-800";
  const chipCls = isBlock
    ? "rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800"
    : "rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800";
  const advice = locale === "ko" ? result.reshootAdviceKo : result.reshootAdviceEn;

  return (
    <div
      className={wrapperCls}
      role={isBlock ? "alert" : "status"}
      aria-live={isBlock ? "assertive" : "polite"}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-lg" aria-hidden="true">
          {isBlock ? "🚫" : "⚠️"}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className={`text-sm font-semibold ${titleCls}`}>
            {isBlock
              ? t("enhancement.quality.blockTitle")
              : t("enhancement.quality.warnTitle")}
          </p>
          {issues.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {issues.map((issue) => (
                <span key={issue} className={chipCls}>
                  {t(ISSUE_LABEL_KEYS[issue])}
                </span>
              ))}
            </div>
          )}
          {advice && (
            <p className={`text-xs leading-relaxed ${bodyCls}`}>{advice}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onReshoot}
              className={
                isBlock
                  ? "rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
                  : "rounded-full border border-amber-400 bg-white px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
              }
            >
              {t("enhancement.quality.reshoot")}
            </button>
            {!isBlock && onProceed && (
              <button
                type="button"
                onClick={onProceed}
                className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
              >
                {t("enhancement.quality.proceed")}
              </button>
            )}
            {isBlock && onUseAnyway && (
              <button
                type="button"
                onClick={onUseAnyway}
                className="text-xs font-medium text-red-800 underline decoration-red-400 underline-offset-2 hover:text-red-900"
              >
                {t("enhancement.quality.useAnyway")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
