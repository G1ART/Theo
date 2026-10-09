import type { SupabaseClient } from "@supabase/supabase-js";
import type { Locale } from "@/lib/i18n/locale";
import {
  pickLocalizedArtworkTitle,
  pickLocalizedDisplayName,
  pickLocalizedHostName,
  pickLocalizedMedium,
} from "@/lib/i18n/pickLocalized";
import { pickExhibitionThumbs, type ExhibitionThumb } from "./exhibitionThumbs";
import type {
  WalkCursor,
  WalkEngagement,
  WalkExhibition,
  WalkFollow,
  WalkLane,
  WalkPerson,
  WalkPools,
  WalkRole,
  WalkViewer,
  WalkWork,
} from "./types";

const PROFILE_COLS =
  "id, username, display_name, display_name_ko, display_name_en, avatar_url, main_role, roles, is_public, city, education, mediums";

const WORK_COLS =
  "id, title, title_ko, title_en, year, medium, medium_ko, medium_en, artist_id, created_at, likes_count, visibility, work_kind, artwork_images(storage_path, sort_order)";

const MAIN_FEED_KINDS = ["artwork", "print_edition"] as const;

const WORK_WITH_ARTIST =
  WORK_COLS +
  ", artist:profiles!artist_id(id, username, display_name, display_name_ko, display_name_en, avatar_url, main_role, roles, is_public, city, education, mediums)";

const EXH_COLS =
  "id, project_type, title, title_ko, title_en, start_date, end_date, status, curator_id, host_name, host_name_ko, host_name_en, host_profile_id, cover_image_paths, created_at";

const WORK_CAP = 36;
const EXH_CAP = 10;
const OPTIONAL_MS = 650;

export type WalkLoadTiming = { ms: number; waves: number[]; skipped: string[] };

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
  artist?: ProfileRow | ProfileRow[] | null;
};

type ExhRow = {
  id: string;
  title: string | null;
  title_ko: string | null;
  title_en: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
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
  opts: {
    userId: string | null;
    sort: "latest" | "popular";
    locale: Locale;
    cursor?: WalkCursor | null;
    lane?: WalkLane;
  }
): Promise<{ viewer: WalkViewer; pools: WalkPools; timing: WalkLoadTiming }> {
  const emptyViewer = blankViewer(opts.userId);
  try {
    return await load(supabase, opts);
  } catch {
    return {
      viewer: emptyViewer,
      pools: emptyPools(),
      timing: { ms: 0, waves: [], skipped: ["error"] },
    };
  }
}

