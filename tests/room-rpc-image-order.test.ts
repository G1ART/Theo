// Shared rooms / boards: the token RPCs must order artwork images by
// artwork_images.sort_order. artwork_images has no "position" column, and
// 20261009220000 shipped `order by ai."position"`, so every active room
// failed with 42703 until 20261017224527.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const DIR = path.join(ROOT, "supabase/migrations");
const strip = (sql: string) =>
  sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

function latestBody(fn: string): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  for (const file of files) {
    const sql = strip(readFileSync(path.join(DIR, file), "utf8"));
    const start = sql.search(new RegExp(`create or replace function public\\.${fn}\\(`, "i"));
    if (start < 0) continue;
    const rest = sql.slice(start);
    const tag = rest.match(/as\s+(\$[A-Za-z_]*\$)/i)?.[1];
    assert.ok(tag, `${file}: ${fn} has a dollar-quoted body`);
    const open = rest.indexOf(tag);
    const close = rest.indexOf(tag, open + tag.length);
    found = { file, body: rest.slice(open, close + tag.length) };
  }
  assert.ok(found, `${fn} is defined in a migration`);
  return found;
}

for (const fn of ["get_room_for_viewer_by_token", "get_shortlist_items_by_token"]) {
  const { file, body } = latestBody(fn);
  assert.ok(!/\bai\."?position"?/i.test(body), `${file}: ${fn} orders images by a missing column`);
  assert.ok(/order by ai\.sort_order/i.test(body), `${file}: ${fn} orders images by sort_order`);
  assert.ok(/si\."position"/.test(body), `${file}: ${fn} keeps the board item order`);
}

const fix = readFileSync(path.join(DIR, "20261017224527_room_rpc_image_order.sql"), "utf8");
assert.equal((fix.match(/^-- == SECTION \d+ ==/gm) ?? []).length, 2);
for (const tag of strip(fix).match(/\$[A-Za-z0-9_]*\$/g) ?? []) assert.match(tag, /^\$[A-Za-z]+\$$/);
assert.ok(!/select[^;]*\binto\s+v_/i.test(strip(fix)), "assignments use :=");

const pitch = readFileSync(path.join(ROOT, "src/app/api/ai/board-pitch-pack/route.ts"), "utf8");
assert.ok(!/artworks!artwork_id\([^)]*keywords/.test(pitch), "artworks has no keywords column");

console.log("room-rpc-image-order: ok");
