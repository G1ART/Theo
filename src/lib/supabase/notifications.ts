import { supabase } from "./client";

export type NotificationType =
  | "like"
  | "follow"
  | "claim_request"
  | "claim_confirmed"
  | "claim_rejected"
  | "price_inquiry"
  | "price_inquiry_reply"
  | "new_work"
  | "connection_message"
  | "board_save"
  | "board_public"
  | "delegation_invite_received"
  | "delegation_accepted"
  | "delegation_declined"
  | "delegation_revoked"
  | "delegation_invite_canceled"
  | "delegation_resigned"
  | "delegation_permissions_updated"
  | "delegation_permission_change_requested"
  | "delegation_permission_change_dismissed"
  | "follow_request"
  | "follow_request_accepted";

export type NotificationRow = {
  id: string;
  user_id: string;
  type: NotificationType;
  actor_id: string | null;
  artwork_id: string | null;
  claim_id: string | null;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
  actor?: { username: string | null; display_name: string | null } | null;
  artwork?: { id: string; title: string | null; artist_id: string | null } | null;
};

const NOTIFICATION_SELECT = `
  id,
  user_id,
  type,
  actor_id,
  artwork_id,
  claim_id,
  payload,
  read_at,
  created_at,
  profiles!actor_id(username, display_name),
  artworks!artwork_id(id, title, artist_id)
`;

function normalizeNotification(
  row: Record<string, unknown>
): NotificationRow {
  const profiles = row.profiles;
  const actor =
    Array.isArray(profiles) && profiles.length > 0
      ? (profiles[0] as { username: string | null; display_name: string | null })
      : profiles && typeof profiles === "object" && !Array.isArray(profiles)
        ? (profiles as { username: string | null; display_name: string | null })
        : null;
  const artworks = row.artworks;
  const artwork =
    Array.isArray(artworks) && artworks.length > 0
      ? (artworks[0] as { id: string; title: string | null; artist_id: string | null })
      : artworks && typeof artworks === "object" && !Array.isArray(artworks)
        ? (artworks as { id: string; title: string | null; artist_id: string | null })
        : null;
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    type: row.type as NotificationType,
    actor_id: (row.actor_id as string) ?? null,
    artwork_id: (row.artwork_id as string) ?? null,
    claim_id: (row.claim_id as string) ?? null,
    payload: (row.payload as Record<string, unknown>) ?? {},
    read_at: (row.read_at as string) ?? null,
    created_at: row.created_at as string,
    actor: actor ?? null,
    artwork: artwork ?? null,
  };
}

export async function getUnreadCount(): Promise<{ data: number; error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: 0, error: null };

  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", session.user.id)
    .is("read_at", null);

  return { data: count ?? 0, error };
}

export async function listNotifications(options: {
  limit?: number;
  offset?: number;
}): Promise<{ data: NotificationRow[]; error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: [], error: null };

  const { limit = 30, offset = 0 } = options;

  const { data, error } = await supabase
    .from("notifications")
    .select(NOTIFICATION_SELECT)
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return { data: [], error };
  const rows = (data ?? []).map((r) => normalizeNotification(r as Record<string, unknown>));
  return { data: rows, error: null };
}

export async function markAllAsRead(): Promise<{ error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { error: null };

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", session.user.id)
    .is("read_at", null);

  return { error };
}

export async function markNotificationRead(id: string): Promise<{ error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { error: null };

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", session.user.id);

  return { error };
}
