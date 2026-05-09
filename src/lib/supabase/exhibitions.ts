/**
 * Exhibition (project) and exhibition_works API.
 * Design: docs/EXHIBITION_PROJECT_AND_MULTI_CLAIM_DESIGN.md
 */

import { supabase } from "./client";
import type { ExhibitionWithCredits } from "@/lib/exhibitionCredits";
import { listMyDelegations } from "./delegations";
import { recordUsageEvent } from "@/lib/metering";
import { USAGE_KEYS } from "@/lib/metering/usageKeys";
import { recordActingContextEvent } from "@/lib/delegation/actingContext";

export type { ExhibitionWithCredits } from "@/lib/exhibitionCredits";

export type ExhibitionRow = {
  id: string;
  project_type: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  curator_id: string;
  host_name: string | null;
  host_profile_id: string | null;
  cover_image_paths: string[] | null;
  created_at: string | null;
};

/** Select + curator/host profile joins for credits label. */
const SELECT_WITH_CREDITS =
  "id, project_type, title, start_date, end_date, status, curator_id, host_name, host_profile_id, cover_image_paths, created_at, curator:profiles!curator_id(display_name, username), host:profiles!host_profile_id(display_name, username)";

export type ExhibitionWorkRow = {
  id: string;
  exhibition_id: string;
  work_id: string;
  added_by_profile_id: string | null;
  sort_order: number | null;
  created_at: string;
};

export type ExhibitionMediaRow = {
  id: string;
  exhibition_id: string;
  type: "installation" | "side_event" | "custom";
  bucket_title: string | null;
  storage_path: string;
  sort_order: number | null;
  created_at: string;
};

export type ExhibitionMediaBucketRow = {
  id: string;
  exhibition_id: string;
  key: string;
  title: string;
  type: "installation" | "side_event" | "custom";
  sort_order: number | null;
  created_at: string;
};

/** Fetch exhibitions by ids (with credits). Returns empty for invalid/empty ids. */
export async function listExhibitionsByIds(ids: string[]): Promise<{
  data: ExhibitionWithCredits[];
  error: unknown;
}> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return { data: [], error: null };
  const { data, error } = await supabase
    .from("projects")
    .select(SELECT_WITH_CREDITS)
    .in("id", unique)
    .eq("project_type", "exhibition")
    .order("created_at", { ascending: false });
  if (error) return { data: [], error };
  return { data: (data ?? []) as ExhibitionWithCredits[], error: null };
}

/** List exhibitions I can manage: curate, host, or active delegate. (Persistent until delegator revokes.) */
export async function listMyExhibitions(
  options?: { forProfileId?: string | null }
): Promise<{
  data: ExhibitionWithCredits[];
  error: unknown;
}> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: [], error: null };

  // Acting-as: when an account-scope delegate operates on behalf of a
  // principal, the curator/host filter must reflect the principal's id
  // so the listing surfaces the principal's own exhibitions. The
  // project-scope delegation merge below stays anchored on the operator
  // (delegations are granted to the operator, not the principal).
  const ownerId = options?.forProfileId ?? session.user.id;
  const [curatedRes, delegationsRes] = await Promise.all([
    supabase
      .from("projects")
      .select(SELECT_WITH_CREDITS)
      .eq("project_type", "exhibition")
      .or(`curator_id.eq.${ownerId},host_profile_id.eq.${ownerId}`)
      .order("created_at", { ascending: false }),
    listMyDelegations(),
  ]);

  if (curatedRes.error) return { data: [], error: curatedRes.error };
  const curated = (curatedRes.data ?? []) as ExhibitionWithCredits[];
  const byId = new Map(curated.map((e) => [e.id, e]));

  const received = delegationsRes.data?.received ?? [];
  const delegatedProjectIds = received
    .filter(
      (d) =>
        d.scope_type === "project" &&
        d.status === "active" &&
        d.project_id != null &&
        !byId.has(d.project_id)
    )
    .map((d) => d.project_id as string);
  if (delegatedProjectIds.length > 0) {
    const { data: delegatedList } = await listExhibitionsByIds(delegatedProjectIds);
    for (const e of delegatedList ?? []) {
      if (!byId.has(e.id)) byId.set(e.id, e);
    }
  }

  const merged = Array.from(byId.values()).sort(
    (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
  );
  return { data: merged, error: null };
}

