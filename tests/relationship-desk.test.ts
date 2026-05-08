// Sprint 6 Phase B + C — Relationship Desk SQL/UI invariants.
//
// We pin three core promises:
//
//   1. The Sprint 6 migration creates `relationship_private_notes`,
//      enables RLS, and defines an explicit owner-only SELECT policy.
//      The target user must NEVER receive a SELECT policy.
//
//   2. `get_relationship_desk_for_owner` exists with the documented
//      signature and gates on `auth.uid() = owner`. The body must NOT
//      include passive surveillance signals (no view/impression/scoring
//      tables joined in v1). The body MUST select from the explicit
//      relationship sources (follows / access_requests / access_grants /
//      price_inquiries / relationship_private_notes).
//
//   3. The Relationship Desk page at /my/relationships fetches via the
//      RPC wrapper, fires the canonical telemetry event for view, and
//      NEVER includes the note body in any logBetaEventSync payload.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
// The table + RLS still live in the Sprint 6 migration; the live RPC
// bodies were re-emitted by Sprint 6.1 (principal-aware + minimized
// surface). We read both files so each invariant points at the source
// of truth.
const SPRINT6_REL =
  "supabase/migrations/20260608000000_sprint6_phase0_and_relationship_desk.sql";
const SPRINT6_1_REL =
  "supabase/migrations/20260610000000_sprint6_1_principal_scoping_and_minimization.sql";

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function sectionFor(sql: string, fnName: string): string | null {
  const sections = sql.split(/-- == SECTION \d+ ==/);
  return sections.find((s) => s.includes(`function public.${fnName}(`)) ?? null;
}

