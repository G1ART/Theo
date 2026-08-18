"use client";

/**
 * "이 보드를 공간에 걸어보기 / Hang this board in a space" CTA on
 * `/my/shortlists/[id]`.
 *
 * Behaviour:
 *   • Only rendered when the shortlist has ≥ 1 artwork item — we
 *     defer the strict `work_form='flat_2d'` filter to
 *     `createSpaceFromShortlist` (Chunk B lib), which copies every
 *     artwork's placement row. Non-flat artworks are silently skipped
 *     at render time by the renderer (`renderScene2D` gates on
 *     resolvable width/height), so the CTA works even if the shortlist
 *     mixes 2D and 3D works.
 *   • Gated by `simulation.2d` — when the caller is over their
 *     lifetime cap, we replace the button with a paywall card.
 *   • On confirm we call `createSpaceFromShortlist(shortlistId,
 *     { title })` and navigate to the editor for the fresh space.
 */

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import {
  createSpaceFromShortlist,
  SimulationEntitlementError,
} from "@/lib/supabase/spaces";
import { SimulationPaywallCard } from "./SimulationPaywallCard";

type Props = {
  shortlistId: string;
  shortlistTitle: string;
  hasFlatArtworks: boolean;
};

export function HangShortlistInSpaceCta({
  shortlistId,
  shortlistTitle,
  hasFlatArtworks,
}: Props) {
  const { t } = useT();
  const router = useRouter();
  const featureAccess = useFeatureAccess("simulation.2d");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);

  const overCap =
    featureAccess.decision != null && featureAccess.decision.allowed === false;

  const handleClick = useCallback(async () => {
    if (busy) return;
    if (overCap) {
      setShowPaywall(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await createSpaceFromShortlist(shortlistId, {
        title: shortlistTitle,
      });
      if (err || !data) {
        setBusy(false);
        setError(t("simulation.shortlist.failed"));
        return;
      }
      router.push(`/my/spaces/${data.id}`);
    } catch (err) {
      setBusy(false);
      if (err instanceof SimulationEntitlementError) {
        setShowPaywall(true);
      } else {
        setError(t("simulation.shortlist.failed"));
      }
    }
  }, [busy, overCap, shortlistId, shortlistTitle, router, t]);

  if (!hasFlatArtworks) return null;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleClick()}
          disabled={busy}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {busy
            ? t("simulation.shortlist.creating")
            : t("simulation.shortlist.cta")}
        </button>
        <p className="text-xs text-zinc-500">
          {t("simulation.shortlist.ctaHint")}
        </p>
      </div>
      {error && (
        <p className="mt-1 rounded-md bg-red-50 px-3 py-1 text-xs text-red-700">
          {error}
        </p>
      )}
      {(overCap || showPaywall) && (
        <div className="mt-3">
          <SimulationPaywallCard decision={featureAccess.decision} />
        </div>
      )}
    </div>
  );
}
