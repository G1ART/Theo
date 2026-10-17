/**
 * Liked works (profile "좋아요" tab): filters, sort, summary and the one
 * action each card offers.
 *
 * Every price and availability value here is the one the server judged
 * for this viewer (`artwork_cards.viewer_fields`). A held-back value is
 * null, so it never lands in a price band, a price sort position, or the
 * "available" count. Hidden prices sort after shown ones by liked time.
 */

import type { ArtworkVisibilityGate } from "@/lib/artworks/viewerFields";
import { artworkDimensionsCm, artworkMatchesConstraints, parseArtworkQuery } from "@/lib/search/artworkQuery";
import { recordMatchesQuery } from "@/lib/search/matchText";

export type LikedArtwork = {
  id: string;
  artist_id: string;
  title?: string | null;
  title_ko?: string | null;
  title_en?: string | null;
  medium?: string | null;
  medium_ko?: string | null;
  medium_en?: string | null;
  size?: string | null;
  size_unit?: string | null;
  width_cm?: number | string | null;
  height_cm?: number | string | null;
  work_kind?: string | null;
  work_form?: string | null;
  visibility?: string | null;
  ownership_status?: string | null;
  pricing_mode?: string | null;
  is_price_public?: boolean | null;
  price_usd?: number | null;
  price_input_amount?: number | null;
  price_input_currency?: string | null;
  fx_rate_to_usd?: number | null;
  price_gate?: ArtworkVisibilityGate | null;
  availability_gate?: ArtworkVisibilityGate | null;
};

export type LikedChangeKind = "exhibition" | "price_listed" | "sold" | "available_again" | "off_market";

export type LikedChange = {
  kind: LikedChangeKind;
  at: string;
  exhibition_id?: string | null;
  title?: string | null;
  title_ko?: string | null;
  title_en?: string | null;
};

export type LikedShow = {
  id: string;
  title: string | null;
  title_ko: string | null;
  title_en: string | null;
  start_date: string | null;
  end_date: string | null;
  phase: "ongoing" | "upcoming";
};

export type LikedMine = { inquiry: "open" | "replied" | null; in_board: boolean };

export type LikedWork<A extends LikedArtwork = LikedArtwork> = {
  artwork: A;
  likedAt: string;
  exhibition: LikedShow | null;
  changes: LikedChange[];
  mine: LikedMine;
  /** The artist's other works this viewer can see as available. */
  moreAvailable: number;
  /** Credited artist (id, or `ext:<name>` for an invited artist) and display name. */
  artistKey: string;
  artistName: string;
  artistHref: string | null;
};

export type LikedStatus = "available" | "sold" | "owned" | "not_for_sale" | "hidden" | "none";

export function likedStatus(art: LikedArtwork): LikedStatus {
  if (art.availability_gate) return "hidden";
  switch (art.ownership_status) {
    case "available":
    case "sold":
    case "owned":
    case "not_for_sale":
      return art.ownership_status;
    default:
      return "none";
  }
}

/** Not purchasable now. These go to the end of the list. */
export function isOffMarket(status: LikedStatus): boolean {
  return status === "sold" || status === "owned" || status === "not_for_sale";
}

export type PriceView =
  | { kind: "listed"; amount: number; currency: string; usd: number | null }
  | { kind: "ask" }
  | { kind: "hidden" }
  | { kind: "none" };

export function priceView(art: LikedArtwork): PriceView {
  if (art.price_gate) return { kind: "hidden" };
  const amount = art.price_input_amount;
  if (art.pricing_mode === "fixed" && art.is_price_public === true && amount != null && Number.isFinite(amount)) {
    const currency = (art.price_input_currency ?? "USD").toUpperCase();
    const usd =
      art.price_usd != null
        ? art.price_usd
        : currency === "USD"
          ? amount
          : art.fx_rate_to_usd != null && art.fx_rate_to_usd > 0
            ? amount * art.fx_rate_to_usd
            : null;
    return { kind: "listed", amount, currency, usd };
  }
  if (art.pricing_mode != null) return { kind: "ask" };
  return { kind: "none" };
}

const KRW_BANDS: Array<{ key: string; max: number }> = [
  { key: "KRW:1", max: 1_000_000 },
  { key: "KRW:2", max: 3_000_000 },
  { key: "KRW:3", max: 10_000_000 },
  { key: "KRW:4", max: Number.POSITIVE_INFINITY },
];

