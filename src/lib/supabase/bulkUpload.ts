/**
 * 일괄 업로드 (bulk upload) — 페이지 컴포넌트에서 뽑아낸 pure helpers.
 *
 * QA 2026-08-12 (Windows) — 위저드 릴리즈 이후 bulk 업로드가 100 %
 * 실패하는 회귀 리포트에 대응하기 위한 재구성.  bulk page 는 여전히
 * chip 기반 UI 를 사용하지만, 아래 3 가지 원자 연산은 순수 함수로
 * 뽑아 회귀 테스트 (`__tests__/bulkUpload.regression.test.ts`) 로
 * 커버한다.
 *
 *  - `computeBulkUploadPayload(item)` — enhance 가 승인됐다면 그
 *    enhanced blob 을 File 로 래핑해 리턴, 아니면 원본 File 그대로.
 *    "enhance 는 opt-in" 규칙을 페이지 밖에서 검증 가능하도록.
 *  - `isBulkItemReady(item)` — 파일 존재 + 필수 폼 필드 3 종 (title /
 *    ownership_status / pricing_mode) 존재 여부로 판정.  위저드 완료
 *    여부에 의존하지 않는다 (미보정 아이템도 원본 업로드 가능).
 *  - `summarizeBulkResult({ succeeded, failed })` — "3개 업로드됨, 1개
 *    실패" 형태의 요약 문자열.  0 succeed 케이스도 명확히 안내.
 *
 * 사용자에게 보이는 카피는 여기서 i18n 을 직접 부르지 않고 caller 가
 * 문구를 넘겨준다 (테스트에서 locale / 문구 검증을 분리하기 위함).
 */

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "heic",
  "heif",
  "avif",
  "bmp",
  "tiff",
  "tif",
]);

/**
 * Windows 탐색기가 브라우저로 파일을 드래그할 때 `File.type` 이 빈
 * 문자열로 오는 경우가 있다.  최소한 확장자가 이미지면 통과시켜
 * 사용자가 "파일이 사라지는" UX 를 겪지 않도록 도와준다.
 */
