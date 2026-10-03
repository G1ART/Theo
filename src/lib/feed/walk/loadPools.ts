import type { SupabaseClient } from "@supabase/supabase-js";
import type { Locale } from "@/lib/i18n/locale";
import {
  pickLocalizedArtworkTitle,
  pickLocalizedDisplayName,
  pickLocalizedHostName,
  pickLocalizedMedium,
} from "@/lib/i18n/pickLocalized";
import type {
  WalkEngagement,
  WalkExhibition,
  WalkFollow,
  WalkPerson,
  WalkPools,
  WalkRole,
  WalkViewer,
  WalkWork,
} from "./types";

const PROFILE_COLS =
  "id, username, display_name, display_name_ko, display_name_en, avatar_url, main_role, roles, is_public, city, education, mediums";

const WORK_COLS =
  "id, title, title_ko, title_en, year, medium, medium_ko, medium_en, artist_id, created_at, likes_count, visibility, artwork_images(storage_path, sort_order)";

const EXH_COLS =
  "id, project_type, title, title_ko, title_en, start_date, end_date, curator_id, host_name, host_name_ko, host_name_en, host_profile_id, cover_image_paths, created_at";

const WORK_CAP = 120;
const EXH_CAP = 36;

type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  display_name_ko: string | null;
  display_name_en: string | null;
  avatar_url: string | null;
  main_role: string | null;
  roles: string[] | null;
  is_public: boolean | null;
  city: string | null;
  education: unknown;
  mediums: string[] | null;
};

type ImageRow = { storage_path?: string | null; sort_order?: number | null };

type WorkRow = {
  id: string;
  title: string | null;
  title_ko: string | null;
  title_en: string | null;
  year: number | null;
  medium: string | null;
  medium_ko: string | null;
  medium_en: string | null;
  artist_id: string | null;
  created_at: string | null;
  likes_count: number | null;
  visibility: string | null;
  artwork_images: ImageRow[] | null;
};

type ExhRow = {
  id: string;
  title: string | null;
  title_ko: string | null;
  title_en: string | null;
  start_date: string | null;
  end_date: string | null;
  curator_id: string | null;
  host_name: string | null;
  host_name_ko: string | null;
  host_name_en: string | null;
  host_profile_id: string | null;
  cover_image_paths: string[] | null;
  created_at: string | null;
};

export async function loadWalkPools(
  supabase: SupabaseClient,
  opts: { userId: string | null; sort: "latest" | "popular"; locale: Locale }
): Promise<{ viewer: WalkViewer; pools: WalkPools }> {
  const emptyViewer = blankViewer(opts.userId);
  try {
    return await load(supabase, opts);
  } catch {
    return { viewer: emptyViewer, pools: emptyPools() };
  }
}

