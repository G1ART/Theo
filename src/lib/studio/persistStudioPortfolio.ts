import { updateMyProfileDetails } from "@/lib/supabase/profileDetails";
import {
  buildSavePayload,
  type StudioPortfolioV1,
} from "@/lib/studio/studioPortfolioConfig";

/**
 * Same persist path StudioPortfolioPanel used on `/my`.
 * Writes `profile_details.studio_portfolio` via the existing merge RPC.
 */
export async function persistStudioPortfolio(
  next: StudioPortfolioV1
): Promise<{ ok: boolean; error: unknown }> {
  const { error } = await updateMyProfileDetails(buildSavePayload(next), null);
  return { ok: !error, error };
}
