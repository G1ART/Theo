import { UPLOAD_MAX_IMAGE_MB_LABEL } from "./limits";

type T = (key: string) => string;

function norm(msg: string): string {
  return msg.toLowerCase();
}

/** Classify common browser / Supabase storage failure strings. */
export function classifyUploadFailureMessage(message: string): "oversized" | "payload" | "network" | "auth" | "unknown" {
  const m = norm(message);
  if (m.includes("401") || m.includes("403") || m.includes("unauthorized") || m.includes("jwt")) return "auth";
  if (m.includes("413") || m.includes("payload too large") || m.includes("request entity too large")) return "payload";
  if (
    m.includes("too large") ||
    m.includes("exceeds") ||
    (m.includes("maximum") && m.includes("size")) ||
    m.includes("file size") ||
    m.includes("object too large")
  ) {
    return "oversized";
  }
  if (m.includes("network") || m.includes("failed to fetch") || m.includes("load failed") || m.includes("timeout")) {
    return "network";
  }
  return "unknown";
}

/**
 * 2026-07-28 — 서버 rejection 문구.
 *
 * 자동 압축 도입 이후 이 케이스는 사실상:
 *   * HEIC / animated GIF 처럼 압축이 skipped 되고 원본이 50 MiB 를
 *     초과한 파일. (프리체크에서 걸러야 정상. 여기까지 오면 안전망.)
 *   * 압축기 iterative drop 이 5회까지 실패한 극단 이미지.
 *
 * 둘 다 사용자 관점에서 대응 방법은 같음: "이 형식은 자동 압축이
 * 지원되지 않아 원본 그대로 저장되니, 50MB 이하로 줄이거나 지원 포맷
 * 으로 변환해 주세요."
 */

/** User-facing sentence for a single failed file in bulk upload. */
export function formatBulkFileUploadFailure(fileName: string, err: unknown, t: T): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const kind = classifyUploadFailureMessage(raw);
  const safeName = fileName || t("bulk.uploadFailedUnnamedFile");
  switch (kind) {
    case "oversized":
    case "payload":
      return t("bulk.uploadFailedFileOversized").replace("{name}", safeName).replace("{maxMb}", String(UPLOAD_MAX_IMAGE_MB_LABEL));
    case "network":
      return t("bulk.uploadFailedFileNetwork").replace("{name}", safeName);
    case "auth":
      return t("bulk.uploadFailedFileAuth").replace("{name}", safeName);
    default:
      return t("bulk.uploadFailedFileGeneric").replace("{name}", safeName);
  }
}

/** Single-upload form: short line for storage rejection. */
export function formatSingleUploadFailure(err: unknown, t: T): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const kind = classifyUploadFailureMessage(raw);
  switch (kind) {
    case "oversized":
    case "payload":
      return t("upload.failedOversized").replace("{maxMb}", String(UPLOAD_MAX_IMAGE_MB_LABEL));
    case "network":
      return t("upload.failedNetwork");
    case "auth":
      return t("upload.failedAuth");
    default:
      return t("upload.failedGeneric");
  }
}
