import type { ExploreTab } from "@/components/feed/FeedHeader";
import type { WalkLane } from "@/lib/feed/walk/types";

const FEED_TABS: readonly ExploreTab[] = ["foryou", "artworks", "artists", "exhibitions", "all"];

/**
 * Which feed tab a URL opens.
 * No tab, and the retired `following`, open the signed-in default For you;
 * a visitor gets all. `all` is the whole public feed for everyone.
 * For you needs an account, so once the session is known a visitor on it
 * sees all. Until then the URL is trusted, so the For you link (logo,
 * Explore) does not flash the all tab for a signed-in reader.
 */
export function normalizeFeedTab(
  raw: string | null,
  signedIn: boolean,
  sessionReady: boolean,
): ExploreTab {
  const lowered = (raw ?? "").trim().toLowerCase();
  if (lowered === "" || lowered === "following") return signedIn ? "foryou" : "all";
  if (lowered === "foryou") return signedIn || !sessionReady ? "foryou" : "all";
  if ((FEED_TABS as readonly string[]).includes(lowered)) return lowered as ExploreTab;
  return signedIn ? "foryou" : "all";
}

/** Walk behind For you and all. `all` is the public walk, signed in or not. */
export function feedWalkLane(tab: ExploreTab, rawTab: string | null, signedIn: boolean): WalkLane {
  if (tab === "all" || !signedIn) return "public";
  return (rawTab ?? "").trim().toLowerCase() === "following" ? "following" : "personalized";
}
