import { ownAccountProfileHref } from "@/lib/delegation/principalProfileHref";
import { leaveUploadOrAssign } from "@/lib/shell/leaveUploadNav";

type ReturnRouter = { push: (href: string) => void; refresh: () => void };

/**
 * Leave acting-as and open the signed-in account's own public profile.
 * The banner, every account switcher row, and resigning the delegation
 * in use all go through here so they cannot drift. Off `/upload*` this
 * is a full page load (see leaveUploadNav).
 */
export function returnToOwnAccount(input: {
  username: string | null | undefined;
  pathname: string;
  clearActingAs: () => void;
  router: ReturnRouter;
}): string {
  input.clearActingAs();
  const href = ownAccountProfileHref(input.username);
  if (leaveUploadOrAssign(input.pathname, href)) return href;
  input.router.push(href);
  input.router.refresh();
  return href;
}
