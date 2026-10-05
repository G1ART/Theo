import { supabase } from "@/lib/supabase/client";

export const ARTIST_PUBLISH_NOTICE_KEY = "artistPublishNotice";

export type ArtistPublishNotice = {
  artistId: string;
  artistName: string;
  artistUsername: string | null;
};

export function artistProfilePath(username: string | null | undefined): string | null {
  const handle = username?.trim();
  if (!handle) return null;
  return `/u/${handle}?tab=CREATED`;
}

export function writeArtistPublishNotice(notice: ArtistPublishNotice): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(ARTIST_PUBLISH_NOTICE_KEY, JSON.stringify(notice));
  } catch {
    // sessionStorage disabled — the publish still landed.
  }
}

export function peekArtistPublishNotice(): ArtistPublishNotice | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ARTIST_PUBLISH_NOTICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ArtistPublishNotice>;
    if (!parsed.artistId || !parsed.artistName) return null;
    return {
      artistId: parsed.artistId,
      artistName: parsed.artistName,
      artistUsername: parsed.artistUsername?.trim() || null,
    };
  } catch {
    return null;
  }
}

export function dismissArtistPublishNotice(artistId?: string): void {
  if (typeof window === "undefined") return;
  const notice = peekArtistPublishNotice();
  if (!notice) return;
  if (artistId && notice.artistId !== artistId) return;
  try {
    window.sessionStorage.removeItem(ARTIST_PUBLISH_NOTICE_KEY);
  } catch {
    // ignore
  }
}

export async function resolveArtistPublishNotice(input: {
  artistId: string;
  artistName?: string | null;
  artistUsername?: string | null;
}): Promise<ArtistPublishNotice | null> {
  let artistName = input.artistName?.trim() || "";
  let artistUsername = input.artistUsername?.trim() || "";
  if (!artistName || !artistUsername) {
    const { data } = await supabase
      .from("profiles")
      .select("username, display_name, display_name_ko, display_name_en")
      .eq("id", input.artistId)
      .maybeSingle();
    const row = data as {
      username?: string | null;
      display_name?: string | null;
      display_name_ko?: string | null;
      display_name_en?: string | null;
    } | null;
    if (!artistUsername) artistUsername = row?.username?.trim() || "";
    if (!artistName) {
      artistName =
        row?.display_name_ko?.trim() ||
        row?.display_name?.trim() ||
        row?.display_name_en?.trim() ||
        artistUsername;
    }
  }
  if (!artistName) return null;
  return {
    artistId: input.artistId,
    artistName,
    artistUsername: artistUsername || null,
  };
}
