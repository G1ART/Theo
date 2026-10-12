import type { WalkCursor } from "./types";

const MAX_USED_WORKS = 4000;
const MAX_USED_SHOWS = 80;
const MAX_USED_PEOPLE = 120;

/**
 * Keep every shown work. People and exhibitions only need a short tail
 * so a long catalog does not push work ids out of the cursor.
 */
export function retainUsed(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const works: string[] = [];
  const shows: string[] = [];
  const people: string[] = [];
  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (key.startsWith("w:")) works.push(key);
    else if (key.startsWith("e:")) shows.push(key);
    else if (key.startsWith("p:")) people.push(key);
  }
  const keep = new Set<string>([
    ...works.slice(-MAX_USED_WORKS),
    ...shows.slice(-MAX_USED_SHOWS),
    ...people.slice(-MAX_USED_PEOPLE),
  ]);
  const out: string[] = [];
  const emitted = new Set<string>();
  for (const key of keys) {
    if (!keep.has(key) || emitted.has(key)) continue;
    emitted.add(key);
    out.push(key);
  }
  return out;
}

export function encodeCursor(cursor: WalkCursor): string {
  return Buffer.from(JSON.stringify({ ...cursor, used: retainUsed(cursor.used) }), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): WalkCursor | null {
  if (!raw || typeof raw !== "string" || raw.length > 200_000) return null;
  try {
    const json = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<WalkCursor>;
    if (!json || json.v !== 1) return null;
    const si = Number(json.si);
    const off = Number(json.off);
    if (!Number.isInteger(si) || si < 0 || si > 30) return null;
    if (!Number.isInteger(off) || off < 0 || off > 5000) return null;
    const used = Array.isArray(json.used)
      ? retainUsed(json.used.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 80))
      : [];
    return { v: 1, si, off, used };
  } catch {
    return null;
  }
}
