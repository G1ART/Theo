/**
 * Delegation manage-destination resolver (PR-B).
 *
 * The "Manage" CTA on a received delegation card historically routed
 * every project-scope delegation to `/my/exhibitions/{id}/add`. That
 * was wrong for two reasons:
 *
 *   1. `project_review` is intentionally view-only. Dropping the user
 *      onto an `/add` route encouraged them to start mutations they
 *      had no permission for, surfacing RLS-denied errors only after
 *      they tried to save.
 *   2. `project_co_edit` includes metadata edit rights but `/add` is
 *      narrowly scoped to adding works. Co-editors should land on the
 *      full edit surface where they can fix copy / dates / etc.
 *
 * This helper centralises the routing decision so the hub page,
 * notification deep-links, and any future entry points stay consistent.
 *
 * Account scope lands on the account's public profile, the same place
 * the account switcher opens. While acting it shows the owner view.
 * Only an account without a public handle falls back to the acting
 * workspace (`/my`).
 *
 * Returns:
 *   - `kind: "navigate"`: the caller should activate acting-as (when
 *     `activateActingAs=true`) and navigate to `href`.
 *   - `kind: "stay"`: the caller should NOT activate acting-as. Show
 *     the message at `messageKey` inline (review presets, where there
 *     are no mutation surfaces, fall here).
 */

import type {
  DelegationPreset,
  DelegationWithDetails,
} from "@/lib/supabase/delegations";
import { principalEntryHref } from "@/lib/delegation/principalProfileHref";

export type ManageDestination =
  | { kind: "navigate"; href: string; activateActingAs: boolean }
  | { kind: "stay"; messageKey: string };

/**
 * Heuristic: does this preset grant ANY mutation rights?
 * `view`-only presets (`project_review`, `account_review`) return false.
 */
export function presetHasMutationRights(
  preset: DelegationPreset | null | undefined
): boolean {
  if (!preset) return false;
  switch (preset) {
    case "review":
    case "project_review":
      return false;
    case "operations":
    case "content":
    case "project_co_edit":
    case "project_works_only":
      return true;
  }
}

export function resolveManageDestination(
  d: Pick<DelegationWithDetails, "scope_type" | "project_id" | "preset"> & {
    delegator_profile?: { username?: string | null } | null;
  }
): ManageDestination {
  if (d.scope_type === "project") {
    if (!d.project_id) {
      return { kind: "stay", messageKey: "delegation.manage.missingProject" };
    }
    // QA 2026-06-26 (#11) — every mutation-capable project preset now
    // lands on the exhibition hub page (`/my/exhibitions/{id}`). The
    // old `/edit` / `/add` deep-links forced the delegate one click
    // away from the place where they actually wanted to be (browse
    // works, add new ones, manage media). The hub already surfaces
    // both "Edit exhibition" and "Add work" affordances, so the
    // delegate can self-route into the narrower screens. RLS still
    // gates each mutation regardless of where they land.
    switch (d.preset) {
      case "project_review":
        // View-only — there is no curator-side surface to land on.
        return { kind: "stay", messageKey: "delegation.manage.reviewOnly" };
      case "project_works_only":
      case "project_co_edit":
      default:
        return {
          kind: "navigate",
          href: `/my/exhibitions/${d.project_id}`,
          activateActingAs: true,
        };
    }
  }

  // account scope — legacy presets (null) act like the writer presets.
  // Permission-aware RLS guards every mutation wherever they land.
  if (d.preset === "review") {
    return { kind: "stay", messageKey: "delegation.manage.reviewOnly" };
  }
  return {
    kind: "navigate",
    href: principalEntryHref(d.delegator_profile?.username),
    activateActingAs: true,
  };
}
