/**
 * 2026-07-28 — 클라이언트 자동 이미지 압축.
 *
 * 목적
 * ----
 * Supabase Storage 의 서버측 50 MiB 상한 (config.toml `[storage]
 * file_size_limit`) 을 사용자 관점에서 사실상 폐지한다. 클라이언트가
 * 업로드 직전에 4K 롱엣지 + WebP q88 로 표시본을 만들고, 필요하면
 * quality 를 iterative 로 낮춰가며 반드시 50 MiB 이하가 되도록 보장한다.
 * 원본 File 은 그대로 유지해 별도 slot 에 백업된다 (아티스트가 나중에
 * 재편집/다운로드 가능).
 *
 * 설계 원칙
 * ----------
 *  1. **아티스트 신뢰 우선** — 원본을 절대 폐기하지 않는다. 이 파일은
 *     "표시용 파생본" 을 만들 뿐이고, 원본은 caller 가 별도 slot 에
 *     보관한다 (`src/lib/supabase/storage.ts`).
 *  2. **가벼운 알고리즘** — canvas + `toBlob('image/webp', q)` 만 쓴다.
 *     외부 라이브러리 (browser-image-compression, pica 등) 없이 zero
 *     dependency. 모던 브라우저는 전부 WebP encode 지원.
 *  3. **메모리 안전** — 8000×6000 원본을 그대로 canvas 에 그리면
 *     190 MB 픽셀 버퍼가 필요해 모바일 Safari 가 크래시한다. 반드시
 *     `createImageBitmap` 의 `resizeWidth/Height` 로 downscale 하면서
 *     decode 한다 (한 번에 최종 크기로).
 *  4. **폴백 안전** — HEIC / 애니메이션 GIF / decode 실패 등 canvas
 *     경로가 안전하지 않은 케이스는 `skipped: true` 를 반환. Caller 가
 *     원본 그대로 업로드하거나 (파일이 서버 상한을 넘으면) 에러로
 *     안내할 수 있다.
 *  5. **결정 가능한 결과 크기** — quality 88 → 82 → 76 → 70 → 62 순으로
 *     낮춰가며 목표 크기 이하가 될 때까지 시도한다. 5번째까지 실패하면
 *     "너무 큼" 으로 skipped 를 리턴한다 (정상적인 이미지에서 이런 일은
 *     발생하지 않는다).
 */

/** 표시본 최대 롱엣지 (px). 4K 프린트/줌 감상까지 손실 없이 커버. */
export const COMPRESS_DEFAULT_LONG_EDGE = 4096;

/** WebP quality 초기값 (0–1). 88 은 JPEG q95 와 유사한 지각 품질. */
export const COMPRESS_DEFAULT_QUALITY = 0.88;

/** Storage 서버 상한과 동일. 이 이하로 압축 결과를 반드시 맞춘다. */
export const COMPRESS_TARGET_MAX_BYTES = 50 * 1024 * 1024;

/** 클라이언트에서 아예 거절하는 절대 상한. 압축 대상 포맷 기준. */
export const COMPRESS_HARD_INPUT_MAX_BYTES = 200 * 1024 * 1024;

/** Canvas encode 로 안전하게 다룰 수 있는 MIME 화이트리스트. */
const COMPRESSIBLE_MIMES = new Set([
  "image/jpeg",
  "image/pjpeg",
  "image/png",
  "image/webp",
]);

/**
 * 압축 결과. `skipped` 인 경우 caller 는 원본을 그대로 표시본으로 쓴다.
 */
