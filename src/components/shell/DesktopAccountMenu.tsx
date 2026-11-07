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
import { placeAccountMenu } from "@/lib/shell/placeAccountMenu";
import { signOut } from "@/lib/supabase/auth";
import { layer } from "@/lib/ui/layers";

const MENU_ID = "desktop-account-menu";

function showMenu(anchor: HTMLElement, panel: HTMLElement) {
  const rect = anchor.getBoundingClientRect();
  const { left, top } = placeAccountMenu(
    { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
    { width: panel.offsetWidth, height: panel.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight },
  );
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
 * The card itself. It only mounts once the body portal has a DOM node,
 * so this layout effect always sees the panel and can un-hide it.
 * The parent used to measure before the portal existed, and the card
 * stayed `visibility: hidden`.
 */
function AccountMenuCard({
  anchorRef,
  onClose,
  username,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  username: string | null;
}) {
  const { t, locale, setLocale } = useT();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { clearActingAs } = useActingAs();
  const { heldRoles, activeRole, setRole } = useRoleMode();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const didFocus = useRef(false);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor) return;
    const panelEl = panel;
    const anchorEl = anchor;
    const place = () => showMenu(anchorEl, panelEl);
    place();
    if (!didFocus.current) {
      panelEl.focus();
      didFocus.current = true;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    function onDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelEl.contains(target) || anchorEl.contains(target)) return;
      onCloseRef.current();
    }
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [anchorRef, onClose, heldRoles, locale, activeRole]);

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
    <div
      ref={panelRef}
      id={MENU_ID}
      role="dialog"
      tabIndex={-1}
      data-account-menu
      aria-label={t("shell.switchProfile")}
      style={{ visibility: "hidden" }}
      className={`pointer-events-auto fixed w-[280px] rounded-2xl border border-zinc-200 bg-white p-4 shadow-lg outline-none ${layer.menu}`}
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
      <ShellNavLink href="/settings/billing" onClick={onClose} className={rowCls}>
        <span>{t("shell.billing")}</span>
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
  );
}

/**
 * In-page account card. Stays closed until the account row is pressed.
 * Language lives here, not in the desktop header.
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
  if (!open) return null;
  return (
    <BodyPortal>
      <AccountMenuCard anchorRef={anchorRef} onClose={onClose} username={username} />
    </BodyPortal>
  );
}

export { MENU_ID };
