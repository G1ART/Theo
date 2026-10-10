import { getExhibitionById } from "@/lib/supabase/exhibitions";
import {
  claimPeriodFromExhibitionStatus,
  claimPeriodFromKnownExhibition,
  type ClaimPeriod,
} from "@/lib/upload/exhibitionPeriod";

export async function claimPeriodForExhibition(
  exhibitionId: string | null | undefined,
  known: Array<{ id: string; status?: string | null }>,
): Promise<ClaimPeriod | null> {
  const id = exhibitionId?.trim() ?? "";
  if (!id) return null;
  if (known.some((row) => row.id === id)) {
    return claimPeriodFromKnownExhibition(id, known);
  }
  const { data } = await getExhibitionById(id);
  return claimPeriodFromExhibitionStatus(data?.status);
}