async function load(
  supabase: SupabaseClient,
  opts: { userId: string | null; sort: "latest" | "popular"; locale: Locale }
): Promise<{ viewer: WalkViewer; pools: WalkPools }> {
  const { userId, sort, locale } = opts;
  const viewerProfile = userId ? await oneProfile(supabase, userId) : null;
  const viewerWorks = userId ? await viewerArtworkRows(supabase, userId) : [];
  const followingIds = userId ? await followingOf(supabase, userId) : [];
  const savedArtworkIds = userId ? await savedArtworks(supabase, userId) : [];
  const inquiredArtworkIds = userId ? await inquiredArtworks(supabase, userId) : [];
  const likedArtworkIds = userId ? await likedArtworks(supabase, userId) : [];
  const ownExhibitionIds = userId
    ? await ownExhibitions(supabase, userId, viewerWorks.map((row) => row.id))
    : [];

  const latest = await latestExhibitions(supabase);
  const exhibitionIds = uniq([...latest.map((row) => row.id), ...ownExhibitionIds]);
  const missing = ownExhibitionIds.filter((id) => !latest.some((row) => row.id === id));
  const extraExhibitions = missing.length ? await exhibitionsByIds(supabase, missing) : [];
  const exhibitionRows = dedupeExhibitions([...extraExhibitions, ...latest]).slice(0, EXH_CAP);
  const exhibitionIdList = exhibitionRows.map((row) => row.id);

  const [links, claims, mediumRows, followedWorks] = await Promise.all([
    exhibitionWorks(supabase, exhibitionIdList),
    exhibitionClaims(supabase, exhibitionIdList),
    mediumMatches(supabase, viewerWorks, locale),
    followingIds.length ? worksByArtists(supabase, followingIds) : Promise.resolve([] as WorkRow[]),
  ]);

  const linkWorkIds = links.flatMap((row) => (row.work_id ? [row.work_id] : []));
  const priorityIds = uniq([
    ...viewerWorks.map((row) => row.id),
    ...savedArtworkIds,
    ...inquiredArtworkIds,
    ...likedArtworkIds,
    ...mediumRows.map((row) => row.id),
    ...followedWorks.map((row) => row.id),
    ...linkWorkIds,
  ]);
  const byId = await worksByIds(supabase, priorityIds);
  const recent = await recentWorks(supabase, sort);
  const workRows = mergeWorks(
    [...viewerWorks, ...mediumRows, ...followedWorks, ...byId, ...recent],
    sort
  ).slice(0, WORK_CAP);

  const artistIds = workRows.map((row) => row.artist_id).filter((id): id is string => !!id);
  const claimIds = claims.map((row) => row.subject_profile_id).filter((id): id is string => !!id);
  const hostIds = exhibitionRows.map((row) => row.host_profile_id).filter((id): id is string => !!id);
  const curatorIds = exhibitionRows.map((row) => row.curator_id).filter((id): id is string => !!id);
  const school = firstSchool(viewerProfile?.education);
  const alumni = school ? await alumniProfiles(supabase, school) : [];
  const peopleIds = uniq([
    ...(userId ? [userId] : []),
    ...followingIds,
    ...artistIds,
    ...claimIds,
    ...hostIds,
    ...curatorIds,
    ...alumni.map((row) => row.id),
  ]);

  const likeRows = await likesForWorks(
    supabase,
    workRows.map((row) => row.id)
  );
  const likerIds = likeRows.map((row) => row.user_id);
  const profiles = await profilesByIds(supabase, uniq([...peopleIds, ...likerIds]));
  const profileMap = new Map(profiles.map((row) => [row.id, row]));

  const allowed = new Set<string>();
  const following = new Set(followingIds);
  for (const row of profiles) {
    if (row.id === userId || following.has(row.id) || row.is_public !== false) allowed.add(row.id);
  }

  const follows = await followEdges(supabase, [...allowed].slice(0, 80), userId);
  const mutualKnown = follows.ok;
  const mutualByTarget = mutualNames(follows.rows, following, profileMap, userId, locale);

  const people: WalkPerson[] = [];
  for (const row of profiles) {
    if (!allowed.has(row.id)) continue;
    const name = pickLocalizedDisplayName(row, locale).trim();
    if (!name) continue;
    const edu = educationBits(row.education);
    people.push({
      id: row.id,
      name,
      username: row.username,
      avatarUrl: row.avatar_url,
      oneLine: edu.oneLine,
      school: edu.school,
      city: text(row.city),
      role: walkRole(row.main_role, row.roles),
      mediums: Array.isArray(row.mediums) ? row.mediums.filter((item) => typeof item === "string" && item.trim()) : [],
      mutualNames: mutualKnown ? mutualByTarget.get(row.id) ?? [] : null,
      viewerFollows: following.has(row.id),
    });
  }
  const peopleById = new Map(people.map((row) => [row.id, row]));

  const worksInEx = new Map<string, string[]>();
  const participants = new Map<string, string[]>();
  function addParticipant(exhibitionId: string, personId: string | null) {
    if (!exhibitionId || !personId || !peopleById.has(personId)) return;
    const list = participants.get(exhibitionId) ?? [];
    if (!list.includes(personId)) list.push(personId);
    participants.set(exhibitionId, list);
  }
  function addWorkLink(exhibitionId: string, workId: string) {
    const list = worksInEx.get(exhibitionId) ?? [];
    if (!list.includes(workId)) list.push(workId);
    worksInEx.set(exhibitionId, list);
  }
  for (const link of links) {
    if (!link.exhibition_id || !link.work_id) continue;
    addWorkLink(link.exhibition_id, link.work_id);
  }
  for (const claim of claims) {
    if (!claim.project_id) continue;
    addParticipant(claim.project_id, claim.subject_profile_id);
  }

  const workExhibitionIds = new Map<string, string[]>();
  for (const [exhibitionId, ids] of worksInEx) {
    for (const workId of ids) {
      const list = workExhibitionIds.get(workId) ?? [];
      list.push(exhibitionId);
      workExhibitionIds.set(workId, list);
    }
  }

  const works: WalkWork[] = [];
  for (const row of workRows) {
    if (!row.artist_id || !peopleById.has(row.artist_id)) continue;
    if (row.visibility && row.visibility !== "public" && row.artist_id !== userId) continue;
    const title = pickLocalizedArtworkTitle(row, locale).trim();
    works.push({
      id: row.id,
      title: title || row.title?.trim() || "",
      year: row.year != null ? String(row.year) : null,
      medium: pickLocalizedMedium(row, locale).trim() || null,
      artistId: row.artist_id,
      imagePath: primaryImage(row.artwork_images),
      exhibitionIds: workExhibitionIds.get(row.id) ?? [],
    });
  }
  const workIds = new Set(works.map((row) => row.id));

  for (const work of works) {
    for (const exhibitionId of work.exhibitionIds) addParticipant(exhibitionId, work.artistId);
  }

  const exhibitions: WalkExhibition[] = [];
  for (const row of exhibitionRows) {
    const title = pickLocalizedArtworkTitle(row, locale).trim() || row.title?.trim() || "";
    if (!title || !row.curator_id) continue;
    addParticipant(row.id, row.curator_id);
    addParticipant(row.id, row.host_profile_id);
    const host = row.host_profile_id ? peopleById.get(row.host_profile_id) : undefined;
    const curator = peopleById.get(row.curator_id);
    const city = host?.city || curator?.city || null;
    exhibitions.push({
      id: row.id,
      title,
      startDate: row.start_date,
      endDate: row.end_date,
      curatorId: row.curator_id,
      hostProfileId: row.host_profile_id,
      hostName: pickLocalizedHostName(row, locale).trim() || null,
      coverPath: row.cover_image_paths?.[0] ?? null,
      participantIds: participants.get(row.id) ?? [],
      workIds: (worksInEx.get(row.id) ?? []).filter((id) => workIds.has(id)),
      city,
    });
  }

  const keptExhibitionIds = new Set(exhibitions.map((row) => row.id));
  for (const work of works) {
    work.exhibitionIds = work.exhibitionIds.filter((id) => keptExhibitionIds.has(id));
  }

  const engagements: WalkEngagement[] = [];
  for (const like of likeRows) {
    if (!workIds.has(like.artwork_id) || !peopleById.has(like.user_id)) continue;
    engagements.push({ userId: like.user_id, artworkId: like.artwork_id, kind: "like" });
  }

  const edu = educationBits(viewerProfile?.education);
  const medium = dominantMedium(viewerWorks, locale);
  const viewer: WalkViewer = {
    id: userId,
    school: edu.school,
    city: text(viewerProfile?.city),
    medium,
    role: viewerProfile ? walkRole(viewerProfile.main_role, viewerProfile.roles) : null,
    exhibitionIds: ownExhibitionIds.filter((id) => keptExhibitionIds.has(id)),
    artworkIds: viewerWorks.map((row) => row.id).filter((id) => workIds.has(id)),
    followingIds: followingIds.filter((id) => peopleById.has(id)),
    savedArtworkIds: savedArtworkIds.filter((id) => workIds.has(id)),
    inquiredArtworkIds: inquiredArtworkIds.filter((id) => workIds.has(id)),
    likedArtworkIds: likedArtworkIds.filter((id) => workIds.has(id)),
  };

  const followRows: WalkFollow[] = follows.rows.filter(
    (row) => peopleById.has(row.followerId) && peopleById.has(row.followingId)
  );

  return {
    viewer,
    pools: { people, works, exhibitions, engagements, follows: followRows },
  };
}