export type CompressResult =
  | {
      skipped: false;
      /** 표시용 파일 (WebP, 4K 이하, ≤ 50 MiB). */
      displayFile: File;
      /** 백업용 원본 (인자로 받은 File 을 그대로 반환). */
      originalFile: File;
      /** 표시본 바이트. */
      displayBytes: number;
      /** 원본 바이트. */
      originalBytes: number;
      /** 관측/디버깅 메타. artwork_images.compression_meta 에 그대로 저장. */
      meta: {
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
    }
  | {
      skipped: true;
      /** 폴백 사유 — UI 힌트 및 로깅용. */
      reason:
        | "unsupported-mime"     // HEIC 등 canvas decode 불가 가능성 큼
        | "decode-failed"        // createImageBitmap 이 던짐
        | "encode-failed"        // toBlob 이 null
        | "still-too-large"      // 5번 iterate 후에도 목표 초과
        | "no-canvas-api"        // 아주 오래된 브라우저
        | "animated";            // 애니메이션 프레임 손실 방지
      /** 백업용 원본 (그대로 통과). */
      originalFile: File;
      /** 원본 바이트. */
      originalBytes: number;
    };

function hasOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas !== "undefined";
}

/**
 * `.gif` 는 애니메이션일 수 있어 canvas 로 인코딩하면 첫 프레임만 남는다.
 * MIME 만으로는 정지/동영상 구분이 어렵고, 인코딩 후 손실 여부도 감지
 * 어렵다. 안전 정책상 gif 는 무조건 스킵.
 */
function isPossiblyAnimated(file: File): boolean {
  return file.type === "image/gif" || /\.gif$/i.test(file.name);
}

/**
 * 원본을 목표 롱엣지 이하로 다운스케일한 `ImageBitmap` 을 얻는다.
 * `createImageBitmap` 의 `resizeWidth/Height` 를 사용해 native decode 시점에
 * 리사이즈되므로 전체 픽셀을 메모리에 올리지 않는다 (특히 모바일 안전).
 */
async function decodeDownscaled(
  file: File,
  maxLongEdge: number,
): Promise<{ bitmap: ImageBitmap; sw: number; sh: number; tw: number; th: number }> {
  // 먼저 dimensions 를 알려면 어차피 한 번 decode 필요. 하지만 옵션 없이
  // decode 하는 것도 위험하므로 첫 pass 는 low quality 로 dimension 만.
  const probe = await createImageBitmap(file);
  const sw = probe.width;
  const sh = probe.height;
  const longEdge = Math.max(sw, sh);
  const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
  const tw = Math.max(1, Math.round(sw * scale));
  const th = Math.max(1, Math.round(sh * scale));
  if (scale === 1) {
    return { bitmap: probe, sw, sh, tw, th };
  }
  // 다시 decode 하면서 리사이즈. probe 는 닫아 메모리 회수.
  try {
    probe.close();
  } catch {
    // 무시 — 오래된 브라우저는 close() 없음
  }
  const bitmap = await createImageBitmap(file, {
    resizeWidth: tw,
    resizeHeight: th,
    resizeQuality: "high",
  });
  return { bitmap, sw, sh, tw, th };
}

