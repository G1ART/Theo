"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import {
  classifyFeedAnchor,
  discardFeedSessionForHref,
  isPlainPrimaryClick,
} from "@/lib/feed/scrollRestore";
import { disarmListScrollReturn, isListScrollPath } from "@/lib/list/scrollRestore";
import { onUploadLeaveClick } from "@/lib/shell/leaveUploadNav";

/**
 * Next `<Link>` that hard-leaves `/upload*` so a hung RSC cannot
 * freeze 둘러보기 / 메시지 / 설정. Upload sub-tabs stay client-side.
 */
export function ShellNavLink({
  href,
  onClick,
  ...props
}: ComponentProps<typeof Link>) {
  const pathname = usePathname() ?? "";
  return (
    <Link
      href={href}
      onClick={(event) => {
        if (
          typeof href === "string" &&
          isPlainPrimaryClick(event) &&
          classifyFeedAnchor(href) === "open-feed"
        ) {
          discardFeedSessionForHref(href);
        }
        if (
          typeof href === "string" &&
          isPlainPrimaryClick(event) &&
          isListScrollPath(href)
        ) {
          // Opening a list from navigation is a new entry, so it starts at the top.
          disarmListScrollReturn();
        }
        if (
          typeof href === "string" &&
          onUploadLeaveClick(pathname, href, event)
        ) {
          return;
        }
        onClick?.(event);
      }}
      {...props}
    />
  );
}
