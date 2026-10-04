/**
 * After every draft card is removed, the drop-zone status must say the
 * delete finished. It must not keep "N drafts uploaded".
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

(async () => {
  const { planBulkDeleteStatus, resolveBulkVisibleStatus } = await import(
    "../src/lib/supabase/bulkUpload"
  );
  const { messages } = await import("../src/lib/i18n/messages");

  const labels = {
    uploadDone: messages.ko["bulk.uploadDone"],
    uploadPartial: messages.ko["bulk.uploadDoneWithFailures"],
    deleted: messages.ko["bulk.deletedCount"],
  };
  const enLabels = {
    uploadDone: messages.en["bulk.uploadDone"],
    uploadPartial: messages.en["bulk.uploadDoneWithFailures"],
    deleted: messages.en["bulk.deletedCount"],
  };

  assert.equal(messages.ko["bulk.deletedCount"], "{n}개 초안을 삭제했습니다");
  assert.equal(messages.en["bulk.deletedCount"], "Deleted {n} drafts");

  const ids = ["a", "b", "c", "d", "e", "f"];

  // Cards still on screen: the upload-complete line stays.
  {
    const status = resolveBulkVisibleStatus(
      {
        uploading: false,
        uploadTotal: 6,
        uploadSucceeded: 6,
        failureCount: 0,
        visibleCount: 6,
        note: null,
      },
      labels,
    );
    assert.equal(status.kind, "upload-done");
    if (status.kind === "upload-done") {
      assert.equal(status.text, "6개 초안 업로드 완료");
    }
  }

  // Delete-all removed the six cards. The line is the delete, not the upload.
  {
    const plan = planBulkDeleteStatus({
      scope: "all",
      draftIdsBefore: ids,
      requestedIds: ids,
      removedCount: 6,
      draftIdsAfter: [],
      placingCount: 0,
    });
    assert.equal(plan.line, "deleted");
    assert.equal(plan.removed, 6);
    assert.equal(plan.clearUploadStatus, true);

    const status = resolveBulkVisibleStatus(
      {
        uploading: false,
        uploadTotal: 6,
        uploadSucceeded: 6,
        failureCount: 0,
        visibleCount: 0,
        note: { kind: "deleted", count: plan.removed },
      },
      labels,
    );
    assert.equal(status.kind, "deleted");
    if (status.kind === "deleted") {
      assert.equal(status.text, "6개 초안을 삭제했습니다");
      assert.equal(status.text.includes("업로드 완료"), false);
    }

    const en = resolveBulkVisibleStatus(
      {
        uploading: false,
        uploadTotal: 6,
        uploadSucceeded: 6,
        failureCount: 0,
        visibleCount: 0,
        note: { kind: "deleted", count: plan.removed },
      },
      enLabels,
    );
    assert.equal(en.kind, "deleted");
    if (en.kind === "deleted") assert.equal(en.text, "Deleted 6 drafts");
  }

  // Delete-selected that removes every remaining card uses the removed count.
  {
    const plan = planBulkDeleteStatus({
      scope: "selected",
      draftIdsBefore: ["a", "b"],
      requestedIds: ["a", "b"],
      removedCount: 2,
      draftIdsAfter: [],
      placingCount: 0,
    });
    assert.equal(plan.line, "deleted");
    assert.equal(plan.removed, 2);
    const status = resolveBulkVisibleStatus(
      {
        uploading: false,
        uploadTotal: 6,
        uploadSucceeded: 6,
        failureCount: 0,
        visibleCount: 0,
        note: { kind: "deleted", count: plan.removed },
      },
      labels,
    );
    if (status.kind === "deleted") assert.equal(status.text, "2개 초안을 삭제했습니다");
  }

  // A partial delete leaves cards, so the upload line stays.
  {
    const plan = planBulkDeleteStatus({
      scope: "selected",
      draftIdsBefore: ids,
      requestedIds: ["a", "b"],
      removedCount: 2,
      draftIdsAfter: ["c", "d", "e", "f"],
      placingCount: 0,
    });
    assert.equal(plan.line, "unchanged");
    assert.equal(plan.clearUploadStatus, false);
    assert.equal(plan.removed, 2);
  }

  // Nothing removed: do not show the upload-complete line.
  {
    const emptied = planBulkDeleteStatus({
      scope: "all",
      draftIdsBefore: ids,
      requestedIds: ids,
      removedCount: 0,
      draftIdsAfter: [],
      placingCount: 0,
    });
    assert.equal(emptied.line, "quiet");
    assert.equal(emptied.clearUploadStatus, true);

    const stillThere = planBulkDeleteStatus({
      scope: "all",
      draftIdsBefore: ids,
      requestedIds: ids,
      removedCount: 0,
      draftIdsAfter: ids,
      placingCount: 0,
    });
    assert.equal(stillThere.line, "quiet");

    for (const plan of [emptied, stillThere]) {
      const status = resolveBulkVisibleStatus(
        {
          uploading: false,
          uploadTotal: 6,
          uploadSucceeded: 6,
          failureCount: 0,
          visibleCount: plan.line === "quiet" && plan === stillThere ? 6 : 0,
          note: { kind: "quiet" },
        },
        labels,
      );
      assert.equal(status.kind, "none");
    }
  }

  // Empty list with a stale upload total and no delete note: no success string.
  {
    const status = resolveBulkVisibleStatus(
      {
        uploading: false,
        uploadTotal: 6,
        uploadSucceeded: 6,
        failureCount: 0,
        visibleCount: 0,
        note: null,
      },
      labels,
    );
    assert.equal(status.kind, "none");
  }

  // An all-failed batch with no cards still explains the failures.
  {
    const status = resolveBulkVisibleStatus(
      {
        uploading: false,
        uploadTotal: 6,
        uploadSucceeded: 0,
        failureCount: 6,
        visibleCount: 0,
        note: null,
      },
      labels,
    );
    assert.equal(status.kind, "upload-partial");
    if (status.kind === "upload-partial") {
      assert.equal(status.text, "6개 중 0개 업로드 완료 · 6개 실패");
    }
  }

  const page = readFileSync(join(__dirname, "../src/app/upload/bulk/page.tsx"), "utf8");
  assert.match(page, /planBulkDeleteStatus\(/);
  assert.match(page, /resolveBulkVisibleStatus\(/);
  assert.equal(page.includes("!uploading && uploadTotal > 0"), false);
})();
