// QA 2026-06-26 (#1) — keep the global Header sticky-at-top so deep
// links / SSR-scrolled landings never reveal a blank top of page.
// Modals (z-50+) must still cover the bar, so we pin z-40 as the
// header's stacking ceiling.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const SRC = readFileSync(
  path.resolve(__dirname, "..", "src/components/Header.tsx"),
  "utf8"
);

// The outermost wrapper of the header tree must declare sticky + a
// z-index below the modal layer.
assert.ok(
  /sticky\s+top-0[^"]*z-40/.test(SRC),
  "Header outer wrapper must be `sticky top-0 z-40` (QA #1)"
);

// And it must NOT be z-50+, which would compete with modals for the
// same paint layer.
assert.equal(
  /sticky\s+top-0[^"]*z-(50|60|70|80|90|100)/.test(SRC),
  false,
  "Header sticky wrapper must stay below modal layer"
);

// The inner <header> must keep `relative` so the mobile menu's
// `absolute top-full` anchoring still resolves to the bar.
assert.ok(
  /<header className="relative\b/.test(SRC),
  "Inner <header> must keep `relative` for the mobile dropdown anchor"
);

console.log("header-sticky.test.ts: ok");
