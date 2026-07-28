import { supabase } from "./client";
import { compressArtworkImage } from "@/lib/image/compress";

/** Serializable subset of the compressor's meta — matches the DB
 *  `artwork_images.compression_meta` jsonb shape. */
export type ArtworkImageCompressionMeta = {
  algo: "canvas-webp";
  quality: number;
  longEdge: number;
  sourceMime: string;
  sourceWidth: number;
  sourceHeight: number;
  outWidth: number;
  outHeight: number;
  iterations: number;
};

const BUCKET = "artworks";

function sanitizeFilename(name: string): string {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  const base = name.includes(".")
    ? name.slice(0, name.lastIndexOf("."))
    : name;
  const sanitized = base
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "");
  return (sanitized || "image") + ext;
}

/**
 * 2026-07-28 — 자동 압축 + 원본 백업 업로드 결과.
 *
 * `displayPath` 는 표시용 (WebP, 4K, ≤ 50 MiB) 이고, 코드베이스 전체가
 * 지금까지 다뤄온 `artwork_images.storage_path` 에 저장된다. `originalPath`
 * 는 아티스트가 나중에 다운로드/재편집 가능하도록 `{userId}/original/...`
 * 밑에 보관한 untouched 원본 (nullable — 압축이 skipped 된 케이스에서는
 * displayPath === 원본 경로 하나만 존재).
 */
export type ArtworkImageUploadResult = {
  displayPath: string;
  displayBytes: number;
  originalPath: string | null;
  originalBytes: number;
  /** NULL 이면 압축이 skipped (원본이 그대로 표시본). */
  compressionMeta: ArtworkImageCompressionMeta | null;
  /** 압축이 어떤 이유로 skip 되었는지 (정상 압축 완료면 undefined). */
  skippedReason?: "unsupported-mime" | "decode-failed" | "encode-failed" | "still-too-large" | "no-canvas-api" | "animated";
};

/**
 * 아트워크 이미지 업로드 (자동 압축 + 원본 백업).
 *
 * 파이프라인:
 *   1. 클라이언트에서 `compressArtworkImage` 로 표시용 파일 생성
 *      (WebP 4K q88, 반드시 ≤ 50 MiB). 원본은 그대로 유지.
 *   2. 표시본을 `{userId}/{uuid}-<name>.webp` 로 upload.
 *   3. (압축이 skipped 되지 않은 경우) 원본을 `{userId}/original/{uuid}-<name>`
 *      로 upload. 원본 upload 가 실패해도 표시본은 이미 저장됐으므로
 *      artwork 자체는 정상 노출되며, `originalPath = null` 로 반환 →
 *      caller 가 감지 후 나중에 재시도할 수 있다 (지금은 로깅만).
 *
 * Storage RLS 정책 (`can_manage_artworks_storage_path`) 은 첫 세그먼트가
 * auth.uid() 인지 확인하므로 `{userId}/original/...` 도 자동으로 커버.
 * 새 정책이나 새 bucket 이 필요하지 않다.
 *
 * 압축이 skipped 되고 원본이 서버 상한 (50 MiB) 을 넘는 경우, 표시본
 * upload 자체가 서버에서 튕겨지며 여기서 그대로 throw. Caller 는 pre-check
 * 에서 `isCompressibleMime` false 이고 파일 > 50 MiB 인 조합을 먼저 걸러야
 * 한다 (limits.ts).
 */
