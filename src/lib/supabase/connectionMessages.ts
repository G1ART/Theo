import { supabase } from "./client";
import type { FollowProfileRow } from "./follows";
import { recordUsageEvent } from "@/lib/metering";
import { USAGE_KEYS } from "@/lib/metering/usageKeys";

const SENDER_SELECT = "id, username, display_name, avatar_url, bio, main_role, roles";

export type ConnectionMessageRow = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
  sender: FollowProfileRow | null;
};

/**
 * Lightweight summary of a conversation thread. Produced by either
 * `list_connection_conversations` (v1) or `list_connection_conversations_v2`
 * (Sprint C.M / 2026-08-03). The v2 RPC additionally returns per-thread
 * `category` + `state` so /my/messages can split its inbox into three
 * tabs (Primary / General / New Request) and label each row with the
 * receive/opened/sent/read state the wireframe requests.
 *
 * The `otherUser` profile is hydrated client-side via a single
 * `in("id", …)` query so the RPC schema stays narrow and cache-friendly.
 */
export type ConnectionThreadCategory = "primary" | "general" | "request";
export type ConnectionThreadState = "received" | "opened" | "sent" | "read";

export type ConversationSummary = {
  participantKey: string;
  otherUserId: string;
  otherUser: FollowProfileRow | null;
  lastMessageId: string;
  lastBody: string;
  lastCreatedAt: string;
  lastReadAt: string | null;
  lastIsFromMe: boolean;
  unreadCount: number;
  /** Populated by the v2 RPC; v1 callers keep `null`. */
  category: ConnectionThreadCategory | null;
  /** Populated by the v2 RPC; v1 callers keep `null`. */
  state: ConnectionThreadState | null;
  /** Present on v2 rows so callers can hide declined threads. */
  declinedAt: string | null;
  /** First accept timestamp — helpful for surfacing "accepted just now" UX. */
  firstAcceptedAt: string | null;
};

const MAX_BODY = 4000;

/**
 * Insert a connection message. The recipient notification row is created by
 * the `on_connection_message_notify` trigger in the
 * 20260422_connection_messages migration, so the client does not need a
 * second insert for notifications.
 */
export async function sendConnectionMessage(
  recipientId: string,
  body: string,
): Promise<{ data: { id: string } | null; error: Error | null }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    return { data: null, error: new Error("Not authenticated") };
  }
  const trimmed = body.trim();
  if (!trimmed) {
    return { data: null, error: new Error("Empty message") };
  }
  if (session.user.id === recipientId) {
    return { data: null, error: new Error("Cannot message self") };
  }
  const clipped = trimmed.length > MAX_BODY ? trimmed.slice(0, MAX_BODY) : trimmed;
  const { data, error } = await supabase
    .from("connection_messages")
    .insert({
      sender_id: session.user.id,
      recipient_id: recipientId,
      body: clipped,
    })
    .select("id")
    .single();
  if (error) return { data: null, error };
  await recordUsageEvent({
    userId: session.user.id,
    key: USAGE_KEYS.CONNECTION_MESSAGE_SENT,
    featureKey: "social.connection_unlimited",
    metadata: { recipient_id: recipientId, message_id: data.id },
  });
  return { data: { id: data.id as string }, error: null };
}

/**
 * List connection messages where the current user is the recipient. Returns
 * newest first with cursor-based pagination (the cursor is just the offset
 * as a string — mirrors the pattern used by `getMyFollowers`).
 */
export async function listMyReceivedMessages(
  options: { limit?: number; cursor?: string } = {},
): Promise<{
  data: ConnectionMessageRow[];
  nextCursor: string | null;
  error: Error | null;
}> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    return { data: [], nextCursor: null, error: new Error("Not authenticated") };
  }

  const { limit = 20, cursor } = options;
  const offset = Math.max(0, Number.parseInt(cursor ?? "0", 10) || 0);

  const { data, error } = await supabase
    .from("connection_messages")
    .select(
      `id, sender_id, recipient_id, body, read_at, created_at, sender:profiles!sender_id(${SENDER_SELECT})`,
    )
    .eq("recipient_id", session.user.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);

  if (error) return { data: [], nextCursor: null, error };

  const raw = (data ?? []) as Array<
    Omit<ConnectionMessageRow, "sender"> & {
      sender: FollowProfileRow | FollowProfileRow[] | null;
    }
  >;
  const hasMore = raw.length > limit;
  const list = hasMore ? raw.slice(0, limit) : raw;

  const normalized: ConnectionMessageRow[] = list.map((row) => ({
    id: row.id,
    sender_id: row.sender_id,
    recipient_id: row.recipient_id,
    body: row.body,
    read_at: row.read_at,
    created_at: row.created_at,
    sender: Array.isArray(row.sender) ? row.sender[0] ?? null : row.sender,
  }));

  return {
    data: normalized,
    nextCursor: hasMore ? String(offset + limit) : null,
    error: null,
  };
}

/**
 * Flip `read_at` to now() for a message the current user received. RLS
 * guarantees the update is only allowed when `recipient_id = auth.uid()`.
 */
