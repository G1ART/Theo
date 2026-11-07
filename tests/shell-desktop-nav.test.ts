// Desktop left nav follows the wire. The hamburger keeps its own list.
// Role mode is a browser view and does not write the account type.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { messages } from "../src/lib/i18n/messages";
import {
  bulletinHasUnread,
  BULLETIN_SEEN_KEY,
} from "../src/lib/shell/bulletinSeen";
import {
  dashboardTileVisible,
  heldShellRoles,
  resolveActiveShellRole,
  roleModeStorageKey,
  writeStoredShellRole,
  shellRoleProfileLabel,
} from "../src/lib/shell/roleMode";
import { placeAccountMenu } from "../src/lib/shell/placeAccountMenu";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const sidebar = read("src/components/shell/AppSidebar.tsx");
const header = read("src/components/Header.tsx");
const menu = read("src/components/shell/DesktopAccountMenu.tsx");
const roleMode = read("src/lib/shell/roleMode.ts");
const roleContext = read("src/context/RoleModeContext.tsx");
const navConfig = read("src/lib/shell/navConfig.ts");

const order = [...sidebar.matchAll(/data-side-item="([^"]+)"|renderRow\("([^"]+)"\)/g)].map(
  (match) => match[1] || match[2],
);
assert.deepEqual(order, [
  "logo",
  "upload",
  "network",
  "bulletin",
  "messages",
  "notifications",
  "dashboard",
  "selections",
]);

assert.match(sidebar, /MY THEO/);
assert.match(sidebar, /href=\{feedHomeHref\(loggedIn\)\}/);
assert.match(sidebar, /loginUrlWithNext\(\{ nextPath: pathname \|\| null \}\)/);
assert.equal(sidebar.includes('href="/login"'), false);
assert.equal(sidebar.includes("nav.explore"), false);
assert.equal(sidebar.includes("/my/delegations"), false);
assert.equal(sidebar.includes("AccountSwitcher"), false);
assert.equal(sidebar.includes("<select"), false);
assert.equal(sidebar.includes("PRIMARY_NAV"), false);
assert.match(sidebar, /hrefFor\("\/upload", true\)/);
const uploadBlock = sidebar.slice(
  sidebar.indexOf('data-side-item="upload"'),
  sidebar.indexOf('renderRow("network")'),
);
assert.equal(/aria-haspopup|dropdown|<select/i.test(uploadBlock), false);

