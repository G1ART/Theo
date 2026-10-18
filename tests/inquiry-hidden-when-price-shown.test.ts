// 대표님 결정 public_price_inquire = hide_button: a viewer who is shown the
// price gets no new "문의하기" on cards, the artwork detail or rooms; the form
// is not opened for them. Works whose price is held back keep it, and an
// inquiry already made ("문의 이어 보기", "답장 보기", its thread) stays.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inquiryFormOpens, inquiryFormOpensForFields } from "../src/lib/inquiry/askable";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

// 1. One rule, on the server's per-viewer fields.
assert.equal(inquiryFormOpens({ priceGated: true, pricingMode: null, isPricePublic: null }), true, "held back");
assert.equal(inquiryFormOpens({ priceGated: false, pricingMode: "inquire", isPricePublic: null }), true, "on request");
assert.equal(inquiryFormOpens({ priceGated: false, pricingMode: "fixed", isPricePublic: false }), true, "kept private");
assert.equal(inquiryFormOpens({ priceGated: false, pricingMode: "fixed", isPricePublic: true }), false, "price shown");
assert.equal(inquiryFormOpensForFields({ price_gate: { required_audience: "mutuals" } }), true);
assert.equal(inquiryFormOpensForFields({ pricing_mode: "fixed", is_price_public: true, price_gate: null }), false);
assert.equal(inquiryFormOpensForFields({}), false, "no judged price, no form");
const askable = read("src/lib/inquiry/askable.ts");
assert.ok(!/supabase|from\("artworks"\)/.test(askable), "reads fields it is given, never the stored price");

// 2. Likes card: a new inquiry only where the form opens; states first.
const view = read("src/lib/likes/likedWorksView.ts");
const cta = view.slice(view.indexOf("export function likedCta"));
assert.ok(cta.indexOf('kind: "reply"') < cta.indexOf("inquiryFormOpensForFields(art)"), "an inquiry already made wins");
assert.ok(cta.indexOf('kind: "continue"') < cta.indexOf("inquiryFormOpensForFields(art)"));
assert.ok(cta.includes('return inquiryFormOpensForFields(art) ? { kind: "ask", href: `${detail}?ask=1` } : { kind: "none" };'));

// 3. Detail: same rule for the form; the viewer's own inquiry is shown even
//    when the price is; gate boxes offer "문의하기" only when the form opens.
const detail = read("src/app/artwork/[id]/page.tsx");
assert.ok(/const showPriceInquiryBlock =\s+canInquire &&\s+inquiryFormOpens\(\{\s+priceGated: priceIsGated,/.test(detail));
assert.ok(/if \(!id \|\| !canInquire\) return;\s[\s\S]{0,400}getMyInquiryForArtwork\(id\)/.test(detail), "own inquiry loads regardless of price");
assert.ok(detail.includes("{(showPriceInquiryBlock || myPriceInquiry) && ("));
assert.ok(/const openInquiryForm = showPriceInquiryBlock \? \(\) => setShowInquiryForm\(true\) : undefined;/.test(detail));
assert.equal((detail.match(/onAskAboutWork=\{openInquiryForm\}/g) ?? []).length, 3);
assert.ok(!detail.includes("onAskAboutWork={() => setShowInquiryForm(true)}"));
const gate = read("src/components/visibility/GatedField.tsx");
assert.ok(gate.includes("const canAsk = Boolean(onAskAboutWork);"));
assert.ok(gate.includes('{cta.kind === "inquiry" && canAsk && ('));
assert.ok(gate.includes("const showSecondaryInquiry = canAsk && shouldShowSecondaryInquiryCta(cta, fieldKey);"));

// 4. Room: per-viewer fields from the server decide each work's link and the
//    room-level link's target.
const room = read("src/app/room/[token]/page.tsx");
assert.ok(room.includes("fetchArtworkViewerFields(visibleArtworkKey.split(\",\"))"));
assert.ok(room.includes("if (inquiryFormOpensForFields(value)) next.add(artworkId);"));
assert.ok(/\{askableIds\.has\(item\.artwork_id\) \? \(\s+<Link[\s\S]{0,600}\{t\("inquiry\.cta"\)\}\s+<\/Link>\s+\) : null\}/.test(room));
assert.ok(/items\.find\(\(i\) => i\.artwork_id && askableIds\.has\(i\.artwork_id\)\)/.test(room));

console.log("inquiry-hidden-when-price-shown: ok");
