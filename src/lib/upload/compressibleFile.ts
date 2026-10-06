/**
 * Phone photos often arrive as JPEG with an empty or generic MIME
 * (camera roll, Windows drag-and-drop). Those still go through the
 * WebP compressor. HEIC and GIF stay on the untouched 50MB path.
 */
const COMPRESSIBLE_MIMES = new Set([
  "image/jpeg",
  "image/pjpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const COMPRESSIBLE_EXT = new Set(["jpg", "jpeg", "png", "webp"]);

export function isCompressibleUpload(file: {
  type?: string | null;
  name?: string | null;
}): boolean {
  const mime = (file.type || "").toLowerCase().split(";")[0].trim();
  if (COMPRESSIBLE_MIMES.has(mime)) return true;
  if (mime && mime !== "application/octet-stream") return false;
  const name = file.name ?? "";
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return false;
  return COMPRESSIBLE_EXT.has(name.slice(dot + 1).toLowerCase());
}
