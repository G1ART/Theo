// Sprint 5.2 — SQL contract checks for the access-enforcement migration.
//
// We don't spin up a Postgres instance in CI; instead we read the
// migration file as text and pin the structural invariants the work
// order requires. Pure source-text checks — fast, deterministic, and
// they survive every CI environment.
//
//   1. The Sprint 5.2 migration file exists at the expected path.
//   2. visibility_subject_belongs_to_owner() is defined and granted.
//   3. resolve_visibility_for_viewer() now references the validator
//      (defense-in-depth against owner/subject id spoofing).
//   4. upsert_visibility_policy() / create_access_request() /
//      resolve_access_request() all call the validator.
//   5. cancel_access_request() RPC exists AND the legacy direct
//      requester UPDATE policy is dropped.
//   6. get_artwork_passport_for_viewer() and
//      get_room_for_viewer_by_token() are defined.
//   7. resolve_visibility_for_preview() is defined and granted.
//   8. create_access_request() returns jsonb with `request` and
//      `duplicate` keys (the explicit duplicate signal).
//   9. The migration uses letters-only dollar tags and SECTION
//      banners (release-workflow §1-1 — dashboard tokenizer safety).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const MIGRATION_REL =
  "supabase/migrations/20260607000000_relationship_access_enforcement_hardening.sql";

(async () => {
  const sql = readFileSync(path.join(ROOT, MIGRATION_REL), "utf8");

  // 1. File header.
  assert.ok(sql.length > 0, "migration file must not be empty");
  assert.ok(
    sql.includes("Sprint 5.2"),
    "migration file should self-identify as Sprint 5.2"
  );

  // 2. Validator helper.
  assert.ok(
    /create or replace function public\.visibility_subject_belongs_to_owner\s*\(/i.test(
      sql
    ),
    "visibility_subject_belongs_to_owner() must be defined"
  );
  assert.ok(
    /grant execute on function public\.visibility_subject_belongs_to_owner/i.test(
      sql
    ),
    "validator must be granted to authenticated callers"
  );

  // 3-4. Mutation paths must invoke the validator.
  for (const fn of [
    "resolve_visibility_for_viewer",
    "upsert_visibility_policy",
    "create_access_request",
    "resolve_access_request",
  ]) {
    const idx = sql.indexOf(fn);
    assert.ok(idx !== -1, `${fn} must be re-created in this migration`);
  }
  // Each of the four functions must include a `visibility_subject_belongs_to_owner` call.
  // We split on SECTION banners so a stray reference outside the body
  // doesn't satisfy the check.
  const sections = sql.split(/-- == SECTION \d+ ==/);
  function sectionForFn(name: string): string | null {
    return sections.find((s) => s.includes(`function public.${name}(`)) ?? null;
  }
  for (const fn of [
    "resolve_visibility_for_viewer",
    "upsert_visibility_policy",
    "create_access_request",
    "resolve_access_request",
  ]) {
    const body = sectionForFn(fn);
    assert.ok(body, `section for ${fn} must exist`);
    assert.ok(
      body!.includes("visibility_subject_belongs_to_owner"),
      `${fn} body must call visibility_subject_belongs_to_owner`
    );
  }

  // 5. cancel_access_request RPC + drop direct requester UPDATE policy.
  assert.ok(
    /create or replace function public\.cancel_access_request\s*\(\s*p_request_id uuid\s*\)/i.test(
      sql
    ),
    "cancel_access_request(uuid) RPC must be defined"
  );
  assert.ok(
    /drop policy if exists access_requests_update_requester_cancel on public\.access_requests/i.test(
      sql
    ),
    "the direct requester UPDATE policy must be dropped"
  );

  // 6. Redacted RPCs.
  assert.ok(
    /create or replace function public\.get_artwork_passport_for_viewer\s*\(\s*p_artwork_id uuid\s*\)/i.test(
      sql
    ),
    "get_artwork_passport_for_viewer(uuid) must be defined"
  );
  assert.ok(
    /create or replace function public\.get_room_for_viewer_by_token\s*\(\s*p_token text\s*\)/i.test(
      sql
    ),
    "get_room_for_viewer_by_token(text) must be defined"
  );
  // anon grant is required so token-bearing visitors can hit the room RPC.
  assert.ok(
    /grant execute on function public\.get_room_for_viewer_by_token\(text\) to anon/i.test(
      sql
    ),
    "get_room_for_viewer_by_token must be granted to anon"
  );

  // 7. Preview-as effective resolver.
  assert.ok(
    /create or replace function public\.resolve_visibility_for_preview\s*\(/i.test(
      sql
    ),
    "resolve_visibility_for_preview() must be defined"
  );
  assert.ok(
    /grant execute on function public\.resolve_visibility_for_preview/i.test(
      sql
    ),
    "resolve_visibility_for_preview must be granted to authenticated"
  );

  // 8. create_access_request returns jsonb with request/duplicate keys.
  const createSection = sectionForFn("create_access_request")!;
  assert.ok(
    /returns jsonb/i.test(createSection),
    "create_access_request must return jsonb (so { request, duplicate } can travel)"
  );
  assert.ok(
    /'request'/.test(createSection) && /'duplicate'/.test(createSection),
    "create_access_request body must build a jsonb with 'request' and 'duplicate' keys"
  );

  // 9. Dashboard tokenizer safety — letters-only dollar tags + SECTION banners.
  // Reject obvious offenders (underscore-bearing dollar tags) just like
  // release-workflow §1-1 calls out.
  assert.ok(
    /-- == SECTION 1 ==/.test(sql),
    "migration must use SECTION banners"
  );
  // Allowed: $a$, $accept$, etc. Disallowed: $p_link$, $foo_bar$.
  const bareDollarTags = sql.match(/\$[A-Za-z0-9_]*\$/g) ?? [];
  for (const tag of bareDollarTags) {
    assert.ok(
      /^\$[A-Za-z]*\$$/.test(tag),
      `dollar tag must be letters only (got ${tag})`
    );
  }

  console.log("visibility-sql-contract.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
