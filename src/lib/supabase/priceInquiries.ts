import { supabase } from "./client";
import { logBetaEventSync } from "@/lib/beta/logEvent";
import { recordUsageEvent } from "@/lib/metering";
import { USAGE_KEYS } from "@/lib/metering/usageKeys";
import { recordActingContextEvent } from "@/lib/delegation/actingContext";

export type InquiryStatus = "new" | "open" | "replied" | "closed";
export type PipelineStage = "new" | "contacted" | "in_discussion" | "offer_sent" | "closed_won" | "closed_lost";

/**
 * Source surfaces an inquiry can be attributed to. Mirrors the
 * `price_inquiries_source_surface_chk` CHECK constraint added in
 * `20260605000000_price_inquiry_source_attribution.sql`.
 */
export type InquirySourceSurface =
  | "feed"
  | "room"
  | "artwork"
  | "exhibition"
  | "profile"
  | "direct";

/**
 * Source attribution payload. All fields are optional; an empty input
 * means "no attribution context", which is treated as `direct` on the
 * client (a deliberate user choice not to forward source data is also
 * `direct`).
 *
 * Privacy invariants — read before extending:
 *   - Never include the room TOKEN here. Resolve it to a `roomId` first.
 *   - Never include free-form titles / messages / image URLs / auth
 *     secrets in `payload`. Keep payload to small structural hints
 *     (feed tab/sort/position, exhibition slug, etc.).
 */
export type InquirySource = {
  surface?: InquirySourceSurface;
  artworkId?: string | null;
  exhibitionId?: string | null;
  /** Resolved shortlist UUID, NOT the share-token. */
  roomId?: string | null;
  feedSessionId?: string | null;
  feedItemKey?: string | null;
  /** Tiny extra structural hints. Kept ≤ 1 KiB by convention. */
  payload?: Record<string, unknown> | null;
};

export type PriceInquiryRow = {
  id: string;
  artwork_id: string;
  inquirer_id: string;
  message: string | null;
  artist_reply: string | null;
  replied_at: string | null;
  replied_by_id?: string | null;
  created_at: string;
  inquiry_status?: InquiryStatus | null;
  last_message_at?: string | null;
  artist_unread?: boolean | null;
  inquirer_unread?: boolean | null;
  pipeline_stage?: PipelineStage | null;
  assignee_id?: string | null;
  next_action_date?: string | null;
  last_contact_date?: string | null;
  source_surface?: InquirySourceSurface | null;
  source_artwork_id?: string | null;
  source_exhibition_id?: string | null;
  source_room_id?: string | null;
  source_feed_session_id?: string | null;
  source_feed_item_key?: string | null;
  source_payload?: Record<string, unknown> | null;
  artwork?: { id: string; title: string | null; artist_id: string } | null;
  inquirer?: { username: string | null; display_name: string | null } | null;
};

export type InquiryNoteRow = {
  id: string;
  inquiry_id: string;
  author_id: string;
  body: string;
  created_at: string;
};