export async function uploadArtworkImage(
  file: File,
  userId: string
): Promise<ArtworkImageUploadResult> {
  const compressed = await compressArtworkImage(file);
  const uuid = crypto.randomUUID();

  if (compressed.skipped) {
    // 압축 폴백 — 원본 자체를 표시본으로 쓴다. 원본 백업 별도 저장 안 함
    // (같은 파일이므로).
    const safeName = sanitizeFilename(file.name);
    const displayPath = `${userId}/${uuid}-${safeName}`;
    const { error } = await supabase.storage.from(BUCKET).upload(displayPath, file, {
      upsert: false,
    });
    if (error) throw error;
    return {
      displayPath,
      displayBytes: compressed.originalBytes,
      originalPath: null,
      originalBytes: compressed.originalBytes,
      compressionMeta: null,
      skippedReason: compressed.reason,
    };
  }

  // 정상 압축 경로: 표시본 + 원본 별도 slot
  const safeDisplayName = sanitizeFilename(compressed.displayFile.name);
  const safeOriginalName = sanitizeFilename(file.name);
  const displayPath = `${userId}/${uuid}-${safeDisplayName}`;
  const originalPath = `${userId}/original/${uuid}-${safeOriginalName}`;

  const { error: displayErr } = await supabase.storage
    .from(BUCKET)
    .upload(displayPath, compressed.displayFile, {
      upsert: false,
      contentType: "image/webp",
    });
  if (displayErr) throw displayErr;

  // 원본 백업 — 실패해도 artwork 는 정상 노출되므로 log 만.
  // (Caller 가 나중에 재시도 UI 를 붙일 수 있게 originalPath=null 반환.)
  let savedOriginalPath: string | null = null;
  try {
    const { error: originalErr } = await supabase.storage
      .from(BUCKET)
      .upload(originalPath, file, {
        upsert: false,
        contentType: file.type || "application/octet-stream",
      });
    if (!originalErr) {
      savedOriginalPath = originalPath;
    } else {
      console.warn("[storage] original backup upload failed", originalErr);
    }
  } catch (originalCatch) {
    console.warn("[storage] original backup upload threw", originalCatch);
  }

  return {
    displayPath,
    displayBytes: compressed.displayBytes,
    originalPath: savedOriginalPath,
    originalBytes: compressed.originalBytes,
    compressionMeta: compressed.meta,
  };
}

/** Upload exhibition media image. Path: exhibition-media/{exhibitionId}/{uuid}-{name}. Uses same bucket as artworks. */
export async function uploadExhibitionMedia(
  file: File,
  exhibitionId: string
): Promise<string> {
  const safeName = sanitizeFilename(file.name);
  const path = `exhibition-media/${exhibitionId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function removeStorageFile(path: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([path]);
}

export async function removeStorageFiles(paths: string[]): Promise<{ error: unknown }> {
  if (paths.length === 0) return { error: null };
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  return { error };
}

export function getPublicImageUrl(path: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// ─── P1-0 Profile media (avatar / cover / artist statement hero) ─────────
//
// Reuses the `artworks` bucket. The existing RLS policy
// `can_manage_artworks_storage_path()` allows write/delete when the path
// starts with `{auth.uid()}/...`, so we keep paths under
// `{userId}/profile/{kind}/{uuid}-{safeName}` and don't need a new bucket
// or new RLS migration.

const PROFILE_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Per-kind size + mime limits. Keep avatars tighter (5 MB) since they ship inline. */
export const PROFILE_MEDIA_LIMITS = {
  avatar: { maxBytes: 5 * 1024 * 1024, mimes: PROFILE_IMAGE_MIMES },
  cover: { maxBytes: 10 * 1024 * 1024, mimes: PROFILE_IMAGE_MIMES },
  statement: { maxBytes: 10 * 1024 * 1024, mimes: PROFILE_IMAGE_MIMES },
} as const;

export type ProfileMediaKind = keyof typeof PROFILE_MEDIA_LIMITS;

export class ProfileMediaValidationError extends Error {
  readonly code: "size" | "mime" | "kind" | "user";
  readonly limitBytes?: number;
  constructor(code: "size" | "mime" | "kind" | "user", message: string, limitBytes?: number) {
    super(message);
    this.code = code;
    this.limitBytes = limitBytes;
    this.name = "ProfileMediaValidationError";
  }
}

/**
 * Upload a profile media file (avatar, cover, or statement hero).
 *
 * Throws `ProfileMediaValidationError` on bad mime/size/kind, or the raw
 * Supabase error on storage failure. On success returns the storage path
 * (e.g. `4f8c…/profile/avatar/abcd-1234-photo.jpg`) which callers should
 * persist via `updateMyProfileBasePatch({ avatar_url, cover_image_url, ... })`.
 */
export async function uploadProfileMedia(
  file: File,
  kind: ProfileMediaKind,
  userId: string
): Promise<string> {
  if (!userId) {
    throw new ProfileMediaValidationError("user", "userId is required");
  }
  const limits = PROFILE_MEDIA_LIMITS[kind];
  if (!limits) {
    throw new ProfileMediaValidationError("kind", `Unknown profile media kind: ${String(kind)}`);
  }
  if (!limits.mimes.has(file.type)) {
    throw new ProfileMediaValidationError(
      "mime",
      `Unsupported image type (${file.type || "unknown"}). Use JPEG, PNG, or WebP.`
    );
  }
  if (file.size > limits.maxBytes) {
    throw new ProfileMediaValidationError(
      "size",
      `File is too large (limit ${(limits.maxBytes / (1024 * 1024)).toFixed(0)} MB).`,
      limits.maxBytes
    );
  }

  const safeName = sanitizeFilename(file.name);
  const path = `${userId}/profile/${kind}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type,
    cacheControl: "3600",
  });
  if (error) throw error;
  return path;
}

