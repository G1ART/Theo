import type { WalkCursor } from "./types";

const MAX_USED = 400;

export function encodeCursor(cursor: WalkCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): WalkCursor | null {
  if (!raw || typeof raw !== "string" || raw.length > 20_000) return null;
  try {
    const json = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<WalkCursor>;
    if (!json || json.v !== 1) return null;
    const si = Number(json.si);
    const off = Number(json.off);
    if (!Number.isInteger(si) || si < 0 || si > 30) return null;
    if (!Number.isInteger(off) || off < 0 || off > 5000) return null;
    const used = Array.isArray(json.used)
      ? json.used
          .filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 80)
          .slice(0, MAX_USED)
      : [];
    return { v: 1, si, off, used };
  } catch {
    return null;
  }
}