export type PriceInquiryMessageRow = {
  id: string;
  inquiry_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

const INQUIRY_SELECT = `
  id,
  artwork_id,
  inquirer_id,
  message,
  artist_reply,
  replied_at,
  replied_by_id,
  created_at,
  inquiry_status,
  last_message_at,
  artist_unread,
  inquirer_unread,
  pipeline_stage,
  assignee_id,
  next_action_date,
  last_contact_date,
  source_surface,
  source_artwork_id,
  source_exhibition_id,
  source_room_id,
  source_feed_session_id,
  source_feed_item_key,
  source_payload,
  artworks!artwork_id(id, title, artist_id),
  profiles!inquirer_id(username, display_name)
`;

/** Artist inbox list: inner join artwork so we can filter by artist_id server-side. */
const INQUIRY_LIST_SELECT = `
  id,
  artwork_id,
  inquirer_id,
  message,
  artist_reply,
  replied_at,
  replied_by_id,
  created_at,
  inquiry_status,
  last_message_at,
  artist_unread,
  inquirer_unread,
  pipeline_stage,
  assignee_id,
  next_action_date,
  last_contact_date,
  source_surface,
  source_artwork_id,
  source_exhibition_id,
  source_room_id,
  source_feed_session_id,
  source_feed_item_key,
  source_payload,
  artworks!artwork_id!inner(id, title, artist_id),
  profiles!inquirer_id(username, display_name)
`;

export type InquiryListCursor = { last_message_at: string; id: string };

export type ListPriceInquiriesForArtistOptions = {
  profileId?: string;
  limit?: number;
  cursor?: InquiryListCursor | null;
  status?: InquiryStatus | "all";
  pipelineStage?: PipelineStage | "all";
  search?: string;
};

function escapeIlike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function normalizeInquiry(row: Record<string, unknown>): PriceInquiryRow {
  const aw = row.artworks;
  const artwork = Array.isArray(aw) && aw.length > 0
    ? (aw[0] as { id: string; title: string | null; artist_id: string })
    : aw && typeof aw === "object" && !Array.isArray(aw)
      ? (aw as { id: string; title: string | null; artist_id: string })
      : null;
  const pr = row.profiles;
  const inquirer = Array.isArray(pr) && pr.length > 0
    ? (pr[0] as { username: string | null; display_name: string | null })
    : pr && typeof pr === "object" && !Array.isArray(pr)
      ? (pr as { username: string | null; display_name: string | null })
      : null;
  return {
    id: row.id as string,
    artwork_id: row.artwork_id as string,
    inquirer_id: row.inquirer_id as string,
    message: (row.message as string) ?? null,
    artist_reply: (row.artist_reply as string) ?? null,
    replied_at: (row.replied_at as string) ?? null,
    replied_by_id: (row.replied_by_id as string) ?? null,
    created_at: row.created_at as string,
    inquiry_status: (row.inquiry_status as InquiryStatus) ?? null,
    last_message_at: (row.last_message_at as string) ?? null,
    artist_unread: row.artist_unread as boolean | null,
    inquirer_unread: row.inquirer_unread as boolean | null,
    pipeline_stage: (row.pipeline_stage as PipelineStage) ?? null,
    assignee_id: (row.assignee_id as string) ?? null,
    next_action_date: (row.next_action_date as string) ?? null,
    last_contact_date: (row.last_contact_date as string) ?? null,
    source_surface: (row.source_surface as InquirySourceSurface) ?? null,
    source_artwork_id: (row.source_artwork_id as string) ?? null,
    source_exhibition_id: (row.source_exhibition_id as string) ?? null,
    source_room_id: (row.source_room_id as string) ?? null,
    source_feed_session_id: (row.source_feed_session_id as string) ?? null,
    source_feed_item_key: (row.source_feed_item_key as string) ?? null,
    source_payload:
      row.source_payload && typeof row.source_payload === "object" && !Array.isArray(row.source_payload)
        ? (row.source_payload as Record<string, unknown>)
        : null,
    artwork: artwork ?? null,
    inquirer: inquirer ?? null,
  };
}

/**
 * Sanitize a client-supplied source attribution payload before persisting.
 * Strips fields the schema CHECK would reject and tiny privacy hazards we
 * never want in long-lived analytics rows.
 *
 * Specifically:
 *   - Caps `source_payload` at 1 KiB JSON to keep rows compact.
 *   - Drops obviously-secret-looking keys (`token`, `password`, `secret`,
 *     anything ending in `_token`). Defense-in-depth — the call sites are
 *     supposed to never pass these in, but the safety net is cheap.
 *   - Coerces nullish to nulls so the SQL `null` defaults kick in cleanly.
 */
function sanitizeInquirySource(input: InquirySource): {
  source_surface: InquirySourceSurface | null;
  source_artwork_id: string | null;
  source_exhibition_id: string | null;
  source_room_id: string | null;
  source_feed_session_id: string | null;
  source_feed_item_key: string | null;
  source_payload: Record<string, unknown> | null;
} {
  const surface = input.surface ?? null;
  const allowed: InquirySourceSurface[] = ["feed", "room", "artwork", "exhibition", "profile", "direct"];
  const safeSurface = surface && allowed.includes(surface) ? surface : null;

  let safePayload: Record<string, unknown> | null = null;
  if (input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)) {
    const cleaned: Record<string, unknown> = {};
    const SECRET_KEY_RE = /(token|password|secret)$|_(token|password|secret)$/i;
    for (const [k, v] of Object.entries(input.payload)) {
      if (SECRET_KEY_RE.test(k)) continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v == null) {
        cleaned[k] = v;
      }
      // Skip nested objects/arrays for the v1 — they're not needed for
      // any current consumer and they're the most common way to bloat
      // analytics rows accidentally.
    }
    try {
      const json = JSON.stringify(cleaned);
      if (json.length <= 1024) {
        safePayload = cleaned;
      }
    } catch {
      safePayload = null;
    }
    if (safePayload && Object.keys(safePayload).length === 0) safePayload = null;
  }

  return {
    source_surface: safeSurface,
    source_artwork_id: input.artworkId ?? null,
    source_exhibition_id: input.exhibitionId ?? null,
    source_room_id: input.roomId ?? null,
    source_feed_session_id: input.feedSessionId ?? null,
    source_feed_item_key: input.feedItemKey ?? null,
    source_payload: safePayload,
  };
}

