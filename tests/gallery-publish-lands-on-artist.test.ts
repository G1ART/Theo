// A gallery publish for another artist is that artist's work, and the
// public profile does not drop it for being past item 50.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  planOnboardedArtistPublish,
} from "../src/lib/upload/artworkOwner";
import { isOwnArtistWork } from "../src/lib/provenance/personaTabs";
import {
  PUBLIC_PROFILE_ARTWORK_LIMIT,
  publicProfileSlice,
  resolvePublicProfileLimit,
} from "../src/lib/artworks/publicProfileQuery";

const GALLERY = "93f4f934-8296-40a0-9d3d-a3667ea2b71a";
const ARTIST = "8b4dc6e1-d9f7-4ac9-a626-ef61566af657";
const DELEGATE = "11111111-1111-4111-8111-111111111111";

const plan = planOnboardedArtistPublish({
  sessionUserId: GALLERY,
  actingAsProfileId: null,
  selectedArtistId: ARTIST,
  intent: "CURATED",
});
assert.ok(plan);
assert.equal(plan.artistId, ARTIST);
assert.equal(plan.createdBy, GALLERY);
assert.equal(plan.listerClaim.subjectProfileId, GALLERY);
assert.equal(plan.listerClaim.artistProfileId, ARTIST);
assert.equal(plan.listerClaim.claimType, "CURATED");

const published = {
  artist_id: plan.artistId,
  created_by: plan.createdBy,
  claims: [
    {
      claim_type: plan.listerClaim.claimType,
      subject_profile_id: plan.listerClaim.subjectProfileId,
      artist_profile_id: plan.listerClaim.artistProfileId,
    },
  ],
};

assert.equal(isOwnArtistWork(published, ARTIST), true);
assert.equal(isOwnArtistWork(published, GALLERY), false);

const delegated = planOnboardedArtistPublish({
  sessionUserId: DELEGATE,
  actingAsProfileId: GALLERY,
  selectedArtistId: ARTIST,
  intent: "CREATED",
});
assert.ok(delegated);
assert.equal(delegated.artistId, ARTIST);
assert.equal(delegated.createdBy, DELEGATE);
assert.equal(delegated.listerClaim.subjectProfileId, GALLERY);
assert.equal(delegated.listerClaim.claimType, "CURATED");
assert.equal(
  isOwnArtistWork(
    {
      artist_id: delegated.artistId,
      claims: [
        {
          claim_type: delegated.listerClaim.claimType,
          subject_profile_id: delegated.listerClaim.subjectProfileId,
          artist_profile_id: delegated.listerClaim.artistProfileId,
        },
      ],
    },
    ARTIST,
  ),
  true,
);

assert.equal(
  planOnboardedArtistPublish({
    sessionUserId: ARTIST,
    actingAsProfileId: null,
    selectedArtistId: ARTIST,
    intent: "CREATED",
  }),
  null,
);

const batch = Array.from({ length: 60 }, (_, index) => ({
  id: `work-${index}`,
  artist_id: ARTIST,
  visibility: "public" as const,
}));
const profileLimit = resolvePublicProfileLimit(undefined);
assert.equal(profileLimit, PUBLIC_PROFILE_ARTWORK_LIMIT);
assert.equal(profileLimit, null);
const shown = publicProfileSlice(batch, profileLimit);
assert.equal(shown.length, 60);
assert.equal(shown.some((row) => row.id === "work-50"), true);
assert.equal(shown.some((row) => row.id === "work-59"), true);
assert.equal(publicProfileSlice(batch, 50).some((row) => row.id === "work-50"), false);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const querySource = readFileSync(join(root, "src/lib/supabase/artworks.ts"), "utf8");
assert.equal(querySource.includes("resolvePublicProfileLimit(options.limit)"), true);
const profilePage = readFileSync(join(root, "src/app/u/[username]/page.tsx"), "utf8");
assert.equal(profilePage.includes("PUBLIC_PROFILE_ARTWORK_LIMIT"), true);
assert.equal(profilePage.includes("limit: 50"), false);
const privateShell = readFileSync(
  join(root, "src/app/u/[username]/PrivateProfileShell.tsx"),
  "utf8",
);
assert.equal(privateShell.includes("PUBLIC_PROFILE_ARTWORK_LIMIT"), true);
assert.equal(privateShell.includes("limit: 50"), false);

console.log("gallery-publish-lands-on-artist.test.ts: ok");