/**
 * Best-effort delete of a previously uploaded profile media path. Idempotent —
 * silently ignores "not found" / RLS errors so the caller's UI flow doesn't
 * stall when the source path was already cleared. Returns true when the
 * Supabase call succeeded (no error), false otherwise.
 */
export async function removeProfileMedia(path: string | null | undefined): Promise<boolean> {
  if (!path || !path.trim()) return true;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  return !error;
}

// ─── QA 2026-06-26 (#6) Profile CV PDF ──────────────────────────────
// Stores a single downloadable resume PDF per artist. Lives in the
// same `artworks` bucket under the owner folder, so the existing
// `can_manage_artworks_storage_path` Shape 1 lets the owner upload,
// replace, and delete it without new RLS work. The path scheme is
// `{userId}/profile/cv/{uuid}-{safeName}` (kind-namespaced so it
// peer-coexists with avatar/cover/statement media).

const CV_PDF_MIMES = new Set(["application/pdf"]);
/** Hard cap so the public download surface doesn't accidentally serve
 *  a 100 MB scanned PDF. 10 MB is plenty for an artist resume. */
export const PROFILE_CV_MAX_BYTES = 10 * 1024 * 1024;

export class ProfileCvValidationError extends Error {
  readonly code: "size" | "mime" | "user";
  readonly limitBytes?: number;
  constructor(code: "size" | "mime" | "user", message: string, limitBytes?: number) {
    super(message);
    this.code = code;
    this.limitBytes = limitBytes;
    this.name = "ProfileCvValidationError";
  }
}

export async function uploadProfileCvPdf(file: File, userId: string): Promise<string> {
  if (!userId) {
    throw new ProfileCvValidationError("user", "userId is required");
  }
  if (!CV_PDF_MIMES.has(file.type)) {
    throw new ProfileCvValidationError(
      "mime",
      `Unsupported file type (${file.type || "unknown"}). Please upload a PDF.`,
    );
  }
  if (file.size > PROFILE_CV_MAX_BYTES) {
    throw new ProfileCvValidationError(
      "size",
      `File is too large (limit ${(PROFILE_CV_MAX_BYTES / (1024 * 1024)).toFixed(0)} MB).`,
      PROFILE_CV_MAX_BYTES,
    );
  }
  const safeName = sanitizeFilename(file.name);
  const path = `${userId}/profile/cv/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    contentType: "application/pdf",
    cacheControl: "3600",
  });
  if (error) throw error;
  return path;
}

/** Best-effort delete of a previous CV PDF storage path. */
export async function removeProfileCvPdf(path: string | null | undefined): Promise<boolean> {
  if (!path || !path.trim()) return true;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  return !error;
}

/** Resolve a CV PDF storage path to a public URL. Returns null when
 *  the input is empty so callers can render a single ternary
 *  without a temporary intermediate. */
export function getProfileCvPdfUrl(path: string | null | undefined): string | null {
  const p = path?.trim();
  if (!p) return null;
  return getPublicImageUrl(p);
}