assert.match(header, /SECONDARY_NAV/);
assert.match(header, /AccountSwitcher/);
assert.match(header, /MobileMenuSheet/);
assert.equal(header.includes("PRIMARY_NAV"), false);
assert.match(navConfig, /key: "explore"/);
assert.match(navConfig, /key: "delegations"/);
assert.equal(menu.includes("updateMyProfile"), false);
assert.equal(menu.includes("saveProfileUnified"), false);
assert.equal(roleMode.includes("updateMyProfile"), false);
assert.equal(roleMode.includes("saveProfileUnified"), false);
assert.equal(roleContext.includes("updateMyProfile"), false);
assert.equal(roleContext.includes("saveProfileUnified"), false);
assert.equal(roleContext.includes(".update("), false);
assert.match(roleContext, /select\("main_role, roles"\)/);
assert.match(menu, /heldRoles\.map/);
assert.match(menu, /function AccountMenuCard/);
assert.match(menu, /data-account-menu/);
assert.match(menu, /showMenu\(anchorEl, panelEl\)/);
assert.match(menu, /panelEl\.focus\(\)/);
assert.match(menu, /event\.key === "Escape"/);
assert.match(menu, /setLocale\("en"\)/);
assert.match(menu, /setLocale\("ko"\)/);
assert.match(menu, /shell\.switchProfile/);
assert.match(menu, /shell\.viewPublicProfile/);
assert.match(menu, /shell\.settings/);
assert.match(menu, /nav\.logout/);
assert.match(menu, /href="\/settings"/);
assert.equal(menu.includes("router.push"), false);
const cardStart = menu.indexOf("function AccountMenuCard");
const cardEnd = menu.indexOf("export function DesktopAccountMenu");
const card = menu.slice(cardStart, cardEnd);
assert.ok(card.includes("ref={panelRef}"));
assert.ok(card.includes("useLayoutEffect"));
assert.match(sidebar, /data-side-account/);
assert.match(sidebar, /setMenuOpen\(\(open\) => !open\)/);
assert.match(sidebar, /aria-controls=\{MENU_ID\}/);
const accountBlock = sidebar.slice(
  sidebar.indexOf("data-side-account"),
  sidebar.indexOf("<DesktopAccountMenu"),
);
assert.equal(accountBlock.includes("href="), false);
const mobile = read("src/components/shell/MobileMenuSheet.tsx");
const mobileOrder = [
  ...mobile.matchAll(/data-mobile-item="upload"|renderRow\("([^"]+)"\)/g),
].map((match) => match[1] || "upload");
assert.deepEqual(mobileOrder, [
  "upload",
  "network",
  "bulletin",
  "messages",
  "notifications",
  "dashboard",
  "selections",
]);
assert.match(mobile, /MY THEO/);
assert.match(mobile, /data-mobile-account/);
assert.match(mobile, /data-mobile-account-panel/);
assert.match(mobile, /setAccountOpen\(\(open\) => !open\)/);
assert.match(mobile, /setLocale\("ko"\)/);
assert.match(mobile, /한국어/);
assert.equal(mobile.includes("nav.explore"), false);
assert.equal(mobile.includes("nav.saved"), false);
assert.equal(mobile.includes("/my/delegations"), false);
assert.equal(mobile.includes("<select"), false);
assert.equal(mobile.includes("DesktopAccountMenu"), false);
assert.match(sidebar, /DesktopAccountMenu/);
assert.equal(sidebar.includes("MobileMenuSheet"), false);

const beside = placeAccountMenu(
  { left: 24, right: 200, top: 700, bottom: 748 },
  { width: 280, height: 320 },
  { width: 1440, height: 900 },
);
assert.equal(beside.left, 208);
assert.equal(beside.top, 428);
const flipped = placeAccountMenu(
  { left: 1200, right: 1400, top: 700, bottom: 748 },
  { width: 280, height: 200 },
  { width: 1440, height: 900 },
);
assert.equal(flipped.left, 912);
assert.equal(flipped.top, 548);

assert.equal(messages.en["shell.nav.dashboard"], "Dashboard");
assert.equal(messages.ko["shell.nav.dashboard"], "대시보드");
assert.equal(messages.en["shell.nav.selections"], "Selections");
assert.equal(messages.ko["shell.nav.selections"], "셀렉션");
assert.equal(messages.en["shell.nav.bulletin"], "Theo Bulletin");
assert.equal(messages.ko["shell.nav.bulletin"], "Theo 게시판");
assert.equal(messages.en["shell.switchProfile"], "SWITCH PROFILE");
assert.equal(messages.ko["shell.switchProfile"], "프로필 전환");
assert.equal(messages.en["shell.viewPublicProfile"], "View public profile");
assert.equal(messages.ko["shell.viewPublicProfile"], "공개프로필 보기");
assert.equal(messages.en["shell.role.gallery"], "Gallery");
assert.equal(messages.ko["shell.role.gallery"], "갤러리");
assert.equal(messages.en["workspace.hub.title"], "Dashboard");
assert.equal(messages.ko["workspace.hub.title"], "대시보드");
assert.equal(messages.en["boards.title"], "Selections");
assert.equal(messages.ko["boards.title"], "셀렉션");
assert.equal(messages.en["theoBoard.title"], "Theo Bulletin");
assert.equal(messages.ko["theoBoard.title"], "Theo 게시판");
assert.equal(messages.en["rail.theoBoard.title"], "Theo Bulletin");
assert.equal(messages.ko["rail.theoBoard.title"], "Theo 게시판");
assert.equal(messages.en["nav.workspace"], "Workspace");
assert.equal(messages.ko["nav.workspace"], "워크스페이스");
assert.equal(messages.en["nav.saved"], "Saved");
assert.equal(messages.ko["nav.saved"], "저장");
assert.equal(messages.en["nav.theoBoard"], "Board");
assert.equal(messages.ko["nav.theoBoard"], "보드");
assert.equal(messages.en["nav.upload"], "Upload");
assert.equal(messages.ko["nav.upload"], "업로드");

