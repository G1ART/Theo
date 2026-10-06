// A gallery picks artist A before any file. Two bulk cards, including the
// ones created after a refresh that only has the session claim, belong to
// A. The feed and detail name is A. The gallery is provenance.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isOwnArtistWork } from "../src/lib/provenance/personaTabs";
import {
  personUnderArtworkTitle,
} from "../src/lib/upload/artworkOwner";
import {
  BULK_SESSION_ARTIST_KEY,
  bulkDraftInsertArtistId,
  bulkSessionFromArtist,
  clearBulkSessionArtist,
  parseBulkSessionArtist,
  readBulkSessionArtist,
  resolveBulkCardArtist,
  serializeBulkSessionArtist,
  writeBulkSessionArtist,
} from "../src/lib/upload/bulkSessionArtist";

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

const memory = new Map<string, string>();
const storage = {
  getItem(key: string) {
    return memory.has(key) ? memory.get(key)! : null;
  },
  setItem(key: string, value: string) {
    memory.set(key, value);
  },
  removeItem(key: string) {
    memory.delete(key);
  },
};

const chosen = bulkSessionFromArtist(
  {
    id: ARTIST,
    username: "heimyunghyun",
    display_name: "현혜명",
    display_name_ko: "현혜명",
    display_name_en: "Hei Myung Hyun",
  },
  "CURATED",
);
assert.ok(chosen);
writeBulkSessionArtist(chosen, storage);
assert.equal(memory.has(BULK_SESSION_ARTIST_KEY), true);

// Refresh: React state is gone. The session claim is still there.
const restored = readBulkSessionArtist(storage);
assert.ok(restored);
assert.equal(restored.artistId, ARTIST);
assert.equal(restored.intent, "CURATED");
assert.equal(parseBulkSessionArtist(serializeBulkSessionArtist(restored))?.artistId, ARTIST);
assert.equal(parseBulkSessionArtist("{"), null);
assert.equal(parseBulkSessionArtist(JSON.stringify({ artistId: "  ", intent: "CURATED" })), null);

function cardAfterRefresh(sessionUserId: string, actingAsProfileId: string | null) {
  return resolveBulkCardArtist({
    sessionUserId,
    actingAsProfileId,
    memoryArtistId: null,
    sessionArtistId: restored!.artistId,
    intent: restored!.intent,
  });
}

const drafts = [cardAfterRefresh(GALLERY, null), cardAfterRefresh(GALLERY, null)];
assert.equal(drafts.length, 2);
for (const card of drafts) {
  assert.equal(card.artistId, ARTIST);
  assert.equal(card.createdBy, GALLERY);
  assert.ok(card.plan);
  assert.equal(card.plan.listerClaim.claimType, "CURATED");
  assert.equal(card.plan.listerClaim.subjectProfileId, GALLERY);
  assert.equal(card.plan.listerClaim.artistProfileId, ARTIST);
  const inserted = bulkDraftInsertArtistId({
    sessionUserId: GALLERY,
    actingAsProfileId: null,
    card,
  });
  assert.equal(inserted, ARTIST);
  const row = {
    artist_id: inserted,
    created_by: card.createdBy,
    claims: [
      {
        claim_type: card.plan.listerClaim.claimType,
        subject_profile_id: card.plan.listerClaim.subjectProfileId,
        artist_profile_id: card.plan.listerClaim.artistProfileId,
        status: "confirmed",
      },
    ],
  };
  assert.equal(isOwnArtistWork(row, ARTIST), true);
  assert.equal(isOwnArtistWork(row, GALLERY), false);
  const shown = personUnderArtworkTitle({
    storedArtist: artist,
    uploaderId: GALLERY,
    claimedArtist: null,
  });
  assert.equal(shown?.id, ARTIST);
  assert.equal(shown?.display_name, "현혜명");
  assert.notEqual(shown?.id, GALLERY);
  assert.notEqual(shown?.display_name, "The GREEN");
  assert.notEqual(shown?.id, card.plan.listerClaim.subjectProfileId);
}

// The name still resolves to the artist if artist_id was left on the gallery
// and only the claim names the artist. That is the feed and detail line.
const fallbackName = personUnderArtworkTitle({
  storedArtist: gallery,
  uploaderId: GALLERY,
  claimedArtist: artist,
});
assert.equal(fallbackName?.display_name, "현혜명");
assert.notEqual(fallbackName?.username, "thegreen_oc");

// A delegate acting for the gallery must not become the artist, and neither does the gallery.
const delegated = resolveBulkCardArtist({
  sessionUserId: DELEGATE,
  actingAsProfileId: GALLERY,
  memoryArtistId: null,
  sessionArtistId: ARTIST,
  intent: "CURATED",
});
assert.equal(delegated.artistId, ARTIST);
assert.equal(delegated.createdBy, DELEGATE);
assert.equal(delegated.plan?.listerClaim.subjectProfileId, GALLERY);
assert.notEqual(delegated.artistId, DELEGATE);
assert.notEqual(delegated.artistId, GALLERY);
assert.equal(
  bulkDraftInsertArtistId({
    sessionUserId: DELEGATE,
    actingAsProfileId: GALLERY,
    card: delegated,
  }),
  ARTIST,
);
assert.equal(
  isOwnArtistWork(
    {
      artist_id: ARTIST,
      claims: [
        {
          claim_type: "CURATED",
          subject_profile_id: GALLERY,
          artist_profile_id: ARTIST,
        },
      ],
    },
    ARTIST,
  ),
  true,
);

// No active claim: the card is the uploader's own work.
const own = resolveBulkCardArtist({
  sessionUserId: GALLERY,
  actingAsProfileId: null,
  memoryArtistId: null,
  sessionArtistId: null,
  intent: "CREATED",
});
assert.equal(own.artistId, GALLERY);
assert.equal(own.plan, null);
assert.equal(
  bulkDraftInsertArtistId({
    sessionUserId: GALLERY,
    actingAsProfileId: null,
    card: own,
  }),
  GALLERY,
);

clearBulkSessionArtist(storage);
assert.equal(readBulkSessionArtist(storage), null);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bulkPage = readFileSync(join(root, "src/app/upload/bulk/page.tsx"), "utf8");
assert.equal(bulkPage.includes("readBulkSessionArtist"), true);
assert.equal(bulkPage.includes("writeBulkSessionArtist"), true);
assert.equal(bulkPage.includes("clearBulkSessionArtist"), true);
assert.equal(bulkPage.includes("bulkDraftInsertArtistId"), true);
assert.equal(bulkPage.includes("artistProfileId: owner.plan ? insertedArtistId : undefined"), true);
const artworks = readFileSync(join(root, "src/lib/supabase/artworks.ts"), "utf8");
assert.equal(artworks.includes("draftArtistIdForInsert"), true);
assert.equal(artworks.includes("personUnderArtworkTitle"), true);
const feed = readFileSync(join(root, "src/components/FeedArtworkCard.tsx"), "utf8");
assert.equal(feed.includes("personUnderArtworkTitle"), true);
assert.equal(feed.includes("showProvenance"), true);

console.log("bulk-other-artist-session.test.ts: ok");
