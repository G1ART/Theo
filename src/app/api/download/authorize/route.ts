import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  canDownloadArtwork,
  canDownloadExhibitionPack,
  exhibitionPackFieldKey,
  isUuid,
  type DownloadActor,
} from "@/lib/download/access";
import { isCameraOriginalPath, pickDisplayStoragePath } from "@/lib/download/displayPath";
import type {
  DownloadArtworkPayload,
  DownloadPosterPayload,
  ExhibitionPackPayload,
} from "@/lib/download/types";

export const runtime = "nodejs";

const MAX_WORKS = 60;

type ArtworkImageRow = {
  storage_path?: string | null;
  sort_order?: number | null;
};

type ArtworkRow = {
  id: string;
  title: string | null;
  title_ko: string | null;
  title_en: string | null;
  year: number | null;
  medium: string | null;
  medium_ko: string | null;
  medium_en: string | null;
  size: string | null;
  size_unit: string | null;
  visibility: string | null;
  artist_id: string | null;
  artwork_images: ArtworkImageRow[] | null;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
  display_name_ko: string | null;
  display_name_en: string | null;
  username: string | null;
  main_role: string | null;
};

function bearer(req: Request): string {
  const header = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

function userClient(token: string): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function uniqueIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_WORKS) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string" || !isUuid(item)) return null;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out.length > 0 ? out : null;
}

async function accountWriterSet(
  supabase: SupabaseClient,
  userId: string,
  actingAsProfileId: string | null,
): Promise<Set<string>> {
  if (!actingAsProfileId || actingAsProfileId === userId || !isUuid(actingAsProfileId)) {
    return new Set();
  }
  const { data, error } = await supabase.rpc("is_active_account_delegate_writer", {
    p_owner_profile_id: actingAsProfileId,
  });
  if (error || data !== true) return new Set();
  return new Set([actingAsProfileId]);
}

function asImages(value: unknown): ArtworkImageRow[] {
  if (!Array.isArray(value)) return [];
  return value as ArtworkImageRow[];
}

function toPayload(row: ArtworkRow, profile: ProfileRow | null): DownloadArtworkPayload | null {
  const displayPath = pickDisplayStoragePath(asImages(row.artwork_images));
  if (!displayPath || isCameraOriginalPath(displayPath)) return null;
  const sizeUnit = row.size_unit === "cm" || row.size_unit === "in" ? row.size_unit : null;
  return {
    id: row.id,
    title: row.title,
    titleKo: row.title_ko,
    titleEn: row.title_en,
    year: row.year,
    medium: row.medium,
    mediumKo: row.medium_ko,
    mediumEn: row.medium_en,
    size: row.size,
    sizeUnit,
    displayPath,
    artistName: profile?.display_name ?? null,
    artistNameKo: profile?.display_name_ko ?? null,
    artistNameEn: profile?.display_name_en ?? null,
    username: profile?.username ?? null,
    role: profile?.main_role ?? null,
  };
}

async function loadArtworkRows(
  supabase: SupabaseClient,
  ids: string[],
): Promise<ArtworkRow[]> {
  const { data, error } = await supabase
    .from("artworks")
    .select(
      "id, title, title_ko, title_en, year, medium, medium_ko, medium_en, size, size_unit, visibility, artist_id, artwork_images(storage_path, sort_order)",
    )
    .in("id", ids);
  if (error || !data) return [];
  return data as ArtworkRow[];
}

