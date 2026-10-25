import { hasPublicLinkableUsername } from "@/lib/identity/format";
import { findArtworkIdsForQuery } from "@/lib/search/findArtworkIds";
import {
  classifySearchIntent,
  exactNameToken,
  orderArtworkIds,
  type SearchIntent,
} from "@/lib/search/searchIntent";
import { supabase } from "@/lib/supabase/client";
import { searchArtistsByArtwork, searchPeople, type PeopleRec } from "@/lib/supabase/peopleRecs";

export type SearchBundle = {
  intent: SearchIntent;
  artworkIds: string[];
  people: PeopleRec[];
};

const ID_CAP = 400;

function namedPeople(query: string, people: PeopleRec[], personId: string | null): PeopleRec[] {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const hits = people.filter(
    (person) =>
      hasPublicLinkableUsername(person) &&
      (exactNameToken(tokens.join(" "), person) || tokens.some((token) => exactNameToken(token, person))),
  );
  if (!personId) return hits;
  return [
    ...hits.filter((person) => person.id === personId),
    ...hits.filter((person) => person.id !== personId),
  ];
}

async function publicArtistIds(ids: string[]): Promise<{ id: string; artistId: string | null }[]> {
  const found = new Map<string, string | null>();
  for (let index = 0; index < ids.length; index += 100) {
    const slice = ids.slice(index, index + 100);
    const { data } = await supabase
      .from("artworks")
      .select("id, artist_id")
      .in("id", slice)
      .eq("visibility", "public");
    for (const row of data ?? []) {
      const id = typeof row.id === "string" ? row.id : "";
      if (!id) continue;
      found.set(id, typeof row.artist_id === "string" ? row.artist_id : null);
    }
  }
  return ids
    .filter((id) => found.has(id))
    .map((id) => ({ id, artistId: found.get(id) ?? null }));
}

/**
 * Full ordered id list, then the caller pages it.
 * Intent is decided here, before any page is cut, so the count and
 * the later pages stay on the same order.
 */
export async function prepareSearch(raw: string): Promise<SearchBundle> {
  const query = raw.trim();
  if (!query) return { intent: "work", artworkIds: [], people: [] };

  const [peopleRes, ids, related] = await Promise.all([
    searchPeople({ q: query, limit: 20 }),
    findArtworkIdsForQuery({ query, mode: "public", limit: ID_CAP }),
    searchArtistsByArtwork({ q: query, limit: 40 }),
  ]);
  const people = (peopleRes.data ?? []).filter((person) => hasPublicLinkableUsername(person));
  const { intent, personId } = classifySearchIntent(query, people);
  const rows = await publicArtistIds(ids);
  const artworkIds = orderArtworkIds(rows, intent === "work" ? null : personId);
  const listed =
    intent === "work"
      ? (related.data ?? []).filter((person) => hasPublicLinkableUsername(person))
      : namedPeople(query, people, personId);
  return { intent, artworkIds, people: listed };
}
