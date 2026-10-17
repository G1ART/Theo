import { supabase } from "./client";
import { ARTWORK_CARDS_VIEW } from "@/lib/artworks/viewerFields";

/**
 * Query column names from information_schema. Requires DB function:
 * create or replace function get_table_columns(p_table_name text)
 * returns table(column_name text) as $$
 *   select column_name::text from information_schema.columns
 *   where table_schema='public' and table_name=p_table_name
 *   order by ordinal_position;
 * $$ language sql security definer;
 */
export async function getTableColumnsFromInformationSchema(
  tableName: string
): Promise<string[]> {
  const { data, error } = await supabase.rpc("get_table_columns", {
    p_table_name: tableName,
  });
  if (error) {
    console.error(`get_table_columns(${tableName}) failed:`, error);
    return [];
  }
  return Array.isArray(data)
    ? data.map((r: { column_name?: string }) => r.column_name ?? "")
    : [];
}

/** Fallback: infer columns from select * limit 1. Stored price columns are not readable by clients; the card view stands in. */
export async function debugArtworksColumns(): Promise<string[]> {
  const { data, error } = await supabase
    .from(ARTWORK_CARDS_VIEW)
    .select("*")
    .limit(1);

  if (error) {
    console.error("debugArtworksColumns error:", error);
    return [];
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row ? Object.keys(row) : [];
}

export async function debugArtworkImagesColumns(): Promise<string[]> {
  const { data, error } = await supabase
    .from("artwork_images")
    .select("*")
    .limit(1);

  if (error) {
    console.error("debugArtworkImagesColumns error:", error);
    return [];
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row ? Object.keys(row) : [];
}

export async function debugProfilesColumns(): Promise<string[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .limit(1);

  if (error) {
    console.error("debugProfilesColumns error:", error);
    return [];
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row ? Object.keys(row) : [];
}

export async function debugSchemaAll(): Promise<{
  artworks: string[];
  artwork_images: string[];
  profiles: string[];
}> {
  const [artworks, artwork_images, profiles] = await Promise.all([
    debugArtworksColumns(),
    debugArtworkImagesColumns(),
    debugProfilesColumns(),
  ]);
  return { artworks, artwork_images, profiles };
}
