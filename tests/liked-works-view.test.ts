// Profile "좋아요" tab: filters, sort, summary and one action per card.
// Values the server held back for this viewer are null and must never
// reach a price band, a price sort position, or the available count.

import assert from "node:assert/strict";
import {
  EMPTY_LIKED_FILTERS,
  artistOptions,
  filterLikedWorks,
  isLikesTabPath,
  likedCta,
  likedStatus,
  likesTabHref,
  priceBand,
  priceBandOptions,
  priceView,
  readLikedMeta,
  sizeBucket,
  sortLikedWorks,
  summarizeLikedWorks,
  type LikedArtwork,
  type LikedWork,
} from "../src/lib/likes/likedWorksView";
import { claimFirstLikeToast, FIRST_LIKE_TOAST_LIMIT } from "../src/lib/likes/firstLikeToast";

const GATE = { required_audience: "mutuals", request_mode: null };

function work(
  id: string,
  art: Partial<LikedArtwork>,
  extra: Partial<LikedWork> = {},
): LikedWork {
  return {
    artwork: { id, artist_id: "artist-a", work_kind: "artwork", ...art },
    likedAt: extra.likedAt ?? "2026-10-01T00:00:00Z",
    exhibition: null,
    changes: [],
    mine: { inquiry: null, in_board: false },
    moreAvailable: 0,
    artistKey: "artist-a",
    artistName: "Artist A",
    artistHref: "/u/artist-a",
    ...extra,
  };
}

const listed = work(
  "listed",
  {
    title: "Wave",
    ownership_status: "available",
    pricing_mode: "fixed",
    is_price_public: true,
    price_input_amount: 800_000,
    price_input_currency: "KRW",
    price_usd: 600,
    width_cm: 91,
    height_cm: 91,
  },
  { likedAt: "2026-10-03T00:00:00Z" },
);
const hidden = work(
  "hidden",
  {
    title: "Stillness",
    ownership_status: null,
    pricing_mode: null,
    is_price_public: null,
    price_input_amount: null,
    price_gate: GATE,
    availability_gate: GATE,
    size: "53*53",
    size_unit: null,
  },
  { likedAt: "2026-10-05T00:00:00Z" },
);
const ask = work(
  "ask",
  {
    title: "Ask me",
    ownership_status: "available",
    pricing_mode: "inquire",
    width_cm: 30,
    height_cm: 40,
  },
  { likedAt: "2026-10-04T00:00:00Z", artistKey: "artist-b", artistName: "Artist B" },
);
const sold = work(
  "sold",
  { title: "Gone", ownership_status: "sold", price_gate: GATE, width_cm: 150, height_cm: 120 },
  { likedAt: "2026-10-06T00:00:00Z", moreAvailable: 3 },
);
const items = [listed, hidden, ask, sold];

// 1. Price view and bands.
assert.equal(priceView(hidden.artwork).kind, "hidden");
assert.equal(priceBand(priceView(hidden.artwork)), null);
assert.equal(priceBand(priceView(ask.artwork)), null);
assert.equal(priceBand(priceView(listed.artwork)), "KRW:1");
assert.deepEqual(priceBandOptions(items), ["KRW:1"]);

// 2. Price filter: held-back prices never land in a band.
assert.deepEqual(
  filterLikedWorks(items, { ...EMPTY_LIKED_FILTERS, price: "KRW:1" }).map((i) => i.artwork.id),
  ["listed"],
);
assert.deepEqual(
  filterLikedWorks(items, { ...EMPTY_LIKED_FILTERS, price: "ask" }).map((i) => i.artwork.id).sort(),
  ["ask", "hidden"],
);
// The search line's price phrase uses the same judged values.
assert.deepEqual(
  filterLikedWorks(items, { ...EMPTY_LIKED_FILTERS, q: "100만원 이하" }).map((i) => i.artwork.id),
  ["listed"],
);
assert.deepEqual(
  filterLikedWorks(items, { ...EMPTY_LIKED_FILTERS, q: "판매 완료" }).map((i) => i.artwork.id),
  ["sold"],
);
assert.deepEqual(
  filterLikedWorks(items, { ...EMPTY_LIKED_FILTERS, q: "wave" }).map((i) => i.artwork.id),
  ["listed"],
);

