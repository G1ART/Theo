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

const DEBOUNCE_MS = 300;

export function SearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useT();
  const qFromUrl = searchParams.get("q") ?? "";
  const [q, setQ] = useState(qFromUrl);
  const [artworks, setArtworks] = useState<ArtworkWithLikes[]>([]);
  const [people, setPeople] = useState<PeopleRec[]>([]);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    setQ(qFromUrl);
  }, [qFromUrl]);

  useLayoutEffect(() => {
    if (loading || !searched) return;
    replayPendingListScroll();
  }, [loading, searched, artworks.length, people.length]);

  useEffect(() => {
    const query = q.trim();
    if (query === qFromUrl.trim()) return;
    const handle = window.setTimeout(() => {
      router.replace(query ? `/search?q=${encodeURIComponent(query)}` : "/search");
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [q, qFromUrl, router]);

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
      {/* Wide screens keep this one field above the results. Below `lg`
          the header row is the only search, so this stays off the page. */}
      <div data-search-page-chrome className="hidden lg:block">
      <form
        className="relative mb-8"
        onSubmit={(event) => {
          event.preventDefault();
          const query = q.trim();
          router.replace(query ? `/search?q=${encodeURIComponent(query)}` : "/search");
        }}
      >
        <input
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder={t("shell.searchPlaceholder")}
          aria-label={t("shell.searchPlaceholder")}
          className="w-full rounded-full border border-zinc-300 bg-white py-2.5 pl-4 pr-12 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none"
        />
        <button
          type="submit"
          aria-label={t("shell.searchSubmit")}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-zinc-500 hover:text-zinc-900"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </form>
      </div>

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
                setQ(suggestion);
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
