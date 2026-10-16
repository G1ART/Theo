import { supabase } from "@/lib/supabase/client";

/** Server liveness check. False when the delegation was revoked or expired. */
export async function probeCanManageProfileTabs(profileId: string): Promise<boolean> {
  const id = profileId.trim();
  if (!id) return false;
  const { data, error } = await supabase.rpc("can_manage_profile_tabs", {
    p_profile_id: id,
  });
  if (error) return false;
  return data === true;
}
import { updateMyProfileDetails } from "@/lib/supabase/profileDetails";
import {
  buildSavePayload,
  type StudioPortfolioV1,
} from "@/lib/studio/studioPortfolioConfig";

/**
 * Writes `profile_details.studio_portfolio` for a profile the caller may
 * manage. Owners and qualifying account delegates both go through
 * `save_profile_studio_portfolio`, which refuses everyone else.
 * A missing profile id keeps the older own-profile RPC for callers that
 * are already editing the signed-in account.
 */
export async function persistStudioPortfolio(
  next: StudioPortfolioV1,
  profileId?: string | null,
): Promise<{ ok: boolean; error: unknown }> {
  const payload = buildSavePayload(next);
  const id = profileId?.trim() ?? "";
  if (id) {
    const { error } = await supabase.rpc("save_profile_studio_portfolio", {
      p_profile_id: id,
      p_portfolio: payload.studio_portfolio,
    });
    return { ok: !error, error };
  }
  const { error } = await updateMyProfileDetails(payload, null);
  return { ok: !error, error };
}
