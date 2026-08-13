"use client";

/**
 * Sprint 2026-08-12 — Overview 전역 인물 검색.
 *
 * `/my/network?tab=overview` 상단에 마운트되는 self-contained 검색 위젯.
 * 이미 구축된 `searchPeopleWithArtwork` (이름 + 유저명 + 작품 medium/theme
 * + 언어변형 팬아웃 + Did-you-mean fallback) 엔진을 재사용해 Overview
 * 탭에서 "그래프 신호에는 안 잡히지만 확실히 원하는 사람" 을 직접 이름·
 * 스타일로 찾을 수 있게 해준다.
 *
 * UX 규칙:
 *   • 빈 쿼리 → 아무 것도 렌더하지 않는다. 부모(Overview) 는 그동안
 *     Invitations + 연결 후보 + 역할별 찾기 sections 를 정상 렌더.
 *   • 쿼리가 있으면 role filter chip row + results grid + Did-you-mean
 *     / empty / load-more / exhausted 를 그린다.
 *   • 부모에게 `onQueryChange(hasQuery)` 로 검색 활성화를 알려서, 부모가
 *     검색 중일 때 그래프-신호 sections 를 숨길 수 있게 한다.
 *
 * 성능 가드:
 *   • 250ms debounce (사용자 입력 폭주 방지).
 *   • Stale-request cancellation: 매 fetch 마다 request id 를 증가시켜,
 *     이전 request 응답이 늦게 도착해도 결과를 반영하지 않는다. 첫 페이지
 *     팬아웃이 2-6 병렬 RPC 를 돌리기 때문에 필수.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/useT";
import { SuggestionCard } from "@/components/network/SuggestionsGroupedPanel";
import {
  searchPeopleWithArtwork,
  type PeopleRec,
} from "@/lib/supabase/peopleRecs";

type RoleFilter = "artist" | "collector" | "curator" | "gallerist" | null;

const ROLE_FILTERS: Exclude<RoleFilter, null>[] = [
  "artist",
  "collector",
  "curator",
  "gallerist",
];

const PAGE_SIZE = 24;
const DEBOUNCE_MS = 250;

export function NetworkPeopleSearch({
  onQueryChange,
}: {
  onQueryChange?: (hasQuery: boolean) => void;
}) {
  const { t } = useT();

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>(null);

  const [rows, setRows] = useState<PeopleRec[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreClicked, setLoadMoreClicked] = useState(false);

  // Stale-request guard. Every `searchPeopleWithArtwork` fanout on the
  // first page runs 2-6 parallel Supabase RPCs; if the user keeps
  // typing, older requests can resolve *after* newer ones. We only
  // apply results whose id still equals `latestReqId.current` at
  // the moment they resolve.
  const latestReqId = useRef(0);

  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;

  useEffect(() => {
    onQueryChange?.(hasQuery);
  }, [hasQuery, onQueryChange]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedQuery(trimmedQuery);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [trimmedQuery]);

  useEffect(() => {
    if (!debouncedQuery) {
      // Clear any lingering results when the query goes empty so the
      // next non-empty query starts from a clean slate.
      setRows([]);
      setNextCursor(null);
      setSuggestion(null);
      setLoading(false);
      setLoadingMore(false);
      setLoadMoreClicked(false);
      return;
    }

    const reqId = ++latestReqId.current;
    setLoading(true);
    setLoadMoreClicked(false);

    void (async () => {
      const res = await searchPeopleWithArtwork({
        q: debouncedQuery,
        roles: roleFilter ? [roleFilter] : null,
        limit: PAGE_SIZE,
      });
      if (reqId !== latestReqId.current) return;
      setRows(res.data ?? []);
      setNextCursor(res.nextCursor ?? null);
      setSuggestion(res.suggestion ?? null);
      setLoading(false);
    })();
  }, [debouncedQuery, roleFilter]);

  const handleLoadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    const reqId = ++latestReqId.current;
    setLoadingMore(true);
    setLoadMoreClicked(true);
    void (async () => {
      const res = await searchPeopleWithArtwork({
        q: debouncedQuery,
        roles: roleFilter ? [roleFilter] : null,
        limit: PAGE_SIZE,
        cursor: nextCursor,
      });
      if (reqId !== latestReqId.current) return;
      setRows((prev) => {
        // De-dupe by id — first-page fanout can overlap the primary
        // fuzzy variant that pagination walks.
        const seen = new Set(prev.map((r) => r.id));
        const merged = [...prev];
        for (const r of res.data ?? []) {
          if (!seen.has(r.id)) {
            seen.add(r.id);
            merged.push(r);
          }
        }
        return merged;
      });
      setNextCursor(res.nextCursor ?? null);
      setLoadingMore(false);
    })();
  }, [debouncedQuery, roleFilter, nextCursor, loadingMore]);

  const chipRow = useMemo(
    () => (
      <div className="flex flex-wrap gap-1.5">
        <RoleChip
          label={t("network.peopleSearch.roleAll")}
          active={roleFilter === null}
          onClick={() => setRoleFilter(null)}
        />
        {ROLE_FILTERS.map((role) => (
          <RoleChip
            key={role}
            label={t(`network.peopleSearch.role${cap(role)}`)}
            active={roleFilter === role}
            onClick={() => setRoleFilter(role)}
          />
        ))}
      </div>
    ),
    [roleFilter, t],
  );

  const suggestionText = suggestion
    ? t("network.peopleSearch.didYouMean").replace("{q}", suggestion)
    : null;
  const noResultsText = t("network.peopleSearch.noResults").replace(
    "{q}",
    debouncedQuery,
  );

  return (
    <section className="space-y-3" data-tour="network-people-search">
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("network.peopleSearch.placeholder")}
          autoComplete="off"
          enterKeyHint="search"
          aria-label={t("network.peopleSearch.placeholder")}
          className="w-full rounded-xl border border-zinc-200 bg-white py-3 pl-10 pr-10 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
        >
          <svg
            viewBox="0 0 20 20"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="9" cy="9" r="6" />
            <path d="m14 14 4 4" />
          </svg>
        </span>
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={t("network.peopleSearch.clear")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <svg
              aria-hidden
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        )}
      </div>

      {hasQuery && (
        <>
          {chipRow}

          {loading ? (
            <p className="rounded-2xl border border-zinc-200 bg-white px-5 py-6 text-sm text-zinc-500">
              …
            </p>
          ) : rows.length > 0 ? (
            <div className="rounded-2xl border border-zinc-200 bg-white">
              <ul className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((r) => (
                  <SuggestionCard key={r.id} row={r} lane="role" />
                ))}
              </ul>
              {nextCursor ? (
                <div className="border-t border-zinc-100 px-4 py-3 text-center">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 disabled:opacity-50"
                  >
                    {loadingMore
                      ? "…"
                      : t("network.peopleSearch.loadMore")}
                  </button>
                </div>
              ) : loadMoreClicked ? (
                <div className="border-t border-zinc-100 px-4 py-3 text-center text-xs text-zinc-500">
                  {t("network.peopleSearch.exhausted")}
                </div>
              ) : null}
            </div>
          ) : suggestionText ? (
            <button
              type="button"
              onClick={() => {
                if (suggestion) setQuery(suggestion);
              }}
              className="block w-full rounded-2xl border border-zinc-200 bg-white px-5 py-6 text-left text-sm text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
            >
              <span className="font-medium text-zinc-900">
                {suggestionText}
              </span>
            </button>
          ) : (
            <div className="space-y-2 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 px-5 py-6 text-sm text-zinc-500">
              <p>{noResultsText}</p>
              <p>
                <Link
                  href="/people/invite"
                  className="font-medium text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900"
                >
                  {t("network.peopleSearch.noResultsInvite")}
                </Link>
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function RoleChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-zinc-900 bg-zinc-900 text-white"
          : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400 hover:text-zinc-900"
      }`}
    >
      {label}
    </button>
  );
}

function cap<S extends string>(s: S): Capitalize<S> {
  return (s.charAt(0).toUpperCase() + s.slice(1)) as Capitalize<S>;
}
