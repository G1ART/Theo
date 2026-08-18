import { supabase } from "./client";
import { recordUsageEvent } from "@/lib/metering";
import { USAGE_KEYS } from "@/lib/metering/usageKeys";

export type ShortlistRow = {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  is_private: boolean;
  share_token: string;
  room_active?: boolean;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
  item_count?: number;
};

export type ShortlistItemRow = {
  id: string;
  shortlist_id: string;
  artwork_id: string | null;
  exhibition_id: string | null;
  note: string | null;
  position: number;
  created_at: string;
  artwork?: {
    id: string;
    title: string | null;
    /** QA 2026-08-17 bilingual — feed `pickLocalizedArtworkTitle`. */
    title_ko?: string | null;
    title_en?: string | null;
    artist_id: string;
    image_path: string | null;
  } | null;
  exhibition?: {
    id: string;
    title: string | null;
    /** QA 2026-08-17 bilingual — feed `pickLocalizedTitle`. */
    title_ko?: string | null;
    title_en?: string | null;
  } | null;
};

export type ShortlistCollaboratorRow = {
  id: string;
  shortlist_id: string;
  profile_id: string;
  role: "viewer" | "editor";
  created_at: string;
  profile?: {
    username: string | null;
    display_name: string | null;
    /** QA 2026-08-17 bilingual — feed `formatDisplayName(profile, t, locale)`. */
    display_name_ko?: string | null;
    display_name_en?: string | null;
  } | null;
};

export type RoomItem = {
  item_id: string;
  artwork_id: string | null;
  exhibition_id: string | null;
  note: string | null;
  position: number;
  artwork_title: string | null;
  artwork_image_path: string | null;
  artwork_artist_name: string | null;
  exhibition_title: string | null;
};

export type RoomMeta = {
  id: string;
  title: string;
  description: string | null;
  owner_id: string;
  owner_username: string | null;
  owner_display_name: string | null;
};

// ── CRUD ──────────────────────────────────────────────────────

/**
 * `forProfileId` (acting-as): when an account-scope delegate operates on
 * behalf of a principal, set `owner_id` to the principal so the board
 * lives under their profile. RLS policy
 * `shortlists_insert_account_delegate` (added 2026-04-28) allows this
 * INSERT path; RLS will reject it for solo callers without permission.
 */
export async function createShortlist(
  title: string,
  description?: string,
  options?: { forProfileId?: string | null }
): Promise<{ data: ShortlistRow | null; error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: null, error: new Error("Not authenticated") };
  const ownerId = options?.forProfileId ?? session.user.id;
  const { data, error } = await supabase
    .from("shortlists")
    .insert({ owner_id: ownerId, title, description: description ?? null })
    .select("*")
    .single();
  if (error) return { data: null, error };
  await recordUsageEvent({
    userId: session.user.id,
    key: USAGE_KEYS.BOARD_CREATED,
    featureKey: "board.pro_create",
    metadata: { shortlist_id: (data as { id?: string } | null)?.id ?? null },
  });
  return { data: data as ShortlistRow, error: null };
}

export async function listMyShortlists(
  options?: { forProfileId?: string | null }
): Promise<{
  data: ShortlistRow[];
  error: unknown;
}> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: [], error: null };
  const ownerId = options?.forProfileId ?? session.user.id;
  const { data, error } = await supabase
    .from("shortlists")
    .select("*, shortlist_items(count)")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });
  if (error) return { data: [], error };
  const rows = (data ?? []).map((r: Record<string, unknown>) => {
    const items = r.shortlist_items;
    const count = Array.isArray(items) && items[0] && typeof items[0] === "object"
      ? (items[0] as { count: number }).count
      : 0;
    return { ...r, item_count: count } as ShortlistRow;
  });
  return { data: rows, error: null };
}

export async function getShortlist(
  id: string
): Promise<{ data: ShortlistRow | null; error: unknown }> {
  const { data, error } = await supabase
    .from("shortlists")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return { data: null, error };
  return { data: data as ShortlistRow, error: null };
}

