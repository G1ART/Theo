import { logSupabaseError } from "@/lib/supabase/errors";
import { getMyProfile } from "@/lib/supabase/profiles";
import { supabase } from "@/lib/supabase/client";
import type { UploadFilingResult } from "@/lib/studio/profileContentKind";
import {
  attachCreatedWorksToProfileTab,
  parseActiveTabParam,
  parseStudioPortfolio,
  type ProfileTabAttachResult,
} from "@/lib/studio/studioPortfolioConfig";

const NONE: ProfileTabAttachResult = {
  portfolio: { version: 1, custom_tabs: [] },
  attached: false,
  tabId: null,
  label: null,
};

/**
 * Writes new work ids into the uploader's existing `studio_portfolio`
 * custom tab. Does not change `artist_id` or claims.
 * No tab, 전체, or an unknown tab id is a no-op.
 */
export async function persistCreatedWorksOnProfileTab(params: {
  artworkIds: string[];
  tabParam: string | null | undefined;
}): Promise<ProfileTabAttachResult> {
  const ids = params.artworkIds.map((id) => id.trim()).filter((id) => id.length > 0);
  if (ids.length === 0) return NONE;
  const active = parseActiveTabParam(params.tabParam ?? null);
  if (!active || active.kind !== "custom") return NONE;
  try {
    const { data, error } = await getMyProfile();
    if (error || !data) {
      if (error) logSupabaseError("persistCreatedWorksOnProfileTab.read", error);
      return NONE;
    }
    const current = parseStudioPortfolio(data.profile_details ?? null);
    const next = attachCreatedWorksToProfileTab({
      portfolio: current,
      artworkIds: ids,
      tabParam: params.tabParam,
    });
    if (!next.attached || !next.tabId || !data.id) return next;
    const filed = await fileArtworksIntoExistingTab({
      profileId: data.id,
      tabId: next.tabId,
      artworkIds: ids,
    });
    if (!filed.ok) {
      logSupabaseError("persistCreatedWorksOnProfileTab.write", filed.error);
      return { ...next, attached: false };
    }
    return next;
  } catch (err) {
    logSupabaseError("persistCreatedWorksOnProfileTab", err);
    return NONE;
  }
}

/**
 * Appends work ids to a tab that already exists and, unless that tab is
 * collected, stores the tab's kind on the works. Does not create a tab
 * and does not change artist_id.
 * Pass a null tab id to lift the ids out of every custom tab on that profile.
 */
export async function fileArtworksIntoExistingTab(params: {
  profileId: string;
  tabId: string | null;
  artworkIds: string[];
}): Promise<{ ok: boolean; error: unknown }> {
  const artworkIds = params.artworkIds.map((id) => id.trim()).filter((id) => id.length > 0);
  if (!params.profileId || artworkIds.length === 0) return { ok: true, error: null };
  const { error } = await supabase.rpc("file_artworks_into_existing_tab", {
    p_profile_id: params.profileId,
    p_tab_id: params.tabId,
    p_artwork_ids: artworkIds,
  });
  if (error) return { ok: false, error };
  return { ok: true, error: null };
}

/**
 * Writes every membership from a filing plan. Artist tabs run before
 * collected tabs so a collector listing does not replace the public kind.
 */
export async function persistUploadFiling(params: {
  artworkIds: string[];
  plan: UploadFilingResult;
}): Promise<{ ok: boolean; error: unknown }> {
  const ids = params.artworkIds.map((id) => id.trim()).filter((id) => id.length > 0);
  if (ids.length === 0) return { ok: true, error: null };
  const artistFirst = [...params.plan.memberships].sort((a, b) => {
    if (a.profileId === params.plan.artistId && b.profileId !== params.plan.artistId) return -1;
    if (b.profileId === params.plan.artistId && a.profileId !== params.plan.artistId) return 1;
    return 0;
  });
  for (const membership of artistFirst) {
    const filed = await fileArtworksIntoExistingTab({
      profileId: membership.profileId,
      tabId: membership.tabId,
      artworkIds: ids,
    });
    if (!filed.ok) {
      logSupabaseError("persistUploadFiling", filed.error);
      return filed;
    }
  }
  return { ok: true, error: null };
}
