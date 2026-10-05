import assert from "node:assert/strict";
import type { ArtworkWithLikes } from "../src/lib/supabase/artworks";
import {
  filterArtworksByPersona,
  getArtworksByAllBuckets,
  getPersonaCounts,
  isOwnArtistWork,
} from "../src/lib/provenance/personaTabs";

const artist = "artist-hyun";
const gallery = "gallery-green";

function work(partial: {
  id: string;
  artist_id: string | null;
  claims?: ArtworkWithLikes["claims"];
}): ArtworkWithLikes {
  return partial as ArtworkWithLikes;
}

const uploadedForArtist = work({
  id: "uploaded-for-artist",
  artist_id: artist,
  claims: [
    {
      claim_type: "CURATED",
      subject_profile_id: gallery,
      artist_profile_id: artist,
      profiles: null,
    },
  ],
});

const galleryOwn = work({
  id: "gallery-own",
  artist_id: gallery,
  claims: [
    {
      claim_type: "CREATED",
      subject_profile_id: gallery,
      artist_profile_id: gallery,
      profiles: null,
    },
  ],
});

const listedOnly = work({
  id: "listed-only",
  artist_id: "someone-else",
  claims: [
    {
      claim_type: "CURATED",
      subject_profile_id: gallery,
      artist_profile_id: "someone-else",
      profiles: null,
    },
  ],
});

assert.equal(isOwnArtistWork(uploadedForArtist, artist), true);
assert.equal(isOwnArtistWork(uploadedForArtist, gallery), false);
assert.equal(isOwnArtistWork(galleryOwn, gallery), true);
assert.equal(isOwnArtistWork(listedOnly, gallery), false);

const rows = [uploadedForArtist, galleryOwn, listedOnly];
const artistMine = filterArtworksByPersona(rows, artist, "CREATED").map((row) => row.id);
assert.deepEqual(artistMine, ["uploaded-for-artist"]);

const galleryMine = filterArtworksByPersona(rows, gallery, "CREATED").map((row) => row.id);
assert.deepEqual(galleryMine, ["gallery-own"]);

const allForArtist = filterArtworksByPersona(rows, artist, "all").map((row) => row.id);
assert.deepEqual(allForArtist, ["uploaded-for-artist", "gallery-own", "listed-only"]);

const counts = getPersonaCounts(rows, artist);
assert.equal(counts.created, 1);
assert.equal(counts.all, 3);

const galleryBuckets = getArtworksByAllBuckets(rows, gallery);
assert.deepEqual(
  galleryBuckets.created.map((row) => row.id),
  ["gallery-own"],
);
assert.deepEqual(
  galleryBuckets.curated.map((row) => row.id).sort(),
  ["listed-only", "uploaded-for-artist"],
);

const artistBuckets = getArtworksByAllBuckets(rows, artist);
assert.deepEqual(
  artistBuckets.created.map((row) => row.id),
  ["uploaded-for-artist"],
);
assert.equal(artistBuckets.curated.length, 0);

console.log("own-artist-works tests ok");
