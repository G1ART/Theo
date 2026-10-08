import assert from "node:assert/strict";
import {
  filterArtworksByPersona,
  getPersonaCounts,
  isOwnArtistWork,
} from "../src/lib/provenance/personaTabs";
import type { ArtworkWithLikes } from "../src/lib/supabase/artworks";
import {
  attachCreatedWorksToProfileTab,
  profileReturnPath,
  uploadHrefForActiveTab,
} from "../src/lib/studio/studioPortfolioConfig";

const artistId = "00000000-0000-4000-8000-000000000001";
const galleryId = "00000000-0000-4000-8000-000000000002";
const tabPainting = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const tabInstall = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const missingTab = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function work(
  id: string,
  ownerId: string,
  claims: ArtworkWithLikes["claims"] = [],
): ArtworkWithLikes {
  return { id, artist_id: ownerId, claims } as ArtworkWithLikes;
}

void (async () => {
  const portfolio = {
    version: 1 as const,
    custom_tabs: [
      { id: tabPainting, label: "회화", public: true, artwork_ids: ["existing"] },
      { id: tabInstall, label: "설치", public: true, artwork_ids: ["other"] },
    ],
  };

  const created = attachCreatedWorksToProfileTab({
    portfolio,
    artworkIds: ["new-work"],
    tabParam: `custom-${tabPainting}`,
  });
  assert.equal(created.attached, true);
  assert.equal(created.tabId, tabPainting);
  assert.equal(created.label, "회화");
  assert.deepEqual(
    created.portfolio.custom_tabs?.find((tab) => tab.id === tabPainting)?.artwork_ids,
    ["existing", "new-work"],
  );
  assert.deepEqual(
    created.portfolio.custom_tabs?.find((tab) => tab.id === tabInstall)?.artwork_ids,
    ["other"],
  );

  const artworks = [
    work("existing", artistId),
    work("other", artistId),
    work("new-work", artistId, [
      {
        claim_type: "CURATED",
        subject_profile_id: galleryId,
        artist_profile_id: artistId,
        profiles: null,
      },
    ]),
  ];
  const all = filterArtworksByPersona(artworks, artistId, "all");
  const counts = getPersonaCounts(artworks, artistId);
  const inPainting = (created.portfolio.custom_tabs ?? [])
    .find((tab) => tab.id === tabPainting)!
    .artwork_ids.filter((id) => artworks.some((artwork) => artwork.id === id));

  assert.equal(all.length, 3);
  assert.ok(all.some((artwork) => artwork.id === "new-work"));
  assert.equal(counts.all, 3);
  assert.equal(inPainting.length, 2);
  assert.ok(counts.all > inPainting.length);
  assert.equal(counts.created, 3);
  assert.equal(isOwnArtistWork(artworks[2]!, artistId), true);
  assert.equal(artworks[2]!.artist_id, artistId);
  assert.equal(isOwnArtistWork(artworks[2]!, galleryId), false);

  const again = attachCreatedWorksToProfileTab({
    portfolio: created.portfolio,
    artworkIds: ["new-work"],
    tabParam: `custom-${tabPainting}`,
  });
  assert.deepEqual(
    again.portfolio.custom_tabs?.find((tab) => tab.id === tabPainting)?.artwork_ids,
    ["existing", "new-work"],
  );

  for (const tabParam of ["all", "CREATED", null, `custom-${missingTab}`]) {
    const skipped = attachCreatedWorksToProfileTab({
      portfolio,
      artworkIds: ["new-work"],
      tabParam,
    });
    assert.equal(skipped.attached, false, String(tabParam));
    assert.equal(skipped.tabId, null);
    assert.deepEqual(skipped.portfolio.custom_tabs?.[0]?.artwork_ids, ["existing"]);
    assert.deepEqual(skipped.portfolio.custom_tabs?.[1]?.artwork_ids, ["other"]);
  }

  assert.equal(uploadHrefForActiveTab({ kind: "persona", tab: "all" }), "/upload");
  assert.equal(uploadHrefForActiveTab({ kind: "persona", tab: "CREATED" }), "/upload");
  assert.equal(
    uploadHrefForActiveTab({ kind: "custom", id: tabPainting }),
    `/upload?tab=${encodeURIComponent(`custom-${tabPainting}`)}`,
  );
  assert.equal(profileReturnPath("lee", "all"), "/u/lee");
  assert.equal(
    profileReturnPath("lee", `custom-${tabPainting}`),
    `/u/lee?tab=${encodeURIComponent(`custom-${tabPainting}`)}`,
  );

  console.log("profile-tab-upload tests ok");
})();
