// Mobile main-feed artwork frame. Exhibition, artist highlight, and the
// network stay on their existing layout. Desktop (sm / 640px and up) stays
// three columns.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FEED_ARTWORK_DESKTOP_COLUMNS,
  FEED_ARTWORK_DESKTOP_GAP_PX,
  FEED_ARTWORK_GRID_GAP_PX,
  FEED_ARTWORK_GRID_PADDING_PX,
  FEED_ARTWORK_MOBILE_COLUMNS,
  FEED_ARTWORK_SCREEN_INSET_PX,
  FEED_ARTWORK_TIGHT_INSET_PX,
  FEED_ARTWORK_TIGHT_MAX_PX,
  FEED_BLOCK_DESKTOP_COUNT,
  FEED_BLOCK_MOBILE_COUNT,
  FEED_NETWORK_COUNT,
  FEED_PAGE_MOBILE_PADDING,
  FEED_WALK_ONE_COLUMN_BELOW_PX,
  WALK_ARTWORK_DESKTOP_TRIM_CLASS,
  WALK_ARTWORK_GRID_CLASS,
  networkDesktopTrimClass,
  WALK_ARTWORK_OMIT_SECONDARY_COPY_CLASS,
  WALK_ARTWORK_SECTION_CLASS,
  artworkFrameForViewport,
  artworkScreenInsetPull,
  isWalkArtworkModule,
  walkBlockShownCount,
  walkGridDesktopCount,
} from "../src/lib/feed/walk/mobileArtworkGrid";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing ${start}`);
  assert.ok(to > from, `missing ${end} after ${start}`);
  return source.slice(from, to);
}

assert.equal(FEED_WALK_ONE_COLUMN_BELOW_PX, 640);
assert.equal(FEED_ARTWORK_MOBILE_COLUMNS, 2);
assert.equal(FEED_ARTWORK_GRID_GAP_PX, 12);
assert.equal(FEED_ARTWORK_SCREEN_INSET_PX, 12);
assert.equal(FEED_ARTWORK_GRID_PADDING_PX, 14);
assert.equal(FEED_ARTWORK_TIGHT_MAX_PX, 350);
assert.equal(FEED_ARTWORK_TIGHT_INSET_PX, 10);
assert.equal(FEED_PAGE_MOBILE_PADDING, "1rem");
assert.equal(FEED_ARTWORK_DESKTOP_COLUMNS, 3);
assert.equal(FEED_ARTWORK_DESKTOP_GAP_PX, 16);
assert.equal(FEED_BLOCK_DESKTOP_COUNT, 3);
assert.equal(FEED_BLOCK_MOBILE_COUNT, 4);
assert.equal(FEED_NETWORK_COUNT, 4);
assert.equal(WALK_ARTWORK_DESKTOP_TRIM_CLASS, "sm:[&>:nth-child(n+4)]:hidden");
assert.equal(networkDesktopTrimClass(3, 4), "sm:[&>:nth-child(n+4)]:hidden");
assert.equal(networkDesktopTrimClass(4, 4), "");
assert.equal(networkDesktopTrimClass(undefined, 4), "");
assert.equal(networkDesktopTrimClass(2, 2), "");
assert.equal(walkBlockShownCount(390, 4, 3), 4);
assert.equal(walkBlockShownCount(1440, 4, 3), 3);
assert.equal(walkBlockShownCount(1440, 4, 4), 4);

for (const width of [320, 350, 390, 639]) {
  assert.equal(walkBlockShownCount(width, 4, 3), 4, String(width));
  assert.equal(walkBlockShownCount(width, 3, 3), 3, String(width));
  assert.equal(walkBlockShownCount(width, 2, 3), 2, String(width));
  assert.equal(walkBlockShownCount(width, 1, 3), 1, String(width));
  assert.equal(walkBlockShownCount(width, 0, 3), 0, String(width));
  assert.equal(walkBlockShownCount(width, 24, null), 24, String(width));
}
for (const width of [640, 768, 1024, 1440]) {
  assert.equal(walkBlockShownCount(width, 4, 3), 3, String(width));
  assert.equal(walkBlockShownCount(width, 3, 3), 3, String(width));
  assert.equal(walkBlockShownCount(width, 2, 3), 2, String(width));
  assert.equal(walkBlockShownCount(width, 24, null), 24, String(width));
  assert.equal(walkBlockShownCount(width, 4, null), 4, String(width));
}
assert.equal(walkGridDesktopCount({ type: "artwork_gallery", desktopCount: 3 }), 3);
assert.equal(walkGridDesktopCount({ type: "curators_view", desktopCount: 3 }), 3);
assert.equal(walkGridDesktopCount({ type: "related_artwork", desktopCount: 3 }), 3);
assert.equal(walkGridDesktopCount({ type: "artwork_gallery" }), null);
assert.equal(walkGridDesktopCount({ type: "related_network", desktopCount: 3 }), null);
assert.equal(walkGridDesktopCount({ type: "exhibition_card" }), null);
assert.equal(walkGridDesktopCount({ type: "artist_card" }), null);

assert.equal(isWalkArtworkModule("artwork_gallery"), true);
assert.equal(isWalkArtworkModule("related_artwork"), true);
assert.equal(isWalkArtworkModule("curators_view"), true);
assert.equal(isWalkArtworkModule("exhibition_card"), false);
assert.equal(isWalkArtworkModule("artist_card"), false);
assert.equal(isWalkArtworkModule("related_network"), false);

for (const width of [320, 350]) {
  const frame = artworkFrameForViewport(width);
  assert.equal(frame.mobile, true, String(width));
  assert.equal(frame.columns, 2, String(width));
  assert.equal(frame.gapPx, 12, String(width));
  assert.equal(frame.screenInsetPx, 10, String(width));
  assert.equal(frame.paddingPx, 10, String(width));
  assert.equal(frame.showSecondaryCopy, false, String(width));
  assert.equal(artworkScreenInsetPull(width), "calc(10px-1rem)", String(width));
}

for (const width of [351, 390, 430, 639]) {
  const frame = artworkFrameForViewport(width);
  assert.equal(frame.mobile, true, String(width));
  assert.equal(frame.columns, 2, String(width));
  assert.equal(frame.gapPx, 12, String(width));
  assert.equal(frame.screenInsetPx, 12, String(width));
  assert.equal(frame.paddingPx, 14, String(width));
  assert.equal(frame.showSecondaryCopy, true, String(width));
  assert.equal(artworkScreenInsetPull(width), "calc(12px-1rem)", String(width));
}

for (const width of [640, 768, 1024, 1440]) {
  const frame = artworkFrameForViewport(width);
  assert.equal(frame.mobile, false, String(width));
  assert.equal(frame.columns, 3, String(width));
  assert.equal(frame.gapPx, 16, String(width));
  assert.equal(frame.screenInsetPx, null, String(width));
  assert.equal(frame.paddingPx, null, String(width));
  assert.equal(frame.showSecondaryCopy, true, String(width));
  assert.equal(artworkScreenInsetPull(width), null, String(width));
}

assert.ok(WALK_ARTWORK_SECTION_CLASS.startsWith("mb-4 rounded-lg border border-zinc-200 bg-white p-4"));
assert.ok(
  WALK_ARTWORK_SECTION_CLASS.includes(
    `min-[${FEED_ARTWORK_TIGHT_MAX_PX + 1}px]:max-sm:[margin-inline:${artworkScreenInsetPull(390)}]`
  )
);
assert.ok(
  WALK_ARTWORK_SECTION_CLASS.includes(`min-[${FEED_ARTWORK_TIGHT_MAX_PX + 1}px]:max-sm:p-[${FEED_ARTWORK_GRID_PADDING_PX}px]`)
);
const tightMedia = `[@media(max-width:${FEED_ARTWORK_TIGHT_MAX_PX}px)]`;
assert.ok(WALK_ARTWORK_SECTION_CLASS.includes(`${tightMedia}:[margin-inline:${artworkScreenInsetPull(350)}]`));
assert.ok(WALK_ARTWORK_SECTION_CLASS.includes(`${tightMedia}:p-[${FEED_ARTWORK_TIGHT_INSET_PX}px]`));
assert.equal(WALK_ARTWORK_SECTION_CLASS.includes("max-[350px]"), false);
const sectionTokens = WALK_ARTWORK_SECTION_CLASS.split(/\s+/);
assert.equal(sectionTokens.includes("max-sm:[margin-inline:calc(12px-1rem)]"), false);
assert.ok(sectionTokens.includes(`min-[${FEED_ARTWORK_TIGHT_MAX_PX + 1}px]:max-sm:[margin-inline:calc(12px-1rem)]`));
assert.ok(sectionTokens.includes(`${tightMedia}:[margin-inline:calc(10px-1rem)]`));

assert.ok(WALK_ARTWORK_GRID_CLASS.includes("grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"));
assert.ok(WALK_ARTWORK_GRID_CLASS.includes(`gap-[${FEED_ARTWORK_GRID_GAP_PX}px]`));
assert.ok(WALK_ARTWORK_GRID_CLASS.includes("sm:grid-cols-3"));
assert.ok(WALK_ARTWORK_GRID_CLASS.includes("sm:gap-4"));
assert.ok(WALK_ARTWORK_GRID_CLASS.includes("[&>*]:min-w-0"));
assert.equal(WALK_ARTWORK_GRID_CLASS.includes("grid-cols-1"), false);
assert.equal(WALK_ARTWORK_GRID_CLASS.includes("md:"), false);

assert.equal(
  WALK_ARTWORK_OMIT_SECONDARY_COPY_CLASS,
  `[@media(max-width:${FEED_ARTWORK_TIGHT_MAX_PX}px)]:hidden`
);

const shell = read("src/components/ds/PageShell.tsx");
assert.ok(shell.includes('const HORIZONTAL = "px-4 sm:px-6"'));

const walk = read("src/components/feed/walk/WalkModules.tsx");
assert.equal(walk.includes("grid-cols-1 gap-4 sm:grid-cols-3"), false);

const view = between(walk, "export function WalkModuleView", "function ModuleHeading");
assert.ok(view.includes("isWalkArtworkModule(shown.type)"));
assert.ok(view.includes("? WALK_ARTWORK_SECTION_CLASS"));
assert.ok(view.includes(': "mb-4 rounded-lg border border-zinc-200 bg-white p-4"'));
assert.ok(view.includes("omitSecondaryCopy={artworkModule}"));

const heading = between(walk, "function ModuleHeading", "function ArtistCard");
const h2 = heading.slice(heading.indexOf("<h2"), heading.indexOf("</h2>"));
assert.equal(h2.includes("OMIT"), false);
assert.ok(heading.includes("omitSecondaryCopy ? WALK_ARTWORK_OMIT_SECONDARY_COPY_CLASS"));
assert.ok(heading.includes('className="truncate"'));

const artist = between(walk, "function ArtistCard", "function WorkTrio");
assert.equal(artist.includes("WALK_ARTWORK"), false);
assert.ok(artist.includes('className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-[minmax(220px,260px)_minmax(0,1fr)]"'));
assert.ok(artist.includes('className="mt-auto grid grid-cols-3 gap-3"'));
assert.ok(artist.includes("works.slice(0, 3)"));

const trio = between(walk, "function WorkTrio", "function GalleryTile");
assert.ok(trio.includes("WALK_ARTWORK_GRID_CLASS"));
assert.ok(trio.includes("WALK_ARTWORK_DESKTOP_TRIM_CLASS"));
assert.ok(trio.includes("FEED_BLOCK_MOBILE_COUNT"));
assert.equal(trio.includes("works.slice(0, 3)"), false);
assert.equal(trio.includes("grid-cols-1"), false);

const gallery = between(walk, "function GalleryTile", "function CreditTile");
assert.equal(gallery.split("WALK_ARTWORK_OMIT_SECONDARY_COPY_CLASS").length - 1, 1);
assert.ok(gallery.includes('className="truncate font-medium"'));
assert.ok(gallery.includes('className="truncate">{caption}'));
assert.ok(gallery.includes("work.medium"));

const credit = between(walk, "function CreditTile", "function ExhibitionCard");
assert.equal(credit.includes("WALK_ARTWORK_OMIT"), false);
assert.ok(credit.includes('className="min-w-0 truncate font-medium"'));

const exhibition = between(walk, "function ExhibitionCard", "function ExhibitionWorkThumbs");
assert.equal(exhibition.includes("WALK_ARTWORK"), false);
assert.ok(
  exhibition.includes(
    'className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(140px,200px)_minmax(0,1fr)]"'
  )
);
assert.ok(exhibition.includes(".slice(0, 6)"));
assert.equal(exhibition.includes("FEED_BLOCK_MOBILE_COUNT"), false);

const network = between(walk, "function Network", "function CreditPill");
assert.equal(network.includes("WALK_ARTWORK"), false);
assert.ok(network.includes("grid-cols-2 gap-3 sm:grid-cols-4"));
assert.ok(network.includes("people.slice(0, FEED_NETWORK_COUNT)"));
assert.ok(network.includes("networkDesktopTrimClass"));
assert.equal(network.includes("people.slice(0, 3)"), false);

const square = between(walk, "function SquareImage", "function PersonName");
assert.ok(square.includes("aspect-square"));
assert.ok(square.includes('className="object-contain"'));
assert.equal(square.includes("object-cover"), false);
assert.ok(square.includes("<ArtworkSizeCapsule label={sizeLabel} />"));

const capsule = read("src/components/artwork/ArtworkSizeCapsule.tsx");
assert.ok(capsule.includes("pointer-events-none"));

for (const file of [
  "src/components/search/SearchArtworkCard.tsx",
  "src/components/ArtworkCard.tsx",
  "src/components/likes/LikedArtworkCard.tsx",
  "src/components/ExploreTaxonomyContent.tsx",
  "src/components/feed/LivingSalonGrid.tsx",
]) {
  assert.equal(read(file).includes("mobileArtworkGrid"), false, file);
}

console.log("feed-mobile-artwork-grid.test.ts ok");