/** Create an exhibition (project). Curator/host can be set explicitly; otherwise caller is curator (or forProfileId when acting as). */
export async function createExhibition(args: {
  title: string;
  start_date?: string | null;
  end_date?: string | null;
  status?: string;
  curator_id?: string | null;
  host_name?: string | null;
  host_profile_id?: string | null;
  forProfileId?: string;
}): Promise<{ data: { id: string } | null; error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: null, error: new Error("Not authenticated") };

  const curatorId = args.curator_id ?? args.forProfileId ?? session.user.id;
  const { data, error } = await supabase
    .from("projects")
    .insert({
      project_type: "exhibition",
      title: args.title.trim(),
      start_date: args.start_date ?? null,
      end_date: args.end_date ?? null,
      status: args.status ?? "planned",
      curator_id: curatorId,
      host_name: args.host_name?.trim() || null,
      host_profile_id: args.host_profile_id ?? null,
      cover_image_paths: [],
    })
    .select("id")
    .single();

  if (error) return { data: null, error };
  const newExhibitionId = (data as { id: string } | null)?.id ?? null;
  await recordUsageEvent({
    userId: session.user.id,
    key: USAGE_KEYS.EXHIBITION_CREATED,
    metadata: {
      exhibition_id: newExhibitionId,
      curator_id: curatorId,
      acting_as: Boolean(args.forProfileId && args.forProfileId !== session.user.id),
    },
  });
  if (args.forProfileId && args.forProfileId !== session.user.id && newExhibitionId) {
    await recordActingContextEvent({
      subjectProfileId: args.forProfileId,
      action: "exhibition.create",
      resourceType: "exhibition",
      resourceId: newExhibitionId,
      payload: { title: args.title },
    });
  }
  return { data: data as { id: string }, error: null };
}

/** Update exhibition (title, dates, status, curator, host). */
export async function updateExhibition(
  id: string,
  patch: Partial<Pick<ExhibitionRow, "title" | "start_date" | "end_date" | "status" | "curator_id" | "host_name" | "host_profile_id" | "cover_image_paths">>,
  options?: {
    /** Principal profile id when operator is acting-as. Audit-only. */
    actingSubjectProfileId?: string | null;
  }
): Promise<{ error: unknown }> {
  const payload: Record<string, unknown> = {};
  if (patch.title !== undefined) payload.title = patch.title.trim();
  if (patch.start_date !== undefined) payload.start_date = patch.start_date;
  if (patch.end_date !== undefined) payload.end_date = patch.end_date;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.curator_id !== undefined) payload.curator_id = patch.curator_id;
  if (patch.host_name !== undefined) payload.host_name = patch.host_name?.trim() || null;
  if (patch.host_profile_id !== undefined) payload.host_profile_id = patch.host_profile_id;
  if (patch.cover_image_paths !== undefined) payload.cover_image_paths = patch.cover_image_paths ?? [];

  const { error } = await supabase.from("projects").update(payload).eq("id", id);

  if (!error && options?.actingSubjectProfileId) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (
      session?.user?.id &&
      options.actingSubjectProfileId !== session.user.id
    ) {
      await recordActingContextEvent({
        subjectProfileId: options.actingSubjectProfileId,
        action: "exhibition.update",
        resourceType: "exhibition",
        resourceId: id,
        payload: { changedKeys: Object.keys(payload) },
      });
    }
  }

  return { error };
}

/** List works in an exhibition (exhibition_works + artwork ids; full artwork details can be fetched separately). */
export async function listWorksInExhibition(exhibitionId: string): Promise<{
  data: ExhibitionWorkRow[];
  error: unknown;
}> {
  const { data, error } = await supabase
    .from("exhibition_works")
    .select("id, exhibition_id, work_id, added_by_profile_id, sort_order, created_at")
    .eq("exhibition_id", exhibitionId)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) return { data: [], error };
  return { data: (data ?? []) as ExhibitionWorkRow[], error: null };
}

/** Add a work to an exhibition (D6: claim is separate; optionally create pending claim via provenance RPC). */
export async function addWorkToExhibition(
  exhibitionId: string,
  workId: string,
  options?: {
    /** Principal profile id when operator is acting-as. Audit-only. */
    actingSubjectProfileId?: string | null;
  }
): Promise<{ data: { id: string } | null; error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: null, error: new Error("Not authenticated") };

  const { data, error } = await supabase
    .from("exhibition_works")
    .insert({
      exhibition_id: exhibitionId,
      work_id: workId,
      added_by_profile_id: session.user.id,
    })
    .select("id")
    .single();

  if (error) return { data: null, error };

  if (
    options?.actingSubjectProfileId &&
    options.actingSubjectProfileId !== session.user.id
  ) {
    await recordActingContextEvent({
      subjectProfileId: options.actingSubjectProfileId,
      action: "exhibition_work.add",
      resourceType: "exhibition",
      resourceId: exhibitionId,
      payload: { work_id: workId },
    });
  }

  return { data: data as { id: string }, error: null };
}

