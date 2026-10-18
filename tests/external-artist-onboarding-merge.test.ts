// 초대받은 작가가 초대 이메일로 가입을 마치면 작품·크레딧이 그 프로필로 붙는다.
//
// 계약:
//   1) 병합 SSOT 는 link_matching_external_artists_for_user (최신 정의 기준)
//   2) 이메일 매칭은 auth.users.email 만 (user_metadata 금지), 인증된 이메일만
//   3) auth.users INSERT / 이메일 확인(UPDATE) / 프로필 저장에서 같은 함수
//   4) 작품 artist_id, 클레임, CREATED 클레임, 전시 참여 크레딧이 옮겨진다
//   5) 초대는 SendGrid 메일(/onboarding?email=)이다. 가입 전에 계정을 만들지
//      않는다(매직링크·OTP 사전 생성 없음, 2026-09-29 a035609)
//   6) 전시 참여자는 이름 다음에 이메일을 넣어도 저장된다(재저장 idempotent)
//   7) 이미 저장된 외부 작가에 이메일을 나중에 넣으면 그 이메일로 초대가 잡힌다
//   8) 이미 온보딩된 미클레임 이메일은 백필
// 실제 DB 시나리오는 supabase/tests/invite_signup_merge.sql (롤백).

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const migDir = join(root, "supabase", "migrations");
const timestamped = readdirSync(migDir)
  .filter((n) => /^\d{14}_.*\.sql$/.test(n))
  .sort();

