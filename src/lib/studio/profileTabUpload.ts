import { logSupabaseError } from "@/lib/supabase/errors";
import { getMyProfile } from "@/lib/supabase/profiles";
import { persistStudioPortfolio } from "@/lib/studio/persistStudioPortfolio";
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
    if (!next.attached) return next;
    const same =
      JSON.stringify(current.custom_tabs ?? []) ===
      JSON.stringify(next.portfolio.custom_tabs ?? []);
    if (same) return next;
    const { ok, error: saveError } = await persistStudioPortfolio(next.portfolio);
    if (!ok) {
      logSupabaseError("persistCreatedWorksOnProfileTab.write", saveError);
      return { ...next, attached: false };
    }
    return next;
  } catch (err) {
    logSupabaseError("persistCreatedWorksOnProfileTab", err);
    return NONE;
  }
}