export async function markConnectionMessageRead(
  messageId: string,
): Promise<{ error: Error | null }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { error: new Error("Not authenticated") };
  const { error } = await supabase
    .from("connection_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("id", messageId)
    .is("read_at", null);
  return { error: error ?? null };
}

/**
 * Bulk-mark every unread message sent by `otherUserId` to the authenticated
 * user as read. Used when opening a conversation thread so the /my badge
 * clears immediately and the thread view reflects the correct state on
 * first paint.
 */
export async function markConversationRead(
  otherUserId: string,
): Promise<{ error: Error | null }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { error: new Error("Not authenticated") };
  const { error } = await supabase
    .from("connection_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", session.user.id)
    .eq("sender_id", otherUserId)
    .is("read_at", null);
  return { error: error ?? null };
}

/**
 * List the caller's conversations, newest first, with a last-message
 * preview and an unread count per thread. Delegates grouping to the
 * `list_connection_conversations` RPC so pagination remains O(N).
 *
 * The `otherUser` profile field is hydrated client-side via a single
 * `profiles` lookup to keep the RPC schema narrow and cache-friendly.
 */
export async function listMyConversations(
  options: { limit?: number; beforeTs?: string | null } = {},
): Promise<{
  data: ConversationSummary[];
  nextCursor: string | null;
  error: Error | null;
}> {
  const { limit = 20, beforeTs = null } = options;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    return { data: [], nextCursor: null, error: new Error("Not authenticated") };
  }

  const { data, error } = await supabase.rpc("list_connection_conversations", {
    limit_count: limit,
    before_ts: beforeTs,
  });

  if (error) return { data: [], nextCursor: null, error };

  const rows = (data ?? []) as Array<{
    participant_key: string;
    other_user_id: string;
    last_message_id: string;
    last_body: string;
    last_created_at: string;
    last_read_at: string | null;
    last_is_from_me: boolean;
    unread_count: number;
  }>;

  if (rows.length === 0) {
    return { data: [], nextCursor: null, error: null };
  }

  const otherIds = Array.from(new Set(rows.map((r) => r.other_user_id)));
  const { data: profiles } = await supabase
    .from("profiles")
    .select(SENDER_SELECT)
    .in("id", otherIds);

  const byId = new Map<string, FollowProfileRow>();
  for (const p of (profiles ?? []) as FollowProfileRow[]) {
    if (p?.id) byId.set(p.id, p);
  }

  const data_: ConversationSummary[] = rows.map((r) => ({
    participantKey: r.participant_key,
    otherUserId: r.other_user_id,
    otherUser: byId.get(r.other_user_id) ?? null,
    lastMessageId: r.last_message_id,
    lastBody: r.last_body,
    lastCreatedAt: r.last_created_at,
    lastReadAt: r.last_read_at,
    lastIsFromMe: r.last_is_from_me,
    unreadCount: Number(r.unread_count) || 0,
    category: null,
    state: null,
    declinedAt: null,
    firstAcceptedAt: null,
  }));

  // Cursor is the oldest message in the current page — feeding it back as
  // `beforeTs` returns the next page. Only surface a cursor when the page
  // is full so the caller can stop paginating at a clear boundary.
  const nextCursor =
    data_.length === limit ? data_[data_.length - 1].lastCreatedAt : null;

  return { data: data_, nextCursor, error: null };
}

/**
 * Sprint C.M / 2026-08-03 — v2 of the conversation listing RPC.
 *
 * Additive over `listMyConversations`: v2 also returns per-thread
 * `category` (primary / general / request) and a per-thread `state`
 * (received / opened / sent / read) computed server-side from the last
 * message's direction + read_at. The categorized inbox at
 * `/my/messages` uses this to power its three tabs and per-row state
 * labels; older callers stay on v1 for backwards compatibility.
 */
export async function listMyConversationsV2(
  options: {
    category?: ConnectionThreadCategory | null;
    limit?: number;
    beforeTs?: string | null;
    includeDeclined?: boolean;
  } = {},
): Promise<{
  data: ConversationSummary[];
  nextCursor: string | null;
  error: Error | null;
}> {
  const {
    category = null,
    limit = 20,
    beforeTs = null,
    includeDeclined = false,
  } = options;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    return { data: [], nextCursor: null, error: new Error("Not authenticated") };
  }

  const { data, error } = await supabase.rpc("list_connection_conversations_v2", {
    p_category: category,
    p_limit: limit,
    p_before_ts: beforeTs,
    p_include_declined: includeDeclined,
  });

  if (error) return { data: [], nextCursor: null, error };

  const rows = (data ?? []) as Array<{
    participant_key: string;
    other_user_id: string;
    category: ConnectionThreadCategory;
    first_accepted_at: string | null;
    declined_at: string | null;
    last_message_id: string;
    last_body: string;
    last_created_at: string;
    last_sender_id: string;
    last_read_at: string | null;
    last_is_from_me: boolean;
    unread_count: number;
    state: ConnectionThreadState;
  }>;

  if (rows.length === 0) {
    return { data: [], nextCursor: null, error: null };
  }

  const otherIds = Array.from(new Set(rows.map((r) => r.other_user_id)));
  const { data: profiles } = await supabase
    .from("profiles")
    .select(SENDER_SELECT)
    .in("id", otherIds);

  const byId = new Map<string, FollowProfileRow>();
  for (const p of (profiles ?? []) as FollowProfileRow[]) {
    if (p?.id) byId.set(p.id, p);
  }

  const mapped: ConversationSummary[] = rows.map((r) => ({
    participantKey: r.participant_key,
    otherUserId: r.other_user_id,
    otherUser: byId.get(r.other_user_id) ?? null,
    lastMessageId: r.last_message_id,
    lastBody: r.last_body,
    lastCreatedAt: r.last_created_at,
    lastReadAt: r.last_read_at,
    lastIsFromMe: r.last_is_from_me,
    unreadCount: Number(r.unread_count) || 0,
    category: r.category,
    state: r.state,
    declinedAt: r.declined_at,
    firstAcceptedAt: r.first_accepted_at,
  }));

  const nextCursor =
    mapped.length === limit ? mapped[mapped.length - 1].lastCreatedAt : null;

  return { data: mapped, nextCursor, error: null };
}

