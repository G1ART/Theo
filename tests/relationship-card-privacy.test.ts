// Sprint 6.1 Phase C + E — Relationship Desk + Card surface minimization.
//
// We pin three product invariants:
//
//   1. The desk RPC must NOT carry the raw private note body. The desk
//      list payload may only signal whether a note exists and, at most,
//      when it was last updated. The full body lives only inside the
//      Relationship Card RPC.
//
//   2. The Relationship Card RPC must NOT join shortlist_views or any
//      other passive named-viewer table, and must NOT return a
//      last_viewed_at field. The card may still indicate whether a
//      room was shared/granted to the target. v1 is intentionally not
//      a named view-tracking surface.
//
//   3. The TypeScript view models match the SQL contract: the desk row
//      type drops private_note_preview and surfaces has_private_note +
//      private_note_updated_at; the card room ref type drops
//      last_viewed_at and surfaces was_shared_or_granted; the desk UI
//      no longer renders a private note body in any list row.

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

  // 1. Desk RPC surface minimization
  const desk = sectionFor(sql, "get_relationship_desk_for_owner");
  assert.ok(desk, "Sprint 6.1 migration must redefine the desk RPC");
  const deskClean = stripSqlComments(desk!);
  assert.ok(
    !/private_note_preview/.test(deskClean),
    "desk RPC must not return private_note_preview"
  );
  assert.ok(
    /'has_private_note'/.test(deskClean),
    "desk RPC must surface has_private_note"
  );
  assert.ok(
    /'private_note_updated_at'/.test(deskClean),
    "desk RPC must surface private_note_updated_at"
  );
  // Defensive: the desk body must also not include any substring scan
  // of the note text (left(rpn.note, 120), substring(rpn.note, ...)).
  assert.ok(
    !/left\s*\(\s*rpn\.note/i.test(deskClean) &&
      !/substring\s*\(\s*rpn\.note/i.test(deskClean),
    "desk RPC must not slice or preview the note body"
  );

  // 2. Card RPC must drop named viewer surveillance entirely
  const card = sectionFor(sql, "get_relationship_card_for_owner");
  assert.ok(card, "Sprint 6.1 migration must redefine the card RPC");
  const cardClean = stripSqlComments(card!);
  for (const banned of [
    "shortlist_views",
    "artwork_views",
    "profile_views",
    "last_viewed_at",
    "buyer_score",
    "lead_score",
  ]) {
    assert.ok(
      !cardClean.includes(banned),
      `card RPC must not reference passive viewer signal "${banned}"`
    );
  }
  assert.ok(
    /'was_shared_or_granted'/.test(cardClean),
    "card RPC rooms section must surface was_shared_or_granted"
  );
  // The card RPC may still echo the full note body inside private_note.
  assert.ok(
    /'private_note',\s*v_note/.test(cardClean) ||
      /'private_note'/.test(cardClean),
    "card RPC may still return the full note body inside private_note"
  );

  // 3. TS view-model alignment
  const types = read("src/lib/visibility/types.ts");
  const deskRowBlock =
    types.match(/export type RelationshipDeskRow = \{[\s\S]*?\};/m)?.[0] ?? "";
  assert.ok(
    !/private_note_preview/.test(deskRowBlock),
    "RelationshipDeskRow must not declare private_note_preview"
  );
  assert.ok(
    /has_private_note:\s*boolean/.test(deskRowBlock),
    "RelationshipDeskRow must declare has_private_note: boolean"
  );
  assert.ok(
    /private_note_updated_at:\s*string\s*\|\s*null/.test(deskRowBlock),
    "RelationshipDeskRow must declare private_note_updated_at: string | null"
  );

  const roomRefBlockRaw =
    types.match(/export type RelationshipCardRoomRef = \{[\s\S]*?\};/m)?.[0] ?? "";
  // Strip TS line + block comments so a "we used to expose last_viewed_at"
  // rationale comment doesn't trip the field check.
  const roomRefBlock = roomRefBlockRaw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  assert.ok(
    !/last_viewed_at/.test(roomRefBlock),
    "RelationshipCardRoomRef must not declare last_viewed_at"
  );
  assert.ok(
    /was_shared_or_granted:\s*boolean/.test(roomRefBlock),
    "RelationshipCardRoomRef must declare was_shared_or_granted: boolean"
  );

  // 4. UI: desk row no longer renders the note body
  const page = read("src/app/my/relationships/page.tsx");
  assert.ok(
    !/private_note_preview/.test(page),
    "/my/relationships must not reference private_note_preview"
  );
  assert.ok(
    /has_private_note/.test(page),
    "/my/relationships must read has_private_note when rendering the desk row chip"
  );
  // The card body's room section should be driven by has_active_grant /
  // was_shared_or_granted, not by last_viewed_at.
  assert.ok(
    !/room\.last_viewed_at/.test(page),
    "/my/relationships must not branch on room.last_viewed_at"
  );

  // 5. Phase D — passport DTO must redact created_by behind owner /
  // delegate-writer. This invariant lives here (not in the trust-floor
  // file) because it is a Sprint 6.1 narrowing, not a Sprint 6 promise.
  for (const rel of [
    MIGRATION_REL,
    "supabase/migrations/20260609000000_artwork_passport_enum_cast_hotfix.sql",
  ]) {
    const body = read(rel);
    if (!body.includes("get_artwork_passport_for_viewer")) continue;
    const passport = sectionFor(body, "get_artwork_passport_for_viewer") ?? body;
    const clean = stripSqlComments(passport);
    if (rel === MIGRATION_REL) {
      // The new build pre-computes a `v_is_owner_or_delegate` boolean
      // from `auth.uid() = owner OR is_active_account_delegate_writer`,
      // then re-uses it in the visibility gate AND the created_by
      // projection. Pin both sides of that contract.
      assert.ok(
        /v_is_owner_or_delegate[\s\S]{0,200}is_active_account_delegate_writer\s*\(\s*v_owner\s*\)/i.test(
          clean
        ),
        "Sprint 6.1 passport must define v_is_owner_or_delegate from owner OR delegate-writer"
      );
      assert.ok(
        /'created_by',\s*case\s+when\s+v_is_owner_or_delegate\s+then\s+v_aw\.created_by\s+else\s+null\s+end/i.test(
          clean
        ),
        "Sprint 6.1 passport must gate created_by on v_is_owner_or_delegate"
      );
      assert.ok(
        !/'created_by',\s*v_aw\.created_by\s*,/i.test(clean),
        "Sprint 6.1 passport must not unconditionally project v_aw.created_by"
      );
    }
  }

  console.log("relationship-card-privacy.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
