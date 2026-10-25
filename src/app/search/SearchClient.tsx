"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageShell } from "@/components/ds/PageShell";
import { SearchArtworkCard } from "@/components/search/SearchArtworkCard";
import { formatIdentityPair, formatUsername, hasPublicLinkableUsername } from "@/lib/identity/format";
import { useT } from "@/lib/i18n/useT";
import { describeArtworkQuery, parseArtworkQuery } from "@/lib/search/artworkQuery";
import { replayPendingListScroll } from "@/lib/list/scrollRestore";
import { searchDiscoverArtworks } from "@/lib/search/discoverArtworks";
import { getArtworkImageUrl, type ArtworkWithLikes } from "@/lib/supabase/artworks";
import { getPeopleRecommendations } from "@/lib/supabase/recommendations";
import type { PeopleRec } from "@/lib/supabase/peopleRecs";

export function SearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useT();
  const qFromUrl = searchParams.get("q") ?? "";
  const [artworks, setArtworks] = useState<ArtworkWithLikes[]>([]);
  const [people, setPeople] = useState<PeopleRec[]>([]);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useLayoutEffect(() => {
    if (loading || !searched) return;
    replayPendingListScroll();
  }, [loading, searched, artworks.length, people.length]);

  useEffect(() => {
    const query = qFromUrl.trim();
    if (!query) {
      setArtworks([]);
      setPeople([]);
      setSuggestion(null);
      setSearched(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const parsed = parseArtworkQuery(query);
    const peopleQuery = parsed.text;
    void (async () => {
      try {
        const [works, peopleRes] = await Promise.all([
          searchDiscoverArtworks(query, 24),
          peopleQuery
            ? getPeopleRecommendations({
                lane: "search",
                q: peopleQuery,
                limit: 8,
                searchVariant: "merged",
              })
            : Promise.resolve({ data: [], suggestion: null, error: null, nextCursor: null }),
        ]);
        if (cancelled) return;
        setArtworks(works);
        setPeople((peopleRes.data ?? []).filter((person) => hasPublicLinkableUsername(person)));
        setSuggestion(peopleRes.suggestion);
      } catch {
        if (cancelled) return;
        setArtworks([]);
        setPeople([]);
        setSuggestion(null);
      }
      if (cancelled) return;
      setSearched(true);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [qFromUrl]);

  const labels = describeArtworkQuery(parseArtworkQuery(qFromUrl), locale);
  const showEmpty = searched && !loading && artworks.length === 0 && people.length === 0;

  return (
    <PageShell variant="default">
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

      {!loading && artworks.length > 0 && (
        <section className="mb-10" aria-label={t("search.artworks")}>
          <h2 className="mb-4 text-sm font-medium text-zinc-500">{t("search.artworks")}</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-8">
            {artworks.map((artwork) => (
              <SearchArtworkCard key={artwork.id} artwork={artwork} />
            ))}
          </div>
        </section>
      )}

      {!loading && people.length > 0 && (
        <section aria-label={t("search.people")}>
          <h2 className="mb-4 text-sm font-medium text-zinc-500">{t("search.people")}</h2>
          <ul className="flex flex-col gap-2">
            {people.map((person) => (
              <PeopleHit key={person.id} person={person} />
            ))}
          </ul>
        </section>
      )}

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
