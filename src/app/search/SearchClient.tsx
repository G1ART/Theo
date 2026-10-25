"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageShell } from "@/components/ds/PageShell";
import { SearchArtworkCard } from "@/components/search/SearchArtworkCard";
import { formatIdentityPair, formatUsername } from "@/lib/identity/format";
import { useT } from "@/lib/i18n/useT";
import { describeArtworkQuery, parseArtworkQuery } from "@/lib/search/artworkQuery";
import { replayPendingListScroll } from "@/lib/list/scrollRestore";
import { prepareSearch, type SearchBundle } from "@/lib/search/searchBundle";
import { fetchPublicArtworkCardsByIds, getArtworkImageUrl, type ArtworkWithLikes } from "@/lib/supabase/artworks";
import type { PeopleRec } from "@/lib/supabase/peopleRecs";

const PAGE = 10;

export function SearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useT();
  const qFromUrl = searchParams.get("q") ?? "";
  const [bundle, setBundle] = useState<SearchBundle | null>(null);
  const [artworks, setArtworks] = useState<ArtworkWithLikes[]>([]);
  const [worksShown, setWorksShown] = useState(PAGE);
  const [peopleShown, setPeopleShown] = useState(PAGE);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useLayoutEffect(() => {
    if (loading || !searched) return;
    replayPendingListScroll();
  }, [loading, searched, artworks.length, peopleShown]);

  useEffect(() => {
    const query = qFromUrl.trim();
    setWorksShown(PAGE);
    setPeopleShown(PAGE);
    setArtworks([]);
    setBundle(null);
    setSearched(false);
    if (!query) {
      setBundle(null);
      setSuggestion(null);
      setSearched(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void prepareSearch(query)
      .then((next) => {
        if (cancelled) return;
        setBundle(next);
        setSuggestion(null);
        setSearched(true);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setBundle({ intent: "work", artworkIds: [], people: [] });
        setSuggestion(null);
        setSearched(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [qFromUrl]);

  useEffect(() => {
    if (!bundle) return;
    const ids = bundle.artworkIds.slice(0, worksShown);
    if (ids.length === 0) {
      setArtworks([]);
      return;
    }
    let cancelled = false;
    void fetchPublicArtworkCardsByIds(ids).then((rows) => {
      if (!cancelled) setArtworks(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [bundle, worksShown]);

  const labels = describeArtworkQuery(parseArtworkQuery(qFromUrl), locale);
  const artworkTotal = bundle?.artworkIds.length ?? 0;
  const people = (bundle?.people ?? []).slice(0, peopleShown);
  const peopleTotal = bundle?.people.length ?? 0;
  const peopleFirst = bundle?.intent === "person";
  const peopleTitle =
    bundle?.intent === "work" ? t("search.relatedArtists") : t("search.people");
  const showEmpty = searched && !loading && artworkTotal === 0 && peopleTotal === 0;

  function worksBlock() {
    if (artworkTotal === 0) return null;
    return (
      <section className="mb-10" aria-label={t("search.artworks")}>
        <h2 className="mb-4 text-sm font-medium text-zinc-500">
          {t("search.artworks")} {artworkTotal}
        </h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-8">
          {artworks.map((artwork) => (
            <SearchArtworkCard key={artwork.id} artwork={artwork} />
          ))}
        </div>
        {artworks.length < artworkTotal ? (
          <button
            type="button"
            onClick={() => setWorksShown((shown) => shown + PAGE)}
            className="mt-6 text-sm text-zinc-500 hover:text-zinc-900"
          >
            {t("people.loadMore")}
          </button>
        ) : null}
      </section>
    );
  }

  function peopleBlock() {
    if (peopleTotal === 0) return null;
    return (
      <section className="mb-10" aria-label={peopleTitle}>
        <h2 className="mb-4 text-sm font-medium text-zinc-500">
          {peopleTitle} {peopleTotal}
        </h2>
        <ul className="flex flex-col gap-2">
          {people.map((person) => (
            <PeopleHit key={person.id} person={person} />
          ))}
        </ul>
        {people.length < peopleTotal ? (
          <button
            type="button"
            onClick={() => setPeopleShown((shown) => shown + PAGE)}
            className="mt-6 text-sm text-zinc-500 hover:text-zinc-900"
          >
            {t("people.loadMore")}
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <PageShell variant="default">
      <div className="hidden h-4 lg:block" data-search-span-clearance aria-hidden />
      {labels.length > 0 && (
        <ul className="mb-6 flex flex-wrap gap-2">
          {labels.map((label) => (
            <li key={label} className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700">
              {label}
            </li>
          ))}
        </ul>
      )}

      {loading ? <p className="text-sm text-zinc-500">{t("common.loading")}</p> : null}

      {!loading && peopleFirst ? peopleBlock() : null}
      {!loading ? worksBlock() : null}
      {!loading && !peopleFirst ? peopleBlock() : null}

      {showEmpty && (
        <div className="rounded-2xl border border-zinc-200 px-5 py-8 text-center">
          <p className="text-sm text-zinc-600">{t("search.empty")}</p>
          {suggestion && (
            <button
              type="button"
              onClick={() => {
                router.replace(`/search?q=${encodeURIComponent(suggestion)}`);
              }}
              className="mt-4 rounded-full border border-zinc-900 bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
            >
              {t("people.searchSuggestion").replace("{suggestion}", suggestion)}
            </button>
          )}
        </div>
      )}
    </PageShell>
  );
}

function PeopleHit({ person }: { person: PeopleRec }) {
  const { t, locale } = useT();
  const username = (person.username ?? "").replace(/^@+/, "");
  const identity = formatIdentityPair(person, t, locale);
  const handle = formatUsername(person);
  const avatar = person.avatar_url
    ? person.avatar_url.startsWith("http")
      ? person.avatar_url
      : getArtworkImageUrl(person.avatar_url, "avatar")
    : null;
  return (
    <li>
      <Link
        href={`/u/${username}`}
        data-people-profile=""
        className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 hover:bg-zinc-50"
      >
        <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-zinc-100">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-sm text-zinc-500">
              {identity.primary.slice(0, 1)}
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-zinc-900">{identity.primary}</span>
          {handle && handle !== identity.primary ? (
            <span className="block truncate text-xs text-zinc-500">{handle}</span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}
