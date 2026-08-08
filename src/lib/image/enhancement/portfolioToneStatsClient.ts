"use client";

/**
 * Theo Image Enhance (Beta) — client fetcher for the
 * `artist_portfolio_tone_stats` RPC (2026-08-07).
 *
 * N+1 contract (see release brief H):
 *   - This module MUST NEVER be called per-file inside a bulk loop.
 *     One call per artist per bulk session, memoized in React state
 *     keyed by artist id. If you find yourself calling this from
 *     inside a Promise.all over files, back up — you're violating the
 *     contract.
 *   - Skip the call entirely when `artistProfileId` is null (unknown
 *     attribution) or when the "Match artist portfolio" chip is off.
 *
 * The RPC returns a single row shape:
 *   { mean_luma, mean_chroma, mean_sat, mean_contrast, sample_count }
 *
 * When sample_count < 3, the caller is expected to skip the coherence
 * step entirely (chip hidden from the UI). This helper still returns
 * the row so the caller can render a "collecting more samples" chip.
 */

import { supabase } from "@/lib/supabase/client";
import type { ToneSignature } from "./coherence";

export type PortfolioToneStats = {
  signature: ToneSignature;
  sampleCount: number;
};

/**
 * Module-level dedupe cache. If two components mount at the same time
 * and both request stats for the same artist, they share ONE inflight
 * promise. Contract-critical for the "one call per artist per session"
 * rule (release brief §H). Cache survives for the tab lifetime; the
 * data is fresh enough for a bulk session and we don't want to re-hit
 * the RPC per new-file mount.
 */
const inflight = new Map<string, Promise<PortfolioToneStats | null>>();

/**
 * Fetch the artist portfolio tone statistics. Returns `null` on any
 * RPC error (network, RLS deny, missing function) so the caller can
 * silently skip the coherence step — coherence is a nudge, never
 * critical.
 */
export async function fetchArtistPortfolioToneStats(
  artistProfileId: string,
): Promise<PortfolioToneStats | null> {
  if (!artistProfileId) return null;
  const cached = inflight.get(artistProfileId);
  if (cached) return cached;
  const p = fetchImpl(artistProfileId);
  inflight.set(artistProfileId, p);
  return p;
}

/** Clear the module-level cache. Only used in tests / dev tooling. */
export function _resetPortfolioToneStatsCache(): void {
  inflight.clear();
}

async function fetchImpl(artistProfileId: string): Promise<PortfolioToneStats | null> {
  const { data, error } = await supabase.rpc("artist_portfolio_tone_stats", {
    p_artist_profile_id: artistProfileId,
  });
  if (error) return null;
  // Supabase returns a table function as an array of rows.
  const row = Array.isArray(data) ? data[0] : (data as Record<string, unknown> | null);
  if (!row) return null;
  const asNum = (v: unknown, fallback: number): number => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const parsed = Number(v);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  };
  return {
    signature: {
      meanLuma: asNum((row as Record<string, unknown>).mean_luma, 0),
      meanChroma: asNum((row as Record<string, unknown>).mean_chroma, 0),
      meanSat: asNum((row as Record<string, unknown>).mean_sat, 1),
      meanContrast: asNum((row as Record<string, unknown>).mean_contrast, 1),
    },
    sampleCount: Math.max(
      0,
      Math.round(asNum((row as Record<string, unknown>).sample_count, 0)),
    ),
  };
}