/** Exposed for unit tests. */
export const _testing = { sanitizeInquirySource };

/**
 * Create a price inquiry for an artwork (caller = inquirer).
 *
 * Sprint 3: optional `source` argument carries attribution context (where
 * the inquirer came from — feed / room / artwork / exhibition / profile).
 * Attribution is informational only — RLS and server-side checks are
 * unchanged. See `InquirySource` and `sanitizeInquirySource` for the
 * privacy invariants.
 *
 * Backward-compatible: existing call sites that pass only
 * `(artworkId, message?)` keep working unchanged. The third argument is
 * fully optional and defaults to "no attribution" (which is treated as
 * `source_surface = null` in storage; the inbox UI renders that as
 * "Direct").
 */
export async function createPriceInquiry(
  artworkId: string,
  message?: string | null,
  source?: InquirySource
): Promise<{ data: { id: string } | null; error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: null, error: new Error("Not authenticated") };

  const sourceColumns = source ? sanitizeInquirySource(source) : null;

  const { data, error } = await supabase
    .from("price_inquiries")
    .insert({
      artwork_id: artworkId,
      inquirer_id: session.user.id,
      message: message?.trim() || null,
      ...(sourceColumns ?? {}),
    })
    .select("id")
    .single();

  if (error) return { data: null, error };
  const row = data as { id: string };
  const trimmed = message?.trim();
  if (trimmed) {
    const { error: msgErr } = await supabase.from("price_inquiry_messages").insert({
      inquiry_id: row.id,
      sender_id: session.user.id,
      body: trimmed,
    });
    if (msgErr) return { data: row, error: msgErr };
  }
  logBetaEventSync("inquiry_created", {
    artwork_id: artworkId,
    inquiry_id: row.id,
    // Echo the resolved source surface (NOT the room token) so analytics
    // can split inquiry funnel by entrypoint without joining back to the
    // attribution columns.
    source_surface: sourceColumns?.source_surface ?? "direct",
  });
  return { data: row, error: null };
}

/**
 * Count of price inquiries on my artworks that still need attention
 * (status `new` / `open`). Replied / closed inquiries are intentionally
 * excluded so the studio "inbox" badge stops nagging the artist after
 * they've already answered (QA 2026-04-28). The total list page still
 * shows every inquiry regardless of status.
 */
export async function getMyPriceInquiryCount(profileId?: string): Promise<{ data: number; error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: 0, error: null };
  const targetId = profileId ?? session.user.id;
  // `inquiry_status` IS NULL covers legacy rows that pre-date the column;
  // we treat those as "open" so existing unanswered threads still surface.
  const { count, error } = await supabase
    .from("price_inquiries")
    .select("id, artworks!artwork_id!inner(artist_id)", { count: "exact", head: true })
    .eq("artworks.artist_id", targetId)
    .or("inquiry_status.in.(new,open),inquiry_status.is.null");
  if (error) return { data: 0, error };
  return { data: count ?? 0, error: null };
}

/**
 * List inquiries on my artworks (artist / delegate acting-as).
 * Keyset on (last_message_at desc, id desc).
 */