// 3. Status and size.
assert.equal(likedStatus(hidden.artwork), "hidden");
assert.deepEqual(
  filterLikedWorks(items, { ...EMPTY_LIKED_FILTERS, status: "available" }).map((i) => i.artwork.id).sort(),
  ["ask", "listed"],
);
assert.deepEqual(
  filterLikedWorks(items, { ...EMPTY_LIKED_FILTERS, status: "ask" }).map((i) => i.artwork.id),
  ["hidden"],
);
assert.equal(sizeBucket(hidden.artwork), "unknown", "a size without a unit is not guessed");
assert.equal(sizeBucket(ask.artwork), "small");
assert.equal(sizeBucket(listed.artwork), "large");
assert.equal(sizeBucket(sold.artwork), "xlarge");

// 4. Sort: sold / not for sale last; hidden prices after shown ones by liked time.
assert.deepEqual(sortLikedWorks(items, "recent").map((i) => i.artwork.id), ["hidden", "ask", "listed", "sold"]);
assert.deepEqual(sortLikedWorks(items, "priceLow").map((i) => i.artwork.id), ["listed", "hidden", "ask", "sold"]);
assert.deepEqual(sortLikedWorks(items, "priceHigh").map((i) => i.artwork.id), ["listed", "hidden", "ask", "sold"]);
assert.deepEqual(sortLikedWorks(items, "sizeSmall").map((i) => i.artwork.id), ["ask", "listed", "hidden", "sold"]);
assert.deepEqual(sortLikedWorks(items, "available").map((i) => i.artwork.id), ["ask", "listed", "hidden", "sold"]);

// 5. Summary counts only what the viewer can see.
assert.deepEqual(summarizeLikedWorks(items), { all: 4, available: 2, onView: 0, changed: 0 });
assert.deepEqual(
  artistOptions(items).map((o) => [o.key, o.count]),
  [["artist-a", 3], ["artist-b", 1]],
);

// 6. One action per card.
assert.deepEqual(likedCta(listed, "viewer"), { kind: "askAbout", href: "/artwork/listed?ask=1" });
assert.deepEqual(likedCta(ask, "viewer"), { kind: "ask", href: "/artwork/ask?ask=1" });
assert.deepEqual(likedCta(hidden, "viewer"), { kind: "askAbout", href: "/artwork/hidden?ask=1" });
assert.deepEqual(likedCta(sold, "viewer"), { kind: "more", href: "/u/artist-a", count: 3 });
assert.deepEqual(likedCta({ ...listed, mine: { inquiry: "replied", in_board: false } }, "viewer"), {
  kind: "reply",
  href: "/artwork/listed",
});
assert.deepEqual(likedCta(listed, "artist-a"), { kind: "none" });

// 7. RPC row parsing.
const meta = readLikedMeta({
  exhibition: { id: "e1", title: "Show", phase: "ongoing", end_date: "2026-11-20" },
  changes: [
    { kind: "price_listed", at: "2026-10-02T00:00:00Z" },
    { kind: "exhibition", at: "2026-10-09T00:00:00Z", exhibition_id: "e1", title: "Show" },
    { kind: "made_up", at: "2026-10-10T00:00:00Z" },
  ],
  mine: { inquiry: "open", in_board: true },
});
assert.equal(meta.exhibition?.phase, "ongoing");
assert.deepEqual(meta.changes.map((c) => c.kind), ["exhibition", "price_listed"]);
assert.deepEqual(meta.mine, { inquiry: "open", in_board: true });
assert.equal(readLikedMeta({ exhibition: { id: "e2", phase: "ended" } }).exhibition, null);
assert.equal(readLikedMeta({ mine: null }).mine.inquiry, null);

// 8. Deep link.
assert.equal(likesTabHref("/u/theo"), "/u/theo?tab=likes");
assert.equal(isLikesTabPath("/u/theo?tab=likes"), true);
assert.equal(isLikesTabPath("/u/theo?tab=all"), false);
assert.equal(isLikesTabPath("/feed?tab=likes"), false);

// 9. First-like hint shows twice, then stops.
const store = new Map<string, string>();
const fake = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
};
const shown = Array.from({ length: FIRST_LIKE_TOAST_LIMIT + 2 }, () => claimFirstLikeToast(fake));
assert.deepEqual(shown, [true, true, false, false]);
assert.equal(claimFirstLikeToast(null), false);

console.log("liked-works-view.test.ts: ok");
