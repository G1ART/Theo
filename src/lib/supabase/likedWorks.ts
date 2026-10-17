import { supabase } from "./client";
import { fetchPublicArtworkCardMap, type ArtworkWithLikes } from "./artworks";
import {
  readLikedMeta,
  type LikedChange,
  type LikedMine,
  type LikedShow,
} from "@/lib/likes/likedWorksView";

export type LikedRow = {
  artwork: ArtworkWithLikes;
  likedAt: string;
  exhibition: LikedShow | null;
  changes: LikedChange[];
  mine: LikedMine;
  moreAvailable: number;
};

export type MyLikedWorks = {
  rows: LikedRow[];
  /** Likes on works this viewer can no longer see (made private, profile hidden). */
  unavailableIds: string[];
};

type RpcRow = {
  artwork_id: string;
  liked_at: string;
  exhibition: unknown;
  changes: unknown;
  mine: unknown;
  artist_more_available: number | null;
};

// Kept for the session so returning from a detail renders the list at
// once and the profile scroll restore has its height.
let cache: { userId: string; data: MyLikedWorks } | null = null;

export function peekMyLikedWorks(userId: string | null): MyLikedWorks | null {
  return cache && userId && cache.userId === userId ? cache.data : null;
}

export function forgetMyLikedWorks(artworkIds: ReadonlyArray<string>): void {
  if (!cache || artworkIds.length === 0) return;
  const drop = new Set(artworkIds);
  cache = {
    userId: cache.userId,
    data: {
      rows: cache.data.rows.filter((row) => !drop.has(row.artwork.id)),
      unavailableIds: cache.data.unavailableIds.filter((id) => !drop.has(id)),
    },
  };
}

/**
 * The signed-in user's likes. Meta (liked time, exhibition, changes since
 * the like, own inquiry / board, the artist's other available works) is
 * judged by `list_my_liked_artworks`; cards come from `artwork_cards`,
 * so price and availability follow the same rule as everywhere else.
 */
export async function listMyLikedWorks(): Promise<{ data: MyLikedWorks | null; error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return { data: null, error: null };
  const { data, error } = await supabase.rpc("list_my_liked_artworks", { p_limit: 300 });
  if (error) return { data: null, error };
  const raw = (Array.isArray(data) ? data : []) as RpcRow[];
  const cards = await fetchPublicArtworkCardMap(
    raw.filter((row) => row.mine != null).map((row) => row.artwork_id),
  );
  const rows: LikedRow[] = [];
  const unavailableIds: string[] = [];
  for (const row of raw) {
    const artwork = cards.get(row.artwork_id);
    if (!artwork || row.mine == null) {
      unavailableIds.push(row.artwork_id);
      continue;
    }
    rows.push({
      artwork,
      likedAt: row.liked_at,
      ...readLikedMeta(row),
      moreAvailable: Math.max(0, Number(row.artist_more_available ?? 0) || 0),
    });
  }
  const result = { rows, unavailableIds };
  cache = { userId: uid, data: result };
  return { data: result, error: null };
}
