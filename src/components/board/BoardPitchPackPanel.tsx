"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/messages";
import { aiApi } from "@/lib/ai/browser";
import {
  AiSurfaceFrame,
  AiStateBlock,
  AiResultSection,
  AiCopyButton,
  AiStatusChip,
  AiDisclosureNote,
} from "@/components/ai/primitives";
import { AiFeedbackChips } from "@/components/beta";
import type {
  BoardPitchPackDraft,
  BoardPitchPackDraftKind,
  BoardPitchPackResult,
} from "@/lib/ai/types";

type Props = {
  boardId: string;
  /**
   * Total items currently saved in the board (artworks + exhibitions).
   * Drives the helper-state gating per
   * `Abstract_P1_AI_Workflow_Surface_Integration_2026-04-27.md` §4.3:
   *   - 0 items: no CTA, helper line only.
   *   - 1 item:  CTA + soft hint that drafts are richer with 2+ items.
   *   - 2+:      normal flow.
   */
  itemCount?: number;
};

const KIND_LABEL: Record<BoardPitchPackDraftKind, MessageKey> = {
  summary: "boards.pitchPack.kind.summary",
  outreach: "boards.pitchPack.kind.outreach",
  wall_text: "boards.pitchPack.kind.wall_text",
};

/**
 * P1-A — Board Pitch Pack panel.
 *
 * Calm collapsed CTA on the board detail page; only fires the model on
 * explicit click. Outputs are copy-only — Theo never pastes anything
 * back into the board, never sends outreach. The panel never displays
 * price/collection info; the API also never sends it.
 *
 * UX system alignment (`Abstract_AI_Layer_UX_Design_Unification_2026-04-27.md`):
 * - Wraps in `AiSurfaceFrame` for consistent collapsible chrome.
 * - Uses `AiStateBlock` for loading/error so all three new panels share
 *   the same offline copy.
 * - Uses `AiCopyButton` so adoption telemetry is wired identically across
 *   surfaces.
 */
export function BoardPitchPackPanel({ boardId, itemCount }: Props) {
  const { t, locale } = useT();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BoardPitchPackResult | null>(null);

  const trigger = async () => {
    setLoading(true);
    const res = await aiApi.boardPitchPack({ boardId, locale });
    setResult(res);
    setLoading(false);
  };

  const aiEventId = result?.aiEventId ?? null;
  const drafts: BoardPitchPackDraft[] = (result?.drafts ?? []).filter(
    (d) => d && typeof d.body === "string" && d.body.trim().length > 0,
  );
  const perWork = (result?.perWork ?? []).filter(
    (p) => p && typeof p.line === "string" && p.line.trim().length > 0,
  );
  const missingInfo = (result?.missingInfo ?? []).filter(
    (m) => typeof m === "string" && m.trim().length > 0,
  );

  return (
    <AiSurfaceFrame
      title={t("boards.pitchPack.title")}
      subtitle={t("boards.pitchPack.hint")}
      className="mb-6"
    >
      {() => (
        <>
          {typeof itemCount === "number" && itemCount === 0 ? (
            <p className="rounded border border-dashed border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-600">
              {t("boards.pitchPack.emptyHelper")}
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={trigger}
                disabled={loading}
                className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {loading
                  ? t("ai.common.loading")
                  : drafts.length > 0
                    ? t("ai.common.regenerate")
                    : t("boards.pitchPack.cta")}
              </button>
              <AiDisclosureNote />
            </div>
          )}

          {typeof itemCount === "number" && itemCount === 1 && (
            <p className="text-[11px] text-zinc-500">
              {t("boards.pitchPack.singleItemHint")}
            </p>
          )}

          <AiStateBlock loading={loading} result={result} />

          {(result?.summary || result?.throughline) && (
            <div className="rounded border border-zinc-200 bg-white p-3 text-sm">
              {result?.summary && (
                <div className="mb-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    {t("boards.pitchPack.summaryLabel")}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-zinc-800">
                    {result.summary}
                  </p>
                </div>
              )}
              {result?.throughline && (
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    {t("boards.pitchPack.throughlineLabel")}
                  </p>
                  <p className="mt-1 text-zinc-800">{result.throughline}</p>
                </div>
              )}
            </div>
          )}

          {missingInfo.length > 0 && (
            <AiResultSection
              title={t("boards.pitchPack.missingInfoLabel")}
              tone="warn"
            >
              <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
                <ul className="list-disc space-y-0.5 pl-5 text-amber-900">
                  {missingInfo.slice(0, 5).map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            </AiResultSection>
          )}

          {drafts.length > 0 && (
            <AiResultSection title={t("boards.pitchPack.draftsLabel")}>
              <ul className="space-y-2">
                {drafts.slice(0, 3).map((draft, idx) => {
                  const labelKey = KIND_LABEL[draft.kind] ?? "boards.pitchPack.kind.summary";
                  return (
                    <li
                      key={`draft-${idx}`}
                      className="rounded border border-zinc-200 bg-white p-3 text-sm leading-relaxed text-zinc-800"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <AiStatusChip label={t(labelKey)} tone="draft" />
                        <AiCopyButton
                          text={draft.body}
                          feature="board_pitch_pack"
                          aiEventId={aiEventId}
                          meta={{ kind: draft.kind }}
                        />
                      </div>
                      <p className="whitespace-pre-line">{draft.body}</p>
                    </li>
                  );
                })}
              </ul>
            </AiResultSection>
          )}

          {perWork.length > 0 && (
            <AiResultSection
              title={t("boards.pitchPack.perWorkLabel")}
              collapsible
              defaultOpen={perWork.length <= 4}
            >
              <ul className="space-y-1 text-sm text-zinc-800">
                {perWork.slice(0, 6).map((p, i) => (
                  <li
                    key={`pw-${i}`}
                    className="flex items-start justify-between gap-2 rounded border border-zinc-200 bg-white px-3 py-2"
                  >
                    <span className="flex-1">{p.line}</span>
                    <AiCopyButton
                      text={p.line}
                      feature="board_pitch_pack"
                      aiEventId={aiEventId}
                      meta={{ kind: "per_work" }}
                    />
                  </li>
                ))}
              </ul>
            </AiResultSection>
          )}

          {result && (
            <AiFeedbackChips
              pageKey="ai.board_pitch_pack"
              contextType="shortlist"
              contextId={boardId}
              aiEventId={aiEventId}
            />
          )}
        </>
      )}
    </AiSurfaceFrame>
  );
}
