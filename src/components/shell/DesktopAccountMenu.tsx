"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ShellNavLink } from "@/components/shell/ShellNavLink";
import { BodyPortal } from "@/components/ui/BodyPortal";
import { useActingAs } from "@/context/ActingAsContext";
import { useRoleMode } from "@/context/RoleModeContext";
import { ownAccountProfileHref } from "@/lib/delegation/principalProfileHref";
import { useT } from "@/lib/i18n/useT";
import { leaveUploadOrAssign } from "@/lib/shell/leaveUploadNav";
import { signOut } from "@/lib/supabase/auth";
import { layer } from "@/lib/ui/layers";

function placeMenu(anchor: HTMLElement, panel: HTMLElement) {
  const margin = 8;
  const rect = anchor.getBoundingClientRect();
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  let left = rect.right + margin;
  if (left + width > window.innerWidth - margin) {
    left = Math.max(margin, rect.left - width - margin);
  }
  let top = rect.bottom - height;
  if (top < margin) top = margin;
  if (top + height > window.innerHeight - margin) {
    top = Math.max(margin, window.innerHeight - height - margin);
  }
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.visibility = "visible";
}

function ExternalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 17 17 7M9 7h8v8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="m9 6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Secondary account card for the desktop sidebar. Role pills change
 * the shell view. They do not write the account's roles.
 */
export function DesktopAccountMenu({
  open,
  onClose,
  anchorRef,
  username,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLButtonElement | null>;
  username: string | null;
}) {
  const { t, locale, setLocale } = useT();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { clearActingAs } = useActingAs();
  const { heldRoles, activeRole, setRole } = useRoleMode();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    if (!open) return;
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const anchorEl = anchor;
    const panelEl = panel;
    function place() {
      placeMenu(anchorEl, panelEl);
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    function onDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelEl.contains(target)) return;
      if (anchorEl.contains(target)) return;
      onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, anchorRef, heldRoles, locale, activeRole, onClose]);

  if (!open) return null;

  const profileHref = ownAccountProfileHref(username);

  async function handleLogout() {
    onClose();
    clearActingAs();
    await signOut();
    if (leaveUploadOrAssign(pathname, "/login")) return;
    router.replace("/login");
  }

  const rowCls =
    "flex w-full items-center justify-between gap-3 rounded-md py-1.5 text-left text-sm text-zinc-800 hover:text-zinc-950";

  return (
    <BodyPortal>
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t("shell.switchProfile")}
        style={{ visibility: "hidden" }}
        className={`fixed w-[280px] rounded-2xl border border-zinc-200 bg-white p-4 shadow-lg ${layer.menu}`}
      >
        {heldRoles.length > 0 && (
          <div className="mb-3">
            <p className="text-[11px] font-medium tracking-wide text-zinc-500">
              {t("shell.switchProfile")}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {heldRoles.map((role) => {
                const selected = activeRole === role;
                return (
                  <button
                    key={role}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setRole(role)}
                    className={`rounded-full px-3 py-1 text-xs ${
                      selected
                        ? "bg-zinc-900 font-medium text-white"
                        : "border border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400"
                    }`}
                  >
                    {t(`shell.role.${role}`)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <ShellNavLink href={profileHref} onClick={onClose} className={rowCls}>
          <span>{t("shell.viewPublicProfile")}</span>
          <ExternalIcon />
        </ShellNavLink>
        <ShellNavLink href="/settings" onClick={onClose} className={rowCls}>
          <span>{t("shell.settings")}</span>
          <ChevronRight />
        </ShellNavLink>

        <div className="mt-1 flex items-center justify-between gap-3 py-1.5">
          <span className="text-sm text-zinc-800">{t("shell.language")}</span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setLocale("en")}
              className={`rounded-full px-2.5 py-0.5 text-xs ${
                locale === "en"
                  ? "bg-zinc-900 font-medium text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => setLocale("ko")}
              className={`rounded-full px-2.5 py-0.5 text-xs ${
                locale.startsWith("ko")
                  ? "bg-zinc-900 font-medium text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
            >
              한국어
            </button>
          </span>
        </div>

        <button
          type="button"
          onClick={() => void handleLogout()}
          className="mt-2 text-left text-sm text-zinc-800 hover:text-zinc-950"
        >
          {t("nav.logout")}
        </button>
      </div>
    </BodyPortal>
  );
}
