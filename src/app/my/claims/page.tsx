"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useActingAs } from "@/context/ActingAsContext";
import { useT } from "@/lib/i18n/useT";
import {
  listMyPendingClaims,
  confirmClaim,
  rejectClaim,
  claimTypeToLabel,
  type PendingClaimRow,
} from "@/lib/provenance/rpc";
import type { ClaimType } from "@/lib/provenance/types";
import { logSupabaseError } from "@/lib/supabase/errors";
import { formatSupabaseError } from "@/lib/errors/supabase";
import { formatDisplayName, formatUsername } from "@/lib/identity/format";
import { setArtworkBack } from "@/lib/artworkBack";

export default function MyClaimsPage() {
  const { t } = useT();
  const { actingAsProfileId } = useActingAs();
  const [list, setList] = useState<PendingClaimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [periodByClaimId, setPeriodByClaimId] = useState<Record<string, "past" | "current" | "future">>({});

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: listError } = await listMyPendingClaims(actingAsProfileId ?? undefined);
    setLoading(false);
    if (listError) {
      setError(formatSupabaseError(listError, t, "common.errorLoad"));
      return;
    }
    setList(data ?? []);
  }, [actingAsProfileId]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  async function handleConfirm(row: PendingClaimRow) {
    setActingId(row.id);
    setError(null);
    const period = row.claim_type === "OWNS" ? undefined : (periodByClaimId[row.id] ?? "current");
    const payload: { period_status?: "past" | "current" | "future" } = {};
    if (period) payload.period_status = period;
    const { error: err } = await confirmClaim(row.id, payload);
    setActingId(null);
    if (err) {
      logSupabaseError("confirmClaim", err);
      setError(formatSupabaseError(err, t, "my.claims.approveFailed"));
      return;
    }
    await fetchList();
  }

  async function handleReject(claimId: string) {
    setActingId(claimId);
    setError(null);
    const { error: err } = await rejectClaim(claimId);
    setActingId(null);
    if (err) {
      logSupabaseError("rejectClaim", err);
      setError(formatSupabaseError(err, t, "my.claims.rejectFailed"));
      return;
    }
    await fetchList();
  }

  return (
    <AuthGate>
      <main className="mx-auto max-w-2xl px-4 py-8">
        <Link href="/my" className="mb-6 inline-block text-sm text-zinc-600 hover:text-zinc-900">
          ← {t("profile.privateBackToMy")}
        </Link>
        <h1 className="mb-2 text-xl font-semibold text-zinc-900">{t("my.kpi.claimRequests")}</h1>
        <p className="mb-6 text-sm text-zinc-500">{t("claims.intro")}</p>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        {loading ? (
          <p className="text-zinc-500">{t("common.loading")}</p>
        ) : list.length === 0 ? (
          <p className="text-zinc-600">{t("my.claimsEmpty")}</p>
        ) : (
          <ul className="space-y-4">
            {list.map((row) => {
              const claimant = row.profiles ?? null;
              const claimantName = formatDisplayName(claimant);
              const claimantHandle = formatUsername(claimant);
              return (
              <li key={row.id} className="rounded-lg border border-zinc-200 bg-white p-4">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-900">
                    {t("claims.statusPending")}
                  </span>
                  <span className="font-medium text-zinc-900">
                    {claimTypeToLabel(row.claim_type as ClaimType)}
                  </span>
                </div>
                <p className="mb-2 text-sm text-zinc-600">
                  {t("claims.requestedBy")}{" "}
                  <span className="font-medium text-zinc-800">{claimantName}</span>
                  {claimantHandle && <span className="ml-1 text-zinc-500">{claimantHandle}</span>}
                </p>
                {row.work_id && (
                  <Link
                    href={`/artwork/${row.work_id}`}
                    onClick={() => setArtworkBack()}
                    className="mb-3 block text-sm text-zinc-600 underline hover:text-zinc-900"
                  >
                    {t("artwork.viewArtwork")} →
                  </Link>
                )}
                {(row.claim_type === "CURATED" || row.claim_type === "EXHIBITED") && (
                  <div className="mb-3">
                    <label className="mr-2 text-xs text-zinc-500">{t("artwork.periodLabel")}:</label>
                    <select
                      value={periodByClaimId[row.id] ?? "current"}
                      onChange={(e) =>
                        setPeriodByClaimId((prev) => ({
                          ...prev,
                          [row.id]: e.target.value as "past" | "current" | "future",
                        }))
                      }
                      className="rounded border border-zinc-300 px-2 py-1 text-sm"
                    >
                      <option value="past">{t("artwork.periodPast")}</option>
                      <option value="current">{t("artwork.periodCurrent")}</option>
                      <option value="future">{t("artwork.periodFuture")}</option>
                    </select>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleConfirm(row)}
                    disabled={actingId === row.id}
                    className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {actingId === row.id ? "..." : t("my.approveClaim")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReject(row.id)}
                    disabled={actingId === row.id}
                    className="rounded border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    {t("my.rejectClaim")}
                  </button>
                </div>
                <p className="mt-3 text-[11px] text-zinc-500">{t("claims.trustNote")}</p>
              </li>
            );
            })}
          </ul>
        )}
      </main>
    </AuthGate>
  );
}
