// The edit screen changes a work's invite email in one server call
// (20261018041803): the refusal rule runs before an invite is created, and the
// invite lookup and the claim move share a transaction, so a refused address
// leaves no empty invite.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const strip = (sql: string) =>
  sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

const raw = read("supabase/migrations/20261018041803_claim_external_artist_atomic.sql");
const sql = strip(raw);

// 1. Editor-safe SQL.
assert.equal((raw.match(/^-- == SECTION \d+ ==/gm) ?? []).length, 2);
for (const tag of sql.match(/\$[A-Za-z0-9_]*\$/g) ?? []) assert.match(tag, /^\$[A-Za-z]+\$$/);
assert.ok(!/select[^;]*\binto\s+v_/i.test(sql), "assignments use :=");

const bodyOf = (fn: string) => {
  const at = sql.indexOf(`function public.${fn}(`);
  assert.ok(at >= 0, fn);
  return sql.slice(at, sql.indexOf("$a$;", at));
};

// 2. prepare: who may edit the claim, then the refusal rule, then the invite.
const prepare = bodyOf("prepare_claim_external_artist");
assert.ok(/security definer/.test(prepare));
assert.ok(/v_subject <> v_uid and not public\.is_active_writer_for\(v_subject\)/.test(prepare));
const refuseAt = prepare.indexOf("raise exception 'invite_email_verified_by_other_account'");
const createAt = prepare.indexOf("public.get_or_create_external_artist(");
assert.ok(refuseAt > 0 && createAt > refuseAt, "the rule is checked before any invite is created");
assert.ok(/v_new is distinct from v_old and public\.invite_email_verified_by_account\(v_new\)/.test(prepare));

// 3. set_claim: one call, the caller's claims RLS, nothing kept on failure.
const setClaim = bodyOf("set_claim_external_artist");
assert.ok(/security invoker/.test(setClaim), "the claim update keeps the caller's RLS");
assert.ok(/v_ext := public\.prepare_claim_external_artist\(p_claim_id, p_display_name, p_invite_email\)/.test(setClaim));
assert.ok(/update public\.claims[\s\S]*external_artist_id = v_ext[\s\S]*where id = p_claim_id/.test(setClaim));
assert.ok(/if v_rows = 0 then\s+raise exception 'claim not found'/.test(setClaim), "no row updated rolls the invite back");
for (const fn of ["prepare_claim_external_artist(uuid, text, text)", "set_claim_external_artist(uuid, text, text, text)"]) {
  const name = fn.replace(/[()]/g, (c) => `\\${c}`);
  assert.ok(new RegExp(`revoke all on function public\\.${name} from public, anon;`).test(sql), fn);
  assert.ok(new RegExp(`grant execute on function public\\.${name} to authenticated;`).test(sql), fn);
}

// 4. The edit screen uses it for a new or changed email, and nothing else
//    on that path writes the claim before the server answers.
const rpc = read("src/lib/provenance/rpc.ts");
assert.ok(/supabase\.rpc\("set_claim_external_artist"/.test(rpc));
const edit = read("src/app/artwork/[id]/edit/page.tsx");
const branchAt = edit.indexOf("if (!existingExtId || emailAdded) {");
const branch = edit.slice(branchAt, edit.indexOf("} else {", branchAt));
assert.ok(branch.includes("await setClaimExternalArtist({"), "email change goes through the one-call RPC");
assert.ok(branch.includes("claimId: myClaim.id"));
assert.ok(!branch.includes("createExternalArtist(") && !branch.includes("updateClaim("), "no two-step write on this path");
assert.ok(branch.includes('formatSupabaseError(extErr, t, "artwork.errors.failedAddArtist")'), "refusal copy still comes from the error map");
assert.ok(!/\bcreateExternalArtist,/.test(edit.slice(0, edit.indexOf('from "@/lib/provenance/rpc"'))), "edit screen no longer imports the two-step helper");

console.log("claim-external-artist-atomic: ok");
