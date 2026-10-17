// Phase 1 (2026-07-01) — 외부 작가 정규화 완결편 + 프로비넌스 정합성 하드닝 계약.
//
// 1) 2차 병합(같은 이메일 / 이메일없는 동일명) + 부분 유니크 인덱스 2개
// 2) get_or_create_external_artist RPC (race-safe) 와 create_external_artist_and_claim 재사용
// 3) edit 경로(createExternalArtist)가 직접 insert 대신 RPC 경유
// 4) claims.project_id FK CASCADE + updated_at 트리거

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

// 1) dedupe phase1 migration -------------------------------------------------
const m1 = readMig("external_artist_dedupe_phase1");
// 같은 이메일 병합
assert.match(m1, /group by invited_by, lower\(trim\(invite_email\)\)/);
// 이메일 없는 동일명 병합
assert.match(m1, /group by invited_by, lower\(trim\(display_name\)\)/);
// 부분 유니크 인덱스 2개
assert.match(m1, /uq_external_artists_inviter_email/);
assert.match(m1, /uq_external_artists_inviter_name_noemail/);
assert.match(m1, /where nullif\(trim\(invite_email\), ''\) is not null and claimed_profile_id is null/);
// get_or_create + race-safe(unique_violation)
assert.match(m1, /create or replace function public\.get_or_create_external_artist/);
assert.match(m1, /exception when unique_violation then/);
// create_external_artist_and_claim 가 helper 재사용
assert.match(m1, /v_ext_id := public\.get_or_create_external_artist\(/);

// 2) integrity migration -----------------------------------------------------
const m2 = readMig("provenance_integrity_phase1");
assert.match(
  m2,
  /add constraint claims_project_id_fkey[\s\S]*references public\.projects\(id\) on delete cascade/,
  "claims.project_id FK must be ON DELETE CASCADE",
);
for (const tbl of ["claims", "external_artists", "projects"]) {
  assert.match(
    m2,
    new RegExp(`alter table public\\.${tbl}\\s+add column if not exists updated_at`),
    `${tbl} must gain updated_at`,
  );
}
assert.match(m2, /create or replace function public\.tg_set_updated_at/);

// 3) edit 경로가 RPC 경유 ----------------------------------------------------
const rpc = read("src/lib/provenance/rpc.ts");
assert.match(
  rpc,
  /supabase\.rpc\(\s*"get_or_create_external_artist"/,
  "createExternalArtist must route through the dedupe RPC",
);
assert.doesNotMatch(
  rpc,
  /\.from\("external_artists"\)\s*\.insert\(/,
  "createExternalArtist must not do a raw external_artists insert",
);

console.log("external-artist-dedupe-phase1.test.ts: ok");
