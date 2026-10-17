// Price and availability reach the browser only as judged by the server
// (`artwork_cards.viewer_fields`). Sold is public; price and every other
// availability value follow the owner's visibility policy.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  applyViewerFields,
  mergeViewerFields,
  readViewerFields,
} from "../src/lib/artworks/viewerFields";
import { cardTradeView } from "../src/lib/artworks/cardTrade";
import { copyContainsForbidden, getCardGateCopy } from "../src/lib/visibility/copy";

const ROOT = path.resolve(__dirname, "..");
const GATE = { required_audience: "mutuals", request_mode: null };

// 1. viewer_fields lands on the familiar keys and the jsonb is dropped.
const judged = applyViewerFields({
  id: "a1",
  title: "Wave",
  viewer_fields: {
    ownership_status: null,
    pricing_mode: null,
    is_price_public: null,
    price_input_amount: null,
    price_gate: GATE,
    availability_gate: GATE,
  },
});
assert.equal("viewer_fields" in judged, false);
assert.equal((judged as Record<string, unknown>).price_input_amount, null);
assert.deepEqual((judged as Record<string, unknown>).price_gate, GATE);

const owner = applyViewerFields({
  id: "a2",
  viewer_fields: {
    ownership_status: "available",
    pricing_mode: "fixed",
    is_price_public: false,
    price_input_amount: "1600000",
    price_input_currency: "KRW",
    price_gate: null,
    availability_gate: null,
  },
}) as Record<string, unknown>;
assert.equal(owner.price_input_amount, 1_600_000);
assert.equal(owner.price_gate, null);

// Rows read without viewer_fields are untouched.
const plain = { id: "a3", title: "x" };
assert.equal(applyViewerFields(plain), plain);

// A missing object means nothing is visible.
assert.equal(readViewerFields(null).ownership_status, null);

// 2. Server-rendered rows pick up the signed-in viewer's values.
const rows = [{ id: "a1", ownership_status: null as string | null }];
const merged = mergeViewerFields(rows, new Map([["a1", readViewerFields({ ownership_status: "sold" })]]));
assert.equal(merged[0].ownership_status, "sold");
assert.equal(mergeViewerFields(rows, new Map()), rows);

// 3. Card lines.
assert.deepEqual(cardTradeView({ ownership_status: null, price_gate: GATE, availability_gate: GATE }), {
  showStatus: false,
  showPrice: false,
  gate: { fieldKey: "price_availability", audience: "mutuals" },
});
// Sold is public: the card says sold and nothing about the held-back price.
assert.deepEqual(cardTradeView({ ownership_status: "sold", price_gate: GATE, availability_gate: null }), {
  showStatus: true,
  showPrice: false,
  gate: null,
});
assert.deepEqual(cardTradeView({ ownership_status: "available", price_gate: null, availability_gate: null }), {
  showStatus: true,
  showPrice: true,
  gate: null,
});
assert.deepEqual(
  cardTradeView({ ownership_status: "available", price_gate: GATE, availability_gate: null }).gate,
  { fieldKey: "price", audience: "mutuals" },
);
assert.equal(
  cardTradeView({ ownership_status: null, price_gate: null, availability_gate: { required_audience: "nope", request_mode: null } })
    .gate?.audience,
  "owner_only",
);

// 4. Card gate copy.
assert.equal(
  getCardGateCopy({ fieldKey: "price_availability", requiredAudience: "mutuals", locale: "ko" }),
  "가격과 소장 여부는 맞팔로우에게 공개",
);
assert.equal(
  getCardGateCopy({ fieldKey: "price_availability", requiredAudience: "mutuals", locale: "en" }),
  "Price and availability shared with mutual connections",
);
for (const audience of ["public", "signed_in", "followers", "following", "mutuals", "approved", "delegates", "owner_only"] as const) {
  for (const fieldKey of ["price", "availability", "price_availability"] as const) {
    for (const locale of ["ko", "en"] as const) {
      const text = getCardGateCopy({ fieldKey, requiredAudience: audience, locale });
      assert.ok(text.length > 0);
      assert.equal(copyContainsForbidden(text), null, text);
    }
  }
}

// 5. No client read selects the stored price/status columns from the
//    artworks table. Writes (insert/update payloads) are fine.
const SENSITIVE = /\b(ownership_status|pricing_mode|is_price_public|price_usd|price_input_amount|price_input_currency|fx_rate_to_usd|fx_date)\b/;
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}
const offenders: string[] = [];
for (const file of walk(path.join(ROOT, "src"))) {
  const text = readFileSync(file, "utf8");
  const re = /\.from\(\s*["']artworks["']\s*\)\s*\.select\(\s*(`[\s\S]*?`|"[^"]*"|'[^']*')/g;
  for (const m of text.matchAll(re)) {
    if (SENSITIVE.test(m[1]) || /^["'`]\s*\*/.test(m[1])) {
      offenders.push(`${path.relative(ROOT, file)}: ${m[1].slice(0, 60).replace(/\s+/g, " ")}`);
    }
  }
  const constRe = /\.from\(\s*["']artworks["']\s*\)\s*\.select\(\s*(ARTWORK_SELECT|FEED_ARTWORK_SELECT|PUBLIC_FILTER_SELECT|PICKER_SELECT)\b/g;
  for (const m of text.matchAll(constRe)) offenders.push(`${path.relative(ROOT, file)}: ${m[1]} on artworks`);
}
assert.deepEqual(offenders, [], "stored price/status columns must come from artwork_cards.viewer_fields");

// 6. SQL contract for the rule.
const sql = readFileSync(
  path.join(ROOT, "supabase/migrations/20261017221000_artwork_viewer_fields.sql"),
  "utf8",
);
assert.ok(/with \(security_invoker = true\)/.test(sql), "artwork_cards must apply artworks RLS for the caller");
assert.ok(/'sold_public'/.test(sql), "the resolver must carry the sold rule");
assert.ok(
  /revoke all on function public\.artwork_viewer_is_editor\(uuid, uuid, uuid\) from public, anon, authenticated/.test(sql),
  "the editor helper is internal",
);
assert.ok(
  /returns table\(id uuid, title text, title_ko text, title_en text, created_at timestamptz\)/.test(sql),
  "search_works_for_dedup must not return whole artwork rows",
);
const view = sql.slice(sql.indexOf("create or replace view public.artwork_cards"), sql.indexOf("from public.artworks a;"));
assert.equal(SENSITIVE.test(view.replace(/viewer_fields/g, "")), false, "the view must not expose stored price/status columns");
assert.ok(!/\$[a-z]*_[a-z_]*\$/i.test(sql), "dollar tags are letters only");
assert.ok(/-- == SECTION 9 ==/.test(sql), "functions are split into sections");

console.log("artwork-viewer-fields.test.ts: ok");