(async () => {
  const sql = read(SPRINT6_REL);
  const sql61 = read(SPRINT6_1_REL);

  // 1. relationship_private_notes table + RLS.
  assert.ok(
    /create table if not exists public\.relationship_private_notes/i.test(sql),
    "relationship_private_notes table must be created"
  );
  assert.ok(
    /alter table public\.relationship_private_notes enable row level security/i.test(
      sql
    ),
    "relationship_private_notes must enable RLS"
  );
  assert.ok(
    /create policy relationship_private_notes_owner_select/i.test(sql),
    "owner-only SELECT policy must exist"
  );
  // Defensive: no policy may target the row's `target_profile_id`.
  // The whole point of the table is that the *target* cannot read it.
  assert.ok(
    !/relationship_private_notes_target/i.test(sql),
    "relationship_private_notes must not have any *_target_* policy (target user must not read notes about themselves)"
  );
  // Owner uniqueness so a desk row preview always picks one note.
  assert.ok(
    /relationship_private_notes_unique_pair[\s\S]*unique\s*\(\s*owner_profile_id,\s*target_profile_id\s*\)/i.test(
      sql
    ),
    "(owner_profile_id, target_profile_id) must be UNIQUE for upsert correctness"
  );

  // 2. get_relationship_desk_for_owner — Sprint 6.1 principal-aware
  // signature + auth.uid() gating + explicit relationship sources only.
  // The live function lives in the Sprint 6.1 migration (Sprint 6's
  // 3-arg overload was dropped to prevent PostgREST from resolving to
  // the un-validated body).
  assert.ok(
    /create or replace function public\.get_relationship_desk_for_owner\s*\(\s*p_owner_profile_id\s+uuid\s+default null\s*,\s*p_limit\s+integer\s+default 50\s*,\s*p_offset\s+integer\s+default 0\s*,\s*p_status\s+text\s+default null\s*\)/i.test(
      sql61
    ),
    "get_relationship_desk_for_owner (Sprint 6.1) must accept (uuid default null, integer default 50, integer default 0, text default null)"
  );
  assert.ok(
    /drop function if exists public\.get_relationship_desk_for_owner\s*\(integer,\s*integer,\s*text\)/i.test(
      sql61
    ),
    "Sprint 6.1 must drop the legacy 3-arg desk RPC overload"
  );
  const desk = sectionFor(sql61, "get_relationship_desk_for_owner");
  assert.ok(desk, "desk RPC section must exist in Sprint 6.1 migration");
  // Gating on auth.uid() (declaration line `v_uid uuid := auth.uid()`).
  assert.ok(
    /v_uid[\s\S]{0,40}:=\s*auth\.uid\(\)/.test(desk!),
    "desk RPC must read auth.uid() (no spoofable owner argument)"
  );
  assert.ok(
    /if v_uid is null then\s*return '\[\]'::jsonb;/i.test(desk!),
    "desk RPC must fail closed for unauthenticated callers"
  );
  // Explicit relationship sources only — no passive viewer tables.
  for (const tbl of [
    "public.follows",
    "public.access_requests",
    "public.access_grants",
    "public.price_inquiries",
    "public.relationship_private_notes",
  ]) {
    assert.ok(
      desk!.includes(tbl),
      `desk RPC must read from ${tbl} (explicit relationship signal)`
    );
  }
  // Forbidden tables — these would re-introduce passive viewer
  // surveillance (named impressions / view tracking / scoring). v1
  // intentionally omits all of them.
  for (const banned of [
    "artwork_views",
    "profile_views",
    "buyer_score",
    "lead_score",
    "buyer_intent",
  ]) {
    assert.ok(
      !desk!.includes(banned),
      `desk RPC must NOT read from passive surveillance source ${banned}`
    );
  }

  // 3. UI panel: RPC wrapper usage + canonical telemetry + no note body
  // in any beta event payload.
  // Sprint 6.2 — the desk body lives in the panel component now (the
  // /my/relationships route is a thin redirect into /my/network?tab=
  // relationships). The full panel still exposes every telemetry call
  // and RPC wrapper that this regression guards.
  const page = read("src/components/network/RelationshipDeskPanel.tsx");
  assert.ok(
    page.includes("getRelationshipDeskForOwner"),
    "page must call the desk RPC wrapper"
  );
  assert.ok(
    page.includes("relationship_desk_viewed"),
    "page must emit relationship_desk_viewed telemetry"
  );
  assert.ok(
    page.includes("relationship_card_opened"),
    "page must emit relationship_card_opened telemetry on drawer open"
  );
  assert.ok(
    page.includes("relationship_private_note_saved"),
    "page must emit relationship_private_note_saved telemetry on save"
  );
  // Defensive: the noteDraft body must NEVER appear inside any
  // logBetaEventSync payload object literal. We scan every event call
  // and assert the literal `noteDraft` (or `note:` body) is absent.
  // Sprint 6.1: payloads may include an `acting_as: boolean` flag, but
  // never a `note` body or any private_note* key.
  for (const m of page.matchAll(/logBetaEventSync\s*\(\s*"[^"]+"\s*,\s*\{([\s\S]*?)\}\s*\)/g)) {
    const body = m[1] ?? "";
    assert.ok(
      !body.includes("noteDraft"),
      `telemetry payload must not include noteDraft (body): ${m[0].slice(0, 80)}…`
    );
    assert.ok(
      !/\bnote\s*:/.test(body),
      `telemetry payload must not include a 'note' key: ${m[0].slice(0, 80)}…`
    );
    assert.ok(
      !/private_note/.test(body),
      `telemetry payload must not include 'private_note' key: ${m[0].slice(0, 80)}…`
    );
  }

  // 4. resolve_access_request_v2 must exist (Phase E backwards-compatible
  // grant lifecycle additive RPC). This still lives in the Sprint 6
  // migration; Sprint 6.1 is intentionally additive-only here.
  assert.ok(
    /create or replace function public\.resolve_access_request_v2\s*\([\s\S]{0,300}p_grant_subject_type text default null/i.test(
      sql
    ),
    "resolve_access_request_v2 must accept the optional grant lifecycle params"
  );

  console.log("relationship-desk.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