const USD_BANDS: Array<{ key: string; max: number }> = [
  { key: "USD:1", max: 1_000 },
  { key: "USD:2", max: 3_000 },
  { key: "USD:3", max: 10_000 },
  { key: "USD:4", max: Number.POSITIVE_INFINITY },
];

export const PRICE_BAND_ORDER = [...KRW_BANDS, ...USD_BANDS].map((band) => band.key);

/** Band of a shown price. Held-back and on-request prices have no band. */
export function priceBand(view: PriceView): string | null {
  if (view.kind !== "listed") return null;
  const bands = view.currency === "KRW" ? KRW_BANDS : view.currency === "USD" ? USD_BANDS : null;
  if (!bands) return `${view.currency}:all`;
  return bands.find((band) => view.amount <= band.max)?.key ?? null;
}

export type SizeBucket = "small" | "medium" | "large" | "xlarge" | "unknown";

export const SIZE_BUCKET_ORDER: SizeBucket[] = ["small", "medium", "large", "xlarge", "unknown"];

/** Long side in cm. A size without a unit stays unknown. */
export function longSideCm(art: LikedArtwork): number | null {
  const dims = artworkDimensionsCm(art);
  return dims ? Math.max(dims.widthCm, dims.heightCm) : null;
}

export function sizeBucket(art: LikedArtwork): SizeBucket {
  const side = longSideCm(art);
  if (side == null) return "unknown";
  if (side <= 45) return "small";
  if (side <= 75) return "medium";
  if (side < 120) return "large";
  return "xlarge";
}

export type LikedStatusFilter = "all" | "available" | "onView" | "changed" | "ask" | "off";

export type LikedFilters = {
  q: string;
  artist: string | null;
  status: LikedStatusFilter;
  /** A band key from `priceBand`, or "ask" for price on request / held back. */
  price: string | null;
  size: SizeBucket | null;
  kind: string | null;
};

export const EMPTY_LIKED_FILTERS: LikedFilters = {
  q: "",
  artist: null,
  status: "all",
  price: null,
  size: null,
  kind: null,
};

export function filtersActive(filters: LikedFilters): boolean {
  return (
    filters.q.trim().length > 0 ||
    filters.artist != null ||
    filters.status !== "all" ||
    filters.price != null ||
    filters.size != null ||
    filters.kind != null
  );
}

function statusMatches(item: LikedWork, status: LikedStatusFilter): boolean {
  const s = likedStatus(item.artwork);
  switch (status) {
    case "all":
      return true;
    case "available":
      return s === "available";
    case "onView":
      return item.exhibition != null;
    case "changed":
      return item.changes.length > 0;
    case "ask":
      return s === "hidden";
    case "off":
      return isOffMarket(s);
  }
}

function priceMatches(item: LikedWork, price: string | null): boolean {
  if (!price) return true;
  const view = priceView(item.artwork);
  if (price === "ask") {
    if (isOffMarket(likedStatus(item.artwork))) return false;
    return view.kind === "ask" || view.kind === "hidden";
  }
  return priceBand(view) === price;
}

function kindOf(art: LikedArtwork): string {
  return art.work_kind ?? "artwork";
}

function textFields(item: LikedWork): Array<string | null | undefined> {
  const a = item.artwork;
  return [a.title, a.title_ko, a.title_en, item.artistName, a.medium, a.medium_ko, a.medium_en];
}

export function filterLikedWorks<A extends LikedArtwork>(
  items: ReadonlyArray<LikedWork<A>>,
  filters: LikedFilters,
): LikedWork<A>[] {
  const parsed = parseArtworkQuery(filters.q);
  const text = parsed.text.trim();
  return items.filter((item) => {
    if (filters.artist && item.artistKey !== filters.artist) return false;
    if (!statusMatches(item, filters.status)) return false;
    if (!priceMatches(item, filters.price)) return false;
    if (filters.size && sizeBucket(item.artwork) !== filters.size) return false;
    if (filters.kind && kindOf(item.artwork) !== filters.kind) return false;
    if (parsed.kindMode === "goods" && kindOf(item.artwork) !== "art_goods") return false;
    if (parsed.kindMode === "collected" && kindOf(item.artwork) !== "collected") return false;
    if (
      parsed.kindMode === "goods-and-collected" &&
      kindOf(item.artwork) !== "art_goods" &&
      kindOf(item.artwork) !== "collected"
    ) {
      return false;
    }
    if (parsed.hasConstraint && !artworkMatchesConstraints(item.artwork, parsed)) return false;
    if (text && !recordMatchesQuery(text, textFields(item))) return false;
    return true;
  });
}

