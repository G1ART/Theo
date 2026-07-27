/**
 * Exhibition "Exhibited by / Curated by" label logic.
 * Single source of truth for host/curator display across cards, detail pages, artwork pages.
 */

import type { ExhibitionRow } from "@/lib/supabase/exhibitions";

export type ExhibitionWithCredits = ExhibitionRow & {
  curator?: { display_name?: string | null; username?: string | null } | null;
  host?: { display_name?: string | null; username?: string | null } | null;
  /**
   * Optional count of works linked via `exhibition_works`. Populated by
   * listMyExhibitions so callers can render "임시 저장 / 예정" badges without
   * an N+1 fetch per row. `null` means "not fetched" (do not conflate with 0).
   */
  works_count?: number | null;
};

function displayName(profile: { display_name?: string | null; username?: string | null } | null | undefined): string {
  if (!profile) return "—";
  const name = profile.display_name?.trim();
  return name || profile.username || "—";
}

/**
 * Returns the single line label for "Exhibited by / Curated by" for an exhibition.
 * - When curator_id === host_profile_id (both set): "Exhibited & Curated by [Name]"
 * - When only host (no curator display needed for host): "Exhibited by [Host]"
 * - When only curator (no host): "Curated by [Curator]"
 * - When both and different (or host_name only, no host_profile_id): "Exhibited by [Host] · Curated by [Curator]"
 * @param exhibition Row with optional curator/host profile (from join). host_name used when host_profile_id is null.
 * @param t i18n function (key) => string. Keys: exhibition.exhibitedAndCuratedBy, exhibitedBy, curatedBy, creditsSeparator
 */
export function getExhibitionHostCuratorLabel(
  exhibition: ExhibitionWithCredits,
  t: (key: string) => string
): string {
  const { curator_id, host_profile_id, host_name } = exhibition;
  const samePerson =
    curator_id != null && host_profile_id != null && curator_id === host_profile_id;
  const curatorLabel = displayName(exhibition.curator ?? null);
  const hasHostProfile = host_profile_id != null && host_profile_id !== "";
  const hostLabelFromProfile = hasHostProfile ? displayName(exhibition.host ?? null) : null;
  const hostLabelFromName = host_name?.trim() || null;
  const hostLabel = hostLabelFromProfile ?? hostLabelFromName ?? null;
  const hasHost = hostLabel != null;

  if (samePerson) {
    const name = curatorLabel !== "—" ? curatorLabel : displayName(exhibition.host ?? null);
    return t("exhibition.exhibitedAndCuratedBy").replace("{name}", name);
  }
  if (hasHost && curator_id) {
    const sep = t("exhibition.creditsSeparator");
    return (
      t("exhibition.exhibitedBy").replace("{name}", hostLabel) +
      sep +
      t("exhibition.curatedBy").replace("{name}", curatorLabel)
    );
  }
  if (hasHost) {
    return t("exhibition.exhibitedBy").replace("{name}", hostLabel);
  }
  return t("exhibition.curatedBy").replace("{name}", curatorLabel);
}
