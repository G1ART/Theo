/**
 * 2026-07-28 (QA) — PDF 첫 페이지를 WebP 썸네일로 렌더.
 *
 * 왜 클라이언트 측인가:
 *  - 서버측 pdf 렌더 (poppler / sharp / ghostscript) 는 Vercel serverless
 *    런타임에서 무겁고 cold-start 비용이 큼.
 *  - 사용자가 PDF 를 고른 시점에 이미 파일 바이트가 브라우저에 있음 →
 *    canvas 렌더 후 WebP 로 upload 하면 서버 왕복 1회 (기존 storage.upload)
 *    만으로 완료.
 *
 * pdf.js (pdfjs-dist v4) 설정 노트:
 *  - Worker 는 CDN URL 로 지정 (jsdelivr, 설치된 lib 버전에 pinned). Next.js
 *    App Router 에서 `new URL('pdfjs-dist/build/pdf.worker.min.mjs',
 *    import.meta.url)` 는 turbopack/webpack 조합에 따라 안정성 편차가 커서
 *    CDN 이 가장 안정적이라 판단 (react-pdf 도 동일 패턴).
 *  - 모든 API 는 dynamic import 로 지연 로드 → 초기 번들에 pdf.js (약 2 MB)
 *    가 포함되지 않음. PDF 를 실제로 고른 순간에만 페치.
 *
 * 실패 처리:
 *  - 암호화 PDF, corrupt PDF, worker 로드 실패 등은 caller 에 예외로 전파.
 *  - Caller 는 폴백으로 원본 PDF 만 저장 (아이콘 카드 렌더링).
 */

/** 렌더 결과. WebP blob + 픽셀 dimensions. */
export type PdfThumbnailResult = {
  blob: Blob;
  width: number;
  height: number;
};

/** 기본 렌더 파라미터. */
const DEFAULT_LONG_EDGE = 2000;
const DEFAULT_QUALITY = 0.9;

/** pdf.js 모듈 캐시 — 여러 파일 연속 업로드 시 재초기화 회피. */
let pdfjsCache: typeof import("pdfjs-dist") | null = null;

async function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  if (pdfjsCache) return pdfjsCache;
  // Dynamic import: pdf.js 는 무거우므로 실제 필요할 때만 로드.
  const mod = await import("pdfjs-dist");
  if (!mod.GlobalWorkerOptions.workerSrc) {
    // Worker 는 pinned CDN. jsdelivr 는 CORS + 캐싱이 안정적.
    // pdfjsLib.version 을 그대로 붙여서 로컬 install 과 항상 일치.
    mod.GlobalWorkerOptions.workerSrc =
      `https://cdn.jsdelivr.net/npm/pdfjs-dist@${mod.version}/build/pdf.worker.min.mjs`;
  }
  pdfjsCache = mod;
  return mod;
}

function hasOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas !== "undefined";
}

function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
  quality: number,
): Promise<Blob | null> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type, quality }).catch(() => null);
  }
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), type, quality);
  });
}

/**
 * PDF 파일의 첫 페이지를 WebP 로 렌더.
 *
 * `opts.longEdge` (default 2000 px) — 렌더 캔버스의 긴 변 (px). 포스터 /
 * 초대장 카드가 grid 에서 crisp 하게 보이는 정도. 너무 크면 모바일에서
 * 메모리 부담 → 2000 이 스위트 스팟.
 *
 * `opts.quality` (default 0.9) — WebP quality. 0.9 는 시각적으로 무손실에
 * 가까움. 포스터/도록 표지는 텍스트가 많아 이보다 낮추면 뭉개짐.
 */
export async function renderPdfFirstPageAsWebp(
  file: File,
  opts?: { longEdge?: number; quality?: number },
): Promise<PdfThumbnailResult> {
  const longEdge = opts?.longEdge ?? DEFAULT_LONG_EDGE;
  const quality = opts?.quality ?? DEFAULT_QUALITY;

  const pdfjs = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buf),
    // Enable common CJK fonts fallback so Korean/Chinese posters aren't
    // rendered as tofu blocks. `standardFontDataUrl` uses the same CDN
    // as the worker for consistency.
    cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/standard_fonts/`,
    // 손상/암호 PDF 은 여기서 exception. Caller 가 폴백 처리.
    disableAutoFetch: true,
    disableStream: true,
  });

  const pdf = await loadingTask.promise;
  try {
    if (pdf.numPages < 1) {
      throw new Error("PDF has no pages");
    }
    const page = await pdf.getPage(1);
    // Compute a scale so the longest edge lands on `longEdge`.
    const viewport1 = page.getViewport({ scale: 1 });
    const scale = longEdge / Math.max(viewport1.width, viewport1.height);
    const viewport = page.getViewport({ scale });
    const w = Math.max(1, Math.round(viewport.width));
    const h = Math.max(1, Math.round(viewport.height));

    const canvas: HTMLCanvasElement | OffscreenCanvas = hasOffscreenCanvas()
      ? new OffscreenCanvas(w, h)
      : (() => {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          return c;
        })();

    const ctx = canvas.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) {
      throw new Error("canvas 2D context unavailable");
    }

    // 배경을 흰색으로 두면 투명 배경 PDF (일부 벡터 아트웍) 이
    // 어두운 배경 grid 에서도 자연스럽게 보임.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
      // PDF 안의 폼/annotation 은 포스터/도록 표지엔 거의 없음. 렌더
      // 안전을 위해 명시적으로 렌더링 skip.
      intent: "display",
    }).promise;

    const blob = await canvasToBlob(canvas, "image/webp", quality);
    if (!blob) {
      throw new Error("WebP encode failed");
    }
    return { blob, width: w, height: h };
  } finally {
    // pdf.js 는 destroy() 를 안 부르면 워커에 페이지 캐시가 남음.
    try {
      await pdf.destroy();
    } catch {
      // 무시 — 이미 destroyed 된 경우
    }
  }
}
