// A tab screen opened before new works reached a tab keeps them when it
// saves: the tabs it read travel with every edit and go to the server,
// which merges. The database side runs in supabase/tests/stale_save_merge.sql.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addCustomTab,
  assignArtworksToCustomTab,
  buildSavePayload,
  parseStudioPortfolio,
  removeCustomTab,
} from "../src/lib/studio/studioPortfolioConfig";

const TAB_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TAB_B = "bbbbbbbb-bbbb-4ccc-9ddd-eeeeeeeeeeee";

const read = parseStudioPortfolio({
  studio_portfolio: {
    version: 1,
    custom_tabs: [
      { id: TAB_A, label: "A", public: true, artwork_ids: ["w1", "w2"] },
      { id: TAB_B, label: "B", public: true, artwork_ids: ["w3"] },
    ],
  },
});
const loaded = [
  { id: TAB_A, artwork_ids: ["w1", "w2"] },
  { id: TAB_B, artwork_ids: ["w3"] },
];
assert.deepEqual(read.loaded_tabs, loaded);
assert.deepEqual(parseStudioPortfolio(null).loaded_tabs, []);

const assigned = assignArtworksToCustomTab({
  portfolio: read,
  artworkIds: ["w1"],
  targetCustomId: TAB_B,
});
assert.deepEqual(assigned.custom_tabs?.map((t) => t.artwork_ids), [["w2"], ["w3", "w1"]]);
assert.deepEqual(assigned.loaded_tabs, loaded);
assert.deepEqual(addCustomTab(read, "C").loaded_tabs, loaded);
assert.deepEqual(removeCustomTab(read, TAB_B).loaded_tabs, loaded);
assert.deepEqual({ ...read, tab_strip_order: ["all"] }.loaded_tabs, loaded);

const payload = buildSavePayload(assigned);
assert.equal(
  Object.prototype.hasOwnProperty.call(payload.studio_portfolio as object, "loaded_tabs"),
  false,
  "loaded tabs are not stored",
);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const persist = readFileSync(join(root, "src/lib/studio/persistStudioPortfolio.ts"), "utf8");
assert.ok(persist.includes("p_loaded_tabs: next.loaded_tabs ?? null"));
assert.equal(persist.includes("updateMyProfileDetails"), false, "every tab save goes through the merging RPC");

const sql = readFileSync(
  join(root, "supabase/migrations/20261017224618_stale_tab_save_merge.sql"),
  "utf8",
);
const code = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .toLowerCase();
assert.ok((sql.match(/-- == SECTION \d+ ==/g) ?? []).length >= 2, "section banners");
for (const tag of sql.match(/\$[A-Za-z0-9_]*\$/g) ?? []) {
  assert.match(tag, /^\$[a-z]+\$$/, `dollar tag ${tag} must be letters only`);
}
assert.equal(/\bselect\b[^;]*?\binto\s+v_/.test(code), false, "use v_x := (select ...)");
assert.ok(code.includes("drop function if exists public.save_profile_studio_portfolio(uuid, jsonb, uuid)"));
assert.ok(code.includes("p_loaded_tabs jsonb default null"));
assert.ok(code.includes("if jsonb_typeof(p_loaded_tabs) = 'array' then"));
assert.ok(code.includes("public.can_manage_profile_tabs(p_profile_id, p_acting_profile_id)"));
assert.ok(code.includes("grant execute on function public.save_profile_studio_portfolio(uuid, jsonb, uuid, jsonb) to authenticated"));
assert.ok(code.includes("revoke all on function public.studio_tabs_merge(jsonb, jsonb, jsonb) from public, anon, authenticated"));
assert.ok(code.includes("notify pgrst, 'reload schema'"));

const dbCheck = readFileSync(join(root, "supabase/tests/stale_save_merge.sql"), "utf8");
assert.ok(dbCheck.includes("raise exception 'stale_save_merge: ok'"), "db check always rolls back");
assert.ok(dbCheck.includes("@example.invalid"), "db check uses throwaway accounts");

console.log("stale-tab-save.test.ts: ok");
