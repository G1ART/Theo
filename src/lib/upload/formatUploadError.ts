import { UPLOAD_MAX_IMAGE_MB_LABEL } from "./limits";

type T = (key: string) => string;

function norm(msg: string): string {
  return msg.toLowerCase();
}

/** Classify common browser / Supabase storage failure strings. */
export function classifyUploadFailureMessage(
  message: string,
): "oversized" | "payload" | "network" | "auth" | "permission" | "empty" | "unknown" {
  const m = norm(message);
  if (m.includes("empty file") || m.includes("empty payload") || m === "file is empty") return "empty";
  if (
    m.includes("row-level security") ||
    m.includes("permission denied") ||
    m.includes("42501")
  ) {
    return "permission";
  }
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

/** Short, token-free snippet of an unexpected server message. */
export function uploadFailureDetail(message: string): string {
  const cleaned = message.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (/bearer\s|eyJ|service_role|apikey|authorization/i.test(cleaned)) return "";
  return cleaned.slice(0, 140);
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
    case "permission":
      return t("bulk.uploadFailedFilePermission").replace("{name}", safeName);
    case "empty":
      return t("bulk.uploadFailedFileEmpty").replace("{name}", safeName);
    default: {
      const detail = uploadFailureDetail(raw);
      if (!detail) return t("bulk.uploadFailedFileGeneric").replace("{name}", safeName);
      return t("bulk.uploadFailedFileDetail").replace("{name}", safeName).replace("{reason}", detail);
    }
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
    case "permission":
      return t("upload.failedPermission");
    case "empty":
      return t("upload.failedEmpty");
    default: {
      const detail = uploadFailureDetail(raw);
      if (!detail) return t("upload.failedGeneric");
      return t("upload.failedDetail").replace("{reason}", detail);
    }
  }
}
