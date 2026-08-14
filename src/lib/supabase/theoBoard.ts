import { supabase } from "./client";

export type TheoBoardType =
  | "announcement"
  | "event"
  | "feature"
  | "community"
  | "news"
  | "promo";

export const THEO_BOARD_TYPES: readonly TheoBoardType[] = [
  "announcement",
  "event",
  "feature",
  "community",
  "news",
  "promo",
] as const;

/** Types authenticated users may submit. Staff/CLI may still use announcement/feature. */
export const USER_SUBMIT_TYPES: readonly TheoBoardType[] = [
  "event",
  "community",
  "news",
  "promo",
] as const;

export type TheoBoardStatus = "pending" | "approved" | "rejected" | "withdrawn";

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
  status?: TheoBoardStatus | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  reject_reason?: string | null;
  author_username?: string | null;
  author_display_name?: string | null;
};

export type TheoBoardQueueStatus = "pending" | "approved" | "rejected";

/** Live rail/list SELECT — omit new columns so missing-migration fetches still fail-soft. */
const LIVE_SELECT_COLS =
  "id, type, title, body_md, summary, href, author_id, published_at, expires_at, pinned, hidden_at, created_at";

export function isTheoBoardType(value: string): value is TheoBoardType {
  return (THEO_BOARD_TYPES as readonly string[]).includes(value);
}

export function isUserSubmitType(value: string): value is TheoBoardType {
  return (USER_SUBMIT_TYPES as readonly string[]).includes(value);
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
    .select(LIVE_SELECT_COLS)
    .is("hidden_at", null)
    .not("published_at", "is", null)
    .order("pinned", { ascending: false })
    .order("published_at", { ascending: false });
}

function asPosts(data: unknown): TheoBoardPost[] {
  if (!Array.isArray(data)) return [];
  return data as TheoBoardPost[];
}

function asPost(data: unknown): TheoBoardPost | null {
  if (!data || typeof data !== "object") return null;
  return data as TheoBoardPost;
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

export async function submitTheoBoardPost(input: {
  type: TheoBoardType;
  title: string;
  body_md?: string | null;
  summary?: string | null;
  href?: string | null;
  expires_in_days?: number | null;
}): Promise<{ data: TheoBoardPost | null; error: unknown }> {
  const { data, error } = await supabase.rpc("theo_board_submit", {
    p_type: input.type,
    p_title: input.title,
    p_body_md: input.body_md ?? null,
    p_summary: input.summary ?? null,
    p_href: input.href ?? null,
    p_expires_in_days: input.expires_in_days ?? null,
  });
  if (error) return { data: null, error };
  return { data: asPost(data), error: null };
}

export async function listMyTheoBoardPosts(): Promise<{
  data: TheoBoardPost[];
  error: unknown;
}> {
  const { data, error } = await supabase.rpc("theo_board_list_mine");
  if (error) return { data: [], error };
  return { data: asPosts(data), error: null };
}

export async function withdrawTheoBoardPost(
  id: string,
): Promise<{ data: { id: string; status: string } | null; error: unknown }> {
  const { data, error } = await supabase.rpc("theo_board_withdraw", {
    p_id: id,
  });
  if (error) return { data: null, error };
  return { data: (data as { id: string; status: string } | null) ?? null, error: null };
}

export async function listTheoBoardQueue(options?: {
  status?: TheoBoardQueueStatus;
  limit?: number;
  offset?: number;
}): Promise<{ data: TheoBoardPost[]; error: unknown }> {
  const { data, error } = await supabase.rpc("theo_board_list_queue", {
    p_status: options?.status ?? "pending",
    p_limit: options?.limit ?? 50,
    p_offset: options?.offset ?? 0,
  });
  if (error) return { data: [], error };
  return { data: asPosts(data), error: null };
}

export async function approveTheoBoardPost(
  id: string,
): Promise<{ data: TheoBoardPost | null; error: unknown }> {
  const { data, error } = await supabase.rpc("theo_board_approve", { p_id: id });
  if (error) return { data: null, error };
  return { data: asPost(data), error: null };
}

export async function rejectTheoBoardPost(
  id: string,
  reason: string,
): Promise<{ data: TheoBoardPost | null; error: unknown }> {
  const { data, error } = await supabase.rpc("theo_board_reject", {
    p_id: id,
    p_reason: reason,
  });
  if (error) return { data: null, error };
  return { data: asPost(data), error: null };
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
    case "promo":
      return "bg-rose-50 text-zinc-700";
  }
}

export function theoBoardStatusChipClass(status: TheoBoardStatus): string {
  switch (status) {
    case "pending":
      return "bg-amber-50 text-amber-800";
    case "approved":
      return "bg-emerald-50 text-emerald-800";
    case "rejected":
      return "bg-red-50 text-red-800";
    case "withdrawn":
      return "bg-zinc-100 text-zinc-600";
  }
}

export function theoBoardTypeLabelKey(type: TheoBoardType): string {
  return `theoBoard.type.${type}`;
}

export function theoBoardStatusLabelKey(status: TheoBoardStatus): string {
  return `theoBoard.status.${status}`;
}