/** canvas.toBlob 을 Promise 로 감쌈. quality 는 WebP/JPEG 만 유효. */
function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
  quality: number,
): Promise<Blob | null> {
  if ("convertToBlob" in canvas) {
    return canvas
      .convertToBlob({ type, quality })
      .catch(() => null);
  }
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

/**
 * 이미지 압축. Caller 는 결과의 `skipped` 를 반드시 분기 처리해야 한다.
 */
export async function compressArtworkImage(
  file: File,
  opts?: {
    maxLongEdge?: number;
    initialQuality?: number;
    targetMaxBytes?: number;
  },
): Promise<CompressResult> {
  const originalBytes = file.size;

  // 애니메이션 / 지원 안 되는 MIME 은 조기 폴백
  if (isPossiblyAnimated(file)) {
    return { skipped: true, reason: "animated", originalFile: file, originalBytes };
  }
  if (!COMPRESSIBLE_MIMES.has(file.type)) {
    return { skipped: true, reason: "unsupported-mime", originalFile: file, originalBytes };
  }
  if (typeof createImageBitmap === "undefined" || typeof document === "undefined") {
    return { skipped: true, reason: "no-canvas-api", originalFile: file, originalBytes };
  }

  const maxLongEdge = opts?.maxLongEdge ?? COMPRESS_DEFAULT_LONG_EDGE;
  const initialQuality = opts?.initialQuality ?? COMPRESS_DEFAULT_QUALITY;
  const targetMaxBytes = opts?.targetMaxBytes ?? COMPRESS_TARGET_MAX_BYTES;

  let decoded: Awaited<ReturnType<typeof decodeDownscaled>>;
  try {
    decoded = await decodeDownscaled(file, maxLongEdge);
  } catch {
    return { skipped: true, reason: "decode-failed", originalFile: file, originalBytes };
  }

  const { bitmap, sw, sh, tw, th } = decoded;

  // OffscreenCanvas 가 있으면 메인 스레드 blocking 을 줄임. 없으면 fallback.
  const canvas: HTMLCanvasElement | OffscreenCanvas = hasOffscreenCanvas()
    ? new OffscreenCanvas(tw, th)
    : (() => {
        const c = document.createElement("canvas");
        c.width = tw;
        c.height = th;
        return c;
      })();

  const ctx = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) {
    try {
      bitmap.close();
    } catch {
      /* noop */
    }
    return { skipped: true, reason: "no-canvas-api", originalFile: file, originalBytes };
  }
  ctx.drawImage(bitmap, 0, 0, tw, th);
  try {
    bitmap.close();
  } catch {
    /* noop */
  }

  // WebP 로 iterative 하게 quality 를 낮추면서 목표 크기에 맞춤.
  // 88 → 82 → 76 → 70 → 62 다섯 단계. 첫 번째로 목표 이하가 되는 결과를 채택.
  const qualitySteps: number[] = [];
  {
    let q = initialQuality;
    for (let i = 0; i < 5; i += 1) {
      qualitySteps.push(q);
      q = Math.max(0.5, q - 0.06);
    }
  }

  let outBlob: Blob | null = null;
  let outQuality = qualitySteps[0];
  let iterations = 0;
  for (const q of qualitySteps) {
    iterations += 1;
    const blob = await canvasToBlob(canvas, "image/webp", q);
    if (!blob) continue;
    if (blob.size <= targetMaxBytes) {
      outBlob = blob;
      outQuality = q;
      break;
    }
    // 다음 iteration 을 위해 유지 — 마지막 시도까지 실패하면 마지막 결과라도 씀
    outBlob = blob;
    outQuality = q;
  }

  if (!outBlob) {
    return { skipped: true, reason: "encode-failed", originalFile: file, originalBytes };
  }
  if (outBlob.size > targetMaxBytes) {
    // 5번 낮췄는데도 넘음 — 아주 큰 사진 또는 저압축률 실패 케이스.
    // 원본 폴백을 caller 에게 넘긴다 (원본 자체가 50MiB 를 넘으면 caller
    // 가 UI 에서 안내 필요).
    return { skipped: true, reason: "still-too-large", originalFile: file, originalBytes };
  }

  const baseName = file.name.replace(/\.[^./\\]+$/, "") || "image";
  const displayFile = new File([outBlob], `${baseName}.webp`, {
    type: "image/webp",
    lastModified: Date.now(),
  });

  return {
    skipped: false,
    displayFile,
    originalFile: file,
    displayBytes: displayFile.size,
    originalBytes,
    meta: {
      algo: "canvas-webp",
      quality: outQuality,
      longEdge: maxLongEdge,
      sourceMime: file.type,
      sourceWidth: sw,
      sourceHeight: sh,
      outWidth: tw,
      outHeight: th,
      iterations,
    },
  };
}

/** 프리체크: 클라이언트가 애초에 거절해야 할 크기인지. */
export function isCompressibleMime(mime: string): boolean {
  return COMPRESSIBLE_MIMES.has(mime);
}
