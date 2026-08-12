// 2026-08-12 — Regression tests for the bulk-upload helper contract.
//
// Backing bug: QA reported that on Windows the bulk upload flow
// completed with "0 uploaded" for every file. Root cause was two-fold:
//   (a) enqueue filter dropped files whose `File.type` was empty (some
//       Windows drag-drop cases), and
//   (b) storage upload path omitted `contentType`, so an empty MIME
//       header caused the bucket to 400 every request.
//
// These tests pin the pure helpers we extracted into
// `src/lib/supabase/bulkUpload.ts` — the goal is that the guarantees
// they encode ("enhance is opt-in", "the loop swallows one item's
// failure and keeps going", "always produce a summary sentence — never
// 0-uploaded silently") stay pinned across future refactors.

import assert from "node:assert/strict";

(async () => {
  const {
    computeBulkUploadPayload,
    fileLooksLikeImage,
    isBulkItemReady,
    summarizeBulkResult,
    runBulkUploadLoop,
  } = await import("../bulkUpload");

  const mkFile = (name: string, size: number, type = "image/jpeg"): File =>
    new File([new Uint8Array(size)], name, { type });

  // ── 1. computeBulkUploadPayload without enhancement returns the
  //     original file verbatim.
  {
    const original = mkFile("무제-01.jpg", 1024);
    const payload = computeBulkUploadPayload({ id: "a", file: original });
    assert.equal(payload.file, original, "no enhance → original file passthrough");
    assert.equal(payload.name, "무제-01.jpg", "korean filename preserved");
    assert.equal(payload.usedEnhancement, false);
  }

  // ── 2. computeBulkUploadPayload with enhanced blob returns a File
  //     wrapping the blob but keeping the ORIGINAL filename (so the
  //     detail page still shows "무제-01" and not "image").
  {
    const original = mkFile("무제-02.jpg", 1024);
    const enhanced = new Blob([new Uint8Array(512)], { type: "image/webp" });
    const payload = computeBulkUploadPayload({
      id: "b",
      file: original,
      enhancedFile: enhanced,
    });
    assert.notEqual(payload.file, original, "enhanced payload uses new blob wrapping");
    assert.equal(payload.file.name, "무제-02.jpg", "wrapped File keeps original name");
    assert.equal(payload.file.type, "image/webp", "wrapped File keeps blob type");
    assert.equal(payload.name, "무제-02.jpg");
    assert.equal(payload.usedEnhancement, true);
  }

  // ── 3. isBulkItemReady returns true iff file + required form fields
  //     are present. Enhancement is deliberately NOT part of the
  //     predicate — the whole point of the fix is "enhance is opt-in".
  {
    const file = mkFile("ok.jpg", 512);
    // Full form + file → ready.
    assert.equal(
      isBulkItemReady({
        file,
        form: {
          title: "Untitled",
          ownership_status: "available",
          pricing_mode: "inquire",
        },
      }),
      true,
      "file + complete form → ready",
    );
    // Missing title → not ready.
    assert.equal(
      isBulkItemReady({
        file,
        form: {
          title: "",
          ownership_status: "available",
          pricing_mode: "inquire",
        },
      }),
      false,
      "empty title → not ready",
    );
    // No file → not ready (even with complete form).
    assert.equal(
      isBulkItemReady({
        file: null,
        form: {
          title: "hi",
          ownership_status: "owned",
          pricing_mode: "fixed",
        },
      }),
      false,
      "no file → not ready",
    );
    // Empty file (0 bytes) → not ready (Windows drag-drop folder case).
    assert.equal(
      isBulkItemReady({
        file: new File([], "empty.jpg", { type: "image/jpeg" }),
        form: {
          title: "hi",
          ownership_status: "owned",
          pricing_mode: "fixed",
        },
      }),
      false,
      "zero-byte file → not ready",
    );
  }

  // ── 4. summarizeBulkResult picks the right template for partial
  //     failures. It must NEVER print "0 uploaded" when in fact some
  //     succeeded (that was the exact user-facing carroll case QA hit).
  {
    const message = summarizeBulkResult(
      {
        succeeded: 3,
        failed: [{ itemId: "a", error: new Error("boom") }],
      },
      {
        succeededOnly: "Uploaded {succeeded}",
        failedOnly: "0 uploaded (of {total})",
        partial: "{succeeded} of {total} uploaded · {failed} failed",
      },
    );
    assert.equal(message, "3 of 4 uploaded · 1 failed", "partial summary is precise");
    assert.ok(!/^0/.test(message), "partial summary MUST NOT start with 0");
  }

  // ── 5. summarizeBulkResult picks succeededOnly when nothing failed.
  {
    const message = summarizeBulkResult(
      { succeeded: 2, failed: [] },
      {
        succeededOnly: "Uploaded {succeeded}",
        failedOnly: "0",
        partial: "P",
      },
    );
    assert.equal(message, "Uploaded 2");
  }

  // ── 6. summarizeBulkResult picks failedOnly when every item failed
  //     AND surfaces the failure count so the user knows what to retry.
  {
    const message = summarizeBulkResult(
      {
        succeeded: 0,
        failed: [
          { itemId: "a", error: new Error("boom-a") },
          { itemId: "b", error: new Error("boom-b") },
        ],
      },
      {
        succeededOnly: "S",
        failedOnly: "{failed}개 모두 실패",
        partial: "P",
      },
    );
    assert.equal(message, "2개 모두 실패");
  }

  // ── 7. runBulkUploadLoop swallows a single item's throw and keeps
  //     going. This is the "crash-safe partial failure" contract.
  {
    const items = [
      { id: "a", boom: false },
      { id: "b", boom: true },
      { id: "c", boom: false },
    ];
    const settled: string[] = [];
    const summary = await runBulkUploadLoop(
      items,
      async (it) => {
        if (it.boom) throw new Error(`boom-${it.id}`);
        settled.push(it.id);
      },
      { concurrency: 1 },
    );
    assert.equal(summary.succeeded, 2, "2 of 3 succeeded");
    assert.equal(summary.failed.length, 1, "1 failure captured");
    assert.equal(summary.failed[0].itemId, "b", "the exact failing item is reported");
    assert.deepEqual(settled, ["a", "c"], "processing continued past the middle failure");
  }

  // ── 8. fileLooksLikeImage — Windows drag-drop empty-MIME cases:
  //     accept when the extension is a known image extension, reject
  //     otherwise. This is the Fix 4 half of the QA report.
  {
    assert.equal(
      fileLooksLikeImage({ name: "shot.jpg", type: "" }),
      true,
      "empty MIME + .jpg → accept",
    );
    assert.equal(
      fileLooksLikeImage({ name: "SHOT.JPG", type: "" }),
      true,
      "uppercase extension still accepted",
    );
    assert.equal(
      fileLooksLikeImage({ name: "phone.HEIC", type: "" }),
      true,
      "HEIC ext accepted even when Windows reports no MIME",
    );
    assert.equal(
      fileLooksLikeImage({ name: "resume.pdf", type: "" }),
      false,
      "non-image extension rejected",
    );
    assert.equal(
      fileLooksLikeImage({ name: "no-extension", type: "" }),
      false,
      "no extension + no MIME rejected",
    );
    assert.equal(
      fileLooksLikeImage({ name: "anything", type: "image/jpeg" }),
      true,
      "non-empty image MIME always accepted",
    );
  }

  console.log("[bulkUpload.regression] all 8 assertions passed");
})();
