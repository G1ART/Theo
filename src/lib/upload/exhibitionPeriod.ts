export type ClaimPeriod = "past" | "current" | "future";

/**
 * Exhibition posts already require a status. That status is the period
 * a linked work should carry. Unknown statuses are left blank.
 */
export function claimPeriodFromExhibitionStatus(
  status: string | null | undefined,
): ClaimPeriod | null {
  if (status === "ended") return "past";
  if (status === "live") return "current";
  if (status === "planned") return "future";
  return null;
}

export function claimPeriodFromKnownExhibition(
  exhibitionId: string | null | undefined,
  known: Array<{ id: string; status?: string | null }>,
): ClaimPeriod | null {
  const id = exhibitionId?.trim() ?? "";
  if (!id) return null;
  const listed = known.find((row) => row.id === id);
  if (!listed) return null;
  return claimPeriodFromExhibitionStatus(listed.status);
}