/** Remove a work from an exhibition (exhibition_works only; D6: do not touch claims). */
export async function removeWorkFromExhibition(
  exhibitionId: string,
  workId: string
): Promise<{ error: unknown }> {
  const { error } = await supabase
    .from("exhibition_works")
    .delete()
    .eq("exhibition_id", exhibitionId)
    .eq("work_id", workId);

  return { error };
}

/** Delete exhibition only: removes exhibition post/media/links, keeps artworks & provenance intact. */
export async function deleteExhibitionKeepWorks(exhibitionId: string): Promise<{ error: unknown }> {
  // First delete provenance claims that point to this exhibition via project_id.
  // For shell exhibitions with 0 works, 외부 작가 초대/큐레이션 클레임이 여기에 걸려 있어
  // projects 삭제 시 FK(claims_project_id_fkey)가 막을 수 있으므로 선삭제가 필요하다.
  const { error: claimsError } = await supabase
    .from("claims")
    .delete()
    .eq("project_id", exhibitionId);
  if (claimsError) {
    return { error: claimsError };
  }

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", exhibitionId)
    .eq("project_type", "exhibition");
  return { error };
}

/** Delete exhibition and all linked artworks (including provenance history via artwork cascade). */
export async function deleteExhibitionWithArtworks(exhibitionId: string): Promise<{
  error: unknown;
  failedArtworkIds?: string[];
}> {
  const { data: rows, error: listErr } = await supabase
    .from("exhibition_works")
    .select("work_id")
    .eq("exhibition_id", exhibitionId);
  if (listErr) return { error: listErr };
  const workIds = [...new Set((rows ?? []).map((r: { work_id: string }) => r.work_id))];
  if (workIds.length > 0) {
    const { deleteArtworksBatch } = await import("./artworks");
    const { failed } = await deleteArtworksBatch(workIds, { concurrency: 3 });
    if (failed.length > 0) {
      return { error: new Error("Some artworks failed to delete"), failedArtworkIds: failed.map((f) => f.id) };
    }
  }
  const { error } = await deleteExhibitionKeepWorks(exhibitionId);
  return { error, failedArtworkIds: [] };
}

