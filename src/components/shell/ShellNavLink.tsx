"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
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
