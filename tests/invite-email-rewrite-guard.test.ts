// 대표님 결정 (20261018040637):
//   invite_email_rewrite = block_verified_other — an invite's email cannot be
//     changed to an address another account has already verified, on the
//     row itself or by moving an existing claim to such an invite.
//   profile_link_mismatch = explain — the profile link says why it refuses.
// Both refusals are message tokens that formatSupabaseError turns into copy.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { formatSupabaseError } from "../src/lib/errors/supabase";
import { messages } from "../src/lib/i18n/messages";

const ROOT = path.resolve(__dirname, "..");
const DIR = path.join(ROOT, "supabase/migrations");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const strip = (sql: string) =>
  sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

const NAME = "20261018040637_invite_email_rewrite_guard.sql";
const raw = read(`supabase/migrations/${NAME}`);
const sql = strip(raw);

// 1. Editor-safe SQL.
assert.equal((raw.match(/^-- == SECTION \d+ ==/gm) ?? []).length, 4);
for (const tag of sql.match(/\$[A-Za-z0-9_]*\$/g) ?? []) assert.match(tag, /^\$[A-Za-z]+\$$/);
assert.ok(!/select[^;]*\binto\s+v_/i.test(sql), "assignments use :=");
assert.ok(
  /revoke all on function public\.invite_email_verified_by_account\(text\) from public, anon, authenticated;/.test(sql),
  "the verified-address lookup is internal",
);

// 2. Changes are refused, new invites are not.
assert.ok(/before update of invite_email on public\.external_artists/.test(sql));
assert.ok(/before update of external_artist_id on public\.claims/.test(sql));
assert.ok(!/before insert[^;]*on public\.(external_artists|claims)[^;]*guard_invite/.test(sql), "creation stays open");
const bodyOf = (fn: string) => {
  const at = sql.indexOf(`function public.${fn}()`);
  assert.ok(at >= 0, fn);
  return sql.slice(at, sql.indexOf("$a$;", at));
};
for (const fn of ["external_artists_guard_invite_email", "claims_guard_invite_repoint"]) {
  const body = bodyOf(fn);
  assert.ok(/raise exception 'invite_email_verified_by_other_account'\s+using errcode = '23514'/.test(body), fn);
  assert.ok(/v_new is not distinct from v_old/.test(body), `${fn}: same address (any case) is not a change`);
  assert.ok(/public\.is_ops_user\(\)/.test(body), `${fn}: ops merges are exempt`);
  assert.ok(/public\.invite_email_verified_by_account\(v_new\)/.test(body), fn);
}
const helper = sql.slice(sql.indexOf("function public.invite_email_verified_by_account"), sql.indexOf("revoke all on function public.invite_email_verified_by_account"));
assert.ok(/u\.email_confirmed_at is not null/.test(helper), "unconfirmed sign-ups do not count");

// 3. The newest link RPC names its refusal and keeps the merge rule.
const files = readdirSync(DIR).filter((n) => /^\d{14}_.*\.sql$/.test(n)).sort();
let link = "";
for (const file of files) {
  const text = strip(readFileSync(path.join(DIR, file), "utf8"));
  const at = text.search(/create or replace function public\.link_external_artist_to_profile\(/);
  if (at >= 0) link = text.slice(at, text.indexOf("$a$;", at));
}
assert.ok(/raise exception 'invite_email_mismatch'/.test(link));
assert.ok(/u\.email_confirmed_at is not null/.test(link) && /lower\(trim\(u\.email\)\) = lower\(v_email\)/.test(link));

// 4. The app shows the reason, and only for these refusals.
const t = (key: string) => key;
assert.equal(
  formatSupabaseError({ message: "invite_email_mismatch", code: "42501" }, t, "myArtists.linkFailed"),
  "myArtists.linkEmailMismatch",
);
assert.equal(
  formatSupabaseError({ message: "invite_email_verified_by_other_account", code: "23514" }, t, "common.errorSave"),
  "errors.invite.emailVerifiedByOther",
);
assert.equal(formatSupabaseError(new TypeError("Failed to fetch"), t, "myArtists.linkFailed"), "myArtists.linkFailed");
assert.equal(
  formatSupabaseError({ message: "permission denied for function link_external_artist_to_profile", code: "42501" }, t, "myArtists.linkFailed"),
  "errors.permission.denied",
);

const ko = messages.ko as Record<string, string>;
const en = messages.en as Record<string, string>;
assert.equal(ko["myArtists.linkEmailMismatch"], "이 계정의 인증된 이메일과 초대 이메일이 달라 연결할 수 없어요.");
assert.equal(en["myArtists.linkEmailMismatch"], "This account's verified email doesn't match the invite email, so it can't be linked.");
assert.equal(ko["errors.invite.emailVerifiedByOther"], "이미 다른 계정이 인증한 이메일이라 초대에 쓸 수 없어요.");
assert.equal(en["errors.invite.emailVerifiedByOther"], "This email is already verified by another account, so it can't be used for the invite.");

// 5. The screens that save an invite email or link a profile go through formatSupabaseError.
for (const [rel, pattern] of [
  ["src/app/my/artists/page.tsx", /formatSupabaseError\(err, t, "myArtists\.linkFailed"\)/],
  ["src/app/artwork/[id]/edit/page.tsx", /formatSupabaseError\(extErr, t, "artwork\.errors\.failedAddArtist"\)/],
  ["src/app/artwork/[id]/edit/page.tsx", /formatSupabaseError\(claimErr, t, "artwork\.errors\.failedUpdateProvenance"\)/],
  ["src/app/my/exhibitions/[id]/add/page.tsx", /saveError: formatSupabaseError\(extErr, t, "common\.errorSave"\)/],
  ["src/app/upload/single/page.tsx", /formatSupabaseError\(claimErr, t, "errors\.failedClaimDuringUpload"\)/],
] as const) {
  assert.match(read(rel), pattern, rel);
}

console.log("invite-email-rewrite-guard: ok");
