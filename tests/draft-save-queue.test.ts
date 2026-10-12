// A later size commit must stay the one that lands.
// The first blur often has only one side; the next blur has both, plus the unit.

import assert from "node:assert/strict";

(async () => {
  const { chainAfter } = await import("../src/lib/upload/draftSaveQueue");

  let releaseFirst: () => void = () => {};
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let saved = { size: "", size_unit: "" };
  const started: string[] = [];

  let chain: Promise<unknown> = Promise.resolve();
  chain = chainAfter(chain, async () => {
    started.push("one");
    await firstGate;
    saved = { size: "48", size_unit: "cm" };
  });
  chain = chainAfter(chain, async () => {
    started.push("both");
    saved = { size: "36 × 48", size_unit: "in" };
  });

  await Promise.resolve();
  assert.deepEqual(started, ["one"]);
  releaseFirst();
  await chain;
  assert.deepEqual(started, ["one", "both"]);
  assert.equal(saved.size, "36 × 48");
  assert.equal(saved.size_unit, "in");

  console.log("draft-save-queue.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
