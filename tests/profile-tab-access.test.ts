// Public profile tabs: the owner, and an active account delegate with
// artwork management or public-profile management, may create, rename,
// reorder, and delete them. Everyone else stays locked out, including
// after the delegation expires or is no longer active.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  canManageProfileTabs,
  delegationGrantsProfileTabManagement,
} from "../src/lib/studio/profileTabAccess";

const root = path.resolve(__dirname, "..");
const owner = "00000000-0000-4000-8000-000000000001";
const delegate = "00000000-0000-4000-8000-000000000002";
const now = new Date("2026-10-15T12:00:00.000Z");

const operations = [
  "view",
  "edit_metadata",
  "manage_works",
  "manage_artworks",
  "manage_exhibitions",
  "manage_inquiries",
  "manage_claims",
];
const content = [
  "view",
  "edit_metadata",
  "manage_works",
  "manage_artworks",
  "manage_exhibitions",
  "edit_profile_public_content",
];

assert.equal(
  canManageProfileTabs({ viewerId: owner, profileId: owner, now }),
  true,
  "the account owner can manage tabs without a delegation",
);
assert.equal(
  canManageProfileTabs({
    viewerId: delegate,
    profileId: owner,
    now,
    delegation: {
      scopeType: "account",
      status: "active",
      permissions: operations,
      expiresAt: null,
    },
  }),
  true,
  "operations (all permissions) includes manage_artworks",
);
assert.equal(
  canManageProfileTabs({
    viewerId: delegate,
    profileId: owner,
    now,
    delegation: {
      scopeType: "account",
      status: "active",
      permissions: content,
    },
  }),
  true,
  "content preset includes profile and artwork management",
);
assert.equal(
  canManageProfileTabs({
    viewerId: delegate,
    profileId: owner,
    now,
    delegation: {
      scopeType: "account",
      status: "active",
      permissions: ["view", "edit_profile_public_content"],
    },
  }),
  true,
  "profile-management permission alone can manage tabs",
);
assert.equal(
  canManageProfileTabs({ viewerId: delegate, profileId: owner, now }),
  false,
  "no delegation cannot manage another profile's tabs",
);
assert.equal(
  canManageProfileTabs({
    viewerId: delegate,
    profileId: owner,
    now,
    delegation: {
      scopeType: "account",
      status: "active",
      permissions: operations,
      expiresAt: "2026-10-15T11:59:00.000Z",
    },
  }),
  false,
  "an expires_at in the past is refused even while status is still active",
);
assert.equal(
  canManageProfileTabs({
    viewerId: delegate,
    profileId: owner,
    now,
    delegation: {
      scopeType: "account",
      status: "revoked",
      permissions: operations,
    },
  }),
  false,
  "a revoked delegation cannot manage tabs",
);
assert.equal(
  canManageProfileTabs({
    viewerId: delegate,
    profileId: owner,
    now,
    delegation: {
      scopeType: "account",
      status: "expired",
      permissions: content,
    },
  }),
  false,
  "status expired is refused",
);
assert.equal(
  canManageProfileTabs({
    viewerId: delegate,
    profileId: owner,
    now,
    delegation: {
      scopeType: "account",
      status: "active",
      permissions: ["view"],
    },
  }),
  false,
  "view-only review cannot manage tabs",
);
assert.equal(
  canManageProfileTabs({
    viewerId: delegate,
    profileId: owner,
    now,
    delegation: {
      scopeType: "account",
      status: "active",
      permissions: ["view", "manage_inquiries", "manage_claims"],
    },
  }),
  false,
  "inquiry or claim delegation is not profile tab management",
);
assert.equal(
  delegationGrantsProfileTabManagement(
    {
      scopeType: "project",
      status: "active",
      permissions: ["view", "manage_artworks"],
    },
    now,
  ),
  false,
  "project scope does not manage the account profile's tabs",
);
assert.equal(
  canManageProfileTabs({
    viewerId: delegate,
    profileId: owner,
    now,
    delegation: {
      scopeType: "account",
      status: "active",
      permissions: operations,
      expiresAt: "2026-10-16T00:00:00.000Z",
    },
  }),
  true,
  "a future expires_at still counts as active",
);

