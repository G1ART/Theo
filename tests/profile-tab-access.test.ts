// Public profile tabs: the owner may always manage them.
// A delegate may manage them only inside delegation work (acting as that
// profile) and only with artwork or public-profile management.
// Visiting the public profile, a missing delegation, and an expired or
// revoked delegation stay locked out.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  canManageProfileTabs,
  delegationGrantsProfileTabManagement,
} from "../src/lib/studio/profileTabAccess";
import {
  ownAccountProfileHref,
  principalPublicProfileHref,
} from "../src/lib/delegation/principalProfileHref";
import { profileManageGrants } from "../src/lib/studio/profileManageAccess";

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
    actingProfileId: owner,
    delegation: {
      scopeType: "account",
      status: "active",
      permissions: operations,
      expiresAt: null,
    },
  }),
  true,
  "operations (all permissions) includes manage_artworks inside delegation work",
);
assert.equal(
  canManageProfileTabs({
    viewerId: delegate,
    profileId: owner,
    now,
    actingProfileId: owner,
    delegation: {
      scopeType: "account",
      status: "active",
      permissions: content,
    },
  }),
  true,
  "content preset includes profile and artwork management inside delegation work",
);
assert.equal(
  canManageProfileTabs({
    viewerId: delegate,
    profileId: owner,
    now,
    actingProfileId: owner,
    delegation: {
      scopeType: "account",
      status: "active",
      permissions: ["view", "edit_profile_public_content"],
    },
  }),
  true,
  "profile-management permission alone can manage tabs inside delegation work",
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
    actingProfileId: owner,
    delegation: {
      scopeType: "account",
      status: "active",
      permissions: operations,
    },
  }) === true &&
    canManageProfileTabs({
      viewerId: delegate,
      profileId: owner,
      now,
      delegation: {
        scopeType: "account",
        status: "active",
        permissions: operations,
      },
    }) === false,
  true,
  "the same active delegation is refused until delegation work names that profile",
);
assert.equal(
  canManageProfileTabs({
    viewerId: delegate,
    profileId: owner,
    now,
    actingProfileId: delegate,
    delegation: {
      scopeType: "account",
      status: "active",
      permissions: operations,
    },
  }),
  false,
  "acting as your own login is not work on the delegated profile",
);
assert.equal(
  canManageProfileTabs({
    viewerId: delegate,
    profileId: owner,
    now,
    actingProfileId: owner,
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
    actingProfileId: owner,
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
    actingProfileId: owner,
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
    actingProfileId: owner,
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
    actingProfileId: owner,
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
    actingProfileId: owner,
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
  path.join(root, "supabase/migrations/20261017000000_profile_tab_delegation_work_path.sql"),
  "utf8",
);
assert.match(sql, /p_acting_profile_id uuid default null/);
assert.match(sql, /auth\.uid\(\) = p_profile_id/);
assert.match(sql, /p_acting_profile_id = p_profile_id/);
assert.match(sql, /p_acting_profile_id is distinct from auth\.uid\(\)/);
assert.match(sql, /d\.status = 'active'::public\.delegation_status_type/);
assert.match(sql, /d\.scope_type = 'account'::public\.delegation_scope_type/);
assert.match(sql, /d\.expires_at is null or d\.expires_at > now\(\)/);
assert.match(sql, /'manage_artworks' = any \(d\.permissions\)/);
assert.match(sql, /'edit_profile_public_content' = any \(d\.permissions\)/);
assert.match(sql, /create or replace function public\.save_profile_studio_portfolio/);
assert.match(sql, /if not public\.can_manage_profile_tabs\(p_profile_id, p_acting_profile_id\) then/);
assert.match(sql, /'\{studio_portfolio\}'/);
assert.match(sql, /create or replace function public\.delete_profile_tab_artworks/);
assert.match(sql, /a\.artist_id = p_profile_id/);
assert.match(sql, /studio_portfolio,custom_tabs/);
assert.match(sql, /create or replace function public\.set_profile_tab_work_kinds/);
assert.match(sql, /'artwork', 'print_edition', 'art_goods', 'collected'/);
assert.equal(sql.includes("$p_link$"), false, "dollar tags stay letters only");
assert.match(sql, /-- == SECTION 1 ==/);
assert.match(sql, /-- == SECTION 4 ==/);

assert.equal(principalPublicProfileHref("heimyunghyun"), "/u/heimyunghyun");
assert.equal(principalPublicProfileHref("g1art_founder"), "/u/g1art_founder");
assert.equal(principalPublicProfileHref("user_abc123"), null);
assert.equal(principalPublicProfileHref("  "), null);
assert.equal(ownAccountProfileHref("g1art_founder"), "/u/g1art_founder");
assert.equal(ownAccountProfileHref("heimyunghyun"), "/u/heimyunghyun");
assert.equal(ownAccountProfileHref(""), "/onboarding/identity");
assert.equal(ownAccountProfileHref("user_abc123"), "/onboarding/identity");

const profile = readFileSync(path.join(root, "src/components/UserProfileContent.tsx"), "utf8");
assert.match(profile, /canManage=\{canManageTabs\}/);
assert.match(profile, /actingProfileId=\{isOwner \? null : actingAsProfileId\}/);
assert.match(profile, /canUploadWorks/);
assert.match(profile, /showManagerChrome \? null : <ProfileActions/);
assert.equal(profile.includes("probeCanManageProfileTabs"), false);
assert.equal(profile.includes("delegatedTabManager"), false);
assert.match(profile, /const showUploadTile =[\s\S]*?canUploadWorks &&/);
assert.match(profile, /viewerIsOwner=\{isOwner\}/);
assert.match(profile, /href="\/settings"/);
const manager = readFileSync(path.join(root, "src/components/profile/ProfileTabManager.tsx"), "utf8");
assert.match(manager, /persistStudioPortfolio\(next, profileId, \{ actingProfileId \}\)/);
assert.match(manager, /\{canManage && \(/);
const persist = readFileSync(path.join(root, "src/lib/studio/persistStudioPortfolio.ts"), "utf8");
assert.match(persist, /save_profile_studio_portfolio/);
assert.match(persist, /p_acting_profile_id/);
const deletion = readFileSync(path.join(root, "src/lib/studio/profileTabDelete.ts"), "utf8");
assert.match(deletion, /delete_profile_tab_artworks/);
assert.match(deletion, /set_profile_tab_work_kinds/);
assert.match(deletion, /p_acting_profile_id: actingProfileId/);
assert.match(deletion, /persistStudioPortfolio\(portfolio, profileId, \{ actingProfileId \}\)/);
const modal = readFileSync(
  path.join(root, "src/components/studio/StudioPortfolioManageModal.tsx"),
  "utf8",
);
assert.match(modal, /actingProfileId,/);
const workspace = readFileSync(path.join(root, "src/app/my/page.tsx"), "utf8");
assert.match(workspace, /actingAsProfileId && <ActingProfileTabs profileId=\{actingAsProfileId\} \/>/);
assert.match(workspace, /workspace\.cta\.publicProfile/);
const actingTabs = readFileSync(
  path.join(root, "src/components/studio/ActingProfileTabs.tsx"),
  "utf8",
);
assert.match(actingTabs, /probeCanManageProfileTabs\(profileId, profileId\)/);
assert.match(actingTabs, /actingProfileId=\{profileId\}/);
const switcher = readFileSync(
  path.join(root, "src/components/shell/AccountSwitcher.tsx"),
  "utf8",
);
assert.match(switcher, /principalPublicProfileHref\(p\.username\)/);
assert.match(switcher, /ownAccountProfileHref\(username\)/);
assert.match(switcher, /function switchToOwn\(\) \{[\s\S]*?ownAccountProfileHref\(username\)/);
const header = readFileSync(path.join(root, "src/components/Header.tsx"), "utf8");
assert.match(header, /ownAccountProfileHref\(profileUsername\)/);
assert.match(
  header,
  /function handleSwitchToOperator\(\) \{[\s\S]*?ownAccountProfileHref\(profileUsername\)/,
);
const artworksSrc = readFileSync(path.join(root, "src/lib/supabase/artworks.ts"), "utf8");
assert.match(artworksSrc, /const PROFILE_ARTWORK_PAGE = 500/);
assert.match(artworksSrc, /const PROFILE_ARTWORK_MAX = 5000/);
assert.match(
  artworksSrc,
  /for \(let from = 0; from < PROFILE_ARTWORK_MAX; from \+= PROFILE_ARTWORK_PAGE\)/,
);
assert.match(artworksSrc, /if \(page\.length < PROFILE_ARTWORK_PAGE\) break/);
const presetSql = readFileSync(
  path.join(root, "supabase/migrations/20261017153000_operations_preset_profile_edit.sql"),
  "utf8",
);
assert.match(presetSql, /when 'operations' then array\[[\s\S]*'edit_profile_public_content'/);
assert.equal(presetSql.includes("$p_link$"), false);

const delegations = readFileSync(path.join(root, "src/lib/supabase/delegations.ts"), "utf8");
assert.match(delegations, /operations:\s*\[[\s\S]*?"manage_artworks"/);
assert.match(delegations, /operations:\s*\[[\s\S]*?"edit_profile_public_content"/);
assert.match(delegations, /content:\s*\[[\s\S]*?"edit_profile_public_content"/);
assert.match(delegations, /review:\s*\["view"\]/);

const kinds = readFileSync(path.join(root, "src/lib/studio/profileContentKind.ts"), "utf8");
assert.match(kinds, /"artwork"/);
assert.match(kinds, /"print_edition"/);
assert.match(kinds, /"art_goods"/);
assert.match(kinds, /"collected"/);
assert.match(kinds, /return kind === "artwork" \|\| kind === "print_edition"/);

const fullOps = {
  scopeType: "account",
  status: "active",
  permissions: [...operations, "edit_profile_public_content"],
};
assert.deepEqual(
  profileManageGrants({
    viewerId: delegate,
    profileId: owner,
    now,
    delegation: fullOps,
  }),
  {
    editPublicProfile: false,
    manageTabs: false,
    manageArtworks: false,
    manageExhibitions: false,
  },
  "a delegation without acting-as stays a visitor",
);
assert.equal(
  profileManageGrants({
    viewerId: delegate,
    profileId: owner,
    now,
    actingProfileId: owner,
    delegation: fullOps,
  }).editPublicProfile,
  true,
  "acting-as with public-profile permission can edit the profile",
);
assert.equal(
  profileManageGrants({
    viewerId: delegate,
    profileId: owner,
    now,
    actingProfileId: owner,
    delegation: {
      scopeType: "account",
      status: "active",
      permissions: ["view", "manage_artworks"],
    },
  }).editPublicProfile,
  false,
  "artwork management alone does not edit cover, bio, statement, or CV",
);
assert.equal(
  profileManageGrants({
    viewerId: delegate,
    profileId: owner,
    now,
    actingProfileId: owner,
    delegation: {
      scopeType: "account",
      status: "active",
      permissions: ["view", "manage_artworks"],
    },
  }).manageArtworks,
  true,
);
assert.equal(
  profileManageGrants({
    viewerId: delegate,
    profileId: owner,
    now,
    actingProfileId: owner,
    delegation: {
      scopeType: "account",
      status: "expired",
      permissions: fullOps.permissions,
    },
  }).manageTabs,
  false,
  "an expired delegation does not open owner controls",
);
assert.equal(
  profileManageGrants({ viewerId: owner, profileId: owner, now }).editPublicProfile,
  true,
  "the account owner keeps every public-profile control",
);

const sqlEdit = readFileSync(
  path.join(root, "supabase/migrations/20261017140000_acting_public_profile_edit.sql"),
  "utf8",
);
assert.match(sqlEdit, /has_acting_profile_perm/);
assert.match(sqlEdit, /save_acting_public_profile/);
assert.match(sqlEdit, /save_acting_profile_cv/);
assert.match(sqlEdit, /save_profile_artwork_order/);
assert.match(sqlEdit, /'edit_profile_public_content'/);
assert.match(sqlEdit, /-- == SECTION 1 ==/);
assert.match(sqlEdit, /-- == SECTION 7 ==/);
assert.equal(sqlEdit.includes("$p_link$"), false);

console.log("profile-tab-access tests ok");
