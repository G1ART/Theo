import { listReturnLinkProps } from "@/lib/list/scrollRestore";
import { profileReturnLinkProps } from "@/lib/profile/scrollRestore";

/**
 * Back link onto a profile or a list. Next must not scroll that page to
 * the top; the page reapplies the scroll saved on the way out.
 */
export function entryReturnLinkProps(href: string): { scroll?: false; onClick?: () => void } {
  const profile = profileReturnLinkProps(href);
  const list = listReturnLinkProps(href);
  if (!profile.onClick && !list.onClick) return {};
  return {
    scroll: false,
    onClick: () => {
      profile.onClick?.();
      list.onClick?.();
    },
  };
}
