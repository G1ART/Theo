"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import {
  claimOrphanExternalArtistAsSelf,
  searchOrphanExternalArtistsForMe,
  type OrphanExternalArtistCandidate,
} from "@/lib/provenance/externalArtists";
import { ConfirmActionDialog } from "@/components/ds/ConfirmActionDialog";
import {
  DISMISSAL_KEYS,
  isDismissed,
  readDismissal,
  recordDismissal,
} from "@/lib/i18n/dismissals";
import { logSupabaseError } from "@/lib/supabase/errors";

/**
 * QA 2026-07-28 Phase D banner, extended QA 2026-07-29 (Part B).
 *
 * Design intent
 * -------------
 * When gallerists / curators upload works for a not-yet-onboarded artist
 * WITHOUT an email, the resulting `external_artists` row cannot be picked
 * up by the auth-signup trigger (which reconciles by email). Onboarded
 * artists therefore need a way to say "yes, that invitation is for me"
 * so their existing catalog surfaces under a single unified profile.
 *
 * This banner is the discovery surface. It:
 *   - Always queries `search_orphan_external_artists_for_me` on dashboard
 *     load (query defaults to the caller's own display_name — the RPC
 *     itself bails out with zero rows when that name is blank, so we
 *     don't need a separate "is display_name empty" guard here).
 *   - Renders nothing if there are zero candidates (no visual noise for
 *     the vast majority of users), or if the user already dismissed it
 *     within the snooze window.
 *   - When exactly one *exact*-confidence candidate is found, offers a
 *     1-click "Yes, this is mine" action (with a confirm dialog, since
 *     the underlying claim moves works and can't be auto-undone) instead
 *     of forcing a trip to the full review list.
 *   - Otherwise links to the full `/my/orphan-invites` claim UI.
 *
 * Dismissal
 * ---------
 *   - Persisted per-user via `user_ui_dismissals`
 *     (`orphan.invites.autoscan_v1`), snoozed for 30 days rather than
 *     dismissed forever — new orphan invitations can appear anytime.
 *
 * Privacy
 * -------
 *   - No email addresses are ever exposed — the underlying RPC is
 *     scoped to unclaimed rows with `invite_email IS NULL`, and the
 *     name-match gate on `claim_orphan_external_artist_as_self`
 *     prevents drive-by claims.
 */
const AUTOSCAN_SNOOZE_DAYS = 30;

export function OrphanInvitesBanner() {
  const { t } = useT();
  const [candidates, setCandidates] = useState<
    OrphanExternalArtistCandidate[] | null
  >(null);
  const [dbDismissed, setDbDismissed] = useState<boolean | null>(null);
  const [sessionDismissed, setSessionDismissed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimedNotice, setClaimedNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data, error }, dismissalRow] = await Promise.all([
        searchOrphanExternalArtistsForMe(null),
        readDismissal(DISMISSAL_KEYS.orphanInvitesAutoscan),
      ]);
      if (cancelled) return;
      setCandidates(error ? [] : data);
      setDbDismissed(isDismissed(dismissalRow));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDismiss = useCallback(() => {
    setSessionDismissed(true);
    void recordDismissal(DISMISSAL_KEYS.orphanInvitesAutoscan, {
      snoozeDays: AUTOSCAN_SNOOZE_DAYS,
    });
  }, []);

  // Only offer the 1-click shortcut when there's a single, exact-name
  // match — anything fuzzy or multi-candidate routes to the full review
  // page so the user can visually confirm before claiming.
  const topMatch =
    candidates && candidates.length === 1 && candidates[0].match_confidence === "exact"
      ? candidates[0]
      : null;

  const handleConfirmClaim = useCallback(async () => {
    if (!topMatch || claiming) return;
    setClaiming(true);
    const { data, error } = await claimOrphanExternalArtistAsSelf(topMatch.id);
    setClaiming(false);
    setConfirmOpen(false);
    if (error) {
      logSupabaseError("claimOrphanExternalArtistAsSelf(banner)", error);
      return;
    }
    setClaimedNotice(
      t("orphanInvites.claimed").replace("{count}", String(data?.works_moved ?? 0))
    );
    setCandidates([]);
  }, [topMatch, claiming, t]);

  if (claimedNotice) {
    return (
      <div
        role="status"
        className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
      >
        <span className="grow">{claimedNotice}</span>
      </div>
    );
  }

  if (
    sessionDismissed ||
    dbDismissed === null ||
    dbDismissed ||
    candidates === null ||
    candidates.length <= 0
  ) {
    return null;
  }

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <span className="grow">
        {t("orphanInvites.banner.body").replace("{count}", String(candidates.length))}
      </span>
      {topMatch ? (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="rounded-lg border border-amber-300 bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-950"
        >
          {t("orphanInvites.banner.thisIsMineCta")}
        </button>
      ) : null}
      <Link
        href="/my/orphan-invites"
        className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
      >
        {t("orphanInvites.banner.cta")}
      </Link>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={t("orphanInvites.banner.dismiss")}
        className="rounded px-1 text-amber-800 hover:text-amber-950"
      >
        ×
      </button>
      {topMatch ? (
        <ConfirmActionDialog
          open={confirmOpen}
          title={t("orphanInvites.confirmTitle")}
          description={t("orphanInvites.confirmBody")
            .replace("{artist}", topMatch.display_name ?? "")
            .replace(
              "{inviter}",
              topMatch.inviter_display_name ?? t("orphanInvites.invitedByUnknown")
            )
            .replace("{count}", String(topMatch.works_count))}
          confirmLabel={t("orphanInvites.confirmCta")}
          cancelLabel={t("common.cancel")}
          busy={claiming}
          onConfirm={() => void handleConfirmClaim()}
          onCancel={() => setConfirmOpen(false)}
        />
      ) : null}
    </div>
  );
}