function codeOf(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

function latestDefinition(fn: string): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(`, "gi");
  for (const file of timestamped) {
    const code = codeOf(readFileSync(join(migDir, file), "utf8"));
    for (const m of code.matchAll(re)) {
      const rest = code.slice(m.index);
      const tag = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(rest)?.[1];
      assert.ok(tag, `${file}: ${fn} has a dollar-quoted body`);
      const open = rest.indexOf(tag);
      found = { file, body: rest.slice(0, rest.indexOf(tag, open + tag.length) + tag.length) };
    }
  }
  assert.ok(found, `${fn} is defined in a timestamped migration`);
  return found;
}

// 1–4) 병합 함수 — 최신 정의 -------------------------------------------------
const link = latestDefinition("link_matching_external_artists_for_user");
assert.match(link.body, /select u\.email from auth\.users u where u\.id = p_user_id/);
assert.doesNotMatch(link.body, /raw_user_meta_data/, "must not match invite email from user-editable metadata");
assert.match(
  link.body,
  /u\.email_confirmed_at is not null[\s\S]*update public\.external_artists\s+set claimed_profile_id = p_user_id/,
  `${link.file}: invites are claimed only for a verified email`,
);
assert.match(
  link.body,
  /where lower\(trim\(invite_email\)\) = lower\(v_email\)\s+and claimed_profile_id is null/,
);
assert.match(link.body, /set artist_profile_id = p_user_id,\s+external_artist_id = null/);
assert.match(link.body, /set artist_id = p_user_id/);
assert.match(link.body, /perform public\.ensure_created_claims_for_linked_artist\(p_user_id, v_work_ids\)/);
assert.match(
  codeOf(readFileSync(join(migDir, link.file), "utf8")),
  /revoke all on function public\.link_matching_external_artists_for_user\(uuid\) from public, anon, authenticated/,
  `${link.file}: clients cannot call the merge directly`,
);

// 3, 8) 트리거·백필 — 09-10 마이그레이션 -------------------------------------
const onboardingFile = readdirSync(migDir)
  .filter((n) => n.includes("link_external_artists_on_onboarding"))
  .sort()
  .pop();
assert.ok(onboardingFile, "expected link_external_artists_on_onboarding migration");
const sql = readFileSync(join(migDir, onboardingFile!), "utf8");

for (const n of [1, 2, 3, 4, 5, 6]) {
  assert.match(sql, new RegExp(`-- == SECTION ${n} ==`));
}
assert.doesNotMatch(sql, /\$[a-z]*_[a-z0-9]*\$/i, "dollar tags must be letters only (no underscore)");
assert.match(sql, /as \$linkfn\$/);
assert.match(
  sql,
  /create or replace function public\.ensure_created_claims_for_linked_artist/,
);
assert.match(
  sql,
  /artist_profile_id\s*\)\s*select[\s\S]*p_subject_profile_id,\s*'CREATED'/,
  "CREATED insert must set artist_profile_id (claims_created_requires_artist)",
);
assert.match(sql, /revoke all on function public\.link_matching_external_artists_for_user\(uuid\)/);
assert.match(sql, /perform public\.link_matching_external_artists_for_user\(new\.id\);/);
assert.match(sql, /after insert on auth\.users/, "a sign-up already verified at creation links on INSERT");
assert.match(
  sql,
  /after update of email, email_confirmed_at on auth\.users/,
  "opening the activation mail links on confirmation",
);
assert.match(
  sql,
  /after insert or update on public\.profiles/,
  "identity save (upsert_my_profile) also runs the merge",
);
assert.match(sql, /if pg_trigger_depth\(\) > 1 then/);
assert.match(sql, /do \$backfill\$/);
assert.match(
  sql,
  /join public\.external_artists ea\s+on lower\(trim\(ea\.invite_email\)\) = lower\(trim\(u\.email\)\)/,
);
assert.match(sql, /ea\.claimed_profile_id is null/);
assert.match(sql, /perform public\.link_matching_external_artists_for_user\(r\.user_id\)/);

// 5) 초대 = SendGrid 메일 → /onboarding?email= , 가입 전 계정 없음 -------------
const inviteRoute = read("src/app/api/artist-invite-email/route.ts");
assert.match(inviteRoute, /\/onboarding\?email=\$\{encodeURIComponent\(/, "invite mail opens sign-up with the invited email");
assert.doesNotMatch(inviteRoute, /signInWithOtp|generateLink|inviteUserByEmail/, "the invite does not create an auth user");

const inviteSurfaces = [
  "src/app/upload/single/page.tsx",
  "src/app/upload/bulk/page.tsx",
  "src/app/artwork/[id]/edit/page.tsx",
  "src/app/my/exhibitions/[id]/add/page.tsx",
  "src/app/my/exhibitions/[id]/edit/page.tsx",
  "src/components/exhibitions/NewExhibitionFormShell.tsx",
  "src/app/my/artists/page.tsx",
];
for (const rel of inviteSurfaces) {
  const src = read(rel);
  assert.match(src, /sendArtistInvite(EmailClient|EmailWithResult)\(/, `${rel} sends the SendGrid invite`);
  assert.doesNotMatch(src, /sendMagicLink\(|signInWithOtp\(/, `${rel} must not pre-create an account`);
}
assert.doesNotMatch(read("src/lib/supabase/artworks.ts"), /sendMagicLink\(|signInWithOtp\(/);

const onboarding = read("src/app/onboarding/page.tsx");
assert.match(onboarding, /searchParams\.get\("email"\)/, "/onboarding prefills the invited email");
const signupLink = read("src/app/api/auth/signup-link/route.ts");
assert.match(signupLink, /generateLink\(/, "an unconfirmed sign-up can get its activation link again");
const auth = read("src/lib/supabase/auth.ts");
assert.match(auth, /export async function deliverSignupConfirmation/);

// 6) 전시 참여자 재저장은 같은 claim 을 돌려준다 -------------------------------
const claimRpc = latestDefinition("create_external_artist_and_claim");
assert.match(
  claimRpc.body,
  /on conflict \(project_id, external_artist_id, claim_type\)\s+where work_id is null\s+and claim_type = 'CURATED'\s+and external_artist_id is not null\s+do nothing/,
  `${claimRpc.file}: a participant saved by name can be saved again with its email`,
);
assert.match(
  claimRpc.body,
  /lower\(trim\(ea\.invite_email\)\) = lower\(v_email\)/,
  `${claimRpc.file}: an email another open invite holds resolves to that invite`,
);
const claimFile = codeOf(readFileSync(join(migDir, claimRpc.file), "utf8"));
assert.match(
  claimFile,
  /drop function if exists public\.create_external_artist_and_claim\(\s*text, text, uuid, uuid, text, text, text, text, text, uuid, uuid, text, text\s*\)/,
  "older argument lists cannot shadow the fixed definition",
);

// 7) 작품 수정에서 새로 넣은 이메일은 초대 행으로 잡힌다 -----------------------
const edit = read("src/app/artwork/[id]/edit/page.tsx");
assert.match(edit, /const emailAdded =/);
assert.match(edit, /if \(!existingExtId \|\| emailAdded\) \{\s+const \{ data: createdId, error: extErr \} = await createExternalArtist\(/);
assert.match(edit, /if \(\(!existingExtId \|\| emailAdded\) && externalArtistEmail\?\.trim\(\)\)/);

const scenario = read("supabase/tests/invite_signup_merge.sql");
assert.match(scenario, /raise exception 'invite_signup_merge: ok'/);
assert.match(scenario, /@example\.invalid/);

console.log("external-artist-onboarding-merge.test.ts: ok");
