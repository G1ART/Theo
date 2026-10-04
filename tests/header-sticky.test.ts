// QA 2026-06-26 (#1) — keep the global Header sticky-at-top so deep
// links / SSR-scrolled landings never reveal a blank top of page.
// The resting bar is the sticky-bar layer. Modal scrims sit above it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { layer, layerLevel } from "../src/lib/ui/layers";

const SRC = readFileSync(
  path.resolve(__dirname, "..", "src/components/Header.tsx"),
  "utf8"
);

assert.equal(layer.stickyBar, "z-40");
assert.ok(layerLevel("scrim") > layerLevel("stickyBar"));
assert.ok(layerLevel("menu") > layerLevel("stickyBar"));
assert.ok(layerLevel("menu") > layerLevel("mobileNavScrim"));

assert.match(
  SRC,
  /sticky top-0 bg-white \$\{mobileOpen \? layer\.menu : layer\.stickyBar\}/,
  "Header outer wrapper stays sticky and uses the sticky-bar layer",
);

assert.equal(
  /sticky\s+top-0[^"]*z-(50|60|70|80|90|100)/.test(SRC),
  false,
  "Header sticky wrapper must stay below the modal scrim",
);

assert.match(
  SRC,
  /<header[\s\S]{0,120}\brelative\b/,
  "Inner <header> must keep `relative` for the mobile dropdown anchor",
);

console.log("header-sticky.test.ts: ok");
