/**
 * Edit and delete are the same people: the artist, the uploader,
 * and an acting-as principal only when artwork management was granted.
 * A curation claim is not enough. The detail page, profile grid,
 * library, and feed card use that predicate, and the claim menu
 * still does not delete the work.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { canDeleteArtwork, canManageArtwork } from "../src/lib/artworks/claimMenu";
import {
  actingProfileMayManageArtworks,
  artworkManageActorIds,
} from "../src/lib/artworks/manageAccess";

const root = path.resolve(__dirname, "..");
const artist = "artist-sol";
const uploader = "uploader-gallery";
const curator = "curator-only";
const stranger = "stranger";
const delegate = "delegate-ops";

const artwork = {
  id: "af761579-7913-46f8-9f79-f34a2bb38e02",
  artist_id: artist,
  created_by: uploader,
  claims: [
    {
      id: "claim-curated",
      claim_type: "CURATED",
      subject_profile_id: curator,
      status: "confirmed",
    },
  ],
};

assert.equal(canManageArtwork(artwork, artist), true);
assert.equal(canDeleteArtwork(artwork, artist), true);
assert.equal(canManageArtwork(artwork, uploader), true);
assert.equal(canDeleteArtwork(artwork, uploader), true);
assert.equal(canManageArtwork(artwork, curator), false);
assert.equal(canDeleteArtwork(artwork, curator), false);
assert.equal(canManageArtwork(artwork, stranger), false);
assert.equal(canManageArtwork(artwork, null), false);
assert.equal(canManageArtwork({ artist_id: artist, created_by: null }, artist), true);
assert.equal(canManageArtwork({ artist_id: artist, created_by: null }, uploader), false);

const now = Date.parse("2026-10-24T12:00:00Z");
const activeAccount = {
  delegator_profile_id: uploader,
  scope_type: "account",
  status: "active",
  permissions: ["manage_artworks"],
  expires_at: null,
};
assert.equal(actingProfileMayManageArtworks([activeAccount], uploader, now), true);
assert.equal(
  actingProfileMayManageArtworks(
    [{ ...activeAccount, permissions: ["view"] }],
    uploader,
    now,
  ),
  false,
);
assert.equal(
  actingProfileMayManageArtworks(
    [{ ...activeAccount, scope_type: "project", permissions: ["manage_works"] }],
    uploader,
    now,
  ),
  true,
);
assert.equal(
  actingProfileMayManageArtworks(
    [{ ...activeAccount, status: "revoked" }],
    uploader,
    now,
  ),
  false,
);
assert.deepEqual(
  artworkManageActorIds({
    sessionUserId: delegate,
    actingAsProfileId: uploader,
    actingMayManage: true,
  }),
  [uploader, delegate],
);
assert.deepEqual(
  artworkManageActorIds({
    sessionUserId: delegate,
    actingAsProfileId: uploader,
    actingMayManage: false,
  }),
  [delegate],
);
assert.equal(canManageArtwork(artwork, [uploader, delegate]), true);
assert.equal(canManageArtwork(artwork, [delegate]), false);

const page = readFileSync(path.join(root, "src/app/artwork/[id]/page.tsx"), "utf8");
assert.match(page, /canManageArtwork\(artwork, manageIds\)/);
assert.match(page, /artworkDeleteNavigation/);
assert.match(page, /setShowDeleteConfirm\(true\)/);
const claimMenu = page.slice(
  page.indexOf("{canRequestClaim && ("),
  page.indexOf("{isOwner && pendingClaims.length > 0 && ("),
);
assert.equal(claimMenu.includes("common.delete"), false);
assert.equal(claimMenu.includes("deleteArtworkCascade"), false);

const profile = readFileSync(
  path.join(root, "src/components/UserProfileContent.tsx"),
  "utf8",
);
assert.match(profile, /showDelete=/);
assert.match(profile, /canManageArtwork\(artwork, profile\.id\)/);
assert.match(profile, /deleteArtworkCascade/);
assert.equal(profile.includes("canEditArtwork"), false);

const library = readFileSync(path.join(root, "src/app/my/library/page.tsx"), "utf8");
assert.match(library, /showDelete=\{!selectMode && rowManageable\(a\)\}/);
assert.match(library, /canManageArtwork/);

const feed = readFileSync(path.join(root, "src/components/FeedArtworkCard.tsx"), "utf8");
assert.match(feed, /ArtworkManageActions/);
assert.equal(feed.includes("canEditArtwork"), false);

const edit = readFileSync(path.join(root, "src/lib/supabase/artworks.ts"), "utf8");
const canEditFn = edit.slice(
  edit.indexOf("export function canEditArtwork"),
  edit.indexOf("export function canDeleteArtwork"),
);
assert.match(canEditFn, /canManageArtwork/);
assert.equal(canEditFn.includes("claims"), false);
const cascade = edit.slice(
  edit.indexOf("export async function deleteArtworkCascade"),
  edit.indexOf("const CONCURRENCY"),
);
assert.match(cascade, /canDeleteArtwork/);
assert.equal(cascade.includes('.from("artwork_images")\n    .delete()'), false);

const exhibition = readFileSync(
  path.join(root, "src/app/my/exhibitions/[id]/page.tsx"),
  "utf8",
);
assert.match(exhibition, /removeWorkFromExhibition/);
assert.match(exhibition, /exhibition\.removeFromExhibition/);
assert.equal(exhibition.includes("deleteArtworkCascade"), false);

const migrations = readdirSync(path.join(root, "supabase/migrations"));
const sqlName = migrations.find((name) => name.includes("artwork_manage_same_people"));
assert.ok(sqlName, "migration file");
const sql = readFileSync(path.join(root, "supabase/migrations", sqlName!), "utf8");
assert.match(sql, /function public\.artwork_manage_allowed/);
assert.match(sql, /\$manage\$/);
assert.equal(sql.includes("subject_profile_id"), false);
assert.match(sql, /has_active_account_delegate_perm\(p_created_by, 'manage_artworks'\)/);
assert.match(sql, /artworks_select_artwork_manager/);
const imageGuard = readFileSync(
  path.join(root, "supabase/migrations/20261022043926_public_artwork_requires_image.sql"),
  "utf8",
);
assert.match(imageGuard, /public_artwork_requires_image/);

console.log("artwork-manage-access.test.ts: ok");