async function load(
  supabase: SupabaseClient,
  opts: {
    userId: string | null;
    sort: "latest" | "popular";
    locale: Locale;
    cursor?: WalkCursor | null;
    lane?: WalkLane;
  }
): Promise<{ viewer: WalkViewer; pools: WalkPools; timing: WalkLoadTiming }> {
  const t0 = Date.now();
  const waves: number[] = [];
  const skipped: string[] = [];
  const mark = () => waves.push(Date.now() - t0);
  const { userId, sort, locale } = opts;
  const lane: WalkLane = opts.lane ?? (userId ? "personalized" : "public");
  const rich = Boolean(userId) && lane === "personalized";
  const followLane = Boolean(userId) && lane === "following";
  const usedWorks = tailUsed(opts.cursor?.used, "w");
  const usedEx = tailUsed(opts.cursor?.used, "e");
  const usedWorkSet = new Set(usedWorks);

  const viewerPack = userId && (rich || followLane)
    ? (async () => {
        const [profile, works, following, inquired, liked, saved] = await Promise.all([
          oneProfile(supabase, userId),
          rich ? viewerArtworkRows(supabase, userId) : Promise.resolve([] as WorkRow[]),
          followingOf(supabase, userId),
          rich ? inquiredArtworks(supabase, userId) : Promise.resolve([] as string[]),
          rich ? likedArtworks(supabase, userId) : Promise.resolve([] as string[]),
          rich ? savedArtworks(supabase, userId) : Promise.resolve([] as string[]),
        ]);
        const own = rich ? await ownExhibitions(supabase, userId, works.map((row) => row.id)) : [];
        return { profile, works, following, inquired, liked, saved, own };
      })()
    : Promise.resolve({
        profile: null as ProfileRow | null,
        works: [] as WorkRow[],
        following: [] as string[],
        inquired: [] as string[],
        liked: [] as string[],
        saved: [] as string[],
        own: [] as string[],
      });

  const catalog = followLane
    ? Promise.resolve({ latest: [] as ExhRow[], recent: [] as WorkRow[] })
    : Promise.all([
        latestExhibitions(supabase, usedEx),
        recentWorks(supabase, sort, usedWorks),
      ]).then(([latest, recent]) => ({ latest, recent }));

  const [pack, shelf] = await Promise.all([viewerPack, catalog]);
  mark();
  const viewerProfile = pack.profile;
  const viewerWorks = pack.works;
  const followingIds = pack.following;
  const savedArtworkIds = pack.saved;
  const inquiredArtworkIds = pack.inquired;
  const likedArtworkIds = pack.liked;
  const ownExhibitionIds = pack.own;
  const school = firstSchool(viewerProfile?.education);
  const optionalMs = opts.cursor ? OPTIONAL_MS : 380;

  const exhibitionIds = uniq([...ownExhibitionIds, ...shelf.latest.map((row) => row.id)]);
  const missing = ownExhibitionIds.filter((id) => !shelf.latest.some((row) => row.id === id));
  const seededIds = uniq([
    ...(userId ? [userId] : []),
    ...followingIds,
    ...viewerWorks.flatMap((row) => (row.artist_id ? [row.artist_id] : [])),
    ...shelf.recent.flatMap((row) => (row.artist_id ? [row.artist_id] : [])),
    ...shelf.latest.flatMap((row) => [row.host_profile_id, row.curator_id].filter((id): id is string => !!id)),
  ]);

  const shownExhibitionIds = exhibitionIds.slice(0, EXH_CAP + 4);
  const [extraExhibitions, links, thumbMap, claims, mediumRows, followedWorks, alumni, seededProfiles] = await Promise.all([
    missing.length ? exhibitionsByIds(supabase, missing) : Promise.resolve([] as ExhRow[]),
    exhibitionWorks(supabase, shownExhibitionIds),
    exhibitionThumbMap(supabase, shownExhibitionIds),
    exhibitionClaims(supabase, shownExhibitionIds),
    rich
      ? withTimeout("medium", mediumMatches(supabase, viewerWorks, locale), optionalMs, [] as WorkRow[], skipped)
      : Promise.resolve([] as WorkRow[]),
    (rich || followLane) && followingIds.length
      ? withTimeout(
          "followed-works",
          worksByArtists(supabase, followingIds, usedWorks),
          optionalMs,
          [] as WorkRow[],
          skipped
        )
      : Promise.resolve([] as WorkRow[]),
    rich && school
      ? withTimeout("alumni", alumniProfiles(supabase, school), optionalMs, [] as ProfileRow[], skipped)
      : Promise.resolve([] as ProfileRow[]),
    profilesByIds(supabase, seededIds),
  ]);
  mark();

  const exhibitionRows = dedupeExhibitions([...extraExhibitions, ...shelf.latest]).slice(0, EXH_CAP + 4);
  const linkWorkIds = links.flatMap((row) => (row.work_id ? [row.work_id] : []));
  const priorityIds = uniq([
    ...viewerWorks.map((row) => row.id),
    ...savedArtworkIds,
    ...inquiredArtworkIds,
    ...likedArtworkIds,
    ...mediumRows.map((row) => row.id),
    ...followedWorks.map((row) => row.id),
    ...linkWorkIds,
  ]).filter((id) => !usedWorkSet.has(id));
  const recentIds = new Set(shelf.recent.map((row) => row.id));
  const missingWorkIds = priorityIds.filter((id) => !recentIds.has(id)).slice(0, WORK_CAP);

  const hostIds = exhibitionRows.map((row) => row.host_profile_id).filter((id): id is string => !!id);
  const curatorIds = exhibitionRows.map((row) => row.curator_id).filter((id): id is string => !!id);
  const claimIds = claims.map((row) => row.subject_profile_id).filter((id): id is string => !!id);
  const earlyPeople = uniq([
    ...(userId ? [userId] : []),
    ...followingIds,
    ...shelf.recent.map((row) => row.artist_id).filter((id): id is string => !!id),
    ...claimIds,
    ...hostIds,
    ...curatorIds,
    ...alumni.map((row) => row.id),
  ]);

  const seededSet = new Set(seededProfiles.map((row) => row.id));
  const profileGap = earlyPeople.filter((id) => !seededSet.has(id));
  const [byId, gapProfiles, likeRows, follows] = await Promise.all([
    worksByIds(supabase, missingWorkIds),
    profilesByIds(supabase, profileGap),
    rich
      ? withTimeout(
          "likes",
          likesForWorks(supabase, uniq([...shelf.recent.map((row) => row.id), ...linkWorkIds]).slice(0, 36)),
          optionalMs,
          [] as { user_id: string; artwork_id: string }[],
          skipped
        )
      : Promise.resolve([] as { user_id: string; artwork_id: string }[]),
    rich
      ? withTimeout(
          "follows",
          followEdges(supabase, earlyPeople.slice(0, 40), userId),
          optionalMs,
          { ok: false, rows: [] as WalkFollow[] },
          skipped
        )
      : Promise.resolve({ ok: false, rows: [] as WalkFollow[] }),
  ]);
  mark();

  const workRows = mergeWorks(
    [...viewerWorks, ...mediumRows, ...followedWorks, ...byId, ...shelf.recent],
    sort
  ).slice(0, WORK_CAP);
  const earlyProfiles = dedupeProfiles([...seededProfiles, ...gapProfiles]);
  const embedded = embeddedArtists(workRows);
  const knownProfileIds = new Set([...earlyProfiles, ...embedded].map((row) => row.id));
  const likerIds = likeRows.map((row) => row.user_id).filter((id) => !knownProfileIds.has(id));
  const lateIds = uniq(likerIds).slice(0, 24);
  const lateProfiles = lateIds.length
    ? await withTimeout("late-profiles", profilesByIds(supabase, lateIds), 350, [] as ProfileRow[], skipped)
    : [];
  if (lateIds.length) mark();
  const profiles = dedupeProfiles([...alumni, ...earlyProfiles, ...embedded, ...lateProfiles]);
  const profileMap = new Map(profiles.map((row) => [row.id, row]));

  const allowed = new Set<string>();
  const following = new Set(followingIds);
  for (const row of profiles) {
    if (row.id === userId || following.has(row.id) || row.is_public !== false) allowed.add(row.id);
  }

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
      mutualNames: mutualKnown ? mutualByTarget.get(row.id)?.names ?? [] : null,
      mutualAvatars: mutualKnown ? mutualByTarget.get(row.id)?.avatars ?? [] : null,
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
      thumbs: thumbMap.get(row.id),
      city,
      status: row.status,
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
    timing: { ms: Date.now() - t0, waves, skipped },
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
): Map<string, { names: string[]; avatars: (string | null)[] }> {
  const byTarget = new Map<string, { names: string[]; avatars: (string | null)[] }>();
  for (const row of rows) {
    if (!following.has(row.followerId) || row.followerId === viewerId) continue;
    const profile = profiles.get(row.followerId);
    const name = profile ? pickLocalizedDisplayName(profile, locale).trim() : "";
    if (!name) continue;
    const bundle = byTarget.get(row.followingId) ?? { names: [], avatars: [] };
    if (!bundle.names.includes(name)) {
      bundle.names.push(name);
      bundle.avatars.push(profile?.avatar_url ?? null);
    }
    bundle.names = bundle.names.slice(0, 8);
    bundle.avatars = bundle.avatars.slice(0, 8);
    byTarget.set(row.followingId, bundle);
  }
  return byTarget;
}