export type LikedSort =
  | "recent"
  | "available"
  | "priceLow"
  | "priceHigh"
  | "sizeLarge"
  | "sizeSmall"
  | "artist"
  | "oldest";

export const LIKED_SORTS: LikedSort[] = [
  "recent",
  "available",
  "priceLow",
  "priceHigh",
  "sizeLarge",
  "sizeSmall",
  "artist",
  "oldest",
];

function likedTime(item: LikedWork): number {
  const t = Date.parse(item.likedAt);
  return Number.isFinite(t) ? t : 0;
}

function availabilityRank(item: LikedWork): number {
  const s = likedStatus(item.artwork);
  if (s === "available") return 0;
  if (s === "hidden" || s === "none") return 1;
  return 2;
}

function comparablePrice(item: LikedWork): number | null {
  const view = priceView(item.artwork);
  if (view.kind !== "listed") return null;
  return view.usd ?? (view.currency === "USD" ? view.amount : null);
}

/**
 * Sold, privately held and not-for-sale works always come last, in the
 * same order as the rest. Values a viewer may not see sort after the
 * values they can, by liked time.
 */
export function sortLikedWorks<A extends LikedArtwork>(
  items: ReadonlyArray<LikedWork<A>>,
  sort: LikedSort,
  locale = "ko",
): LikedWork<A>[] {
  const byRecent = (a: LikedWork, b: LikedWork) => likedTime(b) - likedTime(a);
  const cmp = (a: LikedWork, b: LikedWork): number => {
    switch (sort) {
      case "oldest":
        return likedTime(a) - likedTime(b);
      case "available":
        return availabilityRank(a) - availabilityRank(b) || byRecent(a, b);
      case "priceLow":
      case "priceHigh": {
        const pa = comparablePrice(a);
        const pb = comparablePrice(b);
        if (pa == null && pb == null) return byRecent(a, b);
        if (pa == null) return 1;
        if (pb == null) return -1;
        return (sort === "priceLow" ? pa - pb : pb - pa) || byRecent(a, b);
      }
      case "sizeLarge":
      case "sizeSmall": {
        const sa = longSideCm(a.artwork);
        const sb = longSideCm(b.artwork);
        if (sa == null && sb == null) return byRecent(a, b);
        if (sa == null) return 1;
        if (sb == null) return -1;
        return (sort === "sizeLarge" ? sb - sa : sa - sb) || byRecent(a, b);
      }
      case "artist":
        return a.artistName.localeCompare(b.artistName, locale) || byRecent(a, b);
      case "recent":
      default:
        return byRecent(a, b);
    }
  };
  return [...items].sort((a, b) => {
    const offA = isOffMarket(likedStatus(a.artwork)) ? 1 : 0;
    const offB = isOffMarket(likedStatus(b.artwork)) ? 1 : 0;
    return offA - offB || cmp(a, b);
  });
}

export type LikedSummary = { all: number; available: number; onView: number; changed: number };

export function summarizeLikedWorks(items: ReadonlyArray<LikedWork>): LikedSummary {
  let available = 0;
  let onView = 0;
  let changed = 0;
  for (const item of items) {
    if (likedStatus(item.artwork) === "available") available += 1;
    if (item.exhibition) onView += 1;
    if (item.changes.length > 0) changed += 1;
  }
  return { all: items.length, available, onView, changed };
}

export type LikedOption = { key: string; label: string; count: number };

export function artistOptions(items: ReadonlyArray<LikedWork>, locale = "ko"): LikedOption[] {
  const map = new Map<string, LikedOption>();
  for (const item of items) {
    const row = map.get(item.artistKey) ?? { key: item.artistKey, label: item.artistName, count: 0 };
    row.count += 1;
    map.set(item.artistKey, row);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, locale));
}

