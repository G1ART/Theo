// SQL contract for the likes tab. Source-text checks, like
// visibility-sql-contract.test.ts.

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

const liked = strip(read("supabase/migrations/20261017223000_liked_works.sql"));
const lock = strip(read("supabase/migrations/20261017223500_artwork_likes_private.sql"));

// 1. State log keeps state names, never amounts, and is not client-readable.
const table = liked.slice(
  liked.indexOf("create table if not exists public.artwork_state_events"),
  liked.indexOf("create index if not exists idx_artwork_state_events_artwork_created"),
);
assert.ok(table.length > 0, "artwork_state_events is defined");
assert.ok(!/price_input_amount|price_usd|amount\s+numeric/i.test(table), "no amount column");
assert.ok(/alter table public\.artwork_state_events enable row level security/.test(liked));
assert.ok(/revoke all on public\.artwork_state_events from public, anon, authenticated/.test(liked));
assert.ok(!/create policy[^;]*artwork_state_events/i.test(liked), "no client policy on the state log");
assert.ok(
  /v_from := public\.artwork_price_state\(old\.pricing_mode::text, old\.is_price_public, old\.price_input_amount is not null\)/.test(
    liked,
  ),
  "the trigger stores whether a price is shown, not the price",
);
assert.ok(/after update of ownership_status, pricing_mode, is_price_public, price_input_amount/.test(liked));

// 2. The list judges with the same function as cards and the detail page.
const list = liked.slice(liked.indexOf("create or replace function public.list_my_liked_artworks"));
assert.ok(/security definer/.test(list.slice(0, 600)));
assert.ok(/v_uid uuid := auth\.uid\(\)/.test(list));
assert.ok(/where l\.user_id = v_uid/.test(list), "only the caller's likes");
assert.ok(/public\.artwork_viewer_fields\(lk\.aid\)/.test(list), "availability and price via artwork_viewer_fields");
assert.ok(
  /\(public\.artwork_viewer_fields\(a2\.id\)->>'ownership_status'\) = 'available'/.test(list),
  "more-by-artist counts only works the viewer can see as available",
);
assert.ok(/revoke all on function public\.list_my_liked_artworks\(integer\) from public, anon/.test(liked));
assert.ok(/grant execute on function public\.list_my_liked_artworks\(integer\) to authenticated/.test(liked));

// A price change is shown only when the viewer can see the price now.
assert.ok(
  /sc\.kind = 'price'\s+and sc\.to_state = 'listed'\s+and \(sc\.vf->>'pricing_mode'\) = 'fixed'\s+and \(sc\.vf->>'is_price_public'\) = 'true'/.test(
    list,
  ),
);

// 3. Feed edges: public artist / curator likers only, signed-in callers only.
const edges = liked.slice(liked.indexOf("create or replace function public.get_like_edges_for_works"));
assert.ok(/coalesce\(p\.is_public, true\)/.test(edges));
assert.ok(/limit 80/.test(edges));
assert.ok(/revoke all on function public\.get_like_edges_for_works\(uuid\[\]\) from public, anon/.test(liked));

// 4. Lock: own rows only, grant kept so anon embeds return 0 instead of failing.
assert.ok(/drop policy if exists artwork_likes_select_all on public\.artwork_likes/.test(lock));
assert.ok(/create policy artwork_likes_select_own[\s\S]*using \(user_id = auth\.uid\(\)\)/.test(lock));
assert.ok(!/revoke\s+select\s+on\s+public\.artwork_likes/i.test(lock));

// 5. Release rules: sections for several functions, letters-only dollar tags.
const raw = read("supabase/migrations/20261017223000_liked_works.sql");
assert.ok(/-- == SECTION 5 ==/.test(raw));
assert.ok(!/\$[a-z]*_[a-z_]*\$/i.test(raw));

// 6. Client: nobody reads other people's like rows from the table.
const pools = read("src/lib/feed/walk/loadPools.ts");
const likeReads = pools.match(/from\("artwork_likes"\)[\s\S]{0,160}/g) ?? [];
for (const block of likeReads) {
  assert.ok(/\.eq\("user_id", userId\)/.test(block), "feed reads only the viewer's own likes from the table");
}
assert.ok(/rpc\("get_like_edges_for_works"/.test(pools));

console.log("liked-works-sql-contract.test.ts: ok");
