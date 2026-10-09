import assert from "node:assert/strict";
import { filterArtworksByPersona, isOwnArtistWork } from "../src/lib/provenance/personaTabs";
import type { ArtworkWithLikes } from "../src/lib/supabase/artworks";
import {
  canCreateArtistProfileTab,
  canDeleteAsCustomFolder,
  isMainFeedKind,
  isProfileAllKind,
  planUploadFiling,
  type KnownProfileTab,
} from "../src/lib/studio/profileContentKind";
import { parseStudioPortfolio } from "../src/lib/studio/studioPortfolioConfig";

const artistId = "00000000-0000-4000-8000-000000000001";
const galleryId = "00000000-0000-4000-8000-000000000002";
const collectorId = "00000000-0000-4000-8000-000000000003";
const delegateId = "00000000-0000-4000-8000-000000000004";
const goodsTab: KnownProfileTab = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  kind: "art_goods",
  ownerProfileId: artistId,
  label: "굿즈",
};
const artworkTab: KnownProfileTab = {
  id: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  kind: "artwork",
  ownerProfileId: artistId,
  label: "회화",
};
const collectedTab: KnownProfileTab = {
  id: "cccccccc-cccc-4ccc-8ddd-eeeeeeeeeeee",
  kind: "collected",
  ownerProfileId: collectorId,
  label: "김작가",
};

void (async () => {
  const goods = planUploadFiling({
    actor: { sessionUserId: artistId, roles: ["artist"] },
    channel: "own",
    entryTab: goodsTab,
    sharedTab: null,
    cardTab: null,
    collectorTab: null,
    artistTab: null,
    createArtistTab: false,
  });
  assert.equal(goods.workKind, "art_goods");
  assert.equal(goods.appearsOnMainFeed, false);
  assert.equal(isMainFeedKind(goods.workKind), false);
  assert.equal(goods.appearsInProfileAll, false);
  assert.equal(isProfileAllKind(goods.workKind), false);
  assert.deepEqual(goods.memberships, [{ profileId: artistId, tabId: goodsTab.id }]);

  const made = planUploadFiling({
    actor: { sessionUserId: artistId, roles: ["artist"] },
    channel: "own",
    entryTab: artworkTab,
    sharedTab: null,
    cardTab: null,
    collectorTab: null,
    artistTab: null,
    createArtistTab: false,
  });
  assert.equal(made.workKind, "artwork");
  assert.equal(made.appearsOnMainFeed, true);
  assert.equal(made.appearsInProfileAll, true);
  assert.deepEqual(made.memberships, [{ profileId: artistId, tabId: artworkTab.id }]);

  const bare = planUploadFiling({
    actor: { sessionUserId: artistId, roles: ["artist"] },
    channel: "own",
    entryTab: null,
    sharedTab: null,
    cardTab: null,
    collectorTab: null,
    artistTab: null,
    createArtistTab: false,
  });
  assert.equal(bare.workKind, "artwork");
  assert.deepEqual(bare.memberships, []);

  const collected = planUploadFiling({
    actor: {
      sessionUserId: collectorId,
      roles: ["collector"],
      selectedArtistId: artistId,
    },
    channel: "collector",
    entryTab: null,
    sharedTab: null,
    cardTab: null,
    collectorTab: collectedTab,
    artistTab: artworkTab,
    createArtistTab: false,
  });
  assert.equal(collected.artistId, artistId);
  assert.notEqual(collected.artistId, collectorId);
  assert.equal(collected.workKind, "artwork");
  assert.equal(collected.appearsOnMainFeed, true);
  assert.equal(collected.inCollectorCreated, false);
  assert.equal(isOwnArtistWork({ artist_id: collected.artistId }, collectorId), false);
  assert.equal(isOwnArtistWork({ artist_id: collected.artistId }, artistId), true);
  assert.deepEqual(collected.memberships, [
    { profileId: collectorId, tabId: collectedTab.id },
    { profileId: artistId, tabId: artworkTab.id },
  ]);

  assert.equal(
    canCreateArtistProfileTab({
      actorRoles: ["gallerist"],
      targetProfileId: artistId,
      actorProfileId: galleryId,
    }),
    false,
  );
  assert.equal(
    canCreateArtistProfileTab({
      actorRoles: ["curator"],
      targetProfileId: artistId,
      actorProfileId: galleryId,
    }),
    false,
  );
  const refused = planUploadFiling({
    actor: {
      sessionUserId: galleryId,
      roles: ["gallerist"],
      selectedArtistId: artistId,
    },
    channel: "gallery",
    entryTab: null,
    sharedTab: null,
    cardTab: null,
    collectorTab: null,
    artistTab: null,
    createArtistTab: true,
  });
  assert.equal(refused.rejectedCreateArtistTab, true);
  assert.equal(refused.artistId, artistId);
  assert.deepEqual(refused.memberships, []);

  const delegated = planUploadFiling({
    actor: {
      sessionUserId: delegateId,
      actingAsProfileId: artistId,
      roles: ["artist"],
    },
    channel: "own",
    entryTab: artworkTab,
    sharedTab: null,
    cardTab: null,
    collectorTab: null,
    artistTab: null,
    createArtistTab: false,
  });
  assert.equal(delegated.artistId, artistId);
  assert.notEqual(delegated.artistId, delegateId);

  const namedGoods = parseStudioPortfolio({
    studio_portfolio: {
      version: 1,
      custom_tabs: [
        { id: goodsTab.id, label: "굿즈", public: true, artwork_ids: [] },
      ],
    },
  });
  assert.equal(namedGoods.custom_tabs?.[0]?.kind, "artwork");

  assert.equal(canDeleteAsCustomFolder({ kind: "persona", personaTab: "all" }), false);
  assert.equal(canDeleteAsCustomFolder({ kind: "persona", personaTab: "CREATED" }), false);
  assert.equal(canDeleteAsCustomFolder({ kind: "persona", personaTab: "exhibitions" }), false);
  assert.equal(canDeleteAsCustomFolder({ kind: "custom" }), true);

  const goodsWork = {
    id: "goods-work",
    artist_id: artistId,
    work_kind: "art_goods",
  } as ArtworkWithLikes;
  const madeWork = {
    id: "made-work",
    artist_id: artistId,
    work_kind: "artwork",
  } as ArtworkWithLikes;
  const rows = [goodsWork, madeWork];
  const all = filterArtworksByPersona(rows, artistId, "all");
  const created = filterArtworksByPersona(rows, artistId, "CREATED");
  assert.deepEqual(all.map((row) => row.id), ["made-work"]);
  assert.deepEqual(created.map((row) => row.id), ["made-work"]);
  assert.equal(isMainFeedKind(goodsWork.work_kind), false);
  assert.equal(isMainFeedKind(madeWork.work_kind), true);

  console.log("profile-tab-kinds tests ok");
})();
