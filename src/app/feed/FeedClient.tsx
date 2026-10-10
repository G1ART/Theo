"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getSession } from "@/lib/supabase/auth";
import { ExploreTaxonomyContent } from "@/components/ExploreTaxonomyContent";
import { FeedWalk } from "@/components/feed/walk/FeedWalk";
import { PageShell } from "@/components/ds/PageShell";
import { FeedHeader, type ExploreTab } from "@/components/feed/FeedHeader";
import { BilingualDiscoveryBanner } from "@/components/bilingual/BilingualDiscoveryBanner";
import { discardFeedSession, discardFeedSessionForHref } from "@/lib/feed/scrollRestore";

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
      discardFeedSession({ refetch: false });
      router.push(`/onboarding?next=${encodeURIComponent("/feed?tab=foryou")}`);
      return;
    }
    // A feed tab opens the feed itself. Drop scroll + pages + cursor
    // before the next paint so For you / artworks / artists /
    // exhibitions / all all start at the top.
    const params = new URLSearchParams();
    params.set("tab", next);
    if (next === "foryou" || next === "all") params.set("sort", sortValue);
    const href = `/feed?${params.toString()}`;
    discardFeedSessionForHref(href);
    router.push(href);
  }

  function handleSortChange(next: "latest" | "popular") {
    // Sort reorders the feed. The previous cursor window does not apply.
    const params = new URLSearchParams();
    params.set("tab", tab);
    params.set("sort", next);
    const href = `/feed?${params.toString()}`;
    discardFeedSessionForHref(href);
    router.push(href);
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

      {!sessionReady ? null : tab === "foryou" || (!userId && tab === "all") ? (
        <FeedWalk
          userId={userId}
          lane={
            userId && (rawTab ?? "").trim().toLowerCase() === "following"
              ? "following"
              : userId
                ? "personalized"
                : "public"
          }
          sort={sortValue}
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
