// P1 (2026-08-19) — Unit tests for `parseSizeToDimensionsCm`.
//
// We do NOT re-cover `parseSizeWithUnit` (already load-bearing for the
// display formatter and validated by the display-formatter tests). Only
// the new wrapper is under test here: unit resolution, hosu passthrough,
// bare-number ambiguity, smart-quote normalization, and depth extraction.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSizeToDimensionsCm } from "./format";

function nearly(actual: number, expected: number, epsilon = 0.001): boolean {
  return Math.abs(actual - expected) <= epsilon;
}

test("cm marker + uppercase X", () => {
  const r = parseSizeToDimensionsCm("91 X 91cm", null);
  assert.ok(r);
  assert.equal(r!.widthCm, 91);
  assert.equal(r!.heightCm, 91);
  assert.equal(r!.depthCm, undefined);
});

test("Unicode × separator + cm marker", () => {
  const r = parseSizeToDimensionsCm("91 × 91 cm", null);
  assert.ok(r);
  assert.equal(r!.widthCm, 91);
  assert.equal(r!.heightCm, 91);
});

test("decimal cm dimensions", () => {
  const r = parseSizeToDimensionsCm("91.5 × 91.5 cm", "cm");
  assert.ok(r);
  assert.equal(r!.widthCm, 91.5);
  assert.equal(r!.heightCm, 91.5);
});

test("bare numbers + storedUnit=in → cm-normalized", () => {
  const r = parseSizeToDimensionsCm("16 x 20", "in");
  assert.ok(r);
  assert.ok(nearly(r!.widthCm, 40.64));
  assert.ok(nearly(r!.heightCm, 50.8));
});

test('inch marker via escaped straight quotes ("9\\" x 12\\"")', () => {
  const r = parseSizeToDimensionsCm('9" x 12"', null);
  assert.ok(r);
  assert.ok(nearly(r!.widthCm, 22.86));
  assert.ok(nearly(r!.heightCm, 30.48));
});

test("inch marker via smart quotes (U+201D)", () => {
  const r = parseSizeToDimensionsCm("36” x 36”", null);
  assert.ok(r);
  assert.ok(nearly(r!.widthCm, 91.44));
  assert.ok(nearly(r!.heightCm, 91.44));
});

test("hosu with parenthesized cm — F table wins over parsed dims", () => {
  // 30F → 92 × 73 cm via the shared hosu table.
  const r = parseSizeToDimensionsCm("30F (92.0 x 73.0 cm)", "cm");
  assert.ok(r);
  assert.equal(r!.widthCm, 92);
  assert.equal(r!.heightCm, 73);
  assert.equal(r!.depthCm, undefined);
});

test('bare-number "호" without F/P/M/S returns null', () => {
  const r = parseSizeToDimensionsCm("30호", null);
  assert.equal(r, null);
});

test('free-form ("Variable size") returns null', () => {
  assert.equal(parseSizeToDimensionsCm("Variable size", null), null);
  assert.equal(parseSizeToDimensionsCm("가변설치", null), null);
  assert.equal(parseSizeToDimensionsCm("N/A", null), null);
});

test("empty / whitespace / null / undefined return null", () => {
  assert.equal(parseSizeToDimensionsCm("", "cm"), null);
  assert.equal(parseSizeToDimensionsCm("   ", null), null);
  assert.equal(parseSizeToDimensionsCm(null, null), null);
  assert.equal(parseSizeToDimensionsCm(undefined, null), null);
});

test("bare numbers + no storedUnit → null (ambiguous)", () => {
  assert.equal(parseSizeToDimensionsCm("91*72.2", null), null);
  assert.equal(parseSizeToDimensionsCm("130 × 324", null), null);
});

test("bare numbers + storedUnit=cm → treated as cm", () => {
  const r = parseSizeToDimensionsCm("91*72.2", "cm");
  assert.ok(r);
  assert.equal(r!.widthCm, 91);
  assert.equal(r!.heightCm, 72.2);
});

test("WxHxD with cm marker extracts depth", () => {
  const r = parseSizeToDimensionsCm("91 x 91 x 20 cm", "cm");
  assert.ok(r);
  assert.equal(r!.widthCm, 91);
  assert.equal(r!.heightCm, 91);
  assert.equal(r!.depthCm, 20);
});

test("WxHxD with inch marker converts depth to cm", () => {
  const r = parseSizeToDimensionsCm("40 x 30 x 4 inch", null);
  assert.ok(r);
  assert.ok(nearly(r!.widthCm, 40 * 2.54));
  assert.ok(nearly(r!.heightCm, 30 * 2.54));
  assert.ok(nearly(r!.depthCm ?? 0, 4 * 2.54));
});

test("bare 3D with storedUnit=in converts all three", () => {
  const r = parseSizeToDimensionsCm("10 x 3 x 2.5", "in");
  assert.ok(r);
  assert.ok(nearly(r!.widthCm, 10 * 2.54));
  assert.ok(nearly(r!.heightCm, 3 * 2.54));
  assert.ok(nearly(r!.depthCm ?? 0, 2.5 * 2.54));
});

test("cm suffix on each number ('91cm x 91cm')", () => {
  const r = parseSizeToDimensionsCm("91cm x 91cm", null);
  assert.ok(r);
  assert.equal(r!.widthCm, 91);
  assert.equal(r!.heightCm, 91);
});

test("parenthesized cm marker ('42x29.7(cm)') resolves to cm", () => {
  const r = parseSizeToDimensionsCm("42x29.7(cm)", null);
  assert.ok(r);
  assert.equal(r!.widthCm, 42);
  assert.equal(r!.heightCm, 29.7);
});

test("negative / zero dimensions rejected (defence-in-depth)", () => {
  // Constructing a raw string with a leading zero pair keeps the parser
  // happy but the wrapper should refuse a 0-cm dimension because the
  // renderer will hide it and the collector will assume the row is fine.
  const r = parseSizeToDimensionsCm("0 x 0 cm", "cm");
  assert.equal(r, null);
});
