"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getSession } from "@/lib/supabase/auth";
import { FeedContent } from "@/components/FeedContent";
import { ExploreTaxonomyContent } from "@/components/ExploreTaxonomyContent";
import { PageShell } from "@/components/ds/PageShell";
import { FeedHeader, type ExploreTab } from "@/components/feed/FeedHeader";
import { BilingualDiscoveryBanner } from "@/components/bilingual/BilingualDiscoveryBanner";
import { clearFeedSnapshot } from "@/lib/feed/scrollSnapshot";

const NEW_TABS: readonly ExploreTab[] = [
  "foryou",
  "artworks",
  "artists",
  "exhibitions",
  "all",
] as const;

function normalizeTab(raw: string | null, isSignedIn: boolean): ExploreTab {
  const lowered = (raw ?? "").trim().toLowerCase();
  // Back-compat: pre-redesign the URL used `tab=all|following`. Map the
  // old `all` to the new signed-in default ("foryou") so returning users
  // still land on the personalized surface; keep `all` explicit when the
  // visitor is anonymous. `following` is folded into `foryou` because the
  // Living Salon already respects follow signals.
  if (lowered === "following") return isSignedIn ? "foryou" : "all";
  if (lowered === "" || lowered === "all") return isSignedIn ? "foryou" : "all";
  if ((NEW_TABS as readonly string[]).includes(lowered)) return lowered as ExploreTab;
  return isSignedIn ? "foryou" : "all";
}

export function FeedClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      setUserId(session?.user?.id ?? null);
      setSessionReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const rawTab = searchParams.get("tab");
  const tab = normalizeTab(rawTab, !!userId);
  const sortValue =
    (searchParams.get("sort") === "popular" ? "popular" : "latest") as
      | "latest"
      | "popular";

  function handleTabChange(next: ExploreTab) {
    if (next === "foryou" && !userId) {
      // Cold-visitor policy: detail/personalized surfaces prompt sign-up,
      // not login (consistent with Explore cards, LikeButton, and `/`).
      router.push(`/onboarding?next=${encodeURIComponent("/feed?tab=foryou")}`);
      return;
    }
    // Drop the OLD tab's scroll+state snapshot so switching tabs
    // always gives the user a fresh view — swapping tabs is an
    // explicit "show me something different" signal, not a return-nav.
    clearFeedSnapshot(computeSnapshotKeyForTab(tab, sortValue));
    const params = new URLSearchParams();
    params.set("tab", next);
    if (next === "foryou" || next === "all") params.set("sort", sortValue);
    router.push(`/feed?${params.toString()}`);
  }

  function handleSortChange(next: "latest" | "popular") {
    // Sort is a *reorder* — the paginated cursor windows are keyed on
    // it, so the current snapshot's cursors would be invalid against
    // the new sort. Clear before pushing so the next mount fetches
    // fresh instead of trying to hydrate stale cursors.
    clearFeedSnapshot(computeSnapshotKeyForTab(tab, sortValue));
    const params = new URLSearchParams();
    params.set("tab", tab);
    params.set("sort", next);
    router.push(`/feed?${params.toString()}`);
  }

  /**
   * Mirror of the snapshot-key derivation in `FeedContent` and
   * `ExploreTaxonomyContent`. Kept local (rather than exported from
   * the components) so this small router-adjacent file has no
   * cross-imports into feed body components.
   */
  function computeSnapshotKeyForTab(
    currentTab: ExploreTab,
    currentSort: "latest" | "popular"
  ): string {
    if (currentTab === "foryou") return "feed:foryou";
    return `explore:${currentTab}:${currentSort}`;
  }

  const isPersonalized = tab === "foryou" || tab === "all";
  const showSortControls = isPersonalized;

  return (
    <PageShell variant="feed">
      <FeedHeader
        tab={tab}
        sort={sortValue}
        isSignedIn={!!userId}
        onTabChange={handleTabChange}
        onSortChange={handleSortChange}
        showSortControls={showSortControls}
      />

      {/*
        QA 2026-07-29 — Layer 2 이중언어 발견 배너. 로그인된 사용자에게만,
        dismiss 되지 않았을 때만 렌더한다. 컴포넌트 내부에서 세션/RLS 를
        신뢰하는 dismissal 상태를 스스로 조회하므로 여기서는 세션 게이팅만
        하면 된다. 익명 방문자에겐 노출되지 않아 anon UI 를 흐리지 않는다.
      */}
      {sessionReady && userId && <BilingualDiscoveryBanner />}

      {!sessionReady ? null : tab === "foryou" ? (
        <FeedContent
          tab="all"
          sort={sortValue}
          userId={userId}
          onTabChange={() => {}}
          onSortChange={handleSortChange}
          suppressHeader
        />
      ) : (
        <ExploreTaxonomyContent
          tab={tab}
          sort={sortValue}
          userId={userId}
          onSortChange={handleSortChange}
        />
      )}
    </PageShell>
  );
}
