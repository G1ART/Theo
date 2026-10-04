import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

(async () => {
const {
  canDownloadArtwork,
  canDownloadExhibitionPack,
  exhibitionIdFromPackField,
  exhibitionPackFieldKey,
} = await import("../src/lib/download/access");
const { pickDisplayStoragePath, isCameraOriginalPath } = await import(
  "../src/lib/download/displayPath"
);
const { buildCaption } = await import("../src/lib/download/caption");
const { parseDownloadPreset, DEFAULT_DOWNLOAD_PRESET } = await import(
  "../src/lib/download/preset"
);
const { portfolioTemplateReady } = await import("../src/lib/download/portfolio");

const artist = "11111111-1111-4111-8111-111111111111";
const gallery = "22222222-2222-4222-8222-222222222222";
const curator = "33333333-3333-4333-8333-333333333333";
const stranger = "44444444-4444-4444-8444-444444444444";
const delegate = "55555555-5555-4555-8555-555555555555";

const publishedWork = {
  artistId: artist,
  published: true,
  exhibitionPosterIds: [gallery, curator],
};

assert.equal(
  canDownloadArtwork(
    { userId: stranger, actingAsProfileId: null, accountWriterFor: new Set() },
    publishedWork,
  ),
  false,
  "unrelated user cannot download a published work",
);

assert.equal(
  canDownloadArtwork(
    { userId: artist, actingAsProfileId: null, accountWriterFor: new Set() },
    publishedWork,
  ),
  true,
  "the artist can download",
);

assert.equal(
  canDownloadArtwork(
    { userId: artist, actingAsProfileId: null, accountWriterFor: new Set() },
    { ...publishedWork, published: false },
  ),
  false,
  "a draft stays off the download even for the artist",
);

assert.equal(
  canDownloadArtwork(
    { userId: gallery, actingAsProfileId: null, accountWriterFor: new Set() },
    publishedWork,
  ),
  true,
  "the exhibition gallery can download",
);

assert.equal(
  canDownloadArtwork(
    { userId: curator, actingAsProfileId: null, accountWriterFor: new Set() },
    publishedWork,
  ),
  true,
  "the exhibition curator can download",
);

assert.equal(
  canDownloadArtwork(
    {
      userId: delegate,
      actingAsProfileId: artist,
      accountWriterFor: new Set([artist]),
    },
    publishedWork,
  ),
  true,
  "an account delegate acting as the artist can download",
);

assert.equal(
  canDownloadArtwork(
    {
      userId: delegate,
      actingAsProfileId: artist,
      accountWriterFor: new Set(),
    },
    publishedWork,
  ),
  false,
  "acting-as without an account writer grant is denied",
);

assert.equal(
  canDownloadArtwork(
    {
      userId: delegate,
      actingAsProfileId: gallery,
      accountWriterFor: new Set([gallery]),
    },
    publishedWork,
  ),
  false,
  "acting as the gallery does not unlock a single work",
);

const pack = {
  hostProfileId: gallery,
  curatorId: curator,
  participatingArtistIds: [artist],
  hasPackGrant: false,
};

assert.equal(
  canDownloadExhibitionPack(
    { userId: stranger, actingAsProfileId: null, accountWriterFor: new Set() },
    pack,
  ),
  false,
  "an unrelated account cannot download the exhibition pack",
);

assert.equal(
  canDownloadExhibitionPack(
    { userId: artist, actingAsProfileId: null, accountWriterFor: new Set() },
    pack,
  ),
  true,
);

assert.equal(
  canDownloadExhibitionPack(
    { userId: gallery, actingAsProfileId: null, accountWriterFor: new Set() },
    pack,
  ),
  true,
);

assert.equal(
  canDownloadExhibitionPack(
    { userId: curator, actingAsProfileId: null, accountWriterFor: new Set() },
    pack,
  ),
  true,
);

assert.equal(
  canDownloadExhibitionPack(
    {
      userId: delegate,
      actingAsProfileId: artist,
      accountWriterFor: new Set([artist]),
    },
    pack,
  ),
  true,
  "acting as a participating artist can download the pack",
);

assert.equal(
  canDownloadExhibitionPack(
    { userId: stranger, actingAsProfileId: null, accountWriterFor: new Set() },
    { ...pack, hasPackGrant: true },
  ),
  true,
  "an approved pack request can download",
);

assert.equal(portfolioTemplateReady(), false);

const caption = buildCaption({
  title: "Untitled study",
  year: null,
  medium: "  oil  ",
  size: "",
  artistName: "Mina",
  handle: "@mina",
  role: null,
});
assert.equal(caption.title, "Untitled study");
assert.equal(caption.artistName, "Mina");
assert.deepEqual(caption.lines, ["oil", "@mina"]);
assert.equal(caption.footer, "Theo");

assert.deepEqual(parseDownloadPreset(null), DEFAULT_DOWNLOAD_PRESET);
assert.equal(parseDownloadPreset({ image: "jpeg", several: "pdf" }).image, "jpeg");
assert.equal(parseDownloadPreset({ image: "nope", several: "zip" }).image, "png");

const images = [
  {
    storage_path: "user/original/camera.jpg",
    original_storage_path: "user/original/camera.jpg",
    sort_order: 0,
  },
  {
    storage_path: "user/display.webp",
    original_storage_path: "user/original/camera.jpg",
    sort_order: 1,
  },
];
assert.equal(pickDisplayStoragePath(images), "user/display.webp");
assert.equal(
  pickDisplayStoragePath([
    {
      storage_path: "user/display.webp",
      original_storage_path: "user/original/only-backup.jpg",
      sort_order: 0,
    },
  ]),
  "user/display.webp",
);
assert.equal(isCameraOriginalPath("user/original/camera.jpg"), true);
assert.equal(
  pickDisplayStoragePath([
    { storage_path: "user/original/camera.jpg", original_storage_path: "user/original/camera.jpg" },
  ]),
  null,
);

const exhibitionId = "66666666-6666-4666-8666-666666666666";
assert.equal(exhibitionIdFromPackField(exhibitionPackFieldKey(exhibitionId)), exhibitionId);

const route = readFileSync("src/app/api/download/authorize/route.ts", "utf8");
assert.equal(route.includes("original_storage_path"), false);

for (const file of [
  "src/app/upload/page.tsx",
  "src/app/upload/single/page.tsx",
  "src/app/upload/bulk/page.tsx",
  "src/components/upload/BulkDraftCard.tsx",
]) {
  const text = readFileSync(file, "utf8");
  assert.equal(text.includes("ArtworkDownloadButton"), false, file);
  assert.equal(text.includes("download.action"), false, file);
}

const detail = readFileSync("src/app/artwork/[id]/page.tsx", "utf8");
assert.equal(detail.includes("ArtworkDownloadButton"), true);
const settings = readFileSync("src/app/settings/page.tsx", "utf8");
assert.equal(settings.includes("DownloadFormatPreference"), true);

console.log("download-access: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