/**
 * Accept a `request`-category thread from `peerUserId`. If the two
 * accounts mutually follow, the thread flips to `primary`; otherwise
 * `general`. Idempotent — repeated calls simply refresh the accepted
 * timestamps and clear any prior `declined_at`.
 */
export async function acceptConnectionMessageThread(
  peerUserId: string,
): Promise<{ error: Error | null }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { error: new Error("Not authenticated") };
  const { error } = await supabase.rpc("accept_connection_message_thread", {
    p_peer: peerUserId,
  });
  return { error: error ?? null };
}

/**
 * Decline a `request`-category thread from `peerUserId`. This is a
 * *soft* hide — the thread row stays around so a subsequent message
 * from the peer can re-open it as `request` via the insert trigger.
 * That mirrors typical DM behavior (Instagram / TG) where declining a
 * message doesn't nuke the peer's ability to try again.
 */
export async function declineConnectionMessageThread(
  peerUserId: string,
): Promise<{ error: Error | null }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { error: new Error("Not authenticated") };
  const { error } = await supabase.rpc("decline_connection_message_thread", {
    p_peer: peerUserId,
  });
  return { error: error ?? null };
}

/**
 * Fetch a single thread between the caller and `otherUserId`. Returns every
 * direction (sent + received) ordered oldest → newest so the chat view can
 * render bubbles without re-sorting. Pagination walks backwards through
 * `beforeTs`: pass the oldest message's `created_at` to load the next
 * older page.
 */
export async function listConversationWith(
  otherUserId: string,
  options: { limit?: number; beforeTs?: string | null } = {},
): Promise<{
  data: ConnectionMessageRow[];
  nextCursor: string | null;
  error: Error | null;
}> {
  const { limit = 40, beforeTs = null } = options;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    return { data: [], nextCursor: null, error: new Error("Not authenticated") };
  }
  if (session.user.id === otherUserId) {
    return { data: [], nextCursor: null, error: new Error("Cannot load self thread") };
  }

  // `participant_key` is generated-always-as on the table (see the
  // 20260425000000_connection_message_threads migration). Computing it
  // client-side matches the DB expression exactly and lets us hit the
  // dedicated `(participant_key, created_at desc)` index.
  const [a, b] = [session.user.id, otherUserId].sort();
  const participantKey = `${a}:${b}`;

  let query = supabase
    .from("connection_messages")
    .select(
      `id, sender_id, recipient_id, body, read_at, created_at, sender:profiles!sender_id(${SENDER_SELECT})`,
    )
    .eq("participant_key", participantKey)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (beforeTs) query = query.lt("created_at", beforeTs);

  const { data, error } = await query;
  if (error) return { data: [], nextCursor: null, error };

  const raw = (data ?? []) as Array<
    Omit<ConnectionMessageRow, "sender"> & {
      sender: FollowProfileRow | FollowProfileRow[] | null;
    }
  >;
  const hasMore = raw.length > limit;
  const page = hasMore ? raw.slice(0, limit) : raw;

  const normalized: ConnectionMessageRow[] = page
    .map((row) => ({
      id: row.id,
      sender_id: row.sender_id,
      recipient_id: row.recipient_id,
      body: row.body,
      read_at: row.read_at,
      created_at: row.created_at,
      sender: Array.isArray(row.sender) ? row.sender[0] ?? null : row.sender,
    }))
    // The chat bubble view renders oldest → newest. Query returns newest
    // first for deterministic cursoring, so we flip here instead of
    // forcing every caller to re-sort.
    .reverse();

  const nextCursor = hasMore ? page[page.length - 1].created_at : null;

  return { data: normalized, nextCursor, error: null };
}

/**
 * Count unread messages for the current user. Used for the /my signals
 * badge. Returns 0 on failure so the badge never blocks page render.
 */
export async function getUnreadConnectionMessageCount(): Promise<number> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return 0;
  const { count, error } = await supabase
    .from("connection_messages")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", session.user.id)
    .is("read_at", null);
  if (error) return 0;
  return count ?? 0;
}