function blankViewer(id: string | null): WalkViewer {
  return {
    id,
    school: null,
    city: null,
    medium: null,
    role: null,
    exhibitionIds: [],
    artworkIds: [],
    followingIds: [],
    savedArtworkIds: [],
    inquiredArtworkIds: [],
    likedArtworkIds: [],
  };
}

function emptyPools(): WalkPools {
  return { people: [], works: [], exhibitions: [], engagements: [], follows: [] };
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function uniq(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
}

function walkRole(main: string | null, roles: string[] | null): WalkRole {
  const mainKey = (main ?? "").trim().toLowerCase();
  if (mainKey === "gallerist") return "gallery";
  if (mainKey === "curator" || mainKey === "artist" || mainKey === "collector") return mainKey;
  const list = (roles ?? []).map((role) => role.toLowerCase());
  if (list.includes("curator")) return "curator";
  if (list.includes("gallerist")) return "gallery";
  if (list.includes("artist")) return "artist";
  if (list.includes("collector")) return "collector";
  return "other";
}

function educationBits(education: unknown): { school: string | null; oneLine: string | null } {
  if (!Array.isArray(education)) return { school: null, oneLine: null };
  for (const row of education) {
    if (!row || typeof row !== "object") continue;
    const record = row as { school?: unknown; program?: unknown };
    const school = typeof record.school === "string" ? text(record.school) : null;
    const program = typeof record.program === "string" ? text(record.program) : null;
    if (!school && !program) continue;
    const oneLine = program && school ? `${program}, ${school}` : program ?? school;
    return { school, oneLine };
  }
  return { school: null, oneLine: null };
}

function firstSchool(education: unknown): string | null {
  return educationBits(education).school;
}

function primaryImage(images: ImageRow[] | null): string | null {
  if (!Array.isArray(images)) return null;
  const rows = images.filter((row) => typeof row?.storage_path === "string" && row.storage_path);
  rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return rows[0]?.storage_path ?? null;
}

function dominantMedium(rows: WorkRow[], locale: Locale): string | null {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const medium = pickLocalizedMedium(row, locale).trim();
    if (!medium) continue;
    counts.set(medium, (counts.get(medium) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [medium, count] of counts) {
    if (count > bestCount) {
      best = medium;
      bestCount = count;
    }
  }
  return best;
}

function mergeWorks(rows: WorkRow[], sort: "latest" | "popular"): WorkRow[] {
  const map = new Map<string, WorkRow>();
  for (const row of rows) {
    if (!row?.id || map.has(row.id)) continue;
    if (row.visibility && row.visibility !== "public") continue;
    map.set(row.id, row);
  }
  const list = [...map.values()];
  if (sort === "popular") {
    list.sort((a, b) => (b.likes_count ?? 0) - (a.likes_count ?? 0) || (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  } else {
    list.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "") || b.id.localeCompare(a.id));
  }
  return list;
}

function dedupeExhibitions(rows: ExhRow[]): ExhRow[] {
  const map = new Map<string, ExhRow>();
  for (const row of rows) {
    if (row?.id && !map.has(row.id)) map.set(row.id, row);
  }
  return [...map.values()];
}

function mutualNames(
  rows: WalkFollow[],
  following: Set<string>,
  profiles: Map<string, ProfileRow>,
  viewerId: string | null,
  locale: Locale
): Map<string, string[]> {
  const byTarget = new Map<string, string[]>();
  for (const row of rows) {
    if (!following.has(row.followerId) || row.followerId === viewerId) continue;
    const profile = profiles.get(row.followerId);
    const name = profile ? pickLocalizedDisplayName(profile, locale).trim() : "";
    if (!name) continue;
    const list = byTarget.get(row.followingId) ?? [];
    if (!list.includes(name)) list.push(name);
    byTarget.set(row.followingId, list.slice(0, 8));
  }
  return byTarget;
}

async function oneProfile(supabase: SupabaseClient, id: string): Promise<ProfileRow | null> {
  const { data } = await supabase.from("profiles").select(PROFILE_COLS).eq("id", id).maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

async function viewerArtworkRows(supabase: SupabaseClient, userId: string): Promise<WorkRow[]> {
  const { data } = await supabase
    .from("artworks")
    .select(WORK_COLS)
    .eq("artist_id", userId)
    .eq("visibility", "public")
    .order("created_at", { ascending: false })
    .limit(16);
  return (data as WorkRow[] | null) ?? [];
}

async function followingOf(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", userId)
    .eq("status", "accepted")
    .limit(80);
  return uniq(((data as { following_id: string | null }[] | null) ?? []).map((row) => row.following_id ?? ""));
}

async function savedArtworks(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const { data: lists } = await supabase.from("shortlists").select("id").eq("owner_id", userId).limit(12);
  const ids = ((lists as { id: string }[] | null) ?? []).map((row) => row.id);
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("shortlist_items")
    .select("artwork_id")
    .in("shortlist_id", ids)
    .not("artwork_id", "is", null)
    .limit(40);
  return uniq(((data as { artwork_id: string | null }[] | null) ?? []).map((row) => row.artwork_id ?? ""));
}

async function inquiredArtworks(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("price_inquiries")
    .select("artwork_id")
    .eq("inquirer_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);
  return uniq(((data as { artwork_id: string | null }[] | null) ?? []).map((row) => row.artwork_id ?? ""));
}

async function likedArtworks(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("artwork_likes")
    .select("artwork_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(40);
  return uniq(((data as { artwork_id: string | null }[] | null) ?? []).map((row) => row.artwork_id ?? ""));
}

async function ownExhibitions(
  supabase: SupabaseClient,
  userId: string,
  artworkIds: string[]
): Promise<string[]> {
  const [hosted, claims, links] = await Promise.all([
    supabase
      .from("projects")
      .select("id")
      .eq("project_type", "exhibition")
      .or(`curator_id.eq.${userId},host_profile_id.eq.${userId}`)
      .limit(12),
    supabase
      .from("claims")
      .select("project_id")
      .eq("subject_profile_id", userId)
      .not("project_id", "is", null)
      .limit(20),
    artworkIds.length
      ? supabase.from("exhibition_works").select("exhibition_id").in("work_id", artworkIds.slice(0, 40)).limit(40)
      : Promise.resolve({ data: [] as { exhibition_id: string | null }[] }),
  ]);
  return uniq([
    ...(((hosted.data as { id: string }[] | null) ?? []).map((row) => row.id)),
    ...(((claims.data as { project_id: string | null }[] | null) ?? []).map((row) => row.project_id ?? "")),
    ...(((links.data as { exhibition_id: string | null }[] | null) ?? []).map((row) => row.exhibition_id ?? "")),
  ]);
}

async function latestExhibitions(supabase: SupabaseClient): Promise<ExhRow[]> {
  const { data } = await supabase
    .from("projects")
    .select(EXH_COLS)
    .eq("project_type", "exhibition")
    .order("created_at", { ascending: false })
    .limit(EXH_CAP);
  return (data as ExhRow[] | null) ?? [];
}

async function exhibitionsByIds(supabase: SupabaseClient, ids: string[]): Promise<ExhRow[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.from("projects").select(EXH_COLS).in("id", ids.slice(0, 20));
  return (data as ExhRow[] | null) ?? [];
}

async function exhibitionWorks(
  supabase: SupabaseClient,
  exhibitionIds: string[]
): Promise<{ exhibition_id: string | null; work_id: string | null }[]> {
  if (exhibitionIds.length === 0) return [];
  const { data } = await supabase
    .from("exhibition_works")
    .select("exhibition_id, work_id")
    .in("exhibition_id", exhibitionIds.slice(0, EXH_CAP))
    .limit(500);
  return (data as { exhibition_id: string | null; work_id: string | null }[] | null) ?? [];
}

async function exhibitionClaims(
  supabase: SupabaseClient,
  exhibitionIds: string[]
): Promise<{ subject_profile_id: string | null; project_id: string | null }[]> {
  if (exhibitionIds.length === 0) return [];
  const { data } = await supabase
    .from("claims")
    .select("subject_profile_id, project_id")
    .in("project_id", exhibitionIds.slice(0, EXH_CAP))
    .eq("visibility", "public")
    .limit(400);
  return (data as { subject_profile_id: string | null; project_id: string | null }[] | null) ?? [];
}

async function mediumMatches(
  supabase: SupabaseClient,
  viewerWorks: WorkRow[],
  locale: Locale
): Promise<WorkRow[]> {
  const needles = uniq(
    viewerWorks.flatMap((row) => [row.medium ?? "", row.medium_ko ?? "", row.medium_en ?? "", pickLocalizedMedium(row, locale)])
  ).slice(0, 2);
  if (needles.length === 0) return [];
  const batches = await Promise.all(
    needles.flatMap((needle) => [
      supabase.from("artworks").select(WORK_COLS).eq("visibility", "public").eq("medium", needle).limit(12),
      supabase.from("artworks").select(WORK_COLS).eq("visibility", "public").eq("medium_ko", needle).limit(12),
      supabase.from("artworks").select(WORK_COLS).eq("visibility", "public").eq("medium_en", needle).limit(12),
    ])
  );
  return batches.flatMap((batch) => (batch.data as WorkRow[] | null) ?? []);
}

async function worksByArtists(supabase: SupabaseClient, artistIds: string[]): Promise<WorkRow[]> {
  const { data } = await supabase
    .from("artworks")
    .select(WORK_COLS)
    .in("artist_id", artistIds.slice(0, 40))
    .eq("visibility", "public")
    .order("created_at", { ascending: false })
    .limit(36);
  return (data as WorkRow[] | null) ?? [];
}

async function worksByIds(supabase: SupabaseClient, ids: string[]): Promise<WorkRow[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("artworks")
    .select(WORK_COLS)
    .in("id", ids.slice(0, WORK_CAP))
    .eq("visibility", "public");
  return (data as WorkRow[] | null) ?? [];
}

async function recentWorks(supabase: SupabaseClient, sort: "latest" | "popular"): Promise<WorkRow[]> {
  let query = supabase.from("artworks").select(WORK_COLS).eq("visibility", "public").limit(36);
  query =
    sort === "popular"
      ? query.order("likes_count", { ascending: false }).order("created_at", { ascending: false })
      : query.order("created_at", { ascending: false });
  const { data } = await query;
  return (data as WorkRow[] | null) ?? [];
}

async function likesForWorks(
  supabase: SupabaseClient,
  artworkIds: string[]
): Promise<{ user_id: string; artwork_id: string }[]> {
  if (artworkIds.length === 0) return [];
  const { data } = await supabase
    .from("artwork_likes")
    .select("user_id, artwork_id")
    .in("artwork_id", artworkIds.slice(0, 80))
    .limit(250);
  return ((data as { user_id: string | null; artwork_id: string | null }[] | null) ?? []).flatMap((row) =>
    row.user_id && row.artwork_id ? [{ user_id: row.user_id, artwork_id: row.artwork_id }] : []
  );
}

async function profilesByIds(supabase: SupabaseClient, ids: string[]): Promise<ProfileRow[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.from("profiles").select(PROFILE_COLS).in("id", ids.slice(0, 150));
  return (data as ProfileRow[] | null) ?? [];
}

async function alumniProfiles(supabase: SupabaseClient, school: string): Promise<ProfileRow[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLS)
    .contains("education", [{ school }])
    .limit(24);
  if (error) return [];
  return (data as ProfileRow[] | null) ?? [];
}

async function followEdges(
  supabase: SupabaseClient,
  peopleIds: string[],
  viewerId: string | null
): Promise<{ ok: boolean; rows: WalkFollow[] }> {
  if (peopleIds.length === 0 && !viewerId) return { ok: true, rows: [] };
  const ids = peopleIds.slice(0, 80);
  const [incoming, outgoing, mine] = await Promise.all([
    ids.length
      ? supabase.from("follows").select("follower_id, following_id").eq("status", "accepted").in("following_id", ids).limit(200)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase.from("follows").select("follower_id, following_id").eq("status", "accepted").in("follower_id", ids).limit(200)
      : Promise.resolve({ data: [], error: null }),
    viewerId
      ? supabase.from("follows").select("follower_id, following_id").eq("status", "accepted").eq("follower_id", viewerId).limit(80)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (incoming.error || outgoing.error || mine.error) return { ok: false, rows: [] };
  const rows: WalkFollow[] = [];
  const seen = new Set<string>();
  for (const batch of [incoming.data, outgoing.data, mine.data]) {
    for (const row of (batch as { follower_id: string | null; following_id: string | null }[] | null) ?? []) {
      if (!row.follower_id || !row.following_id) continue;
      const key = `${row.follower_id}:${row.following_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ followerId: row.follower_id, followingId: row.following_id });
    }
  }
  return { ok: true, rows };
}
