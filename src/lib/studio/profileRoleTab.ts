/**
 * Artist / Collector role tab vs the persona strip.
 *
 * Collector is a view: works this profile OWNS, or the empty collected
 * state. It does not write that choice into `active`.
 *
 * The strip guard replaces an `active` tab the public strip does not
 * list. `getOrderedPersonaTabs` omits OWNS when the owns count is 0, which
 * is exactly the empty collected screen. The old collector click wrote
 * OWNS, the guard wrote "all" on the next commit, and the two paints
 * alternated between the artist grid and the empty collected state.
 */
import type { ActiveStudioTab } from "@/lib/studio/studioPortfolioConfig";

export type ProfileRoleTab = "artist" | "collector";

export type ProfileStripRow = {
  kind: "persona" | "custom";
  personaTab?: string;
  customId?: string;
};

export function isCollectedRoleView(roleTab: ProfileRoleTab, showRoleTabs: boolean): boolean {
  return showRoleTabs && roleTab === "collector";
}

export function stripListsActive(strip: ProfileStripRow[], active: ActiveStudioTab): boolean {
  if (active.kind === "custom") {
    return strip.some((row) => row.kind === "custom" && row.customId === active.id);
  }
  return strip.some((row) => row.kind === "persona" && row.personaTab === active.tab);
}

function sameActive(a: ActiveStudioTab, b: ActiveStudioTab): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "persona" && b.kind === "persona") return a.tab === b.tab;
  if (a.kind === "custom" && b.kind === "custom") return a.id === b.id;
  return false;
}

const ARTIST_FALLBACK: ActiveStudioTab = { kind: "persona", tab: "all" };

/**
 * One commit of the profile tab writers.
 * Returns the same `active` reference when nothing changes, so an effect
 * that setStates on a new reference does not schedule another commit.
 */
export function profileActiveAfterRoleWriters(input: {
  roleTab: ProfileRoleTab;
  active: ActiveStudioTab;
  showRoleTabs: boolean;
  stripLists: (active: ActiveStudioTab) => boolean;
}): ActiveStudioTab {
  const { roleTab, active, showRoleTabs, stripLists } = input;
  let resolved = active;
  if (
    showRoleTabs &&
    roleTab === "artist" &&
    active.kind === "persona" &&
    active.tab === "OWNS"
  ) {
    // Collected works belong to the Collector role tab.
    resolved = ARTIST_FALLBACK;
  } else if (!stripLists(active)) {
    resolved = ARTIST_FALLBACK;
  }
  if (sameActive(resolved, active)) return active;
  return resolved;
}
