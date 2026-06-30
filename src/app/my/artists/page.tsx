"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { ConfirmActionDialog } from "@/components/ds/ConfirmActionDialog";
import { useActingAs } from "@/context/ActingAsContext";
import { useT } from "@/lib/i18n/useT";
import {
  listMyExternalArtists,
  linkExternalArtistToProfile,
  type MyExternalArtist,
} from "@/lib/provenance/externalArtists";
import { searchPeople, type PublicProfile } from "@/lib/supabase/artists";
import { logSupabaseError } from "@/lib/supabase/errors";
import { formatSupabaseError } from "@/lib/errors/supabase";
import { formatDisplayName, formatUsername } from "@/lib/identity/format";

export default function MyArtistsPage() {
  const { t } = useT();
  const { actingAsProfileId } = useActingAs();
  const [list, setList] = useState<MyExternalArtist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Per-row link UI state
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState<{ artist: MyExternalArtist; target: PublicProfile } | null>(null);
  const [linking, setLinking] = useState(false);
  const searchSeq = useRef(0);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: listError } = await listMyExternalArtists(actingAsProfileId ?? undefined);
    setLoading(false);
    if (listError) {
      logSupabaseError("listMyExternalArtists", listError);
      setError(formatSupabaseError(listError, t, "common.errorLoad"));
      return;
    }
    setList(data);
  }, [actingAsProfileId]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    const q = query.trim();
    if (openRowId === null || q.length < 2) {
      setResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const handle = setTimeout(async () => {
      const { data } = await searchPeople({ q, limit: 8 });
      if (seq !== searchSeq.current) return;
      setResults(data);
      setSearching(false);
    }, 250);
    return () => clearTimeout(handle);
  }, [query, openRowId]);

  function openLink(rowId: string) {
    setOpenRowId((prev) => (prev === rowId ? null : rowId));
    setQuery("");
    setResults([]);
    setNotice(null);
  }

  async function handleConfirmLink() {
    if (!pending) return;
    setLinking(true);
    setError(null);
    const { error: err } = await linkExternalArtistToProfile(pending.artist.id, pending.target.id);
    setLinking(false);
    if (err) {
      logSupabaseError("linkExternalArtistToProfile", err);
      setError(formatSupabaseError(err, t, "myArtists.linkFailed"));
      setPending(null);
      return;
    }
    setPending(null);
    setOpenRowId(null);
    setQuery("");
    setResults([]);
    setNotice(t("myArtists.linked"));
    await fetchList();
  }

  return (
    <AuthGate>
      <main className="mx-auto max-w-2xl px-4 py-8">
        <Link href="/my" className="mb-6 inline-block text-sm text-zinc-600 hover:text-zinc-900">
          ← {t("myArtists.back")}
        </Link>
        <h1 className="mb-2 text-xl font-semibold text-zinc-900">{t("myArtists.title")}</h1>
        <p className="mb-6 text-sm text-zinc-500">{t("myArtists.subtitle")}</p>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        {notice && <p className="mb-4 text-sm text-emerald-700">{notice}</p>}

        {loading ? (
          <p className="text-zinc-500">{t("common.loading")}</p>
        ) : list.length === 0 ? (
          <p className="text-zinc-600">{t("myArtists.empty")}</p>
        ) : (
          <ul className="space-y-3">
            {list.map((a) => (
              <li key={a.id} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-zinc-900">{a.display_name}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {t("myArtists.worksCount").replace("{count}", String(a.work_count))}
                      <span className="mx-1.5 text-zinc-300">·</span>
                      {a.has_email ? (
                        <span className="text-emerald-700">{t("myArtists.hasEmail")}</span>
                      ) : (
                        <span className="text-amber-700">{t("myArtists.noEmail")}</span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openLink(a.id)}
                    className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:border-zinc-500"
                  >
                    {t("myArtists.linkCta")}
                  </button>
                </div>

                {openRowId === a.id && (
                  <div className="mt-3 border-t border-zinc-100 pt-3">
                    <p className="mb-2 text-xs text-zinc-500">{t("myArtists.searchHint")}</p>
                    <input
                      type="text"
                      autoFocus
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t("myArtists.searchPlaceholder")}
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
                    />
                    <div className="mt-2">
                      {searching ? (
                        <p className="px-1 py-2 text-sm text-zinc-400">{t("common.loading")}</p>
                      ) : query.trim().length >= 2 && results.length === 0 ? (
                        <p className="px-1 py-2 text-sm text-zinc-500">{t("myArtists.noResults")}</p>
                      ) : (
                        <ul className="divide-y divide-zinc-100">
                          {results.map((p) => {
                            const name = formatDisplayName(p);
                            const handle = formatUsername(p);
                            return (
                              <li key={p.id}>
                                <button
                                  type="button"
                                  onClick={() => setPending({ artist: a, target: p })}
                                  className="flex w-full items-center gap-3 px-1 py-2 text-left hover:bg-zinc-50"
                                >
                                  <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-100 text-xs text-zinc-500">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    {p.avatar_url ? (
                                      <img src={p.avatar_url} alt="" className="h-full w-full object-cover" />
                                    ) : (
                                      (name?.[0] ?? "?").toUpperCase()
                                    )}
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block truncate text-sm font-medium text-zinc-900">{name}</span>
                                    {handle && <span className="block truncate text-xs text-zinc-500">{handle}</span>}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <ConfirmActionDialog
          open={!!pending}
          title={t("myArtists.confirmTitle")}
          description={
            pending
              ? t("myArtists.confirmBody")
                  .replace("{artist}", pending.artist.display_name)
                  .replace("{target}", formatDisplayName(pending.target) || "—")
                  .replace("{count}", String(pending.artist.work_count))
              : undefined
          }
          confirmLabel={t("myArtists.confirmCta")}
          cancelLabel={t("common.cancel")}
          tone="neutral"
          busy={linking}
          onConfirm={handleConfirmLink}
          onCancel={() => (linking ? null : setPending(null))}
        />
      </main>
    </AuthGate>
  );
}
