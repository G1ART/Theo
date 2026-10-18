// Who took an invite (external_artists.claimed_profile_id) is written only by
// the owner-run functions: the verified-email merge, the self-claim of a
// name-only invite, and the profile link once the target verified the
// invite email (20261018001729). Signed-in users and anon cannot write it.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const DIR = path.join(ROOT, "supabase/migrations");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const strip = (sql: string) =>
  sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

const NAME = "20261018001729_external_artist_claim_guard.sql";
const raw = read(`supabase/migrations/${NAME}`);
const sql = strip(raw);

// 1. Privileges: anon writes nothing, authenticated writes every column but one.
assert.ok(/revoke insert, update, delete, truncate, references, trigger on public\.external_artists from anon;/.test(sql));
assert.ok(/revoke insert, update, truncate, references, trigger on public\.external_artists from authenticated;/.test(sql));
const columnsOf = (verb: "insert" | "update") => {
  const m = new RegExp(`grant ${verb} \\(([^)]*)\\) on public\\.external_artists to authenticated;`).exec(sql);
  assert.ok(m, `column-level ${verb} grant`);
  return m[1].split(",").map((c) => c.trim()).filter(Boolean).sort();
};
const insertCols = columnsOf("insert");
const updateCols = columnsOf("update");
assert.deepEqual(insertCols, updateCols);
assert.ok(!insertCols.includes("claimed_profile_id"));
for (const col of ["display_name", "display_name_ko", "display_name_en", "invite_email", "invited_by", "website", "instagram", "status"]) {
  assert.ok(insertCols.includes(col), col);
}
assert.equal(insertCols.length, 17);

// 2. The trigger refuses the column from client roles even after a re-grant.
assert.ok(/before insert or update of claimed_profile_id on public\.external_artists/.test(sql));
assert.ok(/current_user in \('anon', 'authenticated'\)/.test(sql));
assert.ok(/new\.claimed_profile_id is distinct from old\.claimed_profile_id/.test(sql));
assert.ok(/using errcode = '42501'/.test(sql));
const guardAt = sql.indexOf("function public.external_artists_guard_claimed_profile()");
const guard = sql.slice(guardAt, sql.indexOf("$a$;", guardAt));
assert.ok(guardAt >= 0 && guard.includes("returns trigger"));
assert.ok(!/security definer/.test(guard), "the guard must see the caller's role");

// 3. Editor-safe SQL.
assert.equal((raw.match(/^-- == SECTION \d+ ==/gm) ?? []).length, 3);
for (const tag of sql.match(/\$[A-Za-z0-9_]*\$/g) ?? []) assert.match(tag, /^\$[A-Za-z]+\$$/);
assert.ok(!/select[^;]*\binto\s+v_/i.test(sql), "assignments use :=");

// 4. The newest link RPC follows the merge rule and is closed to anon.
const files = readdirSync(DIR).filter((n) => /^\d{14}_.*\.sql$/.test(n)).sort();
let link = "";
for (const file of files) {
  const text = strip(readFileSync(path.join(DIR, file), "utf8"));
  const at = text.search(/create or replace function public\.link_external_artist_to_profile\(/);
  if (at >= 0) link = text.slice(at);
}
link = link.slice(0, link.indexOf("$a$;") + 4);
assert.ok(/u\.email_confirmed_at is not null/.test(link));
assert.ok(/lower\(trim\(u\.email\)\) = lower\(v_email\)/.test(link));
assert.ok(/is_active_writer_for\(v_inviter\)/.test(link));
assert.ok(/revoke all on function public\.link_external_artist_to_profile\(uuid, uuid\) from public, anon;/.test(sql));

// 5. Nothing later opens the table to client writes again.
for (const file of files) {
  if (file <= NAME) continue;
  const text = strip(readFileSync(path.join(DIR, file), "utf8"));
  assert.ok(
    !/grant\s+(all|insert|update)(\s+privileges)?\s+on\s+(table\s+)?(public\.external_artists|all tables in schema public)/i.test(text),
    `${file}: table-wide write grant on external_artists`,
  );
}

// 6. The app's own direct write stays on allowed columns.
for (const rel of ["src/app/artwork/[id]/edit/page.tsx"]) {
  const src = read(rel);
  const at = src.indexOf('.from("external_artists")');
  assert.ok(at >= 0, rel);
  assert.ok(!src.slice(at, at + 200).includes("claimed_profile_id"), rel);
}

console.log("external-artist-claim-guard: ok");
