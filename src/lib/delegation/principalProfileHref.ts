import { isPlaceholderUsername } from "@/lib/identity/placeholder";

/**
 * Public profile of an account in the switcher.
 * A placeholder handle has no public profile yet.
 */
export function principalPublicProfileHref(
  username: string | null | undefined,
): string | null {
  const handle = username?.trim() ?? "";
  if (!handle || isPlaceholderUsername(handle)) return null;
  return `/u/${handle}`;
}

/** Where the signed-in account's own icon and "return to my account" go. */
export function ownAccountProfileHref(username: string | null | undefined): string {
  return principalPublicProfileHref(username) ?? "/onboarding/identity";
}
