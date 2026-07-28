"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { searchOrphanExternalArtistsForMe } from "@/lib/provenance/externalArtists";

/**
 * QA 2026-07-28 Phase D banner.
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
 *   - Silently queries `search_orphan_external_artists_for_me` on mount
 *     (query defaults to the caller's own display_name).
 *   - Renders nothing if there are zero candidates (no visual noise for
 *     the vast majority of users).
 *   - Otherwise renders a compact, dismissible amber card that links to
 *     the full `/my/orphan-invites` claim UI.
 *
 * Privacy
 * -------
 *   - No email addresses are ever exposed — the underlying RPC is
 *     scoped to unclaimed rows with `invite_email IS NULL`, and the
 *     name-match gate on `claim_orphan_external_artist_as_self`
 *     prevents drive-by claims.
 */
export function OrphanInvitesBanner() {
  const { t } = useT();
  const [count, setCount] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await searchOrphanExternalArtistsForMe(null);
      if (cancelled || error) return;
      setCount(data.length);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed || count === null || count <= 0) return null;

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <span className="grow">
        {t("orphanInvites.banner.body").replace("{count}", String(count))}
      </span>
      <Link
        href="/my/orphan-invites"
        className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
      >
        {t("orphanInvites.banner.cta")}
      </Link>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t("orphanInvites.banner.dismiss")}
        className="rounded px-1 text-amber-800 hover:text-amber-950"
      >
        ×
      </button>
    </div>
  );
}
