import assert from "node:assert/strict";
import {
  artworkDimensionsCm,
  artworkMatchesDiscover,
  parseArtworkQuery,
  searchArtworkHrefs,
} from "../src/lib/search/artworkQuery";

const square = {
  visibility: "public" as const,
  work_kind: "artwork" as const,
  width_cm: 91.44,
  height_cm: 91.44,
  size: "36 × 36",
  size_unit: "in" as const,
  is_price_public: true,
  price_input_amount: 800000,
  price_input_currency: "KRW",
  price_usd: null,
  ownership_status: "available",
  pricing_mode: "fixed",
};

assert.equal(parseArtworkQuery("Wave V").text, "Wave V");
assert.equal(parseArtworkQuery("Wave V").hasConstraint, false);
assert.equal(parseArtworkQuery("현혜명").text, "현혜명");
assert.equal(parseArtworkQuery("h kim").text, "h kim");
assert.equal(parseArtworkQuery("cheerry blossom").text, "cheerry blossom");

const under = parseArtworkQuery("100cm 이하");
assert.equal(under.text, "");
assert.equal(under.sizeBounds.length, 1);
assert.equal(under.sizeBounds[0]?.op, "lte");
assert.equal(under.sizeBounds[0]?.cm, 100);
assert.equal(artworkMatchesDiscover(square, under), true);
assert.equal(artworkMatchesDiscover(square, parseArtworkQuery("50cm 이하")), false);

const over = parseArtworkQuery("50cm 이상");
assert.equal(over.sizeBounds[0]?.op, "gte");
assert.equal(artworkMatchesDiscover(square, over), true);
assert.equal(artworkMatchesDiscover(square, parseArtworkQuery("200cm 이상")), false);

const inches = parseArtworkQuery("36 in 이하");
assert.ok(Math.abs((inches.sizeBounds[0]?.cm ?? 0) - 91.44) < 0.001);
assert.equal(artworkMatchesDiscover(square, inches), true);

const exact = parseArtworkQuery("91.4 × 91.4 cm");
assert.equal(exact.text, "");
assert.ok(exact.sizeBox);
assert.equal(artworkMatchesDiscover(square, exact), true);
assert.equal(artworkMatchesDiscover(square, parseArtworkQuery("36 in")), true);

const mixed = parseArtworkQuery("물결 80cm 이하");
assert.equal(mixed.text, "물결");
assert.equal(mixed.sizeBounds[0]?.op, "lte");
assert.equal(mixed.sizeBounds[0]?.cm, 80);

const nameAndSize = parseArtworkQuery("현혜명 100cm 이하");
assert.equal(nameAndSize.text, "현혜명");
assert.equal(nameAndSize.sizeBounds[0]?.op, "lte");

const fromText = {
  visibility: "public" as const,
  work_kind: "artwork" as const,
  width_cm: null,
  height_cm: null,
  size: "91.4 × 91.4 cm",
  size_unit: null,
};
assert.equal(artworkMatchesDiscover(fromText, parseArtworkQuery("100cm 이하")), true);
assert.deepEqual(
  artworkDimensionsCm({ size: "91 × 91", size_unit: null, width_cm: null, height_cm: null }),
  null,
);
assert.equal(
  artworkMatchesDiscover(
    { visibility: "public", work_kind: "artwork", size: "91 × 91", size_unit: null, width_cm: null, height_cm: null },
    parseArtworkQuery("100cm 이하"),
  ),
  false,
);
assert.equal(
  artworkDimensionsCm({ size: "36", size_unit: "in", width_cm: null, height_cm: null }),
  null,
);

const widthBound = parseArtworkQuery("가로 100cm 이하");
assert.equal(widthBound.sizeBounds[0]?.axis, "width");
assert.equal(
  artworkMatchesDiscover(
    { ...square, width_cm: 120, height_cm: 40 },
    widthBound,
  ),
  false,
);

const box = parseArtworkQuery("80 x 100 cm 이하");
assert.equal(artworkMatchesDiscover({ ...square, width_cm: 70, height_cm: 90 }, box), true);
assert.equal(artworkMatchesDiscover({ ...square, width_cm: 90, height_cm: 120 }, box), false);

const price = parseArtworkQuery("100만원 이하");
assert.equal(price.priceBounds[0]?.currency, "KRW");
assert.equal(price.priceBounds[0]?.amount, 1_000_000);
assert.equal(price.priceBounds[0]?.op, "lte");
assert.equal(artworkMatchesDiscover(square, price), true);
assert.equal(
  artworkMatchesDiscover({ ...square, price_input_amount: 2_000_000 }, price),
  false,
);

const usd = parseArtworkQuery("under $500");
assert.equal(usd.text, "");
assert.equal(usd.priceBounds[0]?.currency, "USD");
assert.equal(usd.priceBounds[0]?.op, "lte");
assert.equal(usd.priceBounds[0]?.amount, 500);
assert.equal(
  artworkMatchesDiscover({ ...square, price_usd: 400, price_input_amount: null, price_input_currency: "USD" }, usd),
  true,
);
assert.equal(artworkMatchesDiscover(square, usd), false);
assert.equal(
  artworkMatchesDiscover(
    { ...square, price_usd: null, fx_rate_to_usd: 0.00075 },
    parseArtworkQuery("under $800"),
  ),
  true,
);

assert.equal(artworkMatchesDiscover({ ...square, is_price_public: false }, price), false);

const sale = parseArtworkQuery("판매 가능");
assert.equal(sale.sale, "available");
assert.equal(sale.text, "");
assert.equal(artworkMatchesDiscover({ ...square, price_input_amount: null }, sale), true);
assert.equal(artworkMatchesDiscover({ ...square, ownership_status: "sold" }, sale), false);

const goods = {
  visibility: "public" as const,
  work_kind: "art_goods" as const,
  width_cm: 20,
  height_cm: 20,
  size: "20 × 20 cm",
  size_unit: "cm" as const,
};
assert.equal(artworkMatchesDiscover(goods, parseArtworkQuery("wave")), false);
assert.equal(artworkMatchesDiscover(goods, parseArtworkQuery("굿즈")), true);
assert.equal(artworkMatchesDiscover(square, parseArtworkQuery("굿즈")), false);
assert.equal(artworkMatchesDiscover(goods, parseArtworkQuery("wave 굿즈")), true);
assert.equal(artworkMatchesDiscover({ ...goods, visibility: "draft" }, parseArtworkQuery("굿즈")), false);
assert.equal(artworkMatchesDiscover({ ...square, visibility: "draft" }, parseArtworkQuery("Wave")), false);

const links = searchArtworkHrefs({ artworkId: "abc", artistUsername: "siennamiko" });
assert.equal(links.artworkHref, "/artwork/abc");
assert.equal(links.artistHref, "/u/siennamiko");
assert.equal(
  searchArtworkHrefs({ artworkId: "abc", artistUsername: "@siennamiko" }).artistHref,
  "/u/siennamiko",
);
assert.equal(
  searchArtworkHrefs({ artworkId: "abc", artistUsername: "siennamiko", artistIsExternal: true }).artistHref,
  null,
);
assert.equal(searchArtworkHrefs({ artworkId: "abc", artistUsername: "user_abcd1234" }).artistHref, null);

console.log("artwork-search-query: ok");
