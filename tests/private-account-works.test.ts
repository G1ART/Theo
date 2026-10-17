// Private accounts (대표님 결정 followers_only, 20261017234802): their public
// works are seen only by the artist, editors (uploader, claim holders,
// delegates) and accepted followers. The policy and every definer RPC that
// skips RLS follow the same rule; hidden items stay and read "볼 수 없는 작품".

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { messages } from "../src/lib/i18n/messages";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const strip = (sql: string) =>
  sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

const FILE = "supabase/migrations/20261017234802_private_account_works_followers_only.sql";
const raw = read(FILE);
const sql = strip(raw);

// 1. Policies: the catch-all read goes, delegates keep the artist's public works.
assert.ok(/drop policy if exists artworks_public_read on public\.artworks;/.test(sql));
assert.ok(!/create policy artworks_public_read/.test(sql));
const delegate = sql.slice(sql.indexOf("create policy artworks_select_delegate"));
assert.ok(/for select\s+to authenticated/.test(delegate));
assert.ok(/visibility = 'public'::public\.artwork_visibility/.test(delegate), "public works only, no drafts");
assert.ok(/public\.is_active_delegate_of\(artist_id\)/.test(delegate));

// 2. Editor-safe SQL.
assert.equal((raw.match(/^-- == SECTION \d+ ==/gm) ?? []).length, 9);
for (const tag of sql.match(/\$[A-Za-z0-9_]*\$/g) ?? []) assert.match(tag, /^\$[A-Za-z]+\$$/);
assert.ok(
  /revoke all on function public\.artwork_account_visible_to_viewer\(uuid\) from public, anon, authenticated/.test(sql),
  "the rule helper is internal",
);
const helper = sql.slice(
  sql.indexOf("function public.artwork_account_visible_to_viewer"),
  sql.indexOf("-- == SECTION 2"),
);
for (const part of ["public.is_artist_publicly_visible(p_artist_id)", "public.viewer_is_accepted_follower_of(p_artist_id)", "public.is_active_delegate_of(p_artist_id)", "auth.uid() = p_artist_id"]) {
  assert.ok(helper.includes(part), part);
}

// 3. The latest definition of every RLS-skipping RPC carries the rule.
const files = readdirSync(path.join(ROOT, "supabase/migrations"))
  .filter((name) => /^\d{14}_.*\.sql$/.test(name))
  .sort();
function latestBody(fn: string): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  for (const file of files) {
    const text = strip(read(`supabase/migrations/${file}`));
    const re = new RegExp(`create or replace function public\\.${fn}\\(`, "gi");
    for (const m of text.matchAll(re)) {
      const rest = text.slice(m.index);
      const tag = /\bas\s+(\$[A-Za-z]*\$)/i.exec(rest)?.[1];
      assert.ok(tag, `${file}: ${fn} has a dollar-quoted body`);
      const open = rest.indexOf(tag);
      found = { file, body: rest.slice(open, rest.indexOf(tag, open + tag.length)) };
    }
  }
  assert.ok(found, `${fn} is defined`);
  return found;
}
for (const fn of [
  "artwork_viewer_fields",
  "get_artwork_passport_for_viewer",
  "get_room_for_viewer_by_token",
  "get_shortlist_items_by_token",
  "search_works_for_dedup",
]) {
  const { file, body } = latestBody(fn);
  assert.ok(body.includes("public.artwork_account_visible_to_viewer("), `${file}: ${fn} applies the account rule`);
}
assert.ok(/'artwork_visible', a\.id is not null/.test(latestBody("get_room_for_viewer_by_token").body));
const fields = latestBody("artwork_viewer_fields").body;
assert.ok(/p\.id = v_aw\.artist_id and p\.is_public = false/.test(fields), "cheap check first for public accounts");
for (const fn of ["notify_likers_on_state_event", "notify_likers_on_exhibition_link"]) {
  const { file, body } = latestBody(fn);
  assert.ok(/v_account_public := public\.is_artist_publicly_visible\(v_aw\.artist_id\)/.test(body), `${file}: ${fn}`);
  assert.ok(/public\.artwork_viewer_fields_as\(v_liker, v_aw\.id\)/.test(body), `${file}: ${fn} judges per liker`);
}

// 4. Nothing later brings the catch-all read back.
for (const file of files) {
  if (file <= path.basename(FILE)) continue;
  assert.ok(!/create policy\s+"?artworks_public_read/i.test(strip(read(`supabase/migrations/${file}`))), file);
}

// 5. Hidden items stay and say so (room and the owner's board).
const room = read("src/app/room/[token]/page.tsx");
assert.ok(room.includes("item.artwork_id && item.artwork_visible === false"));
assert.ok(room.includes('t("boards.unavailableWork")'));
const board = read("src/app/my/shortlists/[id]/page.tsx");
assert.ok(/\) : item\.artwork_id \? \(/.test(board), "an artwork item without a visible artwork");
assert.ok(board.includes('t("boards.unavailableWork")'));
for (const locale of ["en", "ko"] as const) {
  const table = messages[locale] as Record<string, string>;
  assert.ok(table["boards.unavailableWork"], `${locale}: boards.unavailableWork`);
  assert.ok(table["boards.unavailableWorkHint"], `${locale}: boards.unavailableWorkHint`);
}
assert.equal((messages.ko as Record<string, string>)["boards.unavailableWork"], "볼 수 없는 작품");

console.log("private-account-works: ok");