const sql = readFileSync(
  path.join(root, "supabase/migrations/20261016054717_profile_tab_delegate_manage.sql"),
  "utf8",
);
assert.match(sql, /create or replace function public\.can_manage_profile_tabs\(p_profile_id uuid\)/);
assert.match(sql, /auth\.uid\(\) = p_profile_id/);
assert.match(sql, /d\.status = 'active'::public\.delegation_status_type/);
assert.match(sql, /d\.scope_type = 'account'::public\.delegation_scope_type/);
assert.match(sql, /d\.expires_at is null or d\.expires_at > now\(\)/);
assert.match(sql, /'manage_artworks' = any \(d\.permissions\)/);
assert.match(sql, /'edit_profile_public_content' = any \(d\.permissions\)/);
assert.match(sql, /create or replace function public\.save_profile_studio_portfolio/);
assert.match(sql, /if not public\.can_manage_profile_tabs\(p_profile_id\) then/);
assert.match(sql, /'\{studio_portfolio\}'/);
assert.match(sql, /create or replace function public\.delete_profile_tab_artworks/);
assert.match(sql, /a\.artist_id = p_profile_id/);
assert.match(sql, /studio_portfolio,custom_tabs/);
assert.match(sql, /create or replace function public\.set_profile_tab_work_kinds/);
assert.match(sql, /'artwork', 'print_edition', 'art_goods', 'collected'/);
assert.equal(sql.includes("$p_link$"), false, "dollar tags stay letters only");
assert.match(sql, /-- == SECTION 1 ==/);
assert.match(sql, /-- == SECTION 4 ==/);

const profile = readFileSync(path.join(root, "src/components/UserProfileContent.tsx"), "utf8");
assert.match(profile, /canManage=\{canManageTabs\}/);
assert.match(profile, /probeCanManageProfileTabs/);
assert.equal(
  profile.includes("<ProfileTabManager\n              isOwner={isOwner}"),
  false,
  "tab controls follow canManageTabs, not the owner flag alone",
);
assert.match(profile, /viewerIsOwner=\{isOwner\}/);
assert.match(profile, /href="\/settings"/);
const manager = readFileSync(path.join(root, "src/components/profile/ProfileTabManager.tsx"), "utf8");
assert.match(manager, /persistStudioPortfolio\(next, profileId\)/);
assert.match(manager, /\{canManage && \(/);
const persist = readFileSync(path.join(root, "src/lib/studio/persistStudioPortfolio.ts"), "utf8");
assert.match(persist, /save_profile_studio_portfolio/);
const deletion = readFileSync(path.join(root, "src/lib/studio/profileTabDelete.ts"), "utf8");
assert.match(deletion, /delete_profile_tab_artworks/);
assert.match(deletion, /set_profile_tab_work_kinds/);
assert.match(deletion, /persistStudioPortfolio\(portfolio, profileId\)/);
const modal = readFileSync(
  path.join(root, "src/components/studio/StudioPortfolioManageModal.tsx"),
  "utf8",
);
assert.match(modal, /profileId,\s*\n\s*\}\);/);

const delegations = readFileSync(path.join(root, "src/lib/supabase/delegations.ts"), "utf8");
assert.match(delegations, /operations:\s*\[[\s\S]*?"manage_artworks"/);
assert.match(delegations, /content:\s*\[[\s\S]*?"edit_profile_public_content"/);
assert.match(delegations, /review:\s*\["view"\]/);

const kinds = readFileSync(path.join(root, "src/lib/studio/profileContentKind.ts"), "utf8");
assert.match(kinds, /"artwork"/);
assert.match(kinds, /"print_edition"/);
assert.match(kinds, /"art_goods"/);
assert.match(kinds, /"collected"/);
assert.match(kinds, /return kind === "artwork" \|\| kind === "print_edition"/);

console.log("profile-tab-access tests ok");