/** List exhibitions for feed: curated or hosted by any of the given profile IDs (e.g. people I follow). */
export async function listExhibitionsForFeed(profileIds: string[]): Promise<{
  data: ExhibitionWithCredits[];
  error: unknown;
}> {
  if (profileIds.length === 0) return { data: [], error: null };
  const ids = profileIds.slice(0, 50);
  const [curatedRes, hostRes] = await Promise.all([
    supabase
      .from("projects")
      .select(SELECT_WITH_CREDITS)
      .eq("project_type", "exhibition")
      .in("curator_id", ids)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("projects")
      .select(SELECT_WITH_CREDITS)
      .eq("project_type", "exhibition")
      .in("host_profile_id", ids)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const byId = new Map<string, ExhibitionWithCredits>();
  for (const row of (curatedRes.data ?? []) as ExhibitionWithCredits[]) {
    byId.set(row.id, row);
  }
  for (const row of (hostRes.data ?? []) as ExhibitionWithCredits[]) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  const merged = Array.from(byId.values()).sort(
    (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
  );
  // Filter out "shell" exhibitions with no works (no rows in exhibition_works).
  if (merged.length === 0) {
    return { data: [], error: curatedRes.error ?? hostRes.error };
  }
  const exhibitionIds = merged.map((e) => e.id);
  const { data: ewRows } = await supabase
    .from("exhibition_works")
    .select("exhibition_id")
    .in("exhibition_id", exhibitionIds);
  const withWorks = new Set((ewRows ?? []).map((r: { exhibition_id: string }) => r.exhibition_id));
  const filtered = merged.filter((e) => withWorks.has(e.id));
  const enriched = await enrichExhibitionsCoversFromWorks(filtered.slice(0, 30));
  return { data: enriched, error: curatedRes.error ?? hostRes.error };
}

export type ExhibitionCursor = { created_at: string; id: string };

/**
 * Following feed: exhibitions curated or hosted by any of `profileIds`.
 * Keyset pagination; filters to exhibitions that have at least one work in exhibition_works.
 */
export async function listExhibitionsForFollowingFeed(
  profileIds: string[],
  options: { limit?: number; cursor?: ExhibitionCursor | null } = {}
): Promise<{
  data: ExhibitionWithCredits[];
  nextCursor: ExhibitionCursor | null;
  error: unknown;
}> {
  if (profileIds.length === 0) return { data: [], nextCursor: null, error: null };
  const ids = profileIds.slice(0, 50).filter(Boolean);
  const idList = ids.join(",");
  const pageSize = Math.min(options.limit ?? 12, 20);
  const cursor = options.cursor ?? null;
  const fetchLimit = (pageSize + 1) * 3;

  let query = supabase
    .from("projects")
    .select(SELECT_WITH_CREDITS)
    .eq("project_type", "exhibition")
    .or(`curator_id.in.(${idList}),host_profile_id.in.(${idList})`)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(fetchLimit);

  if (cursor?.created_at && cursor?.id) {
    const createdAt = cursor.created_at.replace(/"/g, '\\"');
    const id = cursor.id.replace(/"/g, '\\"');
    query = query.or(
      `created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt."${id}")`
    );
  }

  const { data, error } = await query;
  if (error) return { data: [], nextCursor: null, error };

  const projects = (data ?? []) as ExhibitionWithCredits[];
  if (projects.length === 0) return { data: [], nextCursor: null, error: null };

  const eids = projects.map((e) => e.id);
  const { data: ewRows } = await supabase
    .from("exhibition_works")
    .select("exhibition_id")
    .in("exhibition_id", eids);
  const withWorks = new Set((ewRows ?? []).map((r: { exhibition_id: string }) => r.exhibition_id));
  const filtered = projects.filter((e) => withWorks.has(e.id));
  const slice = filtered.slice(0, pageSize + 1);
  const hasMore = slice.length > pageSize;
  const page = hasMore ? slice.slice(0, pageSize) : slice;
  const next =
    hasMore && slice[pageSize]
      ? { created_at: slice[pageSize].created_at!, id: slice[pageSize].id }
      : null;
  const enrichedPage = await enrichExhibitionsCoversFromWorks(page);
  return { data: enrichedPage, nextCursor: next, error: null };
}

/**
 * Display-only enrichment: when an exhibition's `cover_image_paths` is
 * shorter than `target` (default 2 — the feed strip's `EXHIBITION_MIN_COVERS`
 * gate), append synthetic cover paths drawn from the exhibition's first
 * artworks (`exhibition_works.sort_order asc` → `artwork_images.sort_order asc`,
 * one image per work). The curator's own covers always come first; synthetic
 * paths only fill the gap.
 *
 * Boundary: this is a feed-only fallback so a curator's exhibition can
 * still surface in the Living Salon while they're still composing the
 * cover. The DB row is NEVER mutated; edit / "my exhibitions" / AI
 * routes call separate fetch functions and continue to see the raw
 * `cover_image_paths` (so we don't trick the curator into thinking they
 * already uploaded a cover, and we don't prompt the AI with phantom
 * covers).
 *
 * Same storage bucket as artwork images — `getArtworkImageUrl(path)` already
 * renders both, so the synthetic path is rendered byte-for-byte the same
 * as a curator-uploaded cover.
 */
export async function enrichExhibitionsCoversFromWorks(
  exhibitions: ExhibitionWithCredits[],
  target = 2
): Promise<ExhibitionWithCredits[]> {
  if (exhibitions.length === 0) return exhibitions;

  const needs = exhibitions.filter(
    (e) => (e.cover_image_paths?.length ?? 0) < target
  );
  if (needs.length === 0) return exhibitions;

  const needIds = needs.map((e) => e.id);
  const { data: ewRowsRaw } = await supabase
    .from("exhibition_works")
    .select("exhibition_id, work_id, sort_order")
    .in("exhibition_id", needIds);
  const ewRows = (ewRowsRaw ?? []) as Array<{
    exhibition_id: string;
    work_id: string;
    sort_order: number | null;
  }>;
  if (ewRows.length === 0) return exhibitions;

  // Per-exhibition: keep the first `target` work_ids by sort_order asc (nulls last).
  const sortedEw = [...ewRows].sort((a, b) => {
    const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    return ao - bo;
  });
  const worksByEx = new Map<string, string[]>();
  for (const row of sortedEw) {
    const arr = worksByEx.get(row.exhibition_id) ?? [];
    if (arr.length < target) {
      arr.push(row.work_id);
      worksByEx.set(row.exhibition_id, arr);
    }
  }

  const candidateWorkIds = Array.from(new Set([...worksByEx.values()].flat()));
  if (candidateWorkIds.length === 0) return exhibitions;

  const { data: imgRowsRaw } = await supabase
    .from("artwork_images")
    .select("artwork_id, storage_path, sort_order")
    .in("artwork_id", candidateWorkIds);
  const imgRows = (imgRowsRaw ?? []) as Array<{
    artwork_id: string;
    storage_path: string;
    sort_order: number | null;
  }>;
  if (imgRows.length === 0) return exhibitions;

  const sortedImgs = [...imgRows].sort((a, b) => {
    const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    return ao - bo;
  });
  const firstImgByWork = new Map<string, string>();
  for (const row of sortedImgs) {
    if (!firstImgByWork.has(row.artwork_id)) {
      firstImgByWork.set(row.artwork_id, row.storage_path);
    }
  }

  return exhibitions.map((e) => {
    const existing = e.cover_image_paths ?? [];
    if (existing.length >= target) return e;
    const wIds = worksByEx.get(e.id) ?? [];
    const synthetic: string[] = [];
    for (const w of wIds) {
      const p = firstImgByWork.get(w);
      if (!p) continue;
      if (existing.includes(p) || synthetic.includes(p)) continue;
      synthetic.push(p);
      if (existing.length + synthetic.length >= target) break;
    }
    if (synthetic.length === 0) return e;
    return { ...e, cover_image_paths: [...existing, ...synthetic] };
  });
}

/** List recent public exhibitions for global feed (not follow-limited). Cursor for load more. */
export async function listPublicExhibitionsForFeed(
  limit = 30,
  cursor?: ExhibitionCursor | null
): Promise<{
  data: ExhibitionWithCredits[];
  nextCursor: ExhibitionCursor | null;
  error: unknown;
}> {
  const pageSize = Math.min(limit, 20);
  let query = supabase
    .from("projects")
    .select(SELECT_WITH_CREDITS)
    .eq("project_type", "exhibition")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit((pageSize + 1) * 2);
  if (cursor) {
    const createdAt = cursor.created_at.replace(/"/g, '\\"');
    const id = cursor.id.replace(/"/g, '\\"');
    query = query.or(
      `created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt."${id}")`
    );
  }
  const { data, error } = await query;
  if (error) return { data: [], nextCursor: null, error };
  const projects = (data ?? []) as ExhibitionWithCredits[];
  if (projects.length === 0) return { data: [], nextCursor: null, error: null };
  const ids = projects.map((e) => e.id);
  const { data: ewRows } = await supabase
    .from("exhibition_works")
    .select("exhibition_id")
    .in("exhibition_id", ids);
  const withWorks = new Set((ewRows ?? []).map((r: { exhibition_id: string }) => r.exhibition_id));
  const filtered = projects.filter((e) => withWorks.has(e.id));
  const result = filtered.slice(0, pageSize + 1);
  const hasMore = result.length > pageSize;
  const next =
    hasMore && result[pageSize]
      ? { created_at: result[pageSize].created_at!, id: result[pageSize].id }
      : null;
  const dataPage = hasMore ? result.slice(0, pageSize) : result;
  const enriched = await enrichExhibitionsCoversFromWorks(dataPage);
  return {
    data: enriched,
    nextCursor: next,
    error: null,
  };
}

/** List exhibitions for a profile: curated/hosted by them OR they have works in. For My & public profile tabs. */
export async function listExhibitionsForProfile(profileId: string): Promise<{
  data: ExhibitionWithCredits[];
  error: unknown;
}> {
  const [curatedRes, worksRes] = await Promise.all([
    supabase
      .from("projects")
      .select(SELECT_WITH_CREDITS)
      .eq("project_type", "exhibition")
      .or(`curator_id.eq.${profileId},host_profile_id.eq.${profileId}`)
      .order("created_at", { ascending: false }),
    supabase.from("artworks").select("id").eq("artist_id", profileId),
  ]);
  const curated = (curatedRes.data ?? []) as ExhibitionWithCredits[];
  const myWorkIds = (worksRes.data ?? []).map((r: { id: string }) => r.id);
  if (myWorkIds.length === 0) return { data: curated, error: curatedRes.error };
  const { data: ewRows } = await supabase
    .from("exhibition_works")
    .select("exhibition_id")
    .in("work_id", myWorkIds);
  const participantIds = [...new Set((ewRows ?? []).map((r: { exhibition_id: string }) => r.exhibition_id))];
  if (participantIds.length === 0) return { data: curated, error: curatedRes.error };
  const curatedIds = new Set(curated.map((e) => e.id));
  const needFetch = participantIds.filter((id) => !curatedIds.has(id));
  if (needFetch.length === 0) return { data: curated, error: curatedRes.error };
  const { data: participantProjects } = await supabase
    .from("projects")
    .select(SELECT_WITH_CREDITS)
    .in("id", needFetch)
    .eq("project_type", "exhibition");
  const participant = (participantProjects ?? []) as ExhibitionWithCredits[];
  const merged = [...curated];
  for (const p of participant) {
    if (!curatedIds.has(p.id)) {
      curatedIds.add(p.id);
      merged.push(p);
    }
  }
  merged.sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
  return { data: merged, error: null };
}

/**
 * Get profile-specific sort orders for exhibitions (manual reorder mode).
 * Returns an `exhibition_id -> sort_order` map. Mirrors `getProfileArtworkOrders`.
 */
export async function getProfileExhibitionOrders(
  profileId: string,
  exhibitionIds: string[]
): Promise<{ data: Map<string, number>; error: unknown }> {
  if (exhibitionIds.length === 0) return { data: new Map(), error: null };

  const { data, error } = await supabase
    .from("profile_exhibition_orders")
    .select("exhibition_id, sort_order")
    .eq("profile_id", profileId)
    .in("exhibition_id", exhibitionIds);

  if (error) return { data: new Map(), error };

  const orderMap = new Map<string, number>();
  (data ?? []).forEach((row: { exhibition_id: string; sort_order: number }) => {
    orderMap.set(row.exhibition_id, row.sort_order);
  });
  return { data: orderMap, error: null };
}

/**
 * Apply a profile-specific manual ordering to exhibitions.
 * Rows present in the order map are placed first (ascending sort_order); rows
 * missing from the map fall back to `created_at` desc, preserving existing
 * defaults for newly added exhibitions.
 */
export function applyProfileExhibitionOrdering(
  rows: ExhibitionWithCredits[],
  orderMap: Map<string, number>
): ExhibitionWithCredits[] {
  return [...rows].sort((a, b) => {
    const ao = orderMap.get(a.id);
    const bo = orderMap.get(b.id);
    if (ao !== undefined && bo !== undefined) return ao - bo;
    if (ao !== undefined) return -1;
    if (bo !== undefined) return 1;
    return (
      new Date(b.created_at ?? 0).getTime() -
      new Date(a.created_at ?? 0).getTime()
    );
  });
}

/**
 * Persist a manual ordering of exhibitions for the current profile.
 * Only the profile owner may write. Mirrors `updateMyArtworkOrder` semantics:
 * we wipe + re-insert so removed ids no longer pin sort.
 */
export async function updateMyProfileExhibitionOrder(
  orderedIds: string[],
  profileId?: string
): Promise<{ error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { error: new Error("Not authenticated") };
  if (orderedIds.length === 0) return { error: null };

  const targetProfileId = profileId ?? session.user.id;
  if (targetProfileId !== session.user.id) {
    return { error: new Error("Only the profile owner may save manual ordering") };
  }

  const { error: deleteError } = await supabase
    .from("profile_exhibition_orders")
    .delete()
    .eq("profile_id", targetProfileId)
    .in("exhibition_id", orderedIds);
  if (deleteError) return { error: deleteError };

  const orders = orderedIds.map((id, idx) => ({
    profile_id: targetProfileId,
    exhibition_id: id,
    sort_order: idx,
    updated_at: new Date().toISOString(),
  }));
  const { error: insertError } = await supabase
    .from("profile_exhibition_orders")
    .insert(orders);
  if (insertError) return { error: insertError };

  return { error: null };
}

/** Clear any saved manual ordering of exhibitions for the current profile. */
export async function clearMyProfileExhibitionOrder(
  profileId?: string
): Promise<{ error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { error: new Error("Not authenticated") };

  const targetProfileId = profileId ?? session.user.id;
  if (targetProfileId !== session.user.id) {
    return { error: new Error("Only the profile owner may clear manual ordering") };
  }

  const { error } = await supabase
    .from("profile_exhibition_orders")
    .delete()
    .eq("profile_id", targetProfileId);
  return { error };
}

/** Get one exhibition by id (for detail/edit). */
export async function getExhibitionById(id: string): Promise<{
  data: ExhibitionWithCredits | null;
  error: unknown;
}> {
  const { data, error } = await supabase
    .from("projects")
    .select(SELECT_WITH_CREDITS)
    .eq("id", id)
    .eq("project_type", "exhibition")
    .maybeSingle();

  if (error) return { data: null, error };
  return { data: data as ExhibitionWithCredits | null, error: null };
}

/** List exhibition-level media (전시전경, 부대행사, or custom buckets via bucket_title). */
export async function listExhibitionMedia(exhibitionId: string): Promise<{
  data: ExhibitionMediaRow[];
  error: unknown;
}> {
  const { data, error } = await supabase
    .from("exhibition_media")
    .select("id, exhibition_id, type, bucket_title, storage_path, sort_order, created_at")
    .eq("exhibition_id", exhibitionId)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) return { data: [], error };
  return { data: (data ?? []) as ExhibitionMediaRow[], error: null };
}

export type ExhibitionMediaBucket = {
  key: string;
  title: string;
  items: ExhibitionMediaRow[];
  /** For inserting new photo into this bucket. */
  insertType: "installation" | "side_event" | "custom";
  insertBucketTitle: string | null;
};

/** Group media by display bucket: key = bucket_title ?? type (for section title). */
export function groupExhibitionMediaByBucket(
  media: ExhibitionMediaRow[],
  t: (key: string) => string,
  bucketRows?: ExhibitionMediaBucketRow[]
): ExhibitionMediaBucket[] {
  const byKey = new Map<string, ExhibitionMediaRow[]>();
  const defaultTitles: Record<string, string> = {
    installation: "exhibition.installationViews",
    side_event: "exhibition.sideEvents",
  };
  for (const m of media) {
    const key = m.bucket_title?.trim() || m.type;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(m);
  }
  const buckets = Array.from(byKey.entries()).map(([key, items]) => {
    const first = items[0];
    const insertType: "installation" | "side_event" | "custom" =
      key === "installation" ? "installation" : key === "side_event" ? "side_event" : "custom";
    return {
      key,
      title: defaultTitles[key] ? t(defaultTitles[key]) : key,
      items,
      insertType,
      insertBucketTitle: insertType === "custom" ? (first?.bucket_title?.trim() || key) : null,
    };
  });
  // Ensure installation and side_event exist (for "add photo" UI even when empty)
  for (const k of ["installation", "side_event"]) {
    if (!byKey.has(k)) {
      buckets.push({
        key: k,
        title: defaultTitles[k] ? t(defaultTitles[k]) : k,
        items: [],
        insertType: k as "installation" | "side_event",
        insertBucketTitle: null,
      });
    }
  }
  if (bucketRows?.length) {
    const byMeta = new Map(bucketRows.map((r) => [r.key, r]));
    for (const b of buckets) {
      const meta = byMeta.get(b.key);
      if (meta?.title?.trim()) b.title = meta.title.trim();
    }
    buckets.sort((a, b) => {
      const ma = byMeta.get(a.key);
      const mb = byMeta.get(b.key);
      const ao = ma?.sort_order ?? Number.MAX_SAFE_INTEGER;
      const bo = mb?.sort_order ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      if (ma && !mb) return -1;
      if (!ma && mb) return 1;
      return 0;
    });
  }
  return buckets;
}

/** Insert one exhibition media row (curator/host only via RLS). Use type 'custom' + bucket_title for user-named buckets. */
export async function insertExhibitionMedia(args: {
  exhibition_id: string;
  type: "installation" | "side_event" | "custom";
  bucket_title?: string | null;
  storage_path: string;
  sort_order?: number | null;
}): Promise<{ data: { id: string } | null; error: unknown }> {
  const { data, error } = await supabase
    .from("exhibition_media")
    .insert({
      exhibition_id: args.exhibition_id,
      type: args.type,
      bucket_title: args.bucket_title?.trim() || null,
      storage_path: args.storage_path,
      sort_order: args.sort_order ?? 0,
    })
    .select("id")
    .single();
  if (error) return { data: null, error };
  return { data: data as { id: string }, error: null };
}

/** Delete exhibition media (curator/host only via RLS). */
export async function deleteExhibitionMedia(id: string): Promise<{ error: unknown }> {
  const { error } = await supabase.from("exhibition_media").delete().eq("id", id);
  return { error };
}

/** Ensure fixed default buckets exist for this exhibition. */
export async function ensureDefaultExhibitionMediaBuckets(exhibitionId: string): Promise<{ error: unknown }> {
  const rows = [
    { exhibition_id: exhibitionId, key: "installation", title: "installation", type: "installation", sort_order: 0 },
    { exhibition_id: exhibitionId, key: "side_event", title: "side_event", type: "side_event", sort_order: 1 },
  ];
  const { error } = await supabase
    .from("exhibition_media_buckets")
    .upsert(rows, { onConflict: "exhibition_id,key", ignoreDuplicates: false });
  return { error };
}

export async function listExhibitionMediaBuckets(exhibitionId: string): Promise<{
  data: ExhibitionMediaBucketRow[];
  error: unknown;
}> {
  const { data, error } = await supabase
    .from("exhibition_media_buckets")
    .select("id, exhibition_id, key, title, type, sort_order, created_at")
    .eq("exhibition_id", exhibitionId)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) return { data: [], error };
  return { data: (data ?? []) as ExhibitionMediaBucketRow[], error: null };
}

export async function upsertExhibitionMediaBucket(args: {
  exhibition_id: string;
  key: string;
  title: string;
  type: "installation" | "side_event" | "custom";
  sort_order?: number | null;
}): Promise<{ error: unknown }> {
  const { error } = await supabase.from("exhibition_media_buckets").upsert(
    {
      exhibition_id: args.exhibition_id,
      key: args.key,
      title: args.title.trim(),
      type: args.type,
      sort_order: args.sort_order ?? 0,
    },
    { onConflict: "exhibition_id,key" }
  );
  return { error };
}

export async function updateExhibitionMediaBucketOrder(
  exhibitionId: string,
  orderedBucketKeys: string[]
): Promise<{ error: unknown }> {
  if (orderedBucketKeys.length === 0) return { error: null };
  const results = await Promise.all(
    orderedBucketKeys.map((key, idx) =>
      supabase
        .from("exhibition_media_buckets")
        .update({ sort_order: idx })
        .eq("exhibition_id", exhibitionId)
        .eq("key", key)
    )
  );
  const failed = results.find((r) => r.error);
  return { error: failed?.error ?? null };
}

/** Persist complete works order for an exhibition (global order across artist buckets). */
export async function updateExhibitionWorksOrder(
  exhibitionId: string,
  orderedWorkIds: string[]
): Promise<{ error: unknown }> {
  if (orderedWorkIds.length === 0) return { error: null };
  const results = await Promise.all(
    orderedWorkIds.map((workId, idx) =>
      supabase
        .from("exhibition_works")
        .update({ sort_order: idx })
        .eq("exhibition_id", exhibitionId)
        .eq("work_id", workId)
    )
  );
  const failed = results.find((r) => r.error);
  return { error: failed?.error ?? null };
}

/** Persist complete media order for an exhibition (global order across media buckets). */
export async function updateExhibitionMediaOrder(
  exhibitionId: string,
  orderedMediaIds: string[]
): Promise<{ error: unknown }> {
  if (orderedMediaIds.length === 0) return { error: null };
  const results = await Promise.all(
    orderedMediaIds.map((mediaId, idx) =>
      supabase
        .from("exhibition_media")
        .update({ sort_order: idx })
        .eq("exhibition_id", exhibitionId)
        .eq("id", mediaId)
    )
  );
  const failed = results.find((r) => r.error);
  return { error: failed?.error ?? null };
}

/** List exhibitions that include this work (for artwork detail "Part of exhibitions"). */
export async function listExhibitionsForWork(workId: string): Promise<{
  data: ExhibitionWithCredits[];
  error: unknown;
}> {
  const { data: ewRows, error: ewError } = await supabase
    .from("exhibition_works")
    .select("exhibition_id")
    .eq("work_id", workId);
  if (ewError || !ewRows?.length) return { data: [], error: ewError ?? null };
  const ids = [...new Set(ewRows.map((r: { exhibition_id: string }) => r.exhibition_id))];
  const { data, error } = await supabase
    .from("projects")
    .select(SELECT_WITH_CREDITS)
    .in("id", ids)
    .eq("project_type", "exhibition")
    .order("created_at", { ascending: false });
  if (error) return { data: [], error };
  return { data: (data ?? []) as ExhibitionWithCredits[], error: null };
}