function tailUsed(used: string[] | undefined, prefix: "w" | "e"): string[] {
  if (!used?.length) return [];
  const p = `${prefix}:`;
  const ids: string[] = [];
  for (let i = used.length - 1; i >= 0 && ids.length < 40; i--) {
    const key = used[i];
    if (!key?.startsWith(p)) continue;
    const id = key.slice(p.length);
    if (id) ids.push(id);
  }
  return ids;
}

function withTimeout<T>(label: string, promise: Promise<T>, ms: number, fallback: T, skipped: string[]): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      skipped.push(label);
      resolve(fallback);
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        skipped.push(label);
        resolve(fallback);
      }
    );
  });
}

function embeddedArtists(rows: WorkRow[]): ProfileRow[] {
  const out: ProfileRow[] = [];
  for (const row of rows) {
    const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist;
    if (artist?.id) out.push(artist);
  }
  return out;
}

function dedupeProfiles(rows: ProfileRow[]): ProfileRow[] {
  const map = new Map<string, ProfileRow>();
  for (const row of rows) {
    if (row?.id && !map.has(row.id)) map.set(row.id, row);
  }
  return [...map.values()];
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
    .in("work_kind", [...MAIN_FEED_KINDS])
    .order("created_at", { ascending: false })
    .limit(8);
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

async function latestExhibitions(supabase: SupabaseClient, exclude: string[]): Promise<ExhRow[]> {
  const run = (skip: boolean) => {
    let query = supabase
      .from("projects")
      .select(EXH_COLS)
      .eq("project_type", "exhibition")
      .in("status", ["live", "ended"])
      .order("created_at", { ascending: false })
      .limit(EXH_CAP);
    if (skip && exclude.length) query = query.not("id", "in", `(${exclude.join(",")})`);
    return query;
  };
  const first = await run(true);
  if (!first.error) return (first.data as ExhRow[] | null) ?? [];
  if (!exclude.length) return [];
  const retry = await run(false);
  return (retry.data as ExhRow[] | null) ?? [];
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
    .in("exhibition_id", exhibitionIds.slice(0, 14))
    .limit(160);
  return (data as { exhibition_id: string | null; work_id: string | null }[] | null) ?? [];
}

type ThumbImage = { storage_path?: string | null; sort_order?: number | null };
type ThumbArtwork = {
  id?: string | null;
  visibility?: string | null;
  work_kind?: string | null;
  artwork_images?: ThumbImage[] | null;
};
type ThumbLink = {
  artworks?: ThumbArtwork | ThumbArtwork[] | null;
};
type ThumbProject = {
  id?: string | null;
  exhibition_works?: ThumbLink[] | null;
};

/**
 * One query for every exhibition on this page: at most six public
 * artwork or print images each. Titles, artists, and enhancement
 * metadata stay off the row.
 */
async function exhibitionThumbMap(
  supabase: SupabaseClient,
  exhibitionIds: string[]
): Promise<Map<string, ExhibitionThumb[]>> {
  const map = new Map<string, ExhibitionThumb[]>();
  if (exhibitionIds.length === 0) return map;
  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, exhibition_works(sort_order, created_at, artworks!inner(id, visibility, work_kind, artwork_images(storage_path, sort_order)))"
    )
    .in("id", exhibitionIds.slice(0, 14))
    .eq("exhibition_works.artworks.visibility", "public")
    .in("exhibition_works.artworks.work_kind", [...MAIN_FEED_KINDS])
    .order("sort_order", { referencedTable: "exhibition_works", ascending: true, nullsFirst: false })
    .order("created_at", { referencedTable: "exhibition_works", ascending: true })
    .limit(6, { referencedTable: "exhibition_works" });
  if (error || !data) return map;
  for (const row of data as ThumbProject[]) {
    if (!row.id) continue;
    const links = Array.isArray(row.exhibition_works) ? row.exhibition_works : [];
    const sources = links.flatMap((link) => {
      const art = Array.isArray(link.artworks) ? link.artworks[0] : link.artworks;
      if (!art?.id) return [];
      return [
        {
          id: art.id,
          imagePath: primaryImage(art.artwork_images ?? null),
          visibility: art.visibility ?? null,
          workKind: art.work_kind ?? null,
        },
      ];
    });
    const picked = pickExhibitionThumbs(sources);
    if (picked.length > 0) map.set(row.id, picked);
  }
  return map;
}

