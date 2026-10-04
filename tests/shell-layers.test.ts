/**
 * Shell stacking scale.
 *
 * The center column clips overflow and owns the content layer, so a
 * fixed overlay inside a page cannot cover the sidebar or the right
 * rail. Full-viewport layers portal out and use this scale. A badge
 * stays under chrome, so a dot on a dimmed sidebar stays dimmed.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { layer, layerLevel, type LayerName } from "../src/lib/ui/layers";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const ORDER: LayerName[] = [
  "content",
  "badge",
  "chrome",
  "stickyBar",
  "mobileNavScrim",
  "menu",
  "scrim",
  "dialog",
  "toast",
];

for (let i = 1; i < ORDER.length; i++) {
  const lower = ORDER[i - 1];
  const higher = ORDER[i];
  assert.ok(
    layerLevel(higher) > layerLevel(lower),
    `${higher} (${layer[higher]}) must sit above ${lower} (${layer[lower]})`,
  );
}

assert.equal(layer.chrome, "z-30");
assert.equal(layer.stickyBar, "z-40");
assert.equal(layer.badge, "z-10");
assert.equal(layer.scrim, "z-[80]", "enhance dialog spells this class literally");

const shell = read("src/components/shell/AppShell.tsx");
assert.match(shell, /layer\.chrome/);
assert.match(shell, /layer\.content/);
assert.match(shell, /overflow-x-clip/);
assert.match(shell, /pointer-events-auto/);

const stage = read("src/components/artwork/ArtworkImageStage.tsx");
assert.match(stage, /<BodyPortal>/);
assert.match(stage, /layer\.scrim/);
assert.equal(/fixed inset-0 z-50/.test(stage), false);

const header = read("src/components/Header.tsx");
assert.match(header, /layer\.badge/);
assert.match(header, /mobileOpen \? layer\.menu : layer\.stickyBar/);
assert.match(header, /layer\.mobileNavScrim/);
assert.equal(
  /absolute -right-1 -top-1 z-10/.test(header),
  false,
  "unread dots use the badge layer, not a raw z-index",
);

const drawer = read("src/components/notifications/NotificationsDrawer.tsx");
assert.match(drawer, /layer\.menu/);
assert.match(drawer, /layer\.stickyBar/);
assert.equal(/layer\.(scrim|dialog|toast)/.test(drawer), false);

const enhance = read("src/components/upload/BulkEnhanceDialog.tsx");
assert.match(enhance, /createPortal\(/);
assert.match(enhance, /document\.body/);
assert.match(enhance, /z-\[80\]/);

const portaledScrims = [
  "src/components/ds/ConfirmActionDialog.tsx",
  "src/components/upload/BulkGroupDialog.tsx",
  "src/components/auth/EmailConfirmWait.tsx",
  "src/components/delegation/DelegationDetailDrawer.tsx",
  "src/components/delegation/CreateDelegationWizard.tsx",
  "src/components/delegation/UpdatePermissionsModal.tsx",
  "src/components/delegation/RequestPermissionChangeModal.tsx",
  "src/components/visibility/AccessRequestModal.tsx",
  "src/components/SaveToShortlistModal.tsx",
  "src/components/artists/UnonboardedArtistInterestPopover.tsx",
  "src/components/network/RelationshipDeskPanel.tsx",
  "src/components/studio/StudioPortfolioManageModal.tsx",
  "src/components/studio/StudioPortfolioPanel.tsx",
  "src/components/profile/ProfileSurfaceCards.tsx",
  "src/components/simulation/ArtworkPickerSheet.tsx",
  "src/components/simulation/CreateSpaceDialog.tsx",
  "src/components/simulation/SeeInMySpaceCta.tsx",
  "src/components/simulation/SpaceEditor.tsx",
  "src/app/upload/bulk/page.tsx",
  "src/app/my/orphan-invites/page.tsx",
];

for (const rel of portaledScrims) {
  const src = read(rel);
  assert.match(src, /<BodyPortal>/, rel);
  assert.match(src, /layer\.scrim/, rel);
  assert.equal(/fixed inset-0 z-(40|50|\[60\])/.test(src), false, rel);
}

console.log("shell-layers.test.ts: ok");
