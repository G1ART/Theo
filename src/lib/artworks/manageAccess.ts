/**
 * Who may edit or delete a work, shared by the screens and the
 * client checks. The database policy `artwork_manage_allowed` is the
 * same rule: artist, uploader, or a delegate of one of those accounts
 * who holds artwork management.
 */

export type ArtworkManageDelegation = {
  delegator_profile_id: string;
  scope_type: string;
  status: string;
  permissions?: readonly string[] | null;
  expires_at?: string | null;
};

export function actingProfileMayManageArtworks(
  delegations: readonly ArtworkManageDelegation[],
  actingAsProfileId: string | null | undefined,
  now = Date.now(),
): boolean {
  const acting = actingAsProfileId?.trim() ?? "";
  if (!acting) return false;
  return delegations.some((row) => {
    if (row.delegator_profile_id !== acting) return false;
    if (row.status !== "active") return false;
    if (row.expires_at) {
      const exp = Date.parse(row.expires_at);
      if (!Number.isFinite(exp) || exp <= now) return false;
    }
    const perms = row.permissions ?? [];
    if (row.scope_type === "account") return perms.includes("manage_artworks");
    if (row.scope_type === "project") return perms.includes("manage_works");
    return false;
  });
}

/** Session always. Acting-as principal only with artwork management. */
export function artworkManageActorIds(input: {
  sessionUserId: string | null | undefined;
  actingAsProfileId?: string | null;
  actingMayManage: boolean;
}): string[] {
  const out: string[] = [];
  const session = input.sessionUserId?.trim() ?? "";
  const acting = input.actingAsProfileId?.trim() ?? "";
  if (acting && input.actingMayManage && acting !== session) out.push(acting);
  if (session && !out.includes(session)) out.push(session);
  return out;
}
