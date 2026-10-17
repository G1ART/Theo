import { supabase } from "@/lib/supabase/client";
import { updateMyProfileDetails } from "@/lib/supabase/profileDetails";
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
 * Owners save their own profile with no acting id.
 * Delegates save only from delegation work, passing the profile they
 * are acting as. A missing profile id keeps the older own-profile RPC.
 */
export async function persistStudioPortfolio(
  next: StudioPortfolioV1,
  profileId?: string | null,
  options?: { actingProfileId?: string | null },
): Promise<{ ok: boolean; error: unknown }> {
  const payload = buildSavePayload(next);
  const id = profileId?.trim() ?? "";
  if (id) {
    const { error } = await supabase.rpc("save_profile_studio_portfolio", {
      p_profile_id: id,
      p_portfolio: payload.studio_portfolio,
      p_acting_profile_id: options?.actingProfileId?.trim() || null,
    });
    return { ok: !error, error };
  }
  const { error } = await updateMyProfileDetails(payload, null);
  return { ok: !error, error };
}
