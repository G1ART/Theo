import type { CaptionModel } from "./caption";
import { isCameraOriginalPath } from "./displayPath";

/** A4 portrait, long edge 2000px. Image sits above the caption. */
const PAGE_W = 1414;
const PAGE_H = 2000;
const MARGIN = 72;

export type ImageFormat = "png" | "jpeg";

function appFont(): string {
  if (typeof document === "undefined") return "sans-serif";
  const family = getComputedStyle(document.body).fontFamily;
  return family || "sans-serif";
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let next = text;
  while (next.length > 1 && ctx.measureText(`${next}…`).width > maxWidth) {
    next = next.slice(0, -1);
  }
  return `${next}…`;
}

async function bitmapFromBlob(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

export async function transcodeImage(blob: Blob, format: ImageFormat): Promise<Blob> {
  const bitmap = await bitmapFromBlob(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("canvas");
  }
  if (format === "jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const type = format === "jpeg" ? "image/jpeg" : "image/png";
  const out = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, format === "jpeg" ? 0.92 : undefined);
  });
  if (!out) throw new Error("encode");
  return out;
}

function drawContained(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  box: { x: number; y: number; w: number; h: number },
) {
  const scale = Math.min(box.w / bitmap.width, box.h / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  const x = box.x + (box.w - w) / 2;
  const y = box.y + (box.h - h) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, x, y, w, h);
}

/** One A4 page: image on top, caption below, Theo at the bottom. */
export async function renderCaptionPage(image: Blob, caption: CaptionModel): Promise<Blob> {
  if (typeof document !== "undefined" && document.fonts?.ready) {
    await document.fonts.ready;
  }
  const bitmap = await bitmapFromBlob(image);
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("canvas");
  }
  const font = appFont();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  const imageBottom = 1360;
  drawContained(ctx, bitmap, {
    x: MARGIN,
    y: MARGIN,
    w: PAGE_W - MARGIN * 2,
    h: imageBottom - MARGIN,
  });
  bitmap.close();

  let y = imageBottom + 56;
  const title = caption.title;
  const name = caption.artistName;
  if (title || name) {
    ctx.fillStyle = "#18181b";
    ctx.font = `600 40px ${font}`;
    ctx.textBaseline = "top";
    const gap = 32;
    const nameMax = name ? Math.min(480, (PAGE_W - MARGIN * 2) * 0.42) : 0;
    const titleMax = PAGE_W - MARGIN * 2 - (name ? nameMax + gap : 0);
    if (title) {
      ctx.textAlign = "left";
      ctx.fillText(fitText(ctx, title, titleMax), MARGIN, y);
    }
    if (name) {
      ctx.textAlign = "right";
      ctx.fillText(fitText(ctx, name, nameMax || titleMax), PAGE_W - MARGIN, y);
    }
    y += 64;
  }

  ctx.fillStyle = "#52525b";
  ctx.font = `400 28px ${font}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (const line of caption.lines) {
    ctx.fillText(fitText(ctx, line, PAGE_W - MARGIN * 2), MARGIN, y);
    y += 44;
  }

  ctx.fillStyle = "#a1a1aa";
  ctx.font = `500 22px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(caption.footer, PAGE_W / 2, PAGE_H - MARGIN);

  const out = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!out) throw new Error("encode");
  return out;
}

export async function buildCaptionPdf(pages: Blob[]): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  for (const pageBlob of pages) {
    const bytes = new Uint8Array(await pageBlob.arrayBuffer());
    const image = await pdf.embedPng(bytes);
    const page = pdf.addPage([595.28, 841.89]);
    page.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }
  const saved = await pdf.save();
  const bytes = new Uint8Array(saved);
  return new Blob([bytes.buffer], { type: "application/pdf" });
}

export async function buildZip(files: { name: string; data: Blob }[]): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const file of files) {
    if (isCameraOriginalPath(file.name)) continue;
    zip.file(file.name, file.data);
  }
  return zip.generateAsync({ type: "blob" });
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