export async function updateShortlist(
  id: string,
  fields: { title?: string; description?: string | null; is_private?: boolean }
): Promise<{ error: unknown }> {
  const { error } = await supabase
    .from("shortlists")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
  return { error };
}

export async function deleteShortlist(id: string): Promise<{ error: unknown }> {
  const { error } = await supabase.from("shortlists").delete().eq("id", id);
  return { error };
}

// ── Items ─────────────────────────────────────────────────────

export async function listShortlistItems(
  shortlistId: string
): Promise<{ data: ShortlistItemRow[]; error: unknown }> {
  // NOTE: `artworks` has no `image_path` column. Thumbnails live in the
  // separate `artwork_images` table (storage_path, sort_order). We embed it
  // and expose the first image path as `artwork.image_path` for callers.
  const { data, error } = await supabase
    .from("shortlist_items")
    .select(
      "*, artworks!artwork_id(id, title, title_ko, title_en, artist_id, artwork_images(storage_path, sort_order, view_type)), projects!exhibition_id(id, title, title_ko, title_en)"
    )
    .eq("shortlist_id", shortlistId)
    .order("position")
    .order("created_at");
  if (error) return { data: [], error };
  const rows = (data ?? []).map((r: Record<string, unknown>) => {
    const aw = r.artworks as
      | {
          id: string;
          title: string | null;
          title_ko?: string | null;
          title_en?: string | null;
          artist_id: string;
          artwork_images?: { storage_path: string | null; sort_order: number | null }[] | null;
        }
      | null;
    let artwork: ShortlistItemRow["artwork"] = null;
    if (aw && typeof aw === "object" && !Array.isArray(aw)) {
      const imgs = Array.isArray(aw.artwork_images) ? [...aw.artwork_images] : [];
      imgs.sort(
        (a, b) =>
          (a?.sort_order ?? 0) - (b?.sort_order ?? 0)
      );
      artwork = {
        id: aw.id,
        title: aw.title,
        title_ko: aw.title_ko ?? null,
        title_en: aw.title_en ?? null,
        artist_id: aw.artist_id,
        image_path: imgs[0]?.storage_path ?? null,
      };
    }
    const pr = r.projects;
    const exhibition = pr && typeof pr === "object" && !Array.isArray(pr) ? pr as ShortlistItemRow["exhibition"] : null;
    return { ...r, artwork, exhibition } as ShortlistItemRow;
  });
  return { data: rows, error: null };
}

export async function addArtworkToShortlist(
  shortlistId: string,
  artworkId: string,
  note?: string
): Promise<{ error: unknown }> {
  const { error } = await supabase.from("shortlist_items").insert({
    shortlist_id: shortlistId,
    artwork_id: artworkId,
    note: note ?? null,
  });
  if (!error) {
    await supabase
      .from("shortlists")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", shortlistId);
    await recordUsageEvent({
      key: USAGE_KEYS.BOARD_SAVED_ARTWORK,
      featureKey: "board.pro_create",
      metadata: { shortlist_id: shortlistId, artwork_id: artworkId },
    });
  }
  return { error };
}

export async function addExhibitionToShortlist(
  shortlistId: string,
  exhibitionId: string,
  note?: string
): Promise<{ error: unknown }> {
  const { error } = await supabase.from("shortlist_items").insert({
    shortlist_id: shortlistId,
    exhibition_id: exhibitionId,
    note: note ?? null,
  });
  if (!error) {
    // Keep parent timestamp fresh so sort-by-recent surfaces match intent.
    await supabase
      .from("shortlists")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", shortlistId);
    await recordUsageEvent({
      key: USAGE_KEYS.BOARD_SAVED_EXHIBITION,
      featureKey: "board.pro_create",
      metadata: { shortlist_id: shortlistId, exhibition_id: exhibitionId },
    });
  }
  return { error };
}

export async function removeShortlistItem(itemId: string): Promise<{ error: unknown }> {
  const { error } = await supabase.from("shortlist_items").delete().eq("id", itemId);
  return { error };
}

