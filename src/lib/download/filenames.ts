export function downloadStem(title: string | null | undefined, index?: number): string {
  const cleaned = (title ?? "")
    .replace(/[^\p{L}\p{N}\s._-]+/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const name = cleaned || "artwork";
  if (index == null) return name;
  return `${String(index).padStart(2, "0")}-${name}`;
}

export function imageExtension(format: "png" | "jpeg"): "png" | "jpg" {
  return format === "jpeg" ? "jpg" : "png";
}
