/**
 * Shared search matching for works and people.
 *
 * Exact text always wins (case-insensitive substring, so a correctly
 * typed name, @handle, or title hits). A light edit of one character
 * is accepted on longer tokens. Related words are a small fixed list
 * (벚꽃 ↔ blossom), not a chat and not an embedding lookup.
 *
 * Keep `RELATED_GROUPS` in this file. The database function does not
 * know the list; the client sends these expanded tokens.
 */

import { hasHangul } from "@/lib/search/queryVariants";

const RELATED_GROUPS: readonly (readonly string[])[] = [
  ["벚꽃", "cherry", "blossom", "sakura"],
  ["꽃", "flower"],
  ["정원", "garden"],
  ["바다", "sea", "ocean"],
  ["산", "mountain"],
  ["달", "moon"],
  ["숲", "forest"],
  ["나무", "tree"],
  ["하늘", "sky"],
];

const MAX_TOKENS = 4;
const MAX_ALTS = 6;

function cleanToken(raw: string): string {
  return raw.trim().replace(/^@+/, "").replace(/[%_\\,()"*]/g, "");
}

/** Whitespace tokens, @ stripped, filter-syntax characters removed. */
export function tokenizeQuery(raw: string): string[] {
  const cleaned = raw.trim().replace(/[%_\\,()"*]/g, " ");
  if (!cleaned.trim()) return [];
  const out: string[] = [];
  for (const part of cleaned.split(/\s+/)) {
    const token = cleanToken(part);
    if (!token) continue;
    out.push(token);
    if (out.length >= MAX_TOKENS) break;
  }
  return out;
}

function pushAlt(out: string[], alt: string) {
  const token = alt.trim();
  if (!token || token.length > 80) return;
  if (out.some((existing) => existing.toLowerCase() === token.toLowerCase())) return;
  if (out.length >= MAX_ALTS) return;
  out.push(token);
}

/**
 * One inner array is OR (the token and its related forms).
 * Every inner array must hit (AND) for the query to match.
 */
export function queryTokenGroups(raw: string): string[][] {
  return tokenizeQuery(raw).map((token) => {
    const alts: string[] = [];
    pushAlt(alts, token);
    const key = token.toLowerCase();
    for (const group of RELATED_GROUPS) {
      if (group.some((word) => word.toLowerCase() === key)) {
        for (const word of group) pushAlt(alts, word);
      }
    }
    return alts;
  });
}

/**
 * Extra ilike stems so a one-character typo still retrieves a row
 * before trigram is applied. "cheery" → "cheer", which sits inside
 * "cheerry". The edit-distance check then drops loose stems.
 */
export function recallTermsForGroup(alts: readonly string[]): string[] {
  const out: string[] = [];
  for (const alt of alts) pushAlt(out, alt);
  for (const alt of alts) {
    if ([...alt].length >= 5) pushAlt(out, [...alt].slice(0, -1).join(""));
  }
  return out;
}

function quoteIlike(token: string): string | null {
  const cleaned = cleanToken(token).slice(0, 60);
  if (!cleaned) return null;
  return `"%${cleaned}%"`;
}

/**
 * PostgREST `or` fragments. Each returned string is one token group
 * (OR across columns and related forms). Callers AND the strings by
 * applying `.or()` once per group.
 */
export function buildIlikeClauses(
  raw: string,
  columns: readonly string[],
): string[] | null {
  const groups = queryTokenGroups(raw);
  if (groups.length === 0 || columns.length === 0) return null;
  const clauses: string[] = [];
  for (const group of groups) {
    const parts: string[] = [];
    for (const alt of group) {
      const pattern = quoteIlike(alt);
      if (!pattern) continue;
      for (const column of columns) parts.push(`${column}.ilike.${pattern}`);
    }
    if (parts.length === 0) return null;
    clauses.push(parts.join(","));
  }
  return clauses;
}

/** OR of every term against every column. Used inside one token group. */
export function ilikeAnyClause(
  terms: readonly string[],
  columns: readonly string[],
): string | null {
  const parts: string[] = [];
  for (const term of terms) {
    const pattern = quoteIlike(term);
    if (!pattern) continue;
    for (const column of columns) parts.push(`${column}.ilike.${pattern}`);
  }
  return parts.length > 0 ? parts.join(",") : null;
}

function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return false;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    let diffs = 0;
    for (let i = 0; i < la; i++) {
      if (a[i] !== b[i]) {
        diffs += 1;
        if (diffs > 1) return false;
      }
    }
    return diffs === 1;
  }
  const shorter = la < lb ? a : b;
  const longer = la < lb ? b : a;
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
    } else if (skipped) {
      return false;
    } else {
      skipped = true;
      j += 1;
    }
  }
  return true;
}

