"use client";

import { useCallback, useMemo, useState } from "react";
import { SectionFrame } from "@/components/ds/SectionFrame";
import { SectionTitle } from "@/components/ds/SectionTitle";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useT } from "@/lib/i18n/useT";
import { aiApi } from "@/lib/ai/browser";
import { markAiAccepted } from "@/lib/ai/accept";
import { AiDraftPanel, copyToClipboard } from "./AiDraftPanel";
import type { ExhibitionDraftResult } from "@/lib/ai/types";
import type { ExhibitionDraftInput } from "@/lib/ai/contexts";

type Kind = ExhibitionDraftInput["kind"];

type Props = {
  title: string;
  startDate?: string | null;
  endDate?: string | null;
  venueLabel?: string | null;
  curatorLabel?: string | null;
  hostLabel?: string | null;
  works?: Array<{ id: string; title?: string | null; year?: string | number | null; medium?: string | null }>;
  onApplyTitle?: (text: string) => void;
  /**
   * QA 2026-07-28 — 소개문(preface) 초안을 편집 폼의 preface 필드로
   * 바로 흘려보내기 위한 콜백. Provided by the create/edit surfaces
   * that own a preface textarea. When omitted the description draft
   * still shows a Copy button so nothing regresses on legacy surfaces.
   */
  onApplyDescription?: (text: string) => void;
  /**
   * Current preface value in the parent form. Used to pick between
   * insert / replace on apply (see AiDraftPanel.resolveMode). Ignored
   * when `onApplyDescription` is not provided.
   */
  currentDescription?: string;
};

const KIND_LABEL_KEY: Record<Kind, string> = {
  title: "ai.exhibition.titleSuggestCta",
  description: "ai.exhibition.descriptionCta",
  wall_text: "ai.exhibition.wallTextCta",
  invite_blurb: "ai.exhibition.inviteCta",
};

/**
 * Best-effort array-of-strings coercion. The OpenAI schema constrains
 * `drafts` to `string[]`, but production has seen the odd malformed
 * payload (e.g. `drafts` as an object, `drafts[0]` as a nested object).
 * Rendering those raw would throw during `.map` and — because the
 * assist historically had no error boundary — white-screen the whole
 * exhibition edit page (QA 2026-07-28 report: "AI 소개문 초안작성 클릭
 * 시 client-side exception"). Coerce here so the panel always sees a
 * clean `string[]`; downstream error boundary is the last line of
 * defence for any other unexpected throw.
 */
function normalizeDrafts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const s = item.trim();
      if (s) out.push(s);
      continue;
    }
    if (item && typeof item === "object") {
      // Occasional model outputs wrap drafts as `{ body: "..." }` or
      // `{ text: "..." }`. Accept both to spare the operator a
      // regenerate cycle.
      const maybeBody = (item as { body?: unknown }).body;
      const maybeText = (item as { text?: unknown }).text;
      if (typeof maybeBody === "string" && maybeBody.trim()) {
        out.push(maybeBody.trim());
        continue;
      }
      if (typeof maybeText === "string" && maybeText.trim()) {
        out.push(maybeText.trim());
      }
    }
  }
  return out;
}

