import { getStorageUrl } from "@/lib/supabase/artworks";

/**
 * Resolve a space's `photo_storage_path` to a public URL. Chunk B
 * stores space photos in the existing `artworks` bucket
 * (`{userId}/spaces/{spaceId}/photo.webp`), so we reuse
 * `getStorageUrl` from `artworks.ts` — the storage RLS on that
 * bucket allows public read.
 *
 * Callers should treat a `null` return as "no photo yet" and render
 * an empty-state placeholder.
 */
export function spacePhotoUrl(storagePath: string | null): string | null {
  if (!storagePath) return null;
  return getStorageUrl(storagePath);
}
