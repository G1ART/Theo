// Profile and studio artwork grids reuse the main-feed size capsule.
// Missing size, or a size whose unit cannot be known, stays hidden.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtworkSizeCapsule } from "../src/components/artwork/ArtworkSizeCapsule";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const capsuleClass =
  "pointer-events-none absolute bottom-1.5 left-1.5 max-w-[calc(100%-0.75rem)] truncate whitespace-nowrap rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium leading-none tracking-tight text-zinc-800 shadow-sm backdrop-blur-sm sm:bottom-2 sm:left-2 sm:text-[11px]";

const shown = renderToStaticMarkup(
  createElement(ArtworkSizeCapsule, { label: "53 × 45.5 cm" }),
);
assert.match(shown, /53 × 45\.5 cm/);
assert.ok(shown.includes(capsuleClass), "capsule keeps the feed pill classes");
assert.equal(renderToStaticMarkup(createElement(ArtworkSizeCapsule, { label: null })), "");
assert.equal(renderToStaticMarkup(createElement(ArtworkSizeCapsule, { label: "" })), "");

const capsuleSrc = read("src/components/artwork/ArtworkSizeCapsule.tsx");
assert.ok(capsuleSrc.includes(capsuleClass));

const card = read("src/components/ArtworkCard.tsx");
assert.ok(card.includes("formatArtworkSizeOverlay"));
assert.ok(card.includes("<ArtworkSizeCapsule label={sizeOverlay} />"));
assert.ok(
  card.includes("imageUrl\n    ? formatArtworkSizeOverlay"),
  "a card with no image does not invent a capsule",
);

const walk = read("src/components/feed/walk/WalkModules.tsx");
assert.ok(walk.includes('import { ArtworkSizeCapsule } from "@/components/artwork/ArtworkSizeCapsule"'));
assert.ok(walk.includes("<ArtworkSizeCapsule label={sizeLabel} />"));
assert.ok(walk.includes("formatArtworkSizeOverlay(work.size, locale, work.sizeUnit, pref)"));
assert.equal(walk.includes(capsuleClass), false, "feed file no longer inlines the pill");

const profile = read("src/components/UserProfileContent.tsx");
const studio = read("src/components/studio/StudioPortfolioPanel.tsx");
assert.ok(profile.includes("ArtworkCard"));
assert.ok(studio.includes("ArtworkCard"));
assert.equal(profile.includes("ArtworkSizeCapsule"), false);
assert.equal(studio.includes("ArtworkSizeCapsule"), false);

const artworks = read("src/lib/supabase/artworks.ts");
const byIds = artworks.slice(artworks.indexOf("export async function getArtworksByIds"));
const selectEnd = byIds.indexOf(".in(\"id\", ids)");
const select = byIds.slice(0, selectEnd);
for (const column of ["size,", "size_unit,", "width_cm,", "height_cm,"]) {
  assert.ok(select.includes(column), `getArtworksByIds select includes ${column}`);
}

console.log("artwork-size-capsule.test.ts ok");
