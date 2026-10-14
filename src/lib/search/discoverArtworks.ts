import {
  fetchPublicArtworkCardsByIds,
  scanPublicArtworkLean,
  type ArtworkWithLikes,
} from "@/lib/supabase/artworks";
import { findArtworkIdsForQuery } from "@/lib/search/findArtworkIds";
import {
  artworkMatchesDiscover,
  artworkQueryIsActive,
  discoverKindRank,
  discoverSqlKinds,
  parseArtworkQuery,
  type ArtworkConstraintSource,
} from "@/lib/search/artworkQuery";

function sortDiscover(rows: ArtworkWithLikes[]): ArtworkWithLikes[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const rank = discoverKindRank(a.row.work_kind) - discoverKindRank(b.row.work_kind);
      return rank !== 0 ? rank : a.index - b.index;
    })
    .map((item) => item.row);
}

/**
 * Public artwork search for the feed header.
 * Text (title, material, story, artist) uses the existing matcher.
 * Size, price, and sale are applied on stored columns afterwards.
 */
export async function searchDiscoverArtworks(raw: string, limit = 24): Promise<ArtworkWithLikes[]> {
  const parsed = parseArtworkQuery(raw);
  if (!artworkQueryIsActive(parsed)) return [];
  const cap = Math.min(Math.max(limit, 1), 48);
  let cards: ArtworkWithLikes[] = [];

  if (parsed.text) {
    const ids = await findArtworkIdsForQuery({
      query: parsed.text,
      mode: "public",
      limit: 80,
    });
    cards = await fetchPublicArtworkCardsByIds(ids);
  } else {
    const lean = await scanPublicArtworkLean(discoverSqlKinds(parsed));
    const ids: string[] = [];
    for (const row of lean) {
      if (!artworkMatchesDiscover(row as ArtworkConstraintSource, parsed)) continue;
      const id = typeof row.id === "string" ? row.id : "";
      if (!id) continue;
      ids.push(id);
      if (ids.length >= cap) break;
    }
    cards = await fetchPublicArtworkCardsByIds(ids);
  }

  return sortDiscover(cards.filter((art) => artworkMatchesDiscover(art, parsed))).slice(0, cap);
}
