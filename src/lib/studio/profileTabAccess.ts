/**
 * Account-scope permissions that may create, rename, reorder, and delete
 * tabs on the principal's public profile.
 *
 * `manage_artworks` is on the operations preset (every permission except
 * security and billing) and on the content preset.
 * `edit_profile_public_content` is the profile-management permission on
 * the content preset. Either one is enough. View-only, project-scope,
 * and inquiry-only delegations are not.
 */
export const PROFILE_TAB_DELEGATION_PERMISSIONS = [
  "manage_artworks",
  "edit_profile_public_content",
] as const;

export type ProfileTabDelegation = {
  scopeType: string;
  status: string;
  permissions: readonly string[];
  expiresAt?: string | null;
};

export function delegationGrantsProfileTabManagement(
  delegation: ProfileTabDelegation | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!delegation) return false;
  if (delegation.scopeType !== "account") return false;
  if (delegation.status !== "active") return false;
  if (delegation.expiresAt) {
    const exp = Date.parse(delegation.expiresAt);
    if (!Number.isFinite(exp) || exp <= now.getTime()) return false;
  }
  return delegation.permissions.some((key) =>
    (PROFILE_TAB_DELEGATION_PERMISSIONS as readonly string[]).includes(key),
  );
}

/** Owner, or an active unexpired account delegate with a tab permission. */
export function canManageProfileTabs(input: {
  viewerId: string | null | undefined;
  profileId: string | null | undefined;
  delegation?: ProfileTabDelegation | null;
  now?: Date;
}): boolean {
  const viewer = input.viewerId?.trim() ?? "";
  const profile = input.profileId?.trim() ?? "";
  if (!viewer || !profile) return false;
  if (viewer === profile) return true;
  return delegationGrantsProfileTabManagement(input.delegation, input.now);
}
