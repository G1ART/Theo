"use client";

import { useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/useT";
import { aiApi } from "@/lib/ai/browser";
import { sanitizeActionHref } from "@/lib/ai/sanitizeActionHref";
import {
  AiSurfaceFrame,
  AiStateBlock,
  AiResultSection,
  AiCopyButton,
  AiDisclosureNote,
} from "@/components/ai/primitives";
import { AiFeedbackChips } from "@/components/beta";
import type { DelegationBriefResult } from "@/lib/ai/types";

type Props = {
  /** Effective profile id the operator is acting as. */
  actingAsProfileId: string;
  /** Optional display name for header copy. */
  principalName?: string | null;
};

/**
 * P1-C — Delegation Brief panel.
 *
 * Renders only when the operator is acting as another profile. Shows
 * 2–4 prioritised actions, watch items, and an optional draft note the
 * operator can copy and send to the principal. Nothing is auto-sent.
 *
 * UX system alignment: shares `AiSurfaceFrame`/`AiStateBlock`/`AiCopyButton`
 * with Board Pitch Pack and Exhibition Review.
 */
export function DelegationBriefPanel({
  actingAsProfileId,
  principalName,
}: Props) {
  const { t, locale } = useT();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DelegationBriefResult | null>(null);

  const trigger = async () => {
    setLoading(true);
    const res = await aiApi.delegationBrief({ actingAsProfileId, locale });
    setResult(res);
    setLoading(false);
  };

  const aiEventId = result?.aiEventId ?? null;
  const priorities = (result?.priorities ?? []).filter(
    (p) => p && typeof p.title === "string" && p.title.trim().length > 0,
  );
  const watchItems = (result?.watchItems ?? []).filter(
    (w) => typeof w === "string" && w.trim().length > 0,
  );
  const draftMessage =
    typeof result?.draftMessage === "string" &&
    result.draftMessage.trim().length > 0
      ? result.draftMessage
      : null;

  const titleText = principalName
    ? t("delegation.brief.title").replace("{name}", principalName)
    : t("delegation.brief.titleNoName");

  // Soft "calm state" — the AI ran clean but found nothing pressing.
  // We only render this when no error and no priorities/watch items.
  const isCalm =
    !!result &&
    !result.degraded &&
    priorities.length === 0 &&
    watchItems.length === 0;

  return (
    <AiSurfaceFrame
      title={titleText}
      subtitle={t("delegation.brief.hint")}
      className="mb-4"
    >
      {() => (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={trigger}
              disabled={loading}
              className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {loading
                ? t("ai.common.loading")
                : priorities.length > 0
                  ? t("ai.common.regenerate")
                  : t("delegation.brief.cta")}
            </button>
            <AiDisclosureNote />
          </div>

          <AiStateBlock loading={loading} result={result} />

          {isCalm && (
            <div className="rounded border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
              <p className="font-medium text-zinc-900">
                {t("delegation.brief.calmTitle")}
              </p>
              <p className="mt-1 text-xs text-zinc-600">
                {t("delegation.brief.calmDetail")}
              </p>
            </div>
          )}

          {priorities.length > 0 && (
            <AiResultSection title={t("delegation.brief.prioritiesLabel")}>
              <ul className="space-y-2">
                {priorities.slice(0, 4).map((p) => {
                  const href = sanitizeActionHref(p.href);
                  return (
                    <li
                      key={p.id}
                      className="rounded border border-zinc-200 bg-white p-3 text-sm leading-relaxed text-zinc-800"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{p.title}</p>
                          {p.reason && (
                            <p className="mt-0.5 text-xs text-zinc-600">
                              {p.reason}
                            </p>
                          )}
                        </div>
                        {href && (
                          <Link
                            href={href}
                            className="shrink-0 rounded border border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-100"
                          >
                            {t("delegation.brief.open")}
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </AiResultSection>
          )}

          {watchItems.length > 0 && (
            <AiResultSection
              title={t("delegation.brief.watchLabel")}
              tone="warn"
            >
              <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
                <ul className="list-disc space-y-0.5 pl-5 text-amber-900">
                  {watchItems.slice(0, 5).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            </AiResultSection>
          )}

          {draftMessage && (
            <AiResultSection title={t("delegation.brief.draftMessageLabel")}>
              <div className="rounded border border-zinc-200 bg-white p-3 text-sm leading-relaxed text-zinc-800">
                <p className="whitespace-pre-line">{draftMessage}</p>
                <div className="mt-2 flex justify-end">
                  <AiCopyButton
                    text={draftMessage}
                    feature="delegation_brief"
                    aiEventId={aiEventId}
                    meta={{ kind: "draft_message" }}
                  />
                </div>
              </div>
            </AiResultSection>
          )}

          {result && (
            <AiFeedbackChips
              pageKey="ai.delegation_brief"
              contextType="delegation"
              contextId={actingAsProfileId}
              aiEventId={aiEventId}
            />
          )}
        </>
      )}
    </AiSurfaceFrame>
  );
}