function wordsOf(blob: string): string[] {
  return blob.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);
}

function tokenHitsBlob(token: string, blob: string): boolean {
  const needle = token.toLowerCase();
  const hay = blob.toLowerCase();
  if (!needle || !hay) return false;
  if (hay.includes(needle)) return true;
  const hangul = hasHangul(needle);
  const minLen = hangul ? 2 : 4;
  if ([...needle].length < minLen) return false;
  for (const word of wordsOf(hay)) {
    if ([...word].length < minLen) continue;
    if (withinOneEdit(needle, word)) return true;
  }
  return false;
}

/** Every token (or a related form) must hit the joined text. */
export function recordMatchesQuery(
  query: string,
  fields: Array<string | null | undefined>,
): boolean {
  const groups = queryTokenGroups(query);
  if (groups.length === 0) return false;
  const blob = fields
    .map((field) => (typeof field === "string" ? field.trim() : ""))
    .filter(Boolean)
    .join("\n");
  if (!blob) return false;
  return groups.every((alts) => alts.some((alt) => tokenHitsBlob(alt, blob)));
}

type NameSlot = {
  username?: string | null;
  display_name?: string | null;
  display_name_ko?: string | null;
  display_name_en?: string | null;
} | null;

function nameFields(person: NameSlot | undefined): string[] {
  if (!person) return [];
  return [
    person.username ?? "",
    person.display_name ?? "",
    person.display_name_ko ?? "",
    person.display_name_en ?? "",
  ];
}

export type ArtworkSearchSource = {
  title?: string | null;
  title_ko?: string | null;
  title_en?: string | null;
  medium?: string | null;
  medium_ko?: string | null;
  medium_en?: string | null;
  story?: string | null;
  story_ko?: string | null;
  story_en?: string | null;
  keywords?: unknown;
  profiles?: NameSlot;
  uploader?: NameSlot;
  claims?: Array<{
    profiles?: NameSlot;
    external_artists?: {
      display_name?: string | null;
      display_name_ko?: string | null;
      display_name_en?: string | null;
    } | null;
  }> | null;
  exhibitionTitles?: Array<string | null | undefined>;
};

export function artworkMatchesSearch(query: string, art: ArtworkSearchSource): boolean {
  const keywords = Array.isArray(art.keywords)
    ? art.keywords.filter((word): word is string => typeof word === "string")
    : [];
  const claimNames = (art.claims ?? []).flatMap((claim) => [
    ...nameFields(claim.profiles),
    claim.external_artists?.display_name ?? "",
    claim.external_artists?.display_name_ko ?? "",
    claim.external_artists?.display_name_en ?? "",
  ]);
  return recordMatchesQuery(query, [
    art.title,
    art.title_ko,
    art.title_en,
    art.medium,
    art.medium_ko,
    art.medium_en,
    art.story,
    art.story_ko,
    art.story_en,
    ...keywords,
    ...nameFields(art.profiles),
    ...nameFields(art.uploader),
    ...claimNames,
    ...(art.exhibitionTitles ?? []),
  ]);
}

/**
 * 내 공간 picker scope: public works, the viewer's own works, and works
 * the viewer uploaded. Someone else's draft stays out. RLS still applies
 * on top of this predicate.
 */
export function artworkInPickerScope(
  work: {
    visibility: string | null;
    artistId: string | null;
    createdBy: string | null;
  },
  viewerId: string | null,
): boolean {
  if (work.visibility === "public") return true;
  if (!viewerId) return false;
  return work.artistId === viewerId || work.createdBy === viewerId;
}