export async function listPriceInquiriesForArtist(
  options: ListPriceInquiriesForArtistOptions = {}
): Promise<{
  data: PriceInquiryRow[];
  nextCursor: InquiryListCursor | null;
  error: unknown;
}> {
  const {
    profileId,
    limit = 25,
    cursor = null,
    status = "all",
    pipelineStage = "all",
    search = "",
  } = options;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: [], nextCursor: null, error: null };

  const targetId = profileId ?? session.user.id;
  const pageSize = Math.min(Math.max(1, limit), 50);
  const requestLimit = pageSize + 1;

  let query = supabase
    .from("price_inquiries")
    .select(INQUIRY_LIST_SELECT)
    .eq("artworks.artist_id", targetId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(requestLimit);

  if (status !== "all") {
    query = query.eq("inquiry_status", status);
  }
  if (pipelineStage !== "all") {
    query = query.eq("pipeline_stage", pipelineStage);
  }

  const q = search.trim().replace(/,/g, " ");
  if (q) {
    const pat = `%${escapeIlike(q)}%`;
    query = query.or(`artworks.title.ilike.${pat},profiles.username.ilike.${pat}`);
  }

  if (cursor?.last_message_at && cursor?.id) {
    const ts = String(cursor.last_message_at).replace(/"/g, '\\"');
    const id = String(cursor.id).replace(/"/g, '\\"');
    query = query.or(
      `last_message_at.lt."${ts}",and(last_message_at.eq."${ts}",id.lt."${id}")`
    );
  }

  const { data, error } = await query;
  if (error) return { data: [], nextCursor: null, error };

  const rows = (data ?? []) as Record<string, unknown>[];
  const normalized = rows.map(normalizeInquiry);
  const slice = normalized.length > pageSize ? normalized.slice(0, pageSize) : normalized;
  let nextCursor: InquiryListCursor | null = null;
  if (normalized.length > pageSize && slice.length > 0) {
    const last = slice[slice.length - 1];
    const lm = last.last_message_at ?? last.created_at;
    if (lm && last.id) nextCursor = { last_message_at: lm, id: last.id };
  }
  return { data: slice, nextCursor, error: null };
}

export async function listPriceInquiryMessages(
  inquiryId: string
): Promise<{ data: PriceInquiryMessageRow[]; error: unknown }> {
  const { data, error } = await supabase
    .from("price_inquiry_messages")
    .select("id, inquiry_id, sender_id, body, created_at")
    .eq("inquiry_id", inquiryId)
    .order("created_at", { ascending: true });
  if (error) return { data: [], error };
  return { data: (data ?? []) as PriceInquiryMessageRow[], error: null };
}

export async function markPriceInquiryRead(inquiryId: string): Promise<{ error: unknown }> {
  const { error } = await supabase.rpc("mark_price_inquiry_read", {
    p_inquiry_id: inquiryId,
  });
  return { error };
}

export async function setPriceInquiryStatus(
  inquiryId: string,
  status: InquiryStatus
): Promise<{ error: unknown }> {
  const { error } = await supabase.rpc("set_price_inquiry_status", {
    p_inquiry_id: inquiryId,
    p_status: status,
  });
  return { error };
}

/** Append a thread message (inquirer or artist/delegate). */
export async function appendPriceInquiryMessage(
  inquiryId: string,
  body: string
): Promise<{ error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { error: new Error("Not authenticated") };
  const text = body.trim();
  if (!text) return { error: new Error("Empty message") };

  const { error } = await supabase.from("price_inquiry_messages").insert({
    inquiry_id: inquiryId,
    sender_id: session.user.id,
    body: text,
  });
  return { error };
}

/** Whether the current user can reply to price inquiries for this artwork (backend: CREATED claim = artist). */
export async function canReplyToPriceInquiry(artworkId: string): Promise<{ data: boolean; error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: false, error: null };

  const { data, error } = await supabase.rpc("can_reply_to_price_inquiry", {
    p_artwork_id: artworkId,
  });
  if (error) return { data: false, error };
  return { data: Boolean(data), error: null };
}

/** List price inquiries for one artwork (for artist; RLS restricts to artist). */
export async function listPriceInquiriesForArtwork(artworkId: string): Promise<{ data: PriceInquiryRow[]; error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: [], error: null };

  const { data, error } = await supabase
    .from("price_inquiries")
    .select(INQUIRY_SELECT)
    .eq("artwork_id", artworkId)
    .order("created_at", { ascending: false });

  if (error) return { data: [], error };
  const rows = (data ?? []) as Record<string, unknown>[];
  return { data: rows.map((r) => normalizeInquiry(r)), error: null };
}

