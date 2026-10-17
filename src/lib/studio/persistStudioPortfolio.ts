import { supabase } from "@/lib/supabase/client";
import {
  buildSavePayload,
  type StudioPortfolioV1,
} from "@/lib/studio/studioPortfolioConfig";

/**
 * Server check. Owners pass with a null acting id.
 * Delegates pass only when `actingProfileId` is the profile they are
 * working on inside delegation work, and the delegation is still active.
 */
export async function probeCanManageProfileTabs(
  profileId: string,
  actingProfileId?: string | null,
): Promise<boolean> {
  const id = profileId.trim();
  if (!id) return false;
  const { data, error } = await supabase.rpc("can_manage_profile_tabs", {
    p_profile_id: id,
    p_acting_profile_id: actingProfileId?.trim() || null,
  });
  if (error) return false;
  return data === true;
}

/**
 * Writes `profile_details.studio_portfolio`.
 * Owners save their own profile with no acting id; a missing profile id
 * saves the signed-in account. Delegates save only from delegation work,
 * passing the profile they are acting as. The tabs this screen read go
 * along so the server keeps works and tabs added since.
 */
export async function persistStudioPortfolio(
  next: StudioPortfolioV1,
  profileId?: string | null,
  options?: { actingProfileId?: string | null },
): Promise<{ ok: boolean; error: unknown }> {
  const payload = buildSavePayload(next);
  let id = profileId?.trim() ?? "";
  if (!id) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    id = session?.user?.id ?? "";
  }
  if (!id) return { ok: false, error: new Error("Not authenticated") };
  const { error } = await supabase.rpc("save_profile_studio_portfolio", {
    p_profile_id: id,
    p_portfolio: payload.studio_portfolio,
    p_acting_profile_id: options?.actingProfileId?.trim() || null,
    p_loaded_tabs: next.loaded_tabs ?? null,
  });
  return { ok: !error, error };
}
