"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { EntitlementDecision } from "@/lib/entitlements";
import { recordUsageEvent } from "@/lib/metering/recordUsageEvent";
import { logBetaEventSync } from "@/lib/beta/logEvent";
import { useT } from "@/lib/i18n/useT";

type Props = {
  decision: EntitlementDecision | null;
  /** Short explanation of what unlocking gets the user. Keep <= 80 chars. */
  headline?: string;
  /** When true, renders even in beta_granted mode (devtool use only). */
  showInBeta?: boolean;
  onUpgradeClick?: () => void;
  className?: string;
};

/**
 * Compact paywall hint. During closed beta it is suppressed by default so
 * users don't see teaser copy for features that are already unlocked; set
 * `showInBeta` on diagnostic pages to inspect what the post-beta UI will
 * look like. The button opens plan and billing. It does not lock a feature
 * while beta is on, because the hint stays hidden.
 */
export function UpgradeHint({ decision, headline, showInBeta = false, onUpgradeClick, className = "" }: Props) {
  const { t } = useT();
  const router = useRouter();
  const shownFor = useRef<string | null>(null);

  useEffect(() => {
    if (!decision) return;
    if (decision.uiState === "beta_granted" && !showInBeta) return;
    if (!decision.paywallHint && decision.uiState !== "soft_locked" && decision.uiState !== "blocked") return;
    const fp = `${decision.featureKey}:${decision.uiState}`;
    if (shownFor.current === fp) return;
    shownFor.current = fp;
    void recordUsageEvent(
      {
        key: "feature.upgrade_hint_shown",
        featureKey: decision.featureKey,
        metadata: { uiState: decision.uiState, paywallHint: decision.paywallHint ?? null },
      },
      { dualWriteBeta: false }
    );
    logBetaEventSync("monetization_hint_shown", {
      feature_key: decision.featureKey,
      paywall_hint: decision.paywallHint ?? null,
      ui_state: decision.uiState,
    });
  }, [decision, showInBeta]);

  if (!decision) return null;
  if (decision.uiState === "beta_granted" && !showInBeta) return null;
  if (decision.uiState === "available") return null;

  const hint = decision.paywallHint;
  const line = headline ?? (hint ? t(`billing.plan.${hint}.blurb`) : t("billing.lead"));
  const cta = t("billing.open");

  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5 text-[13px] text-amber-900 sm:flex-row sm:items-center sm:justify-between ${className}`.trim()}
      role="note"
    >
      <div className="min-w-0">
        <p className="font-medium">{line}</p>
        {decision.quota && decision.quota.limit !== Number.POSITIVE_INFINITY && (
          <p className="mt-0.5 text-xs text-amber-800/80">
            {decision.quota.used} / {decision.quota.limit} used
            {decision.quota.windowDays > 0 ? ` · last ${decision.quota.windowDays}d` : ""}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          void recordUsageEvent(
            {
              key: "feature.upgrade_hint_clicked",
              featureKey: decision.featureKey,
              metadata: { paywallHint: decision.paywallHint ?? null },
            },
            { dualWriteBeta: false }
          );
          logBetaEventSync("monetization_hint_clicked", {
            feature_key: decision.featureKey,
            paywall_hint: decision.paywallHint ?? null,
          });
          onUpgradeClick?.();
          router.push("/settings/billing");
        }}
        className="shrink-0 rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-medium text-amber-50 hover:bg-amber-950"
      >
        {cta}
      </button>
    </div>
  );
}