export async function updateShortlistItemNote(
  itemId: string,
  note: string | null
): Promise<{ error: unknown }> {
  const { error } = await supabase.from("shortlist_items").update({ note }).eq("id", itemId);
  return { error };
}

// ── Collaborators ─────────────────────────────────────────────

export async function listShortlistCollaborators(
  shortlistId: string
): Promise<{ data: ShortlistCollaboratorRow[]; error: unknown }> {
  const { data, error } = await supabase
    .from("shortlist_collaborators")
    .select(
      "*, profiles!profile_id(username, display_name, display_name_ko, display_name_en)"
    )
    .eq("shortlist_id", shortlistId)
    .order("created_at");
  if (error) return { data: [], error };
  const rows = (data ?? []).map((r: Record<string, unknown>) => {
    const pr = r.profiles;
    const profile = pr && typeof pr === "object" && !Array.isArray(pr)
      ? pr as {
          username: string | null;
          display_name: string | null;
          display_name_ko?: string | null;
          display_name_en?: string | null;
        }
      : null;
    return { ...r, profile } as ShortlistCollaboratorRow;
  });
  return { data: rows, error: null };
}

export async function addCollaborator(
  shortlistId: string,
  profileId: string,
  role: "viewer" | "editor" = "viewer"
): Promise<{ error: unknown }> {
  const { error } = await supabase.from("shortlist_collaborators").insert({
    shortlist_id: shortlistId,
    profile_id: profileId,
    role,
  });
  return { error };
}

export async function removeCollaborator(collaboratorId: string): Promise<{ error: unknown }> {
  const { error } = await supabase.from("shortlist_collaborators").delete().eq("id", collaboratorId);
  return { error };
}

// ── Public room (via RPC / share_token) ───────────────────────

export async function getRoomByToken(
  token: string
): Promise<{ data: RoomMeta | null; error: unknown }> {
  const { data, error } = await supabase.rpc("get_shortlist_by_token", { p_token: token });
  if (error) return { data: null, error };
  const rows = data as RoomMeta[];
  return { data: rows?.[0] ?? null, error: null };
}

export async function getRoomItemsByToken(
  token: string
): Promise<{ data: RoomItem[]; error: unknown }> {
  const { data, error } = await supabase.rpc("get_shortlist_items_by_token", { p_token: token });
  if (error) return { data: [], error };
  return { data: (data ?? []) as RoomItem[], error: null };
}

export async function logRoomAction(
  shortlistId: string,
  action: "viewed" | "opened" | "inquiry_clicked"
): Promise<void> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    await supabase.from("shortlist_views").insert({
      shortlist_id: shortlistId,
      viewer_id: session?.user?.id ?? null,
      action,
    });
  } catch {
    /* best-effort */
  }
}

// ── Share controls ────────────────────────────────────────────

export async function rotateShareToken(
  shortlistId: string
): Promise<{ data: string | null; error: unknown }> {
  const { data, error } = await supabase.rpc("rotate_shortlist_token", {
    p_shortlist_id: shortlistId,
  });
  if (error) return { data: null, error };
  return { data: data as string, error: null };
}

export async function toggleRoomActive(
  shortlistId: string,
  active: boolean
): Promise<{ error: unknown }> {
  const { error } = await supabase
    .from("shortlists")
    .update({ room_active: active, updated_at: new Date().toISOString() })
    .eq("id", shortlistId);
  return { error };
}

