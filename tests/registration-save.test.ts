// First registration keeps both medium languages, and a chosen artist
// stays the artist even when the form still defaults to "I made this".

import assert from "node:assert/strict";
import { resolveRegistrationArtist } from "../src/lib/upload/artworkOwner";
import {
  registrationBilingualFields,
  withPendingLocaleMedium,
} from "../src/lib/upload/registrationCopy";

const CURATOR = "d4b84e70-3b10-4da9-a6da-ad7830fc7519";
const ARTIST = "8b4dc6e1-d9f7-4ac9-a626-ef61566af657";

{
  const slots = withPendingLocaleMedium({
    locale: "ko",
    mediumKo: "",
    mediumEn: "Mixed media on Canvas",
    pending: "캔버스에 혼합재료",
  });
  const saved = registrationBilingualFields({
    titleKo: "테스트",
    titleEn: "Test",
    mediumKo: slots.mediumKo,
    mediumEn: slots.mediumEn,
    storyKo: "",
    storyEn: "",
  });
  assert.equal(saved.medium_ko, "캔버스에 혼합재료");
  assert.equal(saved.medium_en, "Mixed media on Canvas");
  assert.equal(saved.title_ko, "테스트");
  assert.equal(saved.title_en, "Test");
}

{
  const slots = withPendingLocaleMedium({
    locale: "en",
    mediumKo: "한지에 먹",
    mediumEn: "ink",
    pending: "on paper",
  });
  assert.equal(slots.mediumKo, "한지에 먹");
  assert.equal(slots.mediumEn, "ink, on paper");
}

{
  const slots = withPendingLocaleMedium({
    locale: "ko",
    mediumKo: "캔버스에 혼합재료",
    mediumEn: "Mixed media on Canvas",
    pending: "캔버스에 혼합재료",
  });
  assert.equal(slots.mediumKo, "캔버스에 혼합재료");
  assert.equal(slots.mediumEn, "Mixed media on Canvas");
}

{
  const own = resolveRegistrationArtist({
    sessionUserId: CURATOR,
    intent: "CREATED",
    selectedArtistId: null,
    sessionArtistId: null,
  });
  assert.equal(own.onboardedArtistId, null);
  assert.equal(own.claimIntent, "CREATED");
}

{
  // Single upload defaults to CREATED. The artist chosen on the form,
  // or remembered from the upload workspace, is still the owner.
  const chosen = resolveRegistrationArtist({
    sessionUserId: CURATOR,
    intent: "CREATED",
    selectedArtistId: ARTIST,
  });
  assert.equal(chosen.onboardedArtistId, ARTIST);
  assert.equal(chosen.claimIntent, "CURATED");

  const remembered = resolveRegistrationArtist({
    sessionUserId: CURATOR,
    intent: "CREATED",
    selectedArtistId: null,
    sessionArtistId: ARTIST,
  });
  assert.equal(remembered.onboardedArtistId, ARTIST);
  assert.equal(remembered.claimIntent, "CURATED");

  const explicit = resolveRegistrationArtist({
    sessionUserId: CURATOR,
    intent: "OWNS",
    selectedArtistId: ARTIST,
    sessionArtistId: "someone-else",
  });
  assert.equal(explicit.onboardedArtistId, ARTIST);
  assert.equal(explicit.claimIntent, "OWNS");
}

{
  const external = resolveRegistrationArtist({
    sessionUserId: CURATOR,
    intent: "CURATED",
    selectedArtistId: ARTIST,
    sessionArtistId: ARTIST,
    useExternalArtist: true,
  });
  assert.equal(external.onboardedArtistId, null);
  assert.equal(external.claimIntent, "CURATED");
}

console.log("registration-save.test.ts: ok");
