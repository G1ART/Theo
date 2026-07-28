"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { ConfirmActionDialog } from "@/components/ds/ConfirmActionDialog";
import { useT } from "@/lib/i18n/useT";
import {
  claimOrphanExternalArtistAsSelf,
  searchOrphanExternalArtistsForMe,
  type OrphanExternalArtistCandidate,
} from "@/lib/provenance/externalArtists";
import { formatSupabaseError } from "@/lib/errors/supabase";
import { logSupabaseError } from "@/lib/supabase/errors";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import { pickLocalizedDisplayName } from "@/lib/i18n/pickLocalized";

/**
 * QA 2026-07-28 Phase D — orphan external artist claim UI.
 *
 * Two audiences:
 *   1. A newly-onboarded artist who was previously invited (by name only,
 *      no email) — they surface here through the banner on `/my` and
 *      claim their catalog.
 *   2. An existing artist who wants to sweep for any dangling name-based
 *      invitations. They can widen the search with the free-text input.
 *
 * The RPC guards ownership so we don't need to double-check on the
 * client, but we do surface: inviter identity (public), work count, and
 * recent cover previews so the artist can confidently recognize their
 * own work before claiming.
 */
export default function MyOrphanInvitesPage() {
  const { t, locale } = useT();
  const [list, setList] = useState<OrphanExternalArtistCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<OrphanExternalArtistCandidate | null>(
    null
  );
  const [claiming, setClaiming] = useState(false);

  const fetchList = useCallback(
    async (q: string | null) => {
      setLoading(true);
      setError(null);
      const { data, error: err } = await searchOrphanExternalArtistsForMe(q);
      setLoading(false);
      if (err) {
        logSupabaseError("searchOrphanExternalArtistsForMe", err);
        setError(formatSupabaseError(err, t, "common.errorLoad"));
        return;
      }
      setList(data);
    },
    [t]
  );

  useEffect(() => {
    fetchList(null);
  }, [fetchList]);

  async function handleConfirmClaim() {
    if (!pending) return;
    setClaiming(true);
    setError(null);
    const { data, error: err } = await claimOrphanExternalArtistAsSelf(
      pending.id
    );
    setClaiming(false);
    if (err) {
      logSupabaseError("claimOrphanExternalArtistAsSelf", err);
      setError(formatSupabaseError(err, t, "orphanInvites.claimFailed"));
      setPending(null);
      return;
    }
    setPending(null);
    setNotice(
      t("orphanInvites.claimed")
        .replace("{count}", String(data?.works_moved ?? 0))
    );
    await fetchList(query.trim() || null);
  }

  return (
    <AuthGate>
      <main className="mx-auto max-w-2xl px-4 py-8">
        <Link
          href="/my"
          className="mb-6 inline-block text-sm text-zinc-600 hover:text-zinc-900"
        >
          ← {t("myArtists.back")}
        </Link>
        <h1 className="mb-2 text-xl font-semibold text-zinc-900">
          {t("orphanInvites.title")}
        </h1>
        <p className="mb-6 text-sm text-zinc-500">
          {t("orphanInvites.subtitle")}
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void fetchList(query.trim() || null);
          }}
          className="mb-6 flex flex-wrap gap-2"
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("orphanInvites.searchPlaceholder")}
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:border-zinc-500"
          >
            {t("orphanInvites.searchCta")}
          </button>
        </form>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        {notice && <p className="mb-4 text-sm text-emerald-700">{notice}</p>}

        {loading ? (
          <p className="text-zinc-500">{t("common.loading")}</p>
        ) : list.length === 0 ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
            {t("orphanInvites.empty")}
          </div>
        ) : (
          <ul className="space-y-3">
            {list.map((c) => {
              const displayed =
                pickLocalizedDisplayName(
                  {
                    display_name: c.display_name,
                    display_name_ko: c.display_name_ko,
                    display_name_en: c.display_name_en,
                  },
                  locale
                ) ||
                c.display_name ||
                "—";
              return (
                <li
                  key={c.id}
                  className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-zinc-900">
                        {displayed}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {c.inviter_display_name
                          ? t("orphanInvites.invitedBy").replace(
                              "{inviter}",
                              c.inviter_display_name
                            )
                          : t("orphanInvites.invitedByUnknown")}
                        <span className="mx-1.5 text-zinc-300">·</span>
                        {t("orphanInvites.worksCount").replace(
                          "{count}",
                          String(c.works_count)
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPending(c)}
                      className="shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-900 hover:bg-amber-100"
                    >
                      {t("orphanInvites.claimCta")}
                    </button>
                  </div>
                  {c.latest_cover_paths.length > 0 && (
                    <div className="mt-3 flex gap-2 overflow-hidden">
                      {c.latest_cover_paths.slice(0, 3).map((p) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={p}
                          src={getArtworkImageUrl(p, "thumb")}
                          alt=""
                          className="h-16 w-16 shrink-0 rounded-md object-cover"
                        />
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <ConfirmActionDialog
          open={!!pending}
          title={t("orphanInvites.confirmTitle")}
          description={
            pending
              ? t("orphanInvites.confirmBody")
                  .replace(
                    "{artist}",
                    pending.display_name ?? "—"
                  )
                  .replace(
                    "{inviter}",
                    pending.inviter_display_name ??
                      t("orphanInvites.invitedByUnknown")
                  )
                  .replace("{count}", String(pending.works_count))
              : undefined
          }
          confirmLabel={t("orphanInvites.confirmCta")}
          cancelLabel={t("common.cancel")}
          tone="neutral"
          busy={claiming}
          onConfirm={handleConfirmClaim}
          onCancel={() => (claiming ? null : setPending(null))}
        />
      </main>
    </AuthGate>
  );
}
