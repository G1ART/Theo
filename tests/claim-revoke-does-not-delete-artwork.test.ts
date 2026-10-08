/**
 * A relationship claim is not permission to delete the work.
 * Revoking a pending or approved claim removes that claim only.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  canDeleteArtwork,
  relationshipClaimsForActor,
  revokeRelationshipClaim,
} from "../src/lib/artworks/claimMenu";

const root = path.resolve(__dirname, "..");
const artist = "artist-sol";
const uploader = "uploader-gallery";
const lea = "lea";
const stranger = "stranger";

const artwork = {
  id: "af761579-7913-46f8-9f79-f34a2bb38e02",
  artist_id: artist,
  created_by: uploader,
};

function claim(
  status: "pending" | "confirmed",
  type = "OWNS",
  subject = lea,
) {
  return {
    id: `claim-${type}-${status}-${subject}`,
    claim_type: type,
    subject_profile_id: subject,
    status,
  };
}

const pendingOwns = claim("pending", "OWNS");
const approvedOwns = claim("confirmed", "OWNS");
const approvedCurated = claim("confirmed", "CURATED");
const approvedExhibited = claim("confirmed", "EXHIBITED");
const approvedInventory = claim("confirmed", "INVENTORY");
const created = claim("confirmed", "CREATED", uploader);

for (const row of [pendingOwns, approvedOwns, approvedCurated, approvedExhibited, approvedInventory]) {
  const withClaim = { ...artwork, claims: [row] };
  assert.equal(
    canDeleteArtwork(withClaim, lea),
    false,
    `${row.status} ${row.claim_type} claimant must not delete`,
  );
}
assert.equal(canDeleteArtwork(artwork, stranger), false);
assert.equal(canDeleteArtwork(artwork, null), false);
const artistStillDeletes = { ...artwork, claims: [pendingOwns] };
const uploaderStillDeletes = { ...artwork, claims: [approvedOwns] };
const claimantIsArtist = { ...artwork, artist_id: lea, claims: [approvedOwns] };
assert.equal(canDeleteArtwork(artistStillDeletes, artist), true);
assert.equal(canDeleteArtwork(uploaderStillDeletes, uploader), true);
assert.equal(canDeleteArtwork(claimantIsArtist, lea), true);

const pendingRevoke = revokeRelationshipClaim({
  artwork,
  claims: [pendingOwns, created],
  claimId: pendingOwns.id,
  actorId: lea,
});
assert.equal(pendingRevoke.artworkDeleted, false);
assert.equal(pendingRevoke.artwork, artwork);
assert.equal(pendingRevoke.artwork.id, artwork.id);
assert.equal(pendingRevoke.claims.some((row) => row.id === pendingOwns.id), false);
assert.deepEqual(pendingRevoke.claims.map((row) => row.id), [created.id]);

for (const row of [approvedOwns, approvedCurated, approvedExhibited, approvedInventory]) {
  const revoked = revokeRelationshipClaim({
    artwork,
    claims: [row],
    claimId: row.id,
    actorId: lea,
  });
  assert.equal(revoked.artworkDeleted, false);
  assert.equal(revoked.artwork.id, artwork.id);
  assert.equal(revoked.claims.length, 0, `${row.claim_type} revoke removes the claim only`);
}

const notMine = revokeRelationshipClaim({
  artwork,
  claims: [pendingOwns],
  claimId: pendingOwns.id,
  actorId: stranger,
});
assert.equal(notMine.artworkDeleted, false);
assert.equal(notMine.claims.length, 1);

const authorship = revokeRelationshipClaim({
  artwork,
  claims: [created],
  claimId: created.id,
  actorId: uploader,
});
assert.equal(authorship.claims.length, 1);
assert.equal(authorship.artworkDeleted, false);

const listed = relationshipClaimsForActor(
  [pendingOwns, approvedCurated, approvedExhibited, approvedInventory, created],
  [lea],
);
assert.deepEqual(
  listed.map((row) => row.claim_type),
  ["OWNS", "CURATED", "EXHIBITED", "INVENTORY"],
);

const page = readFileSync(path.join(root, "src/app/artwork/[id]/page.tsx"), "utf8");
const claimMenu = page.slice(
  page.indexOf("{canRequestClaim && ("),
  page.indexOf("{isOwner && pendingClaims.length > 0 && ("),
);
assert.match(claimMenu, /handleRevokeClaim/);
assert.match(claimMenu, /artwork\.revokeClaim/);
assert.equal(claimMenu.includes("deleteArtworkCascade"), false);
assert.equal(claimMenu.includes("setShowDeleteConfirm"), false);
assert.equal(claimMenu.includes("common.delete"), false);
assert.equal(claimMenu.includes("text-red-600"), false);

const rpc = readFileSync(path.join(root, "src/lib/provenance/rpc.ts"), "utf8");
const revokeFn = rpc.slice(
  rpc.indexOf("export async function revokeMyClaim"),
  rpc.indexOf("export type PendingClaimRow"),
);
assert.match(revokeFn, /from\("claims"\)/);
assert.match(revokeFn, /REVOCABLE_CLAIM_TYPES/);
assert.equal(revokeFn.includes('from("artworks")'), false);
assert.equal(revokeFn.includes("deleteArtwork"), false);

const artworks = readFileSync(path.join(root, "src/lib/supabase/artworks.ts"), "utf8");
const cascade = artworks.slice(
  artworks.indexOf("export async function deleteArtworkCascade"),
  artworks.indexOf("const CONCURRENCY"),
);
const checkAt = cascade.indexOf("canDeleteArtwork");
const storageAt = cascade.indexOf("removeCascadeStorage");
assert.ok(checkAt >= 0 && storageAt > checkAt, "permission check runs before storage cleanup");

const deleteOne = artworks.slice(
  artworks.indexOf("export async function deleteArtwork"),
  artworks.indexOf("export async function deleteArtworkCascade"),
);
assert.match(deleteOne, /canDeleteArtworkRole/);
assert.match(deleteOne, /not owned by you/);

const sql = readFileSync(
  path.join(root, "supabase/migrations/20261008170208_claim_does_not_delete_artwork.sql"),
  "utf8",
);
const section1 = sql.slice(sql.indexOf("-- == SECTION 1 =="), sql.indexOf("-- == SECTION 2 =="));
const section2 = sql.slice(sql.indexOf("-- == SECTION 2 =="), sql.indexOf("-- == SECTION 3 =="));
const section3 = sql.slice(sql.indexOf("-- == SECTION 3 =="));
for (const section of [section1, section2]) {
  assert.match(section, /artist_id = auth\.uid\(\)/);
  assert.match(section, /created_by = auth\.uid\(\)/);
  assert.equal(section.includes("public.claims"), false);
  assert.equal(section.includes("subject_profile_id"), false);
}
assert.match(section3, /auth\.uid\(\) = old\.subject_profile_id/);
assert.match(section3, /\$notify\$/);
assert.equal(section3.includes("$notify_$"), false);

const messages = readFileSync(path.join(root, "src/lib/i18n/messages.ts"), "utf8");
assert.match(messages, /"artwork\.revokeClaim": "Revoke"/);
assert.match(messages, /"artwork\.revokeClaim": "클레임 취소"/);

console.log("claim-revoke-does-not-delete-artwork.test.ts: ok");