assert.deepEqual(
  heldShellRoles({ main_role: "gallerist", roles: ["artist", "gallerist"] }),
  ["artist", "gallery"],
);
assert.deepEqual(heldShellRoles({ main_role: "collector", roles: ["collector"] }), ["collector"]);
assert.deepEqual(
  heldShellRoles({ main_role: "artist", roles: ["curator", "nope"] }),
  ["artist", "curator"],
);
assert.deepEqual(heldShellRoles({ main_role: null, roles: [] }), []);
assert.equal(
  resolveActiveShellRole(["artist", "collector"] as const, "collector", "artist"),
  "collector",
);
assert.equal(resolveActiveShellRole(["artist"] as const, "gallery", "artist"), "artist");
assert.equal(resolveActiveShellRole(["artist", "curator"] as const, null, "curator"), "curator");
const both = heldShellRoles({ main_role: null, roles: ["gallerist", "artist"] });
assert.deepEqual(both, ["artist", "gallery"]);
assert.equal(resolveActiveShellRole(both, null, null), "artist");
assert.equal(resolveActiveShellRole([] as const, "artist", "artist"), null);

assert.equal(dashboardTileVisible("artist", "drafts"), true);
assert.equal(dashboardTileVisible("collector", "drafts"), false);
assert.equal(dashboardTileVisible("collector", "ownership"), true);
assert.equal(dashboardTileVisible("curator", "inquiries"), false);
assert.equal(dashboardTileVisible("gallery", "my_exhibitions"), true);
assert.equal(dashboardTileVisible("gallery", "ownership"), false);
assert.equal(dashboardTileVisible(null, "drafts"), true);

assert.equal(bulletinHasUnread(null, null), false);
assert.equal(bulletinHasUnread("2026-01-02T00:00:00Z", null), true);
assert.equal(bulletinHasUnread("2026-01-02T00:00:00Z", "2026-01-02T00:00:00Z"), false);
assert.equal(bulletinHasUnread("2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z"), true);
assert.equal(bulletinHasUnread("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"), false);

const store = new Map<string, string>();
const previousWindow = (globalThis as { window?: unknown }).window;
const previousStorage = (globalThis as { localStorage?: unknown }).localStorage;
Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  },
  configurable: true,
});
try {
  writeStoredShellRole("user-1", "curator");
  assert.deepEqual([...store.keys()], [roleModeStorageKey("user-1")]);
  assert.equal(store.get(roleModeStorageKey("user-1")), "curator");
  assert.equal(store.has(BULLETIN_SEEN_KEY), false);
} finally {
  if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else Object.defineProperty(globalThis, "window", { value: previousWindow, configurable: true });
  if (previousStorage === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
  else Object.defineProperty(globalThis, "localStorage", { value: previousStorage, configurable: true });
}

assert.equal(
  shellRoleProfileLabel("artist", (key) =>
    key === "shell.roleProfile" ? "{role} 프로필" : key === "shell.role.artist" ? "아티스트" : key,
  ),
  "아티스트 프로필",
);

const my = read("src/app/my/page.tsx");
assert.match(my, /dashboardTileVisible\(viewRole, tile\.key\)/);
assert.match(my, /data-role-mode=\{viewRole \?\? "none"\}/);
const settings = read("src/app/settings/page.tsx");
assert.match(settings, /href="\/my\/delegations"/);
const shortlists = read("src/app/my/shortlists/page.tsx");
assert.match(shortlists, /data-role-mode=\{viewRole \?\? "none"\}/);
assert.match(shortlists, /shell\.selections\.lead/);

console.log("shell-desktop-nav.test.ts: ok");
