"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { getMyProfile } from "@/lib/supabase/me";
import { updateMyProfileBase } from "@/lib/supabase/profiles";

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
  /**
   * QA 2026-07-28 (Track D) — orphan claim 성공 직후, 큐레이터가 등록한
   * KO/EN 이름 쌍이 내 프로필에 아직 반영되어 있지 않다면 confirm 모달을
   * 띄운다. 자동 저장은 하지 않고 (설계 결정: 이름은 사람이 판단), 기본
   * 포커스는 "이대로 사용" 버튼에 두어 one-tap 으로 반영 가능.
   */
  const [inheritModal, setInheritModal] = useState<{
    externalKo: string | null;
    externalEn: string | null;
    profileKo: string | null;
    profileEn: string | null;
  } | null>(null);
  const [inheritSaving, setInheritSaving] = useState(false);
  const inheritConfirmRef = useRef<HTMLButtonElement | null>(null);

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
    const externalKo = pending.display_name_ko?.trim() || null;
    const externalEn = pending.display_name_en?.trim() || null;
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

    /*
     * QA 2026-07-28 (Track D) — bilingual inheritance offer.
     *
     * The signup trigger (240005 SECTION 5) only fires when the user
     * *first* creates their profile row. Claim-as-self is a runtime
     * merge for existing profiles, so the trigger doesn't cover it —
     * we offer the inheritance interactively instead. The RPC never
     * touches the profile row (its guards keep it read-mostly), so we
     * fetch the profile fresh here and diff against the external row.
     *
     * Only show the modal when the external record adds information —
     * i.e. the external row has a KO/EN slot the profile is missing.
     * If profile already has both slots filled we skip silently; the
     * curator's version is not authoritative once the artist has
     * curated their own name.
     */
    try {
      if (!externalKo && !externalEn) return;
      const { data: profile } = await getMyProfile();
      if (!profile) return;
      const profileKo = ((profile as { display_name_ko?: string | null })
        .display_name_ko ?? "").trim() || null;
      const profileEn = ((profile as { display_name_en?: string | null })
        .display_name_en ?? "").trim() || null;

      const wouldAddKo = !!externalKo && !profileKo;
      const wouldAddEn = !!externalEn && !profileEn;
      if (!wouldAddKo && !wouldAddEn) return;

      setInheritModal({
        externalKo,
        externalEn,
        profileKo,
        profileEn,
      });
    } catch {
      // Silent — inheritance is a nice-to-have; a network hiccup here
      // must not surface as a scary error after a successful claim.
    }
  }

  async function handleInheritAccept() {
    if (!inheritModal) return;
    setInheritSaving(true);
    try {
      const patch: {
        display_name_ko?: string | null;
        display_name_en?: string | null;
      } = {};
      if (inheritModal.externalKo && !inheritModal.profileKo) {
        patch.display_name_ko = inheritModal.externalKo;
      }
      if (inheritModal.externalEn && !inheritModal.profileEn) {
        patch.display_name_en = inheritModal.externalEn;
      }
      if (Object.keys(patch).length > 0) {
        const { error: upErr } = await updateMyProfileBase(patch);
        if (upErr) {
          logSupabaseError("orphan.inherit.updateMyProfileBase", upErr);
          setError(formatSupabaseError(upErr, t, "common.errorUpdate"));
        } else {
          setNotice(t("bilingual.inheritConfirmSaved"));
        }
      }
    } finally {
      setInheritSaving(false);
      setInheritModal(null);
    }
  }

  useEffect(() => {
    if (inheritModal) {
      // Pre-focus 이대로 사용 button so keyboard/screen-reader users can
      // adopt with a single Enter press. Slight delay so the dialog is
      // mounted before we focus.
      const timer = window.setTimeout(() => {
        inheritConfirmRef.current?.focus();
      }, 50);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [inheritModal]);

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

        {/*
          QA 2026-07-28 (Track D) — bilingual inheritance dialog. Rendered
          as a small in-page card rather than a full ConfirmActionDialog
          because we want to show BOTH names (KO + EN) side by side in a
          two-column layout that reads naturally in either UI locale, not
          fit into the dialog component's single description string. The
          "이대로 사용" button is programmatically focused on open so
          keyboard / screen-reader users adopt with one Enter press.
        */}
        {inheritModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="orphan-inherit-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          >
            <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl">
              <h2
                id="orphan-inherit-title"
                className="text-base font-semibold text-zinc-900"
              >
                {t("bilingual.inheritConfirmTitle")}
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                {t("bilingual.inheritConfirmBody")}
              </p>
              <dl className="mt-4 grid grid-cols-1 gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    KO
                  </dt>
                  <dd className="mt-0.5 truncate text-zinc-900">
                    {inheritModal.externalKo || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    EN
                  </dt>
                  <dd className="mt-0.5 truncate text-zinc-900">
                    {inheritModal.externalEn || "—"}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Link
                  href="/settings#displayName"
                  onClick={() => setInheritModal(null)}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:border-zinc-500"
                >
                  {t("bilingual.inheritConfirmEdit")}
                </Link>
                <button
                  ref={inheritConfirmRef}
                  type="button"
                  onClick={() => void handleInheritAccept()}
                  disabled={inheritSaving}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                >
                  {inheritSaving
                    ? t("common.loading")
                    : t("bilingual.inheritConfirmUse")}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </AuthGate>
  );
}
