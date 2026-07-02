"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getSession } from "@/lib/supabase/auth";
import { FeedContent } from "@/components/FeedContent";
import { ExploreTaxonomyContent } from "@/components/ExploreTaxonomyContent";
import { PageShell } from "@/components/ds/PageShell";
import { FeedHeader, type ExploreTab } from "@/components/feed/FeedHeader";

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
      router.push(`/login?next=${encodeURIComponent("/feed?tab=foryou")}`);
      return;
    }
    const params = new URLSearchParams();
    params.set("tab", next);
    if (next === "foryou" || next === "all") params.set("sort", sortValue);
    router.push(`/feed?${params.toString()}`);
  }

  function handleSortChange(next: "latest" | "popular") {
    const params = new URLSearchParams();
    params.set("tab", tab);
    params.set("sort", next);
    router.push(`/feed?${params.toString()}`);
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
