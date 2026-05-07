// Sprint 6.1 Phase B — acting-as / delegate principal correctness.
//
// Static SQL/source checks pinning that the Relationship Desk RPC
// trio (desk + card + private-note upsert) treats the owner as an
// EXPLICIT principal id, not as auth.uid(). Acting-as in this app is
// a CLIENT product context — auth.uid() does not swap when a delegate
// is acting on behalf of a principal. The RPCs therefore must:
//
//   * accept p_owner_profile_id as a first-class argument,
//   * resolve v_owner = coalesce(p_owner_profile_id, auth.uid()),
//   * authorize on auth.uid() = v_owner OR
//     is_active_account_delegate_writer(v_owner).
//
// We also assert the UI page imports useActingAs and that the wrapper
// signatures accept ownerProfileId. And we forbid the misleading
// "swap session uid" comment in the relationship_private_notes RPC
// (the assumption that earlier broke the design).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const MIGRATION_REL =
  "supabase/migrations/20260610000000_sprint6_1_principal_scoping_and_minimization.sql";

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function sectionFor(sql: string, fnName: string): string | null {
  const sections = sql.split(/-- == SECTION \d+ ==/);
  return sections.find((s) => s.includes(`function public.${fnName}(`)) ?? null;
}

function stripSqlComments(s: string): string {
  return s
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

(async () => {
  const sql = read(MIGRATION_REL);

  // 1. Each of the three RPCs must take p_owner_profile_id and validate
  // delegation server-side via is_active_account_delegate_writer.
  for (const fn of [
    "get_relationship_desk_for_owner",
    "get_relationship_card_for_owner",
    "upsert_relationship_private_note",
  ]) {
    const section = sectionFor(sql, fn);
    assert.ok(section, `Sprint 6.1 migration must redefine ${fn}`);
    const body = stripSqlComments(section!);
    assert.ok(
      /p_owner_profile_id\s+uuid/i.test(body),
      `${fn} must accept p_owner_profile_id (uuid)`
    );
    assert.ok(
      /v_owner\s*:=\s*coalesce\(\s*p_owner_profile_id\s*,\s*v_uid\s*\)/i.test(body),
      `${fn} must resolve v_owner = coalesce(p_owner_profile_id, auth.uid())`
    );
    assert.ok(
      /is_active_account_delegate_writer\s*\(\s*v_owner\s*\)/i.test(body),
      `${fn} must authorize via is_active_account_delegate_writer(v_owner)`
    );
    assert.ok(
      /v_owner\s*<>\s*v_uid/i.test(body),
      `${fn} must explicitly compare v_owner against auth.uid()`
    );
  }

  // 2. Drop-and-recreate the legacy overloads so PostgREST always picks
  // the principal-aware version (function overloading would otherwise
  // let an old client call the un-validated body).
  for (const drop of [
    /drop function if exists public\.get_relationship_desk_for_owner\s*\(integer,\s*integer,\s*text\)/i,
    /drop function if exists public\.get_relationship_card_for_owner\s*\(uuid\)/i,
    /drop function if exists public\.upsert_relationship_private_note\s*\(uuid,\s*text\)/i,
  ]) {
    assert.ok(
      drop.test(sql),
      `Sprint 6.1 migration must drop the matching legacy overload before re-creating: ${drop}`
    );
  }

  // 3. The misleading "delegated acting-as flows swap the session uid"
  // assumption that produced the bug must not reappear in the new
  // private-note section. We also forbid it from the desk and card.
  for (const fn of [
    "get_relationship_desk_for_owner",
    "get_relationship_card_for_owner",
    "upsert_relationship_private_note",
  ]) {
    const section = sectionFor(sql, fn);
    assert.ok(
      !/swap[^\n]*session uid/i.test(section!),
      `${fn} must not claim acting-as swaps the session uid (it does not)`
    );
  }

  // 4. The UI page must import useActingAs and pass an effective owner
  // into all three RPC wrappers.
  const page = read("src/app/my/relationships/page.tsx");
  assert.ok(
    /useActingAs\s*\(/.test(page),
    "/my/relationships must import useActingAs"
  );
  assert.ok(
    /effectiveOwnerProfileId\s*=\s*actingAsProfileId\s*\?\?\s*userId/.test(page),
    "/my/relationships must compute effectiveOwnerProfileId from actingAsProfileId ?? userId"
  );
  for (const call of [
    /getRelationshipDeskForOwner\(\s*\{[\s\S]{0,200}ownerProfileId:\s*effectiveOwnerProfileId/,
    /getRelationshipCardForOwner\(\s*[\s\S]{0,40}effectiveOwnerProfileId/,
    /upsertRelationshipPrivateNote\(\s*\{[\s\S]{0,200}ownerProfileId:\s*effectiveOwnerProfileId/,
  ]) {
    assert.ok(
      call.test(page),
      `/my/relationships must pass effectiveOwnerProfileId to RPC wrapper: ${call}`
    );
  }

  // 5. The wrappers must accept ownerProfileId and forward it as
  // p_owner_profile_id to the RPC.
  const wrappers = read("src/lib/supabase/relationshipAccess.ts");
  for (const sig of [
    /export async function getRelationshipDeskForOwner\(\s*args\?\:\s*\{[\s\S]{0,200}ownerProfileId\?:/,
    /export async function getRelationshipCardForOwner\([\s\S]{0,200}ownerProfileId:/,
    /export async function upsertRelationshipPrivateNote\(args:\s*\{[\s\S]{0,200}ownerProfileId\?:/,
  ]) {
    assert.ok(
      sig.test(wrappers),
      `relationshipAccess wrapper must accept ownerProfileId: ${sig}`
    );
  }
  for (const send of [
    /p_owner_profile_id:\s*args\?\.ownerProfileId\s*\?\?\s*null/,
    /p_owner_profile_id:\s*ownerProfileId/,
    /p_owner_profile_id:\s*args\.ownerProfileId\s*\?\?\s*null/,
  ]) {
    assert.ok(
      send.test(wrappers),
      `relationshipAccess wrapper must forward p_owner_profile_id to RPC: ${send}`
    );
  }

  // 6. Telemetry from the desk page may carry a boolean acting_as flag
  // (helpful for product analytics) but MUST NOT include the principal
  // id itself. Otherwise log readers could reconstruct the delegation
  // graph. We allow `acting_as: !!actingAsProfileId` (boolean coercion)
  // but forbid raw id emission such as `acting_as: actingAsProfileId`,
  // `principal_id: effectiveOwnerProfileId`, or any `owner_profile_id`
  // key.
  for (const m of page.matchAll(
    /logBetaEventSync\s*\(\s*"[^"]+"\s*,\s*\{([\s\S]*?)\}\s*\)/g
  )) {
    const body = m[1] ?? "";
    assert.ok(
      !/owner_profile_id/.test(body),
      `telemetry payload must not include 'owner_profile_id' key: ${m[0].slice(0, 80)}…`
    );
    // Forbid raw id values: `<key>: actingAsProfileId` or
    // `<key>: effectiveOwnerProfileId` without `!!` coercion.
    for (const re of [
      /:\s*actingAsProfileId\b(?!\s*\?\?\s*null)/,
      /:\s*effectiveOwnerProfileId\b/,
    ]) {
      assert.ok(
        !re.test(body),
        `telemetry payload must not emit principal id raw: ${m[0].slice(0, 80)}…`
      );
    }
  }

  console.log("sprint6-delegation-principal.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