export function fileLooksLikeImage(file: { name: string; type?: string | null }): boolean {
  if (file.type && file.type.startsWith("image/")) return true;
  const name = file.name ?? "";
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Bulk pending item — page 의 로컬 shape 을 순수하게 표현.  실제 UI
 * 컴포넌트는 이보다 더 많은 필드를 갖고 있지만 헬퍼는 아래 최소 집합
 * 만 필요로 한다.
 */
export type BulkPendingItem = {
  id: string;
  file: File;
  /** enhance 가 승인된 경우 최종 displayFile 을 여기에 담아둔다. */
  enhancedFile?: File | Blob | null;
  /** enhance 승인 여부 — enhancedFile 없이 kind === 'approved' 만 있는
   *  케이스 (server-side pipeline) 를 위해 별도로 노출. */
  enhanceApproved?: boolean;
};

export type BulkUploadPayload = {
  /** Storage 로 실제 올라갈 File.  Blob 이었더라도 원본 이름을
   *  물려받은 File 로 래핑한다.  Storage side sanitize 가 다시 걸리므로
   *  여기서는 원본 이름 유지가 안전하다. */
  file: File;
  /** 원본 파일명 (확장자 포함). */
  name: string;
  /** 이 페이로드가 사용자가 승인한 보정본을 사용하는가? */
  usedEnhancement: boolean;
};

/**
 * `File([blob], name)` 로 안전하게 감쌈.  Blob 을 그대로 storage 에
 * 넘겨도 Supabase JS 는 `File` 로 승격시키지만, 이름을 잃어서
 * `sanitizeFilename` 이 `image` 폴백을 쓴다 → Korean 파일명이
 * "image.webp" 로 뭉개짐.  캐치. 원본 이름 유지가 목표.
 */
function blobToFileWithName(blob: Blob | File, name: string): File {
  if (blob instanceof File && blob.name === name) return blob;
  const type = blob.type || "application/octet-stream";
  return new File([blob], name, { type, lastModified: Date.now() });
}

/**
 * bulk item 의 upload payload 를 결정한다.
 *
 * 규칙:
 *   1. `enhancedFile` 이 있으면 그 blob 을 원본 파일명으로 wrap 해
 *      storage 에 올린다.
 *   2. 없으면 원본 File 그대로.
 *
 * 위저드 완료 여부에 상관없이 항상 유효한 payload 를 리턴한다 —
 * 이 함수가 null 을 리턴하지 않는다는 사실 자체가 "bulk 미보정 파일도
 * 항상 업로드 가능해야 한다" 는 계약을 코드로 표현한다.
 */
export function computeBulkUploadPayload(item: BulkPendingItem): BulkUploadPayload {
  const original = item.file;
  if (item.enhancedFile) {
    return {
      file: blobToFileWithName(item.enhancedFile, original.name),
      name: original.name,
      usedEnhancement: true,
    };
  }
  return {
    file: original,
    name: original.name,
    usedEnhancement: false,
  };
}

/** bulk publish 판정에 쓰이는 필수 폼 필드 — draft artwork side 와
 *  1:1 대응 (`validatePublish` 참조). */
export type BulkFormFields = {
  title?: string | null;
  ownership_status?: string | null;
  pricing_mode?: string | null;
};

/**
 * 아이템이 "업로드 가능" 상태인지 판정.
 *
 * "업로드 가능" 은 두 조건의 곱:
 *   (a) 파일이 존재하고 (b) 필수 폼 필드 (title, ownership_status,
 *   pricing_mode) 3 개가 채워져 있어야 한다.
 *
 * enhance 완료 여부는 의도적으로 검사하지 않는다 — 사용자가 위저드
 * 를 열지 않아도 원본 그대로 업로드가 가능해야 한다.
 */
export function isBulkItemReady(item: {
  file?: File | null;
  form?: BulkFormFields | null;
}): boolean {
  if (!item.file || typeof item.file.size !== "number" || item.file.size <= 0) return false;
  const f = item.form ?? {};
  if (!f.title || !String(f.title).trim()) return false;
  if (!f.ownership_status || !String(f.ownership_status).trim()) return false;
  if (!f.pricing_mode || !String(f.pricing_mode).trim()) return false;
  return true;
}

export type BulkFailure = {
  itemId: string;
  /** 사용자에게 노출할 실패 사유 (i18n 적용된 문자열 또는 Error). */
  error: unknown;
};

export type BulkResultSummary = {
  succeeded: number;
  failed: BulkFailure[];
};

/**
 * "3개 업로드됨, 1개 실패" 스타일의 요약 문자열.
 *
 * 카피는 caller 가 i18n 을 통해 넘긴다 (`labels`).  포맷:
 *   - all ok:      `{succeededOnly}` (예: "5개 업로드됨")
 *   - all failed:  `{failedOnly}`    (예: "5개 모두 실패 — 다시 시도해 주세요")
 *   - partial:     `{partial}`       (예: "3개 업로드됨, 2개 실패")
 *
 * 각 라벨 안의 `{succeeded}` / `{failed}` / `{total}` 토큰을 치환.
 * 이 함수는 절대 예외를 던지지 않는다 — 렌더 파이프라인에서 마지막
 * 방어선으로 항상 무언가 문자열을 리턴한다.
 */
export function summarizeBulkResult(
  summary: BulkResultSummary,
  labels: {
    succeededOnly: string;
    failedOnly: string;
    partial: string;
  },
): string {
  const succeeded = Math.max(0, Number(summary.succeeded) || 0);
  const failed = Math.max(0, summary.failed?.length ?? 0);
  const total = succeeded + failed;
  const substitute = (tpl: string): string =>
    tpl
      .replace(/\{succeeded\}/g, String(succeeded))
      .replace(/\{failed\}/g, String(failed))
      .replace(/\{total\}/g, String(total));
  if (failed === 0 && succeeded === 0) {
    // 아무 것도 실행 안 됨.  bulk page 는 이 상태에 도달하지 못하지만
    // 방어적으로 succeededOnly 를 재사용.
    return substitute(labels.succeededOnly);
  }
  if (failed === 0) return substitute(labels.succeededOnly);
  if (succeeded === 0) return substitute(labels.failedOnly);
  return substitute(labels.partial);
}

export type BulkRunItemResult =
  | { ok: true; id: string }
  | { ok: false; id: string; error: unknown };

/**
 * bulk upload 루프의 crash-safe 실행기.
 *
 * `runOne` 이 한 아이템 처리 중 throw 하더라도 나머지는 정상 진행하고,
 * 모든 결과를 `{ succeeded, failed }` 로 요약해 리턴한다.  concurrency
 * cap 은 caller 가 정함 (모바일 Safari 는 2, 데스크톱은 4 등).
 *
 * 프로덕션에서는 bulk page 가 자체 loop 를 그대로 쓰지만, 이 함수는
 * (a) 정확히 같은 계약을 회귀 테스트로 커버하고,
 * (b) 향후 CSV bulk import / website import 등에서 재사용 가능하도록
 * 문서화 겸 export 한다.
 */
export async function runBulkUploadLoop<T extends { id: string }>(
  items: readonly T[],
  runOne: (item: T) => Promise<void>,
  opts: { concurrency?: number; onSettle?: (r: BulkRunItemResult) => void } = {},
): Promise<BulkResultSummary> {
  const concurrency = Math.max(1, Math.min(items.length || 1, opts.concurrency ?? 4));
  const failures: BulkFailure[] = [];
  let succeeded = 0;
  let nextIdx = 0;
  const worker = async () => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= items.length) return;
      const item = items[idx];
      try {
        await runOne(item);
        succeeded += 1;
        opts.onSettle?.({ ok: true, id: item.id });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[bulkUpload] item failed", item.id, err);
        failures.push({ itemId: item.id, error: err });
        opts.onSettle?.({ ok: false, id: item.id, error: err });
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { succeeded, failed: failures };
}