async function exhibitionClaims(
  supabase: SupabaseClient,
  exhibitionIds: string[]
): Promise<{ subject_profile_id: string | null; project_id: string | null }[]> {
  if (exhibitionIds.length === 0) return [];
  const { data } = await supabase
    .from("claims")
    .select("subject_profile_id, project_id")
    .in("project_id", exhibitionIds.slice(0, 14))
    .eq("visibility", "public")
    .limit(120);
  return (data as { subject_profile_id: string | null; project_id: string | null }[] | null) ?? [];
}

async function mediumMatches(
  supabase: SupabaseClient,
  viewerWorks: WorkRow[],
  locale: Locale
): Promise<WorkRow[]> {
  const needles = uniq(
    viewerWorks.flatMap((row) => [row.medium ?? "", row.medium_ko ?? "", row.medium_en ?? "", pickLocalizedMedium(row, locale)])
  ).slice(0, 1);
  if (needles.length === 0) return [];
  const needle = needles[0]!;
  const batches = await Promise.all([
    supabase.from("artworks").select(WORK_COLS).eq("visibility", "public").in("work_kind", [...MAIN_FEED_KINDS]).eq("medium", needle).limit(12),
    supabase.from("artworks").select(WORK_COLS).eq("visibility", "public").in("work_kind", [...MAIN_FEED_KINDS]).eq("medium_ko", needle).limit(8),
    supabase.from("artworks").select(WORK_COLS).eq("visibility", "public").in("work_kind", [...MAIN_FEED_KINDS]).eq("medium_en", needle).limit(8),
  ]);
  return batches.flatMap((batch) => (batch.data as WorkRow[] | null) ?? []);
}

