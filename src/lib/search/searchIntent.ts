export type SearchIntent = "person" | "work" | "person-work";

export type NameFields = {
  id: string;
  username?: string | null;
  display_name?: string | null;
  display_name_ko?: string | null;
  display_name_en?: string | null;
};

function norm(value: string): string {
  return value.trim().replace(/^@+/g, "").toLowerCase().replace(/\s+/g, "");
}

/** A token is this person's account name, handle, or full name. */
export function exactNameToken(token: string, person: NameFields): boolean {
  const query = norm(token);
  if (query.length < 2) return false;
  return [person.username, person.display_name, person.display_name_ko, person.display_name_en].some(
    (field) => !!field && norm(field) === query,
  );
}

/**
 * Person name, work words, or a name plus work words.
 * Exact name fields only — a title that merely overlaps a name stays a work query.
 */
export function classifySearchIntent(
  query: string,
  people: readonly NameFields[],
): { intent: SearchIntent; personId: string | null } {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { intent: "work", personId: null };
  const joined = tokens.join(" ");
  const whole = people.find(
    (person) => exactNameToken(joined, person) || exactNameToken(tokens.join(""), person),
  );
  if (whole && tokens.length === 1) return { intent: "person", personId: whole.id };
  if (whole && tokens.every((token) => exactNameToken(token, whole) || exactNameToken(joined, whole))) {
    return { intent: "person", personId: whole.id };
  }
  if (tokens.length === 1) {
    const hit = people.find((person) => exactNameToken(tokens[0], person));
    return hit ? { intent: "person", personId: hit.id } : { intent: "work", personId: null };
  }
  for (const person of people) {
    const named = tokens.filter((token) => exactNameToken(token, person));
    if (named.length > 0 && named.length < tokens.length) {
      return { intent: "person-work", personId: person.id };
    }
  }
  return { intent: "work", personId: null };
}

/** The named person's works lead. Everyone else's matches keep their order after. */
export function orderArtworkIds(
  rows: readonly { id: string; artistId: string | null }[],
  personId: string | null,
): string[] {
  if (!personId) return rows.map((row) => row.id);
  const first: string[] = [];
  const rest: string[] = [];
  for (const row of rows) {
    if (row.artistId === personId) first.push(row.id);
    else rest.push(row.id);
  }
  return [...first, ...rest];
}