async function loadProfiles(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, ProfileRow>> {
  const map = new Map<string, ProfileRow>();
  if (ids.length === 0) return map;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, display_name_ko, display_name_en, username, main_role")
    .in("id", ids);
  if (error || !data) return map;
  for (const row of data as ProfileRow[]) map.set(row.id, row);
  return map;
}

async function exhibitionPostersByWork(
  supabase: SupabaseClient,
  workIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const { data: links, error } = await supabase
    .from("exhibition_works")
    .select("work_id, exhibition_id")
    .in("work_id", workIds);
  if (error || !links?.length) return map;
  const exhibitionIds = [
    ...new Set(
      (links as { exhibition_id: string }[])
        .map((row) => row.exhibition_id)
        .filter((id) => isUuid(id)),
    ),
  ];
  if (exhibitionIds.length === 0) return map;
  const { data: projects, error: projectError } = await supabase
    .from("projects")
    .select("id, host_profile_id, curator_id, project_type")
    .in("id", exhibitionIds)
    .eq("project_type", "exhibition");
  if (projectError || !projects) return map;
  const posters = new Map<string, string[]>();
  for (const project of projects as {
    id: string;
    host_profile_id: string | null;
    curator_id: string | null;
  }[]) {
    const ids = [project.host_profile_id, project.curator_id].filter(
      (id): id is string => !!id,
    );
    posters.set(project.id, ids);
  }
  for (const link of links as { work_id: string; exhibition_id: string }[]) {
    const ids = posters.get(link.exhibition_id);
    if (!ids) continue;
    const prev = map.get(link.work_id) ?? [];
    map.set(link.work_id, [...prev, ...ids]);
  }
  return map;
}

async function hasPackGrant(
  supabase: SupabaseClient,
  userId: string,
  exhibitionId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("access_grants")
    .select("id, expires_at")
    .eq("grantee_profile_id", userId)
    .eq("subject_type", "exhibition")
    .eq("field_key", exhibitionPackFieldKey(exhibitionId))
    .limit(8);
  if (error || !data) return false;
  const now = Date.now();
  return (data as { expires_at: string | null }[]).some((row) => {
    if (!row.expires_at) return true;
    return new Date(row.expires_at).getTime() > now;
  });
}

export async function POST(req: Request) {
  const token = bearer(req);
  if (!token) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const supabase = userClient(token);
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "misconfigured" }, { status: 500 });
  }
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: {
    kind?: unknown;
    intent?: unknown;
    artworkIds?: unknown;
    exhibitionId?: unknown;
    actingAsProfileId?: unknown;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  const actingAs =
    typeof body.actingAsProfileId === "string" && isUuid(body.actingAsProfileId)
      ? body.actingAsProfileId
      : null;
  const actor: DownloadActor = {
    userId: user.id,
    actingAsProfileId: actingAs,
    accountWriterFor: await accountWriterSet(supabase, user.id, actingAs),
  };

  if (body.kind === "artworks") {
    const ids = uniqueIds(body.artworkIds);
    if (!ids) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
    const [rows, posters] = await Promise.all([
      loadArtworkRows(supabase, ids),
      exhibitionPostersByWork(supabase, ids),
    ]);
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of ids) {
      const row = byId.get(id);
      const allowed = canDownloadArtwork(actor, {
        artistId: row?.artist_id ?? null,
        published: row?.visibility === "public",
        exhibitionPosterIds: posters.get(id) ?? [],
      });
      if (!row || !allowed) {
        return NextResponse.json({ ok: false, error: "denied" }, { status: 403 });
      }
    }
    const profiles = await loadProfiles(
      supabase,
      [...new Set(rows.map((row) => row.artist_id).filter((id): id is string => !!id))],
    );
    const artworks: DownloadArtworkPayload[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) return NextResponse.json({ ok: false, error: "denied" }, { status: 403 });
      const payload = toPayload(row, row.artist_id ? profiles.get(row.artist_id) ?? null : null);
      if (!payload) {
        return NextResponse.json({ ok: false, error: "no_image" }, { status: 422 });
      }
      artworks.push(payload);
    }
    return NextResponse.json({ ok: true, artworks });
  }

  if (body.kind === "exhibition") {
    const exhibitionId = typeof body.exhibitionId === "string" ? body.exhibitionId : "";
    if (!isUuid(exhibitionId)) {
      return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
    }
    const intent = body.intent === "check" ? "check" : "fetch";
    const { data: exhibition, error: exhibitionError } = await supabase
      .from("projects")
      .select(
        "id, title, preface_ko, preface_en, host_profile_id, curator_id, cover_image_paths, project_type",
      )
      .eq("id", exhibitionId)
      .eq("project_type", "exhibition")
      .maybeSingle();
    if (exhibitionError || !exhibition) {
      return NextResponse.json({ ok: false, error: "denied" }, { status: 403 });
    }
    const show = exhibition as {
      id: string;
      title: string | null;
      preface_ko: string | null;
      preface_en: string | null;
      host_profile_id: string | null;
      curator_id: string | null;
      cover_image_paths: string[] | null;
    };
    const { data: links, error: linkError } = await supabase
      .from("exhibition_works")
      .select("work_id, sort_order, created_at")
      .eq("exhibition_id", exhibitionId)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (linkError) {
      return NextResponse.json({ ok: false, error: "denied" }, { status: 403 });
    }
    const workIds = (links ?? [])
      .map((row) => (row as { work_id: string }).work_id)
      .filter((id) => isUuid(id));
    const artworkRows = workIds.length > 0 ? await loadArtworkRows(supabase, workIds.slice(0, MAX_WORKS)) : [];
    const published = artworkRows.filter((row) => row.visibility === "public");
    const participatingArtistIds = [
      ...new Set(published.map((row) => row.artist_id).filter((id): id is string => !!id)),
    ];
    const granted = await hasPackGrant(supabase, user.id, exhibitionId);
    const allowed = canDownloadExhibitionPack(actor, {
      hostProfileId: show.host_profile_id,
      curatorId: show.curator_id,
      participatingArtistIds,
      hasPackGrant: granted,
    });
    if (intent === "check") {
      return NextResponse.json({ ok: true, allowed, canRequest: !allowed });
    }
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "denied" }, { status: 403 });
    }

    const { data: media } = await supabase
      .from("exhibition_media")
      .select("storage_path, bucket_title, type, media_kind, sort_order")
      .eq("exhibition_id", exhibitionId)
      .order("sort_order", { ascending: true, nullsFirst: false });

    const posters: DownloadPosterPayload[] = [];
    const seen = new Set<string>();
    const pushPoster = (path: string | null | undefined, kind: "image" | "pdf") => {
      const trimmed = (path ?? "").trim();
      if (!trimmed || seen.has(trimmed) || isCameraOriginalPath(trimmed)) return;
      seen.add(trimmed);
      posters.push({ displayPath: trimmed, kind });
    };
    for (const row of (media ?? []) as {
      storage_path: string | null;
      bucket_title: string | null;
      type: string | null;
      media_kind: string | null;
    }[]) {
      const key = (row.bucket_title ?? "").trim().toLowerCase() || (row.type ?? "");
      if (key !== "poster") continue;
      const kind = row.media_kind === "pdf" ? "pdf" : "image";
      pushPoster(row.storage_path, kind);
    }
    for (const path of show.cover_image_paths ?? []) {
      pushPoster(path, path.toLowerCase().endsWith(".pdf") ? "pdf" : "image");
    }

    const profiles = await loadProfiles(supabase, participatingArtistIds);
    const byId = new Map(published.map((row) => [row.id, row]));
    const works: DownloadArtworkPayload[] = [];
    for (const id of workIds) {
      const row = byId.get(id);
      if (!row) continue;
      const payload = toPayload(row, row.artist_id ? profiles.get(row.artist_id) ?? null : null);
      if (payload) works.push(payload);
    }
    const pack: ExhibitionPackPayload = {
      id: show.id,
      title: show.title,
      prefaceKo: show.preface_ko,
      prefaceEn: show.preface_en,
      posters,
      works,
    };
    return NextResponse.json({ ok: true, allowed: true, pack });
  }

  return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
}