async function worksByArtists(
  supabase: SupabaseClient,
  artistIds: string[],
  exclude: string[] = []
): Promise<WorkRow[]> {
  const run = (skip: boolean) => {
    let query = supabase
      .from("artworks")
      .select(WORK_COLS)
      .in("artist_id", artistIds.slice(0, 24))
      .eq("visibility", "public")
      .in("work_kind", [...MAIN_FEED_KINDS])
      .order("created_at", { ascending: false })
      .limit(18);
    if (skip && exclude.length) query = query.not("id", "in", `(${exclude.join(",")})`);
    return query;
  };
  const first = await run(true);
  if (!first.error) return (first.data as WorkRow[] | null) ?? [];
  if (!exclude.length) return [];
  const retry = await run(false);
  return (retry.data as WorkRow[] | null) ?? [];
}

async function worksByIds(supabase: SupabaseClient, ids: string[]): Promise<WorkRow[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("artworks")
    .select(WORK_WITH_ARTIST)
    .in("id", ids.slice(0, WORK_CAP))
    .eq("visibility", "public")
    .in("work_kind", [...MAIN_FEED_KINDS]);
  return (data as WorkRow[] | null) ?? [];
}

async function recentWorks(
  supabase: SupabaseClient,
  sort: "latest" | "popular",
  exclude: string[] = []
): Promise<WorkRow[]> {
  const run = (skip: boolean) => {
    let query = supabase.from("artworks").select(WORK_COLS).eq("visibility", "public").in("work_kind", [...MAIN_FEED_KINDS]).limit(20);
    if (skip && exclude.length) query = query.not("id", "in", `(${exclude.join(",")})`);
    query =
      sort === "popular"
        ? query.order("likes_count", { ascending: false }).order("created_at", { ascending: false })
        : query.order("created_at", { ascending: false });
    return query;
  };
  const first = await run(true);
  if (!first.error) return (first.data as WorkRow[] | null) ?? [];
  if (!exclude.length) return [];
  const retry = await run(false);
  return (retry.data as WorkRow[] | null) ?? [];
}

async function likesForWorks(
  supabase: SupabaseClient,
  artworkIds: string[]
): Promise<{ user_id: string; artwork_id: string }[]> {
  if (artworkIds.length === 0) return [];
  const { data } = await supabase
    .from("artwork_likes")
    .select("user_id, artwork_id")
    .in("artwork_id", artworkIds.slice(0, 36))
    .limit(80);
  return ((data as { user_id: string | null; artwork_id: string | null }[] | null) ?? []).flatMap((row) =>
    row.user_id && row.artwork_id ? [{ user_id: row.user_id, artwork_id: row.artwork_id }] : []
  );
}

async function profilesByIds(supabase: SupabaseClient, ids: string[]): Promise<ProfileRow[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.from("profiles").select(PROFILE_COLS).in("id", ids.slice(0, 80));
  return (data as ProfileRow[] | null) ?? [];
}

async function alumniProfiles(supabase: SupabaseClient, school: string): Promise<ProfileRow[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLS)
    .contains("education", [{ school }])
    .limit(12);
  if (error) return [];
  return (data as ProfileRow[] | null) ?? [];
}

async function followEdges(
  supabase: SupabaseClient,
  peopleIds: string[],
  viewerId: string | null
): Promise<{ ok: boolean; rows: WalkFollow[] }> {
  if (peopleIds.length === 0 && !viewerId) return { ok: true, rows: [] };
  const ids = peopleIds.slice(0, 40);
  const [incoming, outgoing, mine] = await Promise.all([
    ids.length
      ? supabase.from("follows").select("follower_id, following_id").eq("status", "accepted").in("following_id", ids).limit(80)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase.from("follows").select("follower_id, following_id").eq("status", "accepted").in("follower_id", ids).limit(80)
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
