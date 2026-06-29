// QA 2026-06-29 — 외부(미온보딩) 작가 작품의 작가명이 게시물 단위(작품 상세,
// 전시, 룸/숏리스트)에서 업로더(갤러리)명으로 표시되던 버그 + 외부 작가명
// 링크가 업로더 계정으로 곧장 가던 버그. 그리고 전시 페이지에서 서로 다른
// 외부 작가 작품이 한 작가로 묶이던 그룹핑 버그.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

// 1) SQL helper + RPC 교체 -------------------------------------------------
const migrationsDir = join(root, "supabase", "migrations");
const mig = readdirSync(migrationsDir)
  .filter((n) => n.includes("external_artist_name_everywhere"))
  .sort()
  .pop();
assert.ok(mig, "expected external_artist_name_everywhere migration to exist");
const sql = readFileSync(join(migrationsDir, mig!), "utf8");

assert.match(
  sql,
  /create or replace function public\.artwork_display_artist_name/,
  "helper function must be defined",
);
// resolves external artist name, prefers CREATED, falls back to uploader name.
assert.match(sql, /external_artists ea on ea\.id = c\.external_artist_id/);
assert.match(sql, /claim_type = 'CREATED'/);
assert.match(sql, /coalesce\(/);
assert.match(sql, /p_fallback/);
// both room + shortlist RPCs must route artist name through the helper.
assert.match(
  sql,
  /'artwork_artist_name', public\.artwork_display_artist_name\(a\.id, prof\.display_name\)/,
  "room RPC must use the helper for artwork_artist_name",
);
assert.match(
  sql,
  /public\.artwork_display_artist_name\(a\.id, prof\.display_name\) as artwork_artist_name/,
  "shortlist RPC must use the helper for artwork_artist_name",
);

// 2) artworks.ts 공통 헬퍼 ------------------------------------------------
const artworksSrc = read("src/lib/supabase/artworks.ts");
assert.match(artworksSrc, /export function getExternalArtistClaim/);
assert.match(artworksSrc, /export function isExternalArtistArtwork/);
assert.match(artworksSrc, /export function getArtworkArtistGroupKey/);
// group key for external artists must prefer the STABLE external_artist_id.
// After the 2026-06-30 dedupe migration there is one external_artists row per
// invited artist, so the id collapses one artist's works into a single section
// while genuine homonyms (distinct rows) split. Name is only a blank-id fallback.
assert.match(artworksSrc, /ext:\$\{externalClaim\.external_artist_id\}/);
assert.match(artworksSrc, /extname:\$\{name\}/);

// 3) 전시 페이지 그룹핑 키 교체 ------------------------------------------
for (const rel of [
  "src/app/e/[id]/page.tsx",
  "src/app/my/exhibitions/[id]/page.tsx",
]) {
  const src = read(rel);
  assert.match(
    src,
    /getArtworkArtistGroupKey\(/,
    `${rel} must group by getArtworkArtistGroupKey`,
  );
  // The old artist_id-only key must be gone from the grouping loop.
  assert.doesNotMatch(
    src,
    /const key = a\.artist_id \|\| `ext:\$\{label/,
    `${rel} must not keep the artist_id-only group key`,
  );
  assert.doesNotMatch(
    src,
    /const key = art\.artist_id \|\| `ext:\$\{label/,
    `${rel} must not keep the artist_id-only group key`,
  );
}

// 4) 피드/상세가 공통 ArtworkArtistName 사용 ----------------------------
const feedSrc = read("src/components/FeedArtworkCard.tsx");
assert.match(feedSrc, /import \{ ArtworkArtistName \}/);
assert.match(feedSrc, /<ArtworkArtistName/);
// feed must no longer hardcode a /u/ link straight off the uploader profile
// for the artist name.
assert.doesNotMatch(
  feedSrc,
  /href=\{`\/u\/\$\{artistUsername\}`\}/,
  "feed must route artist name link through ArtworkArtistName",
);

const detailSrc = read("src/app/artwork/[id]/page.tsx");
assert.match(detailSrc, /isExternalArtistArtwork/);
assert.match(detailSrc, /<ArtworkArtistName/);

// 5) ArtworkArtistName: confirm-then-redirect for external artists --------
const comp = read("src/components/artwork/ArtworkArtistName.tsx");
assert.match(comp, /ConfirmActionDialog/);
assert.match(comp, /artwork\.externalArtistRedirect\.title/);
assert.match(comp, /router\.push\(`\/u\/\$\{uploaderHandle\}`\)/);
// onboarded artists still get a direct link.
assert.match(comp, /href=\{`\/u\/\$\{onboardedHandle\}`\}/);

// 6) i18n 키 (EN + KO) ---------------------------------------------------
const messages = read("src/lib/i18n/messages.ts");
for (const key of [
  "artwork.externalArtistRedirect.title",
  "artwork.externalArtistRedirect.body",
  "artwork.externalArtistRedirect.confirm",
]) {
  const count = messages.split(`"${key}"`).length - 1;
  assert.ok(count >= 2, `i18n key ${key} must exist in both EN and KO`);
}

console.log("external-artist-name-everywhere.test.ts: ok");
