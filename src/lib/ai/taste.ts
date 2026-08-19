/**
 * Taste profile update pipeline.
 * v0: works with null embeddings (debug counters only).
 */

import { supabase } from "@/lib/supabase/client";
import { weightedAverage, normalize } from "./vectorMath";

const WEIGHT_OLD = 0.8;
/**
 * Documented complement of {@link WEIGHT_OLD} used by the EMA update rule
 * (`newTaste = 0.8·oldTaste + 0.2·newLikeEmbedding`). Retained as a
 * named constant so the weighting scheme is explicit at the call site
 * even though `weightedAverage` currently accepts only `WEIGHT_OLD` and
 * infers the complement internally. Do not delete: swapping the mix ratio
 * lives here.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const WEIGHT_NEW = 0.2;

async function getArtworkEmbedding(artworkId: string): Promise<number[] | null> {
  const { data } = await supabase
    .from("artwork_embeddings")
    .select("text_embedding, image_embedding")
    .eq("artwork_id", artworkId)
    .maybeSingle();

  if (!data) return null;
  const row = data as { text_embedding?: number[] | null; image_embedding?: number[] | null };
  const text = Array.isArray(row.text_embedding) ? row.text_embedding : null;
  const image = Array.isArray(row.image_embedding) ? row.image_embedding : null;
  if (text) return text;
  if (image) return image;
  return null;
}

async function getTasteEmbedding(userId: string): Promise<number[] | null> {
  const { data } = await supabase
    .from("user_taste_profiles")
    .select("taste_embedding")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return null;
  const row = data as { taste_embedding?: number[] | null };
  return Array.isArray(row.taste_embedding) ? row.taste_embedding : null;
}

export async function updateTasteFromLike(
  userId: string,
  artworkId: string
): Promise<void> {
  try {
    const emb = await getArtworkEmbedding(artworkId);

    if (!emb || emb.length === 0) {
      const { data: existing } = await supabase
        .from("user_taste_profiles")
        .select("debug")
        .eq("user_id", userId)
        .maybeSingle();

      const debug = (existing as { debug?: Record<string, unknown> } | null)?.debug ?? {};
      const likedCount = (Number(debug.liked_count) || 0) + 1;
      const updated = {
        user_id: userId,
        taste_updated_at: new Date().toISOString(),
        last_event_at: new Date().toISOString(),
        debug: { ...debug, liked_count: likedCount, last_liked_artwork_id: artworkId },
      };

      await supabase.from("user_taste_profiles").upsert(updated, {
        onConflict: "user_id",
      });
      return;
    }

    const currentTaste = await getTasteEmbedding(userId);
    const newVec = currentTaste
      ? weightedAverage(currentTaste, emb, WEIGHT_OLD)
      : emb;
    if (!newVec) return;

    const normalized = normalize(newVec);
    await supabase.from("user_taste_profiles").upsert(
      {
        user_id: userId,
        taste_embedding: normalized,
        taste_updated_at: new Date().toISOString(),
        last_event_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[taste] updateTasteFromLike failed:", err);
    }
  }
}