export async function setRoomExpiry(
  shortlistId: string,
  expiresAt: string | null
): Promise<{ error: unknown }> {
  const { error } = await supabase
    .from("shortlists")
    .update({ expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq("id", shortlistId);
  return { error };
}

// ── Profile search for collaborator add ───────────────────────

export async function searchProfilesForCollab(
  query: string
): Promise<{
  data: {
    id: string;
    username: string | null;
    display_name: string | null;
    display_name_ko: string | null;
    display_name_en: string | null;
  }[];
  error: unknown;
}> {
  const q = query.trim();
  if (!q) return { data: [], error: null };
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, display_name_ko, display_name_en")
    .or(
      `username.ilike.%${q}%,display_name.ilike.%${q}%,display_name_ko.ilike.%${q}%,display_name_en.ilike.%${q}%`,
    )
    .limit(10);
  if (error) return { data: [], error };
  return {
    data: (data ?? []) as {
      id: string;
      username: string | null;
      display_name: string | null;
      display_name_ko: string | null;
      display_name_en: string | null;
    }[],
    error: null,
  };
}

// ── Check if artwork is in any of user's shortlists ──────────

export async function getShortlistIdsForArtwork(
  artworkId: string,
  options?: { forProfileId?: string | null }
): Promise<{ data: string[]; error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: [], error: null };
  const ownerId = options?.forProfileId ?? session.user.id;
  const { data, error } = await supabase
    .from("shortlist_items")
    .select("shortlist_id, shortlists!shortlist_id(owner_id)")
    .eq("artwork_id", artworkId);
  if (error) return { data: [], error };
  const ids = (data ?? [])
    .filter((r: Record<string, unknown>) => {
      const sl = r.shortlists;
      return sl && typeof sl === "object" && (sl as { owner_id: string }).owner_id === ownerId;
    })
    .map((r: Record<string, unknown>) => r.shortlist_id as string);
  return { data: ids, error: null };
}

export async function removeArtworkFromShortlist(
  shortlistId: string,
  artworkId: string
): Promise<{ error: unknown }> {
  const { error } = await supabase
    .from("shortlist_items")
    .delete()
    .eq("shortlist_id", shortlistId)
    .eq("artwork_id", artworkId);
  return { error };
}

/**
 * Exhibition counterpart of `getShortlistIdsForArtwork`. Needed so the
 * Save modal can show accurate "already in this board" state for
 * exhibitions too (previously only artworks were de-duped).
 */
export async function getShortlistIdsForExhibition(
  exhibitionId: string,
  options?: { forProfileId?: string | null }
): Promise<{ data: string[]; error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: [], error: null };
  const ownerId = options?.forProfileId ?? session.user.id;
  const { data, error } = await supabase
    .from("shortlist_items")
    .select("shortlist_id, shortlists!shortlist_id(owner_id)")
    .eq("exhibition_id", exhibitionId);
  if (error) return { data: [], error };
  const ids = (data ?? [])
    .filter((r: Record<string, unknown>) => {
      const sl = r.shortlists;
      return sl && typeof sl === "object" && (sl as { owner_id: string }).owner_id === ownerId;
    })
    .map((r: Record<string, unknown>) => r.shortlist_id as string);
  return { data: ids, error: null };
}

export async function removeExhibitionFromShortlist(
  shortlistId: string,
  exhibitionId: string
): Promise<{ error: unknown }> {
  const { error } = await supabase
    .from("shortlist_items")
    .delete()
    .eq("shortlist_id", shortlistId)
    .eq("exhibition_id", exhibitionId);
  return { error };
}

// ── Artist-side aggregate signal ──────────────────────────────
/**
 * Returns aggregate-only counts: how many distinct boards contain the
 * authenticated user's works, and how many distinct other users have
 * saved them. No per-board detail is exposed — this protects curator
 * scouting privacy. Per-save events are delivered via `board_save`
 * notifications with actor + artwork only.
 */
export type BoardSaveSignal = { boards_count: number; savers_count: number };

export async function getBoardSaveSignals(): Promise<{ data: BoardSaveSignal; error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: { boards_count: 0, savers_count: 0 }, error: null };
  const { data, error } = await supabase.rpc("get_board_save_signals");
  if (error) return { data: { boards_count: 0, savers_count: 0 }, error };
  const obj = (data ?? {}) as Partial<BoardSaveSignal>;
  return {
    data: {
      boards_count: Number(obj.boards_count ?? 0),
      savers_count: Number(obj.savers_count ?? 0),
    },
    error: null,
  };
}