function ExhibitionDraftAssistInner({
  title,
  startDate,
  endDate,
  venueLabel,
  curatorLabel,
  hostLabel,
  works,
  onApplyTitle,
  onApplyDescription,
  currentDescription,
}: Props) {
  const { t, locale } = useT();
  const [activeKind, setActiveKind] = useState<Kind | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExhibitionDraftResult | null>(null);

  // Memoise so the trigger callback's identity is stable when the parent
  // passes a fresh literal `[]` on every render (e.g.
  // NewExhibitionFormShell always renders `works={[]}`). This also
  // silences the react-hooks/exhaustive-deps warning that would fire on
  // an unmemoised conditional inside the deps list.
  const safeWorks = useMemo(() => (Array.isArray(works) ? works : []), [works]);
  const hasFewWorks = safeWorks.length === 0;

  const trigger = useCallback(
    async (kind: Kind) => {
      setActiveKind(kind);
      setLoading(true);
      setResult(null);
      try {
        const res = await aiApi.exhibitionDraft({
          exhibition: {
            kind,
            title,
            startDate: startDate ?? null,
            endDate: endDate ?? null,
            venueLabel: venueLabel ?? null,
            curatorLabel: curatorLabel ?? null,
            hostLabel: hostLabel ?? null,
            locale,
            works: safeWorks,
          },
        });
        // QA 2026-07-28 — defensive shape check. `aiApi` never rejects
        // (it returns a degraded fallback), but we still normalise the
        // drafts array so a malformed model response can't crash the
        // renderer.
        const cleaned: ExhibitionDraftResult = {
          ...res,
          kind: res?.kind ?? kind,
          drafts: normalizeDrafts(res?.drafts),
        };
        setResult(cleaned);
      } catch (err) {
        // aiApi is designed not to throw, but never trust the wire.
        // Wrap in a synthetic degraded result so AiDraftPanel renders
        // the amber "잠시 후 다시 시도" line instead of a white screen.
        if (typeof console !== "undefined") {
          console.error("[ExhibitionDraftAssist] trigger failed", err);
        }
        setResult({
          kind,
          drafts: [],
          degraded: true,
          reason: "error",
        });
      } finally {
        setLoading(false);
      }
    },
    [
      title,
      startDate,
      endDate,
      venueLabel,
      curatorLabel,
      hostLabel,
      locale,
      safeWorks,
    ],
  );

  const drafts = result?.drafts ?? [];
  const isTitleKind = result?.kind === "title";
  const isDescriptionKind = result?.kind === "description";
  const canApplyDescription = isDescriptionKind && typeof onApplyDescription === "function";

  const applyMode: "auto" | "link" = isTitleKind || canApplyDescription ? "auto" : "link";
  const applyLabelKey = isTitleKind
    ? "ai.exhibition.applyTitle"
    : canApplyDescription
      ? "ai.exhibition.applyDescription"
      : undefined;
  const currentValue = isTitleKind
    ? title
    : canApplyDescription
      ? currentDescription ?? ""
      : "";

  const onApply = isTitleKind && onApplyTitle
    ? (text: string) => {
        onApplyTitle(text);
        markAiAccepted(result?.aiEventId, {
          feature: "exhibition_draft",
          via: "apply",
        });
      }
    : canApplyDescription
      ? (text: string) => {
          onApplyDescription!(text);
          markAiAccepted(result?.aiEventId, {
            feature: "exhibition_draft",
            via: "apply",
          });
        }
      : undefined;

  return (
    <SectionFrame tone="muted" padding="md" noMargin>
      <SectionTitle eyebrow={t("ai.exhibition.title")} size="sm">
        {t("ai.exhibition.subtitle")}
      </SectionTitle>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(KIND_LABEL_KEY) as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => void trigger(k)}
            disabled={loading}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              activeKind === k
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-500"
            } disabled:opacity-60`}
            title={t("ai.disclosure.tooltip")}
          >
            {t(KIND_LABEL_KEY[k])}
          </button>
        ))}
      </div>

      {hasFewWorks && !result && (
        <p className="mt-2 text-[11px] text-zinc-500">
          {t("ai.exhibition.emptyWorksHint")}
        </p>
      )}

      {result && !isTitleKind && !result.degraded && drafts.length > 0 && !canApplyDescription && (
        <p className="mt-2 text-[11px] text-zinc-500">
          {t("ai.exhibition.previewOnly")}
        </p>
      )}

      {(loading || result) && (
        <div className="mt-3">
          <AiDraftPanel
            loading={loading}
            degraded={result ?? undefined}
            drafts={drafts}
            currentValue={currentValue}
            applyMode={applyMode}
            onApply={onApply}
            onCopy={(text) => {
              copyToClipboard(text);
              markAiAccepted(result?.aiEventId, {
                feature: "exhibition_draft",
                via: "copy",
              });
            }}
            onDismiss={() => setResult(null)}
            applyLabelKey={applyLabelKey}
            copyLabelKey="ai.exhibition.copy"
          />
        </div>
      )}
    </SectionFrame>
  );
}

/**
 * Public component wraps the inner assist in an ErrorBoundary so any
 * future crash (malformed AI response, third-party lib blow-up, etc.)
 * degrades to a small retry card instead of white-screening the whole
 * exhibition-edit surface.
 */
export function ExhibitionDraftAssist(props: Props) {
  const { t } = useT();
  return (
    <ErrorBoundary
      retryLabel={t("ai.exhibition.retryAssist")}
      message={t("ai.exhibition.assistCrashed")}
    >
      <ExhibitionDraftAssistInner {...props} />
    </ErrorBoundary>
  );
}
