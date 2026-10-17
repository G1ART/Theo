import type { ProfileTabDelegation } from "@/lib/studio/profileTabAccess";
import { delegationGrantsProfileTabManagement } from "@/lib/studio/profileTabAccess";

export type ProfileManageGrants = {
  editPublicProfile: boolean;
  manageTabs: boolean;
  manageArtworks: boolean;
  manageExhibitions: boolean;
};

export const EMPTY_PROFILE_MANAGE_GRANTS: ProfileManageGrants = {
  editPublicProfile: false,
  manageTabs: false,
  manageArtworks: false,
  manageExhibitions: false,
};

const ALL_TRUE: ProfileManageGrants = {
  editPublicProfile: true,
  manageTabs: true,
  manageArtworks: true,
  manageExhibitions: true,
};

function hasPerm(delegation: ProfileTabDelegation, key: string): boolean {
  return delegation.permissions.includes(key);
}

/**
 * Owner always. A delegate only while acting as this profile, and only
 * for the permissions on an active unexpired account delegation.
 * Visiting the public profile without acting-as stays a visitor.
 */
export function profileManageGrants(input: {
  viewerId: string | null | undefined;
  profileId: string | null | undefined;
  actingProfileId?: string | null;
  delegation?: ProfileTabDelegation | null;
  now?: Date;
}): ProfileManageGrants {
  const viewer = input.viewerId?.trim() ?? "";
  const profile = input.profileId?.trim() ?? "";
  if (!viewer || !profile) return EMPTY_PROFILE_MANAGE_GRANTS;
  if (viewer === profile) return ALL_TRUE;
  const acting = input.actingProfileId?.trim() ?? "";
  if (!acting || acting !== profile || acting === viewer) return EMPTY_PROFILE_MANAGE_GRANTS;
  const delegation = input.delegation;
  if (!delegation) return EMPTY_PROFILE_MANAGE_GRANTS;
  if (delegation.scopeType !== "account") return EMPTY_PROFILE_MANAGE_GRANTS;
  if (delegation.status !== "active") return EMPTY_PROFILE_MANAGE_GRANTS;
  if (delegation.expiresAt) {
    const exp = Date.parse(delegation.expiresAt);
    if (!Number.isFinite(exp) || exp <= (input.now ?? new Date()).getTime()) {
      return EMPTY_PROFILE_MANAGE_GRANTS;
    }
  }
  const editPublicProfile = hasPerm(delegation, "edit_profile_public_content");
  const manageArtworks = hasPerm(delegation, "manage_artworks");
  const manageExhibitions = hasPerm(delegation, "manage_exhibitions");
  return {
    editPublicProfile,
    manageArtworks,
    manageExhibitions,
    manageTabs: delegationGrantsProfileTabManagement(delegation, input.now),
  };
}
