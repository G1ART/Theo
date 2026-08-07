// Theo Image Enhance (Beta, 2026-08-05) — prepareArtworkImageForUpload
// contract test. Verifies the four-upload-path shared decision table:
// original always preserved, displayFile only when local pipeline ran,
// preparedDisplayPath wins over displayFile (server pipeline), and
// enhancementMeta normalizes to the canonical shape or falls to null.

import assert from "node:assert/strict";

(async () => {
  const { prepareArtworkImageForUpload } = await import("../../prepareArtworkImageForUpload");

  const original = new File([new Uint8Array([1, 2, 3])], "art.jpg", { type: "image/jpeg" });
  const enhanced = new File([new Uint8Array([4, 5, 6])], "art.enhanced.webp", { type: "image/webp" });

  // 1) Pass-through — no adjusted, no prepared path, no meta.
  const passthrough = prepareArtworkImageForUpload({ originalFile: original });
  assert.equal(passthrough.originalFile, original);
  assert.equal(passthrough.displayFile, null);
  assert.equal(passthrough.preparedDisplayPath, null);
  assert.equal(passthrough.enhancementMeta, null);

  // 2) Local pipeline result — displayFile populated, path is null.
  const localOnly = prepareArtworkImageForUpload({
    originalFile: original,
    adjustedFile: enhanced,
  });
  assert.equal(localOnly.displayFile, enhanced, "local adjusted becomes displayFile");
  assert.equal(localOnly.preparedDisplayPath, null);

  // 3) Server pipeline result — preparedDisplayPath wins even when an
  //    adjustedFile is also passed (avoid double-upload).
  const serverPath = "u123/enhanced/abc.webp";
  const serverPipeline = prepareArtworkImageForUpload({
    originalFile: original,
    adjustedFile: enhanced,
    preparedDisplayPath: serverPath,
  });
  assert.equal(serverPipeline.preparedDisplayPath, serverPath);
  assert.equal(
    serverPipeline.displayFile,
    null,
    "when preparedDisplayPath is set, we skip local displayFile to avoid double upload",
  );

  // 4) Empty preparedDisplayPath is not treated as prepared.
  const emptyPath = prepareArtworkImageForUpload({
    originalFile: original,
    adjustedFile: enhanced,
    preparedDisplayPath: "",
  });
  assert.equal(emptyPath.displayFile, enhanced);
  assert.equal(emptyPath.preparedDisplayPath, null);

  // 5) Malformed enhancementMeta becomes null (never persisted).
  const badMeta = prepareArtworkImageForUpload({
    originalFile: original,
    enhancementMeta: { provider: "not-real" } as never,
  });
  assert.equal(badMeta.enhancementMeta, null);

  // 6) Well-formed enhancementMeta round-trips.
  const good = {
    provider: "local_opencv",
    mode: "flat",
    recipe: {
      kind: "flat",
      params: {
        sourceCorners: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
        tone: { b: 1, c: 1, s: 1 },
        sharpen: 0.3,
        bezel: 0.02,
      },
    },
    confidence: 1,
    sourceHashSha256: "a".repeat(64),
    processedAtIso: "2026-08-05T00:00:00.000Z",
    latencyMs: 200,
    versions: { schema: 1, engine: "local-flat/1" },
  };
  const okMeta = prepareArtworkImageForUpload({
    originalFile: original,
    enhancementMeta: good as never,
  });
  assert.ok(okMeta.enhancementMeta, "well-formed meta round-trips non-null");
  assert.equal(okMeta.enhancementMeta?.provider, "local_opencv");
  assert.equal(okMeta.enhancementMeta?.recipe.kind, "flat");

  console.log("prepareArtworkImageForUpload contract: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
