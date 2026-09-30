import assert from "node:assert/strict";
import {
  artworkDuplicateKey,
  isDuplicateInProfileLibrary,
  libraryPageCursor,
  mergeLibraryRows,
  workBelongsInProfileLibrary,
} from "../src/lib/artworks/libraryInventory";
import { primaryArtworkImage } from "../src/lib/artworks/primaryImage";
import { followProfileSearchOr } from "../src/lib/network/followSearch";

const gallery = "gallery-1";
const artist = "artist-2";

assert.equal(
  workBelongsInProfileLibrary({
    profileId: gallery,
    artistId: gallery,
    claims: [],
  }),
  true,
  "external artists who are not onboarded stay because artist_id is still the gallery",
);

assert.equal(
  workBelongsInProfileLibrary({
    profileId: gallery,
    artistId: artist,
    claims: [{ subjectProfileId: gallery, status: "confirmed" }],
  }),
  true,
  "a confirmed claim keeps the work in the gallery library after artist_id moves",
);

assert.equal(
  workBelongsInProfileLibrary({
    profileId: gallery,
    artistId: artist,
    claims: [{ subjectProfileId: gallery, status: null }],
  }),
  true,
  "legacy claims with a null status count as confirmed",
);

assert.equal(
  workBelongsInProfileLibrary({
    profileId: gallery,
    artistId: artist,
    claims: [{ subjectProfileId: gallery, status: "pending" }],
  }),
  false,
  "a pending claim is not inventory",
);

assert.equal(
  workBelongsInProfileLibrary({
    profileId: gallery,
    artistId: artist,
    claims: [{ subjectProfileId: "someone-else", status: "confirmed" }],
  }),
  false,
);

const page = libraryPageCursor(
  [
    { id: "a", created_at: "2026-01-03" },
    { id: "b", created_at: "2026-01-02" },
    { id: "c", created_at: "2026-01-01" },
  ],
  2,
  false,
);
assert.deepEqual(page.page.map((row) => row.id), ["a", "b"]);
assert.equal(page.nextCursor?.id, "b");
assert.notEqual(page.nextCursor?.id, "c");

const byArtistOrder = mergeLibraryRows(
  [
    { id: "late", created_at: "2026-01-01", artist_sort_order: null },
    { id: "first", created_at: "2026-01-02", artist_sort_order: 1 },
    { id: "second", created_at: "2026-01-03", artist_sort_order: 2 },
  ],
  "artist_sort",
);
assert.deepEqual(
  byArtistOrder.map((row) => row.id),
  ["first", "second", "late"],
);

const primary = primaryArtworkImage([
  { storage_path: "later.jpg", sort_order: 2 },
  { storage_path: "cover.jpg", sort_order: 0 },
  { storage_path: "middle.jpg", sort_order: 1 },
]);
assert.equal(primary?.storage_path, "cover.jpg");

assert.equal(followProfileSearchOr("  "), null);
assert.equal(followProfileSearchOr("%,()"), null);
const filter = followProfileSearchOr("민수");
assert.ok(filter?.includes('username.ilike."%민수%"'));
assert.ok(filter?.includes("display_name_ko.ilike."));
assert.equal(filter?.includes(",()"), false);

assert.equal(
  isDuplicateInProfileLibrary({
    existingArtistId: "other-person",
    targetProfileId: gallery,
    existingTitle: "Red",
    existingYear: 2020,
    rowTitle: "Red",
    rowYear: "2020",
  }),
  false,
);
assert.equal(
  isDuplicateInProfileLibrary({
    existingArtistId: gallery,
    targetProfileId: gallery,
    existingTitle: "Red",
    existingYear: 2020,
    rowTitle: " red ",
    rowYear: "2020",
  }),
  true,
);
assert.equal(artworkDuplicateKey("Red", 2020), "red|2020");

console.log("studio-inventory.test.ts ok");
