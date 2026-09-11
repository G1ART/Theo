// 초대 메일이 간 비온보딩 작가 → 그 이메일로 온보딩이 끝나면 데이터 병합.
//
// 계약:
//   1) 병합 SSOT 는 link_matching_external_artists_for_user
//   2) auth.users INSERT 만 믿지 않는다 (OTP 가계정이 INSERT 를 소모함)
//   3) 이메일 confirm / 프로필 저장에서도 같은 함수
//   4) OTP 사전 생성(sendMagicLink / signInWithOtp) 은 유지
//   5) 이미 온보딩된 미클레임 이메일은 백필
//   6) 이메일 매칭은 auth.users.email 만 (user_metadata 금지)

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const migDir = join(root, "supabase", "migrations");

const migFile = readdirSync(migDir)
  .filter((n) => n.includes("link_external_artists_on_onboarding"))
  .sort()
  .pop();
assert.ok(migFile, "expected link_external_artists_on_onboarding migration");
const sql = readFileSync(join(migDir, migFile!), "utf8");

assert.match(sql, /-- == SECTION 1 ==/);
assert.match(sql, /-- == SECTION 2 ==/);
assert.match(sql, /-- == SECTION 3 ==/);
assert.match(sql, /-- == SECTION 4 ==/);
assert.match(sql, /-- == SECTION 5 ==/);
assert.match(sql, /-- == SECTION 6 ==/);

assert.doesNotMatch(
  sql,
  /\$[a-z]*_[a-z0-9]*\$/i,
  "dollar tags must be letters only (no underscore)",
);

assert.match(
  sql,
  /create or replace function public\.link_matching_external_artists_for_user\(\s*p_user_id uuid\s*\)/,
);
assert.match(sql, /as \$linkfn\$/);
assert.match(
  sql,
  /select u\.email from auth\.users u where u\.id = p_user_id/,
);
assert.doesNotMatch(
  sql,
  /raw_user_meta_data/,
  "must not match invite email from user-editable metadata",
);
assert.match(
  sql,
  /where lower\(trim\(invite_email\)\) = lower\(v_email\)\s+and claimed_profile_id is null/,
);
assert.match(
  sql,
  /set artist_profile_id = p_user_id,\s+external_artist_id = null/,
);
assert.match(sql, /set artist_id = p_user_id/);
assert.match(
  sql,
  /create or replace function public\.ensure_created_claims_for_linked_artist/,
);
assert.match(
  sql,
  /artist_profile_id\s*\)\s*select[\s\S]*p_subject_profile_id,\s*'CREATED'/,
  "CREATED insert must set artist_profile_id (claims_created_requires_artist)",
);
assert.match(
  sql,
  /perform public\.ensure_created_claims_for_linked_artist\(p_user_id, v_work_ids\)/,
);
assert.match(
  sql,
  /revoke all on function public\.link_matching_external_artists_for_user\(uuid\)/,
);

assert.match(
  sql,
  /perform public\.link_matching_external_artists_for_user\(new\.id\);/,
);
assert.match(
  sql,
  /after insert on auth\.users/,
  "OTP pre-create path must still link on INSERT when it can",
);
assert.match(
  sql,
  /after update of email, email_confirmed_at on auth\.users/,
  "confirming a ghost account must retry the merge",
);
assert.match(
  sql,
  /after insert or update on public\.profiles/,
  "identity save (upsert_my_profile) must merge even if auth INSERT already fired",
);
assert.match(sql, /if pg_trigger_depth\(\) > 1 then/);

assert.match(sql, /do \$backfill\$/);
assert.match(
  sql,
  /join public\.external_artists ea\s+on lower\(trim\(ea\.invite_email\)\) = lower\(trim\(u\.email\)\)/,
);
assert.match(sql, /ea\.claimed_profile_id is null/);
assert.match(
  sql,
  /perform public\.link_matching_external_artists_for_user\(r\.user_id\)/,
);

// Invite OTP pre-create stays. Do not "fix" merge by stopping user creation.
const upload = read("src/app/upload/page.tsx");
assert.match(upload, /sendMagicLink\(email\)/);
const bulk = read("src/lib/supabase/artworks.ts");
assert.match(bulk, /sendMagicLink\(opts\.externalArtistEmail\.trim\(\)\)/);
const auth = read("src/lib/supabase/auth.ts");
assert.match(auth, /export async function sendMagicLink/);
assert.match(auth, /signInWithOtp/);

console.log("external-artist-onboarding-merge.test.ts: ok");
