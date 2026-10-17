import { supabase } from "./client";
import { updateTasteFromLike } from "@/lib/ai/taste";

export async function isLiked(artworkId: string): Promise<boolean> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return false;

  const { count } = await supabase
    .from("artwork_likes")
    .select("*", { count: "exact", head: true })
    .eq("artwork_id", artworkId)
    .eq("user_id", session.user.id);

  return (count ?? 0) > 0;
}

export async function like(artworkId: string) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { error: new Error("Not authenticated") };
  const result = await supabase.from("artwork_likes").insert({
    artwork_id: artworkId,
    user_id: session.user.id,
  });
  if (!result.error) {
    updateTasteFromLike(session.user.id, artworkId).catch(() => {});
  }
  return result;
}

export async function unlike(artworkId: string) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { error: new Error("Not authenticated") };
  return supabase
    .from("artwork_likes")
    .delete()
    .eq("artwork_id", artworkId)
    .eq("user_id", session.user.id);
}

/** How many works the signed-in user has liked (own rows only). */
export async function countMyLikes(): Promise<number | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return null;
  const { count, error } = await supabase
    .from("artwork_likes")
    .select("artwork_id", { count: "exact", head: true })
    .eq("user_id", session.user.id);
  if (error) return null;
  return count ?? 0;
}

export async function getLikedArtworkIds(
  artworkIds: string[]
): Promise<Set<string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id || artworkIds.length === 0) return new Set();

  const { data } = await supabase
    .from("artwork_likes")
    .select("artwork_id")
    .eq("user_id", session.user.id)
    .in("artwork_id", artworkIds);

  return new Set((data ?? []).map((r) => r.artwork_id));
}
