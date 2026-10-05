// A gallery upload attributed to another artist stores and displays that artist.

import assert from "node:assert/strict";
import {
  claimedOnboardedArtist,
  personUnderArtworkTitle,
  rememberedArtistId,
  resolveUploadedArtworkArtist,
} from "../src/lib/upload/artworkOwner";

const GALLERY = "93f4f934-8296-40a0-9d3d-a3667ea2b71a";
const ARTIST = "8b4dc6e1-d9f7-4ac9-a626-ef61566af657";
const DELEGATE = "11111111-1111-4111-8111-111111111111";

const gallery = {
  id: GALLERY,
  display_name: "The GREEN",
  username: "thegreen_oc",
  roles: ["gallerist", "curator"],
};
const artist = {
  id: ARTIST,
  display_name: "현혜명",
  username: "heimyunghyun",
  roles: ["artist", "collector"],
};

{
  const stored = resolveUploadedArtworkArtist({
    sessionUserId: GALLERY,
    actingAsProfileId: GALLERY,
    selectedArtistId: ARTIST,
  });
  assert.equal(stored.artistId, ARTIST);
  assert.equal(stored.createdBy, GALLERY);
  const shown = personUnderArtworkTitle({
    storedArtist: artist,
    uploaderId: GALLERY,
    claimedArtist: null,
  });
  assert.equal(shown?.id, ARTIST);
  assert.equal(shown?.display_name, "현혜명");
  assert.notEqual(shown?.username, "thegreen_oc");
}

{
  const stored = resolveUploadedArtworkArtist({
    sessionUserId: DELEGATE,
    actingAsProfileId: GALLERY,
    selectedArtistId: ARTIST,
  });
  assert.equal(stored.artistId, ARTIST);
  assert.equal(stored.createdBy, DELEGATE);
}

{
  const own = resolveUploadedArtworkArtist({
    sessionUserId: GALLERY,
    actingAsProfileId: null,
    selectedArtistId: null,
  });
  assert.equal(own.artistId, GALLERY);
  assert.equal(own.createdBy, GALLERY);
  const shown = personUnderArtworkTitle({
    storedArtist: gallery,
    uploaderId: GALLERY,
    claimedArtist: null,
  });
  assert.equal(shown?.id, GALLERY);
}

{
  // artist_id still points at the uploader, but the claim names the artist.
  const shown = personUnderArtworkTitle({
    storedArtist: gallery,
    uploaderId: GALLERY,
    claimedArtist: claimedOnboardedArtist(
      [{ artist_profile_id: ARTIST, artist_profile: artist, status: "confirmed" }],
      GALLERY,
    ),
  });
  assert.equal(shown?.display_name, "현혜명");
  assert.deepEqual(shown?.roles, ["artist", "collector"]);
}

{
  const remembered = rememberedArtistId(
    [{ claims: [{ artist_profile_id: ARTIST, status: "confirmed" }] }],
    [GALLERY],
  );
  assert.equal(remembered, ARTIST);
  assert.equal(
    rememberedArtistId(
      [{ claims: [{ artist_profile_id: GALLERY, status: "confirmed" }] }],
      [GALLERY],
    ),
    null,
  );
}

console.log("artwork-owner-is-selected-artist.test.ts: ok");
