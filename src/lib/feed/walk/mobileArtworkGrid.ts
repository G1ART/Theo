/**
 * Mobile main-feed artwork frame.
 *
 * The walk lays artwork tiles in one column below Tailwind `sm` (40rem /
 * 640px) and three columns from there up. These rules apply only below
 * that breakpoint. Desktop (`sm` and wider) keeps the three-column gap.
 *
 * Screen inset is one rule. `PageShell` already pads the feed with `px-4`
 * (1rem) below `sm`. The artwork section cancels that padding down to the
 * target inset. It does not add a second inset inside the page padding.
 *   350px < width < 640px → 12px from the viewport, 14px inside the frame
 *   width ≤ 350px         → 10px from the viewport and 10px inside the frame
 */

export const FEED_WALK_ONE_COLUMN_BELOW_PX = 640;

export const FEED_ARTWORK_SCREEN_INSET_PX = 12;
export const FEED_ARTWORK_GRID_PADDING_PX = 14;
export const FEED_ARTWORK_GRID_GAP_PX = 12;
export const FEED_ARTWORK_MOBILE_COLUMNS = 2;

export const FEED_ARTWORK_TIGHT_MAX_PX = 350;
export const FEED_ARTWORK_TIGHT_INSET_PX = 10;

/** `PageShell` horizontal token `px-4` below `sm`. */
export const FEED_PAGE_MOBILE_PADDING = "1rem";

export const FEED_ARTWORK_DESKTOP_COLUMNS = 3;
/** Existing `sm:gap-4`. */
export const FEED_ARTWORK_DESKTOP_GAP_PX = 16;

export const WALK_ARTWORK_MODULE_TYPES = [
  "artwork_gallery",
  "related_artwork",
  "curators_view",
] as const;

export type WalkArtworkModuleType = (typeof WALK_ARTWORK_MODULE_TYPES)[number];

export function isWalkArtworkModule(type: string): type is WalkArtworkModuleType {
  return (WALK_ARTWORK_MODULE_TYPES as readonly string[]).includes(type);
}

export type ArtworkFrame = {
  mobile: boolean;
  columns: typeof FEED_ARTWORK_MOBILE_COLUMNS | typeof FEED_ARTWORK_DESKTOP_COLUMNS;
  gapPx: typeof FEED_ARTWORK_GRID_GAP_PX | typeof FEED_ARTWORK_DESKTOP_GAP_PX;
  /** Null when the page padding is left alone (desktop). */
  screenInsetPx: typeof FEED_ARTWORK_SCREEN_INSET_PX | typeof FEED_ARTWORK_TIGHT_INSET_PX | null;
  /** Null when the section keeps `p-4` (desktop). */
  paddingPx: typeof FEED_ARTWORK_GRID_PADDING_PX | typeof FEED_ARTWORK_TIGHT_INSET_PX | null;
  /** Medium line and the module recommendation sentence. */
  showSecondaryCopy: boolean;
};

export function artworkFrameForViewport(width: number): ArtworkFrame {
  if (width >= FEED_WALK_ONE_COLUMN_BELOW_PX) {
    return {
      mobile: false,
      columns: FEED_ARTWORK_DESKTOP_COLUMNS,
      gapPx: FEED_ARTWORK_DESKTOP_GAP_PX,
      screenInsetPx: null,
      paddingPx: null,
      showSecondaryCopy: true,
    };
  }
  const tight = width <= FEED_ARTWORK_TIGHT_MAX_PX;
  return {
    mobile: true,
    columns: FEED_ARTWORK_MOBILE_COLUMNS,
    gapPx: FEED_ARTWORK_GRID_GAP_PX,
    screenInsetPx: tight ? FEED_ARTWORK_TIGHT_INSET_PX : FEED_ARTWORK_SCREEN_INSET_PX,
    paddingPx: tight ? FEED_ARTWORK_TIGHT_INSET_PX : FEED_ARTWORK_GRID_PADDING_PX,
    showSecondaryCopy: !tight,
  };
}

/** Margin that places the frame's border box at `screenInsetPx` inside a `1rem` page pad. */
export function artworkScreenInsetPull(width: number): string | null {
  const inset = artworkFrameForViewport(width).screenInsetPx;
  if (inset == null) return null;
  return `calc(${inset}px-${FEED_PAGE_MOBILE_PADDING})`;
}

/**
 * Artwork module shell. Border and radius match the other walk modules.
 * Padding and the viewport inset change only below `sm`, and the 10px
 * band does not overlap the 12px / 14px band.
 *
 * Tailwind v4 `max-[350px]` is `width < 350px`, so 350 itself would keep
 * the wider mobile padding. The tight band uses `max-width: 350px`, which
 * includes 350.
 */
export const WALK_ARTWORK_SECTION_CLASS =
  "mb-4 rounded-lg border border-zinc-200 bg-white p-4 min-[351px]:max-sm:[margin-inline:calc(12px-1rem)] min-[351px]:max-sm:p-[14px] [@media(max-width:350px)]:[margin-inline:calc(10px-1rem)] [@media(max-width:350px)]:p-[10px]";

/** Two equal columns below `sm`; the existing three-column gap from `sm` up. */
export const WALK_ARTWORK_GRID_CLASS =
  "grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-[12px] sm:grid-cols-3 sm:gap-4 [&>*]:min-w-0";

/** Hides medium and the recommendation sentence at `FEED_ARTWORK_TIGHT_MAX_PX` and below. */
export const WALK_ARTWORK_OMIT_SECONDARY_COPY_CLASS = "[@media(max-width:350px)]:hidden";

export const WALK_ARTWORK_IMAGE_SIZES = "(max-width: 639px) 42vw, 240px";
