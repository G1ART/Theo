"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  type ViewerRelationshipContext,
  type VisibilityResolution,
  type VisibilitySubjectType,
} from "@/lib/visibility/types";
import { getVisibilityGateCopy } from "@/lib/visibility/copy";
import {
  resolveGateCta,
  shouldShowSecondaryInquiryCta,
  type GateCtaResult,
} from "@/lib/visibility/cta";
import { useT } from "@/lib/i18n/useT";
import { logBetaEventSync } from "@/lib/beta/logEvent";
import { FollowButton } from "@/components/FollowButton";
import { AccessRequestModal } from "./AccessRequestModal";

type Props = {
  ownerProfileId: string;
  subjectType: VisibilitySubjectType;
  subjectId: string | null;
  fieldKey: string;
  /** Server-resolved judgement. Never compute audience client-side. */
  resolution: VisibilityResolution;
  viewerRelationship: ViewerRelationshipContext | null;
  ownerLabel?: string | null;
  children: ReactNode;
  /** Optional override for telemetry surface. */
  surface?: string;
  /** When the gated CTA is "inquiry", this is the click handler (e.g. open price-inquiry modal). */
  onAskAboutWork?: () => void;
  /**
   * Sprint 5.2 — fires after a `follow` CTA produces a real follow / follow
   * request (FollowButton's `onFollowed`) so the parent can re-fetch the
   * server-resolved visibility and the gate disappears the moment the
   * relationship changes. Without this, the page would stay gated until a
   * full reload even though the relationship-graph is now richer.
   */
  onAfterFollow?: () => void;
};

export function GatedField({
  ownerProfileId,
  subjectType,
  subjectId,
  fieldKey,
  resolution,
  viewerRelationship,
  ownerLabel,
  children,
  surface,
  onAskAboutWork,
  onAfterFollow,
}: Props) {
  const { t, locale } = useT();
  const [accessOpen, setAccessOpen] = useState(false);
  const seenRef = useRef<string | null>(null);

  const cta = resolveGateCta({
    resolution,
    fieldKey,
    viewerRelationship,
  });

  // Impression telemetry — fire once per (subject, field, audience) tuple.
  // For canView=true on a sensitive field we still want one impression
  // (artwork_sensitive_field_viewed) so analytics can count successful
  // disclosures. For canView=false we fire visibility_gate_seen.
  useEffect(() => {
    const baseKey = `${subjectType}:${subjectId ?? "*"}:${fieldKey}`;
    const stateKey = resolution.canView
      ? `${baseKey}:viewed`
      : `${baseKey}:gated:${resolution.requiredAudience}`;
    if (seenRef.current === stateKey) return;
    seenRef.current = stateKey;
    if (resolution.canView) {
      // Only emit the disclosure event for the first-class sensitive
      // fields. We deliberately avoid firing on '*' (subject-level) so
      // gallery-style listings don't spam the firehose.
      if (
        ["price", "availability", "description", "studio_note"].includes(fieldKey)
      ) {
        logBetaEventSync("artwork_sensitive_field_viewed", {
          subject_type: subjectType,
          subject_id: subjectId ?? undefined,
          field_key: fieldKey,
          audience: resolution.requiredAudience,
          surface,
        });
      }
    } else {
      logBetaEventSync("visibility_gate_seen", {
        subject_type: subjectType,
        subject_id: subjectId ?? undefined,
        field_key: fieldKey,
        audience: resolution.requiredAudience,
        surface,
      });
    }
  }, [
    resolution.canView,
    resolution.requiredAudience,
    subjectType,
    subjectId,
    fieldKey,
    surface,
  ]);

  if (resolution.canView) {
    return <>{children}</>;
  }

  const copy = getVisibilityGateCopy({
    fieldKey,
    requiredAudience: resolution.requiredAudience,
    ownerLabel,
    locale,
  });

  const handleClick = (kind: GateCtaResult["kind"]) => {
    logBetaEventSync("visibility_gate_cta_clicked", {
      subject_type: subjectType,
      subject_id: subjectId ?? undefined,
      field_key: fieldKey,
      audience: resolution.requiredAudience,
      request_type: kind === "inquiry" ? "price_inquiry" : kind,
      surface,
    });
    if (kind === "inquiry") {
      onAskAboutWork?.();
      logBetaEventSync("price_inquiry_from_gate", {
        subject_type: subjectType,
        subject_id: subjectId ?? undefined,
        field_key: fieldKey,
        surface,
      });
    } else if (kind === "access_request") {
      setAccessOpen(true);
    }
    // 'follow' CTA is rendered as a real <FollowButton>, not via this
    // handler (Sprint 5.2 — eliminates the inert no-op CTA). Telemetry
    // for the follow path lives on the click-capture wrapper below.
  };

  const showSecondaryInquiry = shouldShowSecondaryInquiryCta(cta, fieldKey);

  // Sprint 5.2 — fires the follow_request_from_visibility_gate event the
  // moment the user actually presses the FollowButton. We use a small
  // wrapper element with onMouseDownCapture so the telemetry lands even
  // when the FollowButton's own state update / network call swallows the
  // bubbling click.
  const handleFollowIntent = () => {
    logBetaEventSync("visibility_gate_cta_clicked", {
      subject_type: subjectType,
      subject_id: subjectId ?? undefined,
      field_key: fieldKey,
      audience: resolution.requiredAudience,
      request_type: "follow",
      surface,
    });
    logBetaEventSync("follow_request_from_visibility_gate", {
      subject_type: subjectType,
      subject_id: subjectId ?? undefined,
      field_key: fieldKey,
      audience: resolution.requiredAudience,
      surface,
    });
  };

  return (
    <div className="rounded-2xl bg-zinc-50/70 p-4">
      <p className="text-sm leading-relaxed text-zinc-700">{copy}</p>
      {cta.kind !== "none" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {cta.kind === "follow" && (
            // Real follow flow — never a no-op. Click-intent telemetry
            // fires once on press; `onFollowed` re-resolves visibility
            // so the gate disappears as soon as the relationship lands.
            <span onMouseDownCapture={handleFollowIntent}>
              <FollowButton
                targetProfileId={ownerProfileId}
                initialStatus={cta.followStatus ?? "none"}
                isPrivateTarget={
                  viewerRelationship?.target_is_public === false
                }
                size="sm"
                onFollowed={() => onAfterFollow?.()}
                surface="other"
              />
            </span>
          )}
          {cta.kind === "inquiry" && (
            <button
              type="button"
              onClick={() => handleClick("inquiry")}
              className="rounded-full bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
            >
              {t("visibility.gate.cta.askAboutWork")}
            </button>
          )}
          {cta.kind === "access_request" && (
            <button
              type="button"
              onClick={() => handleClick("access_request")}
              className="rounded-full bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
            >
              {t("visibility.gate.cta.requestAccess")}
            </button>
          )}
          {showSecondaryInquiry && (
            <button
              type="button"
              onClick={() => handleClick("inquiry")}
              className="rounded-full border border-zinc-300 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              {t("visibility.gate.cta.askAboutWork")}
            </button>
          )}
        </div>
      )}
      <AccessRequestModal
        open={accessOpen}
        onClose={() => setAccessOpen(false)}
        ownerProfileId={ownerProfileId}
        subjectType={subjectType}
        subjectId={subjectId}
        fieldKey={fieldKey}
        sourceSurface={surface ?? null}
      />
    </div>
  );
}
