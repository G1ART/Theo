// Search SQL widens matching (KO/EN slots, one-character typos) without
// loosening viewer rules. The latest definitions read no stored price or
// availability column and return no whole artwork rows, artwork search
// runs as the caller so artworks RLS hides drafts, and the never-applied
// 2026-10-07 file stays inert.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "supabase", "migrations");
const files = readdirSync(dir)
  .filter((name) => /^\d{14}_.*\.sql$/.test(name))
  .sort();

function codeOf(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

function latest(fn: string): { file: string; sql: string } {
  let found: { file: string; sql: string } | null = null;
  const re = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${fn}\\s*\\(`, "gi");
  for (const file of files) {
    const code = codeOf(readFileSync(join(dir, file), "utf8"));
    for (const m of code.matchAll(re)) {
      const rest = code.slice(m.index);
      const tag = /\bas\s+(\$[a-z]*\$)/i.exec(rest)?.[1];
      assert.ok(tag, `${file}: ${fn} has a dollar-quoted body`);
      const open = rest.indexOf(tag);
      found = { file, sql: rest.slice(0, rest.indexOf(tag, open + tag.length) + tag.length) };
    }
  }
  assert.ok(found, `${fn} is defined in a timestamped migration`);
  return found;
}

const LOCKED =
  /\b(ownership_status|pricing_mode|is_price_public|price_input_amount|price_input_currency|fx_rate_to_usd|fx_date|price_usd)\b/;

const dedup = latest("search_works_for_dedup");
assert.match(
  dedup.sql,
  /returns\s+table\s*\(\s*id uuid, title text, title_ko text, title_en text, created_at timestamptz\s*\)/i,
  `${dedup.file}: search_works_for_dedup returns titles only`,
);
assert.doesNotMatch(dedup.sql, /setof\s+public\.artworks|select\s+a\.\*/i, `${dedup.file}: no whole artwork rows`);

const ids = latest("search_artwork_ids");
assert.match(ids.sql, /returns\s+table\s*\(\s*id uuid\s*\)/i, `${ids.file}: search_artwork_ids returns ids`);
assert.match(ids.sql, /security\s+invoker/i, `${ids.file}: artworks RLS applies to the caller`);

for (const fn of ["search_people", "search_people_with_external", "search_artists_by_artwork", "search_works_for_dedup"]) {
  const { file, sql } = latest(fn);
  assert.match(sql, /security\s+definer/i, `${file}: ${fn} stays security definer`);
  assert.match(sql, /set\s+search_path\s*=\s*public/i, `${file}: ${fn} pins search_path`);
}

for (const fn of [
  "search_artwork_ids",
  "search_people",
  "search_people_with_external",
  "search_artists_by_artwork",
  "search_works_for_dedup",
]) {
  const { file, sql } = latest(fn);
  assert.doesNotMatch(sql, LOCKED, `${file}: ${fn} must not read a locked price or availability column`);
  assert.match(sql, /word_similarity/, `${file}: ${fn} accepts a light typo`);
}

const old = readFileSync(join(dir, "20261007160000_search_artist_name_and_typo.sql"), "utf8");
assert.match(old, /^-- 적용하지 말 것/, "20261007160000 says not to apply it");
assert.equal(codeOf(old).trim(), "", "20261007160000 has no executable SQL");

for (const file of [
  "20261017230024_search_name_and_typo_live.sql",
  "20261017230340_search_typo_numbers_dedup_order.sql",
]) {
  const sql = readFileSync(join(dir, file), "utf8");
  assert.ok(!/\$[a-z]*_[a-z_]*\$/i.test(sql), `${file}: dollar tags are letters only`);
  assert.match(sql, /-- == SECTION 2 ==/, `${file}: functions are split into sections`);
}

console.log("search-typo-sql-contract.test.ts: ok");
