import { Suspense } from "react";
import { PageShellSkeleton } from "@/components/ds/PageShellSkeleton";
import { FeedClient } from "./FeedClient";

/**
 * Explore / feed route. As of the wireframe redesign this is a **public**
 * landing:
 *   - Anonymous visitors see the taxonomy (Artworks / Artists / Exhibitions
 *     / All) with artist/meta info blurred; interacting with a card routes
 *     to /login?next=/feed.
 *   - Signed-in viewers get the personalized "For you" tab (the Living
 *     Salon engine that used to be the default), plus the same taxonomy
 *     tabs. The AuthGate has been intentionally removed here — deeper
 *     auth-required actions (like/follow/inquiry) still guard themselves.
 */
export default function FeedPage() {
  return (
    <Suspense fallback={<PageShellSkeleton variant="feed" />}>
      <FeedClient />
    </Suspense>
  );
}