/** Bands that actually hold a shown price, in band order. */
export function priceBandOptions(items: ReadonlyArray<LikedWork>): string[] {
  const seen = new Set<string>();
  for (const item of items) {
    const band = priceBand(priceView(item.artwork));
    if (band) seen.add(band);
  }
  const ordered = PRICE_BAND_ORDER.filter((key) => seen.has(key));
  const other = [...seen].filter((key) => !PRICE_BAND_ORDER.includes(key)).sort();
  return [...ordered, ...other];
}

export function kindOptions(items: ReadonlyArray<LikedWork>): string[] {
  const order = ["artwork", "print_edition", "art_goods", "collected"];
  const seen = new Set(items.map((item) => kindOf(item.artwork)));
  return order.filter((kind) => seen.has(kind));
}

export function sizeOptions(items: ReadonlyArray<LikedWork>): SizeBucket[] {
  const seen = new Set(items.map((item) => sizeBucket(item.artwork)));
  return SIZE_BUCKET_ORDER.filter((bucket) => seen.has(bucket));
}

export type LikedCta =
  | { kind: "ask" | "askAbout" | "continue" | "reply"; href: string }
  | { kind: "more"; href: string | null; count: number }
  | { kind: "none" };

/** One action per card. Asking goes through the detail form (`?ask=1`). */
export function likedCta(item: LikedWork, viewerId: string | null): LikedCta {
  const art = item.artwork;
  if (viewerId && art.artist_id === viewerId) return { kind: "none" };
  const status = likedStatus(art);
  if (isOffMarket(status)) {
    return { kind: "more", href: item.artistHref, count: item.moreAvailable };
  }
  const detail = `/artwork/${art.id}`;
  if (item.mine.inquiry === "replied") return { kind: "reply", href: detail };
  if (item.mine.inquiry === "open") return { kind: "continue", href: detail };
  if (status === "available") {
    return { kind: priceView(art).kind === "listed" ? "askAbout" : "ask", href: `${detail}?ask=1` };
  }
  return { kind: "askAbout", href: `${detail}?ask=1` };
}

export function latestChange(item: LikedWork): LikedChange | null {
  return item.changes[0] ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

const CHANGE_KINDS = new Set<LikedChangeKind>(["exhibition", "price_listed", "sold", "available_again", "off_market"]);

/** Parse one `list_my_liked_artworks` row's jsonb parts. */
export function readLikedMeta(row: {
  exhibition?: unknown;
  changes?: unknown;
  mine?: unknown;
}): { exhibition: LikedShow | null; changes: LikedChange[]; mine: LikedMine } {
  const ex = asRecord(row.exhibition);
  const phase = str(ex?.phase);
  const exhibition: LikedShow | null =
    ex && typeof ex.id === "string" && (phase === "ongoing" || phase === "upcoming")
      ? {
          id: ex.id,
          title: str(ex.title),
          title_ko: str(ex.title_ko),
          title_en: str(ex.title_en),
          start_date: str(ex.start_date),
          end_date: str(ex.end_date),
          phase,
        }
      : null;
  const changes: LikedChange[] = [];
  if (Array.isArray(row.changes)) {
    for (const raw of row.changes) {
      const c = asRecord(raw);
      const kind = str(c?.kind) as LikedChangeKind | null;
      const at = str(c?.at);
      if (!c || !kind || !CHANGE_KINDS.has(kind) || !at) continue;
      changes.push({
        kind,
        at,
        exhibition_id: str(c.exhibition_id),
        title: str(c.title),
        title_ko: str(c.title_ko),
        title_en: str(c.title_en),
      });
    }
    changes.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }
  const m = asRecord(row.mine);
  const inquiry = str(m?.inquiry);
  return {
    exhibition,
    changes,
    mine: {
      inquiry: inquiry === "open" || inquiry === "replied" ? inquiry : null,
      in_board: m?.in_board === true,
    },
  };
}

/** Profile link with the likes tab open. */
export const LIKES_TAB_PARAM = "likes";

export function likesTabHref(profileHref: string): string {
  return `${profileHref}?tab=${LIKES_TAB_PARAM}`;
}

export function isLikesTabPath(path: string): boolean {
  const [pathname, search = ""] = path.split("?");
  if (!/^\/u\/[^/]+/.test(pathname ?? "")) return false;
  return new URLSearchParams(search.split("#")[0]).get("tab") === LIKES_TAB_PARAM;
}
