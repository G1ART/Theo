import { supabase } from "./client";

export type TheoBoardType =
  | "announcement"
  | "event"
  | "feature"
  | "community"
  | "news";

export const THEO_BOARD_TYPES: readonly TheoBoardType[] = [
  "announcement",
  "event",
  "feature",
  "community",
  "news",
] as const;

export type TheoBoardPost = {
  id: string;
  type: TheoBoardType;
  title: string;
  body_md: string | null;
  summary: string | null;
  href: string | null;
  author_id: string | null;
  published_at: string | null;
  expires_at: string | null;
  pinned: boolean;
  hidden_at: string | null;
  created_at: string;
};

const SELECT_COLS =
  "id, type, title, body_md, summary, href, author_id, published_at, expires_at, pinned, hidden_at, created_at";

export function isTheoBoardType(value: string): value is TheoBoardType {
  return (THEO_BOARD_TYPES as readonly string[]).includes(value);
}

export function isTheoBoardTableMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  if (e.code === "42P01" || e.code === "PGRST205") return true;
  const msg = (e.message ?? "").toLowerCase();
  return msg.includes("theo_board_posts");
}

function liveQuery() {
  return supabase
    .from("theo_board_posts")
    .select(SELECT_COLS)
    .is("hidden_at", null)
    .not("published_at", "is", null)
    .order("pinned", { ascending: false })
    .order("published_at", { ascending: false });
}

function asPosts(data: unknown): TheoBoardPost[] {
  if (!Array.isArray(data)) return [];
  return data as TheoBoardPost[];
}

export async function getTheoBoardRail(
  limit = 6,
): Promise<{ data: TheoBoardPost[]; error: unknown }> {
  const { data, error } = await liveQuery().limit(limit);
  if (error) return { data: [], error };
  return { data: asPosts(data), error: null };
}

export async function getTheoBoardPage(options: {
  offset?: number;
  limit?: number;
  type?: TheoBoardType | null;
}): Promise<{ data: TheoBoardPost[]; error: unknown }> {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 20;
  let q = liveQuery().range(offset, offset + limit - 1);
  if (options.type) q = q.eq("type", options.type);
  const { data, error } = await q;
  if (error) return { data: [], error };
  return { data: asPosts(data), error: null };
}

export async function getTheoBoardPostById(
  id: string,
): Promise<{ data: TheoBoardPost | null; error: unknown }> {
  const { data, error } = await liveQuery().eq("id", id).maybeSingle();
  if (error) {
    if (isTheoBoardTableMissing(error)) return { data: null, error };
    return { data: null, error };
  }
  return { data: (data as TheoBoardPost | null) ?? null, error: null };
}

const MD_MARKERS = /[#*_\[\]()`>~-]+/g;

/** Prefer `summary`; otherwise first ~80 chars of body with markdown stripped. */
export function displaySummary(post: Pick<TheoBoardPost, "summary" | "body_md">): string {
  const s = post.summary?.trim();
  if (s) return s;
  const raw = (post.body_md ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(MD_MARKERS, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "";
  if (raw.length <= 80) return raw;
  return `${raw.slice(0, 80).trimEnd()}…`;
}

export function theoBoardTypeChipClass(type: TheoBoardType): string {
  switch (type) {
    case "announcement":
      return "bg-zinc-100 text-zinc-700";
    case "event":
      return "bg-amber-50 text-amber-700";
    case "feature":
      return "bg-emerald-50 text-emerald-700";
    case "community":
      return "bg-blue-50 text-blue-700";
    case "news":
      return "bg-violet-50 text-violet-700";
  }
}

export function theoBoardTypeLabelKey(type: TheoBoardType): string {
  return `theoBoard.type.${type}`;
}