/** My inquiry for a single artwork (to show "Already inquired" or reply state). */
export async function getMyInquiryForArtwork(artworkId: string): Promise<{ data: PriceInquiryRow | null; error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: null, error: null };

  const { data, error } = await supabase
    .from("price_inquiries")
    .select(INQUIRY_SELECT)
    .eq("artwork_id", artworkId)
    .eq("inquirer_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { data: null, error };
  return { data: data ? normalizeInquiry(data as Record<string, unknown>) : null, error: null };
}

/** Resend price_inquiry notification to artist/delegates for own unanswered inquiry (e.g. pre-patch inquiry that never notified). */
export async function resendPriceInquiryNotification(inquiryId: string): Promise<{ data: number; error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: 0, error: new Error("Not authenticated") };

  const { data, error } = await supabase.rpc("resend_price_inquiry_notification", {
    p_inquiry_id: inquiryId,
  });
  if (error) return { data: 0, error };
  return { data: typeof data === "number" ? data : 0, error: null };
}

/**
 * Artist/delegate reply: inserts a thread row; DB trigger syncs legacy artist_reply / replied_at for notifications.
 */
export async function replyToPriceInquiry(inquiryId: string, reply: string): Promise<{ error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { error: new Error("Not authenticated") };

  const { error } = await supabase.from("price_inquiry_messages").insert({
    inquiry_id: inquiryId,
    sender_id: session.user.id,
    body: reply.trim() || "",
  });
  if (!error) {
    logBetaEventSync("inquiry_replied", { inquiry_id: inquiryId });
    await recordUsageEvent({
      userId: session.user.id,
      key: USAGE_KEYS.INQUIRY_REPLIED,
      featureKey: "inquiry.triage",
      metadata: { inquiry_id: inquiryId },
    });
    // Best-effort acting-as audit. Lookup artist_id of the underlying
    // artwork and, if the current session user isn't that artist, log
    // the reply as a delegation event.
    try {
      const { data: inq } = await supabase
        .from("price_inquiries")
        .select("artworks!artwork_id(artist_id)")
        .eq("id", inquiryId)
        .maybeSingle();
      const aw = (inq as { artworks?: { artist_id?: string } | { artist_id?: string }[] } | null)
        ?.artworks;
      const artistId = Array.isArray(aw) ? aw[0]?.artist_id ?? null : aw?.artist_id ?? null;
      if (artistId && artistId !== session.user.id) {
        await recordActingContextEvent({
          subjectProfileId: artistId,
          action: "inquiry.reply",
          resourceType: "price_inquiry",
          resourceId: inquiryId,
          payload: { has_body: (reply ?? "").trim().length > 0 },
        });
      }
    } catch {
      /* best-effort */
    }
  }
  return { error };
}

// ── Pipeline helpers ──────────────────────────────────────────

export async function updateInquiryPipeline(
  inquiryId: string,
  fields: {
    pipeline_stage?: PipelineStage;
    assignee_id?: string;
    next_action_date?: string | null;
    last_contact_date?: string | null;
  }
): Promise<{ error: unknown }> {
  const { error } = await supabase.rpc("update_inquiry_pipeline", {
    p_inquiry_id: inquiryId,
    p_pipeline_stage: fields.pipeline_stage ?? null,
    p_assignee_id: fields.assignee_id ?? null,
    p_next_action_date: fields.next_action_date ?? null,
    p_last_contact_date: fields.last_contact_date ?? null,
  });
  return { error };
}

// ── Inquiry notes (internal, private to gallery) ──────────────

export async function listInquiryNotes(
  inquiryId: string
): Promise<{ data: InquiryNoteRow[]; error: unknown }> {
  const { data, error } = await supabase
    .from("inquiry_notes")
    .select("id, inquiry_id, author_id, body, created_at")
    .eq("inquiry_id", inquiryId)
    .order("created_at", { ascending: true });
  if (error) return { data: [], error };
  return { data: (data ?? []) as InquiryNoteRow[], error: null };
}

export async function addInquiryNote(
  inquiryId: string,
  body: string
): Promise<{ error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { error: new Error("Not authenticated") };
  const { error } = await supabase.from("inquiry_notes").insert({
    inquiry_id: inquiryId,
    author_id: session.user.id,
    body: body.trim(),
  });
  return { error };
}
