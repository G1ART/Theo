// Phase 2 (2026-07-01) 계약 테스트.
//   1) link_external_artist_to_profile / list_my_external_artists RPC 마이그레이션
//   2) 스토리지 정책 Shape 5 (현재 artist_id 소유자)
//   3) 소프트 필수 이메일: 단일/벌크/편집 + "이메일 없음" 옵트아웃
//   4) /my/artists 관리 페이지 + lib + 진입 링크

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const migDir = join(root, "supabase", "migrations");
const readMig = (needle: string) => {
  const f = readdirSync(migDir).filter((n) => n.includes(needle)).sort().pop();
  assert.ok(f, `expected migration containing ${needle}`);
  return readFileSync(join(migDir, f!), "utf8");
};

// 1) link/list RPC -----------------------------------------------------------
const link = readMig("external_artist_link");
assert.match(link, /create or replace function public\.link_external_artist_to_profile/);
assert.match(link, /set claimed_profile_id = p_target_profile_id, status = 'claimed'/);
assert.match(link, /set artist_profile_id = p_target_profile_id, external_artist_id = null/);
assert.match(link, /update public\.artworks\s+set artist_id = p_target_profile_id/);
assert.match(link, /is_active_writer_for\(v_inviter\)/, "must allow inviter or their account delegate");
assert.match(link, /create or replace function public\.list_my_external_artists/);

// 2) storage Shape 5 ---------------------------------------------------------
const storage = readMig("artwork_storage_current_owner");
assert.match(storage, /join public\.artworks a on a\.id = ai\.artwork_id/);
assert.match(storage, /ai\.storage_path = p_name[\s\S]*a\.artist_id = auth\.uid\(\)/);
assert.match(storage, /idx_artwork_images_storage_path/);

// 3) soft-required email -----------------------------------------------------
for (const rel of [
  "src/app/upload/page.tsx",
  "src/app/upload/bulk/page.tsx",
  "src/app/artwork/[id]/edit/page.tsx",
]) {
  const src = read(rel);
  assert.match(src, /externalNoEmail/, `${rel} must have the no-email opt-out`);
  assert.match(src, /externalArtistEmailRequired/, `${rel} must validate email softly`);
}

// 4) management page + lib + entry -------------------------------------------
const lib = read("src/lib/provenance/externalArtists.ts");
assert.match(lib, /link_external_artist_to_profile/);
assert.match(lib, /list_my_external_artists/);
const page = read("src/app/my/artists/page.tsx");
assert.match(page, /linkExternalArtistToProfile/);
assert.match(page, /ConfirmActionDialog/);
const myPage = read("src/app/my/page.tsx");
assert.match(myPage, /href="\/my\/artists"/, "/my must link to invited-artists page");

// rpc.ts edit path uses the dedupe RPC (carried from Phase 1)
assert.match(read("src/lib/provenance/rpc.ts"), /get_or_create_external_artist/);

console.log("external-artist-link-phase2.test.ts: ok");
