import assert from "node:assert/strict";
import { assembleWalk, PERSONALIZED_SCENARIOS } from "../src/lib/feed/walk/assemble";
import { visibleModule } from "../src/lib/feed/walk/content";
import { decodeCursor, encodeCursor } from "../src/lib/feed/walk/cursor";
import { fillTemplate } from "../src/lib/feed/walk/fill";
import { messages } from "../src/lib/i18n/messages";
import type {
  FeedModule,
  WalkEngagement,
  WalkExhibition,
  WalkFollow,
  WalkPerson,
  WalkPools,
  WalkViewer,
  WalkWork,
} from "../src/lib/feed/walk/types";

/**
 * The walk assembler is pure: scenario order, skip, cursor, and a ban on
 * invented rows. Fixtures below are the only legal names.
 */

function person(partial: Partial<WalkPerson> & Pick<WalkPerson, "id" | "name">): WalkPerson {
  return {
    username: partial.id.toLowerCase(),
    avatarUrl: null,
    oneLine: null,
    school: null,
    city: null,
    role: "artist",
    mediums: [],
    mutualNames: null,
    viewerFollows: false,
    ...partial,
  };
}

function work(
  partial: Partial<WalkWork> & Pick<WalkWork, "id" | "artistId">
): WalkWork {
  return {
    title: partial.title ?? partial.id,
    year: "2024",
    medium: partial.medium ?? "mixed",
    imagePath: null,
    exhibitionIds: partial.exhibitionIds ?? [],
    ...partial,
  };
}

function exhibition(
  partial: Partial<WalkExhibition> & Pick<WalkExhibition, "id" | "title">
): WalkExhibition {
  return {
    startDate: "2024-03-01",
    endDate: "2024-04-01",
    curatorId: "Cur",
    hostProfileId: null,
    hostName: null,
    coverPath: null,
    participantIds: [],
    workIds: [],
    city: null,
    ...partial,
  };
}

function viewer(partial: Partial<WalkViewer> = {}): WalkViewer {
  return {
    id: "V",
    school: "Hansung",
    city: "Seoul",
    medium: "Oil",
    role: "artist",
    exhibitionIds: ["E1"],
    artworkIds: ["Wv"],
    followingIds: ["Cur", "F1", "F2", "F3"],
    savedArtworkIds: ["S1", "S2", "S3"],
    inquiredArtworkIds: [],
    likedArtworkIds: ["S1"],
    ...partial,
  };
}

function world(): { viewer: WalkViewer; pools: WalkPools } {
  const people: WalkPerson[] = [
    person({ id: "V", name: "Viewer", school: "Hansung", city: "Seoul", mediums: ["Oil"] }),
    person({ id: "Co", name: "Co Artist", mutualNames: ["Ada"] }),
    person({ id: "R1", name: "Room One" }),
    person({ id: "R2", name: "Room Two" }),
    person({ id: "Lik", name: "Liker" }),
    person({ id: "OA", name: "Oil A", mediums: ["Oil"] }),
    person({ id: "OB", name: "Oil B", mediums: ["Oil"] }),
    person({ id: "OC", name: "Oil C", mediums: ["Oil"] }),
    person({ id: "Fan", name: "Oil Fan" }),
    person({ id: "Cur", name: "Curator Kim", role: "curator", viewerFollows: true }),
    person({ id: "CA", name: "Shown Artist" }),
    person({ id: "CT", name: "Curator Target" }),
    person({ id: "A1", name: "Alum One", school: "Hansung" }),
    person({ id: "A2", name: "Alum Two", school: "Hansung" }),
    person({ id: "A3", name: "Alum Three", school: "Hansung" }),
    person({ id: "Host", name: "North Host", role: "gallery", city: "Seoul" }),
    person({ id: "L1", name: "Local Artist" }),
    person({ id: "L2", name: "Gallery Artist" }),
    person({ id: "Lnet", name: "Local Net" }),
    person({ id: "Cart", name: "Cart Artist" }),
    person({ id: "Cnet", name: "Cart Net" }),
    person({ id: "KX", name: "Liked Maker" }),
    person({ id: "F1", name: "Follow One", viewerFollows: true }),
    person({ id: "F2", name: "Follow Two", viewerFollows: true }),
    person({ id: "F3", name: "Follow Three", viewerFollows: true }),
    person({ id: "PubA", name: "Public Artist" }),
    person({ id: "PubB", name: "Public Peer" }),
    person({
      id: "Decoy",
      name: "Sienna Ko",
      school: "RISD",
      city: "Providence",
    }),
  ];

  const works: WalkWork[] = [
    work({ id: "Wv", artistId: "V", medium: "Oil" }),
    work({ id: "Co1", artistId: "Co", title: "Shared Piece" }),
    work({ id: "R1a", artistId: "R1", exhibitionIds: ["E2"] }),
    work({ id: "R1b", artistId: "R1", exhibitionIds: ["E2"] }),
    work({ id: "R2a", artistId: "R2", exhibitionIds: ["E2"] }),
    work({ id: "Lik1", artistId: "Lik" }),
    work({ id: "OA1", artistId: "OA", medium: "Oil", exhibitionIds: ["Eoil"] }),
    work({ id: "OA2", artistId: "OA", medium: "Oil" }),
    work({ id: "OB1", artistId: "OB", medium: "Oil" }),
    work({ id: "OA3", artistId: "OA", medium: "Oil" }),
    work({ id: "OB2", artistId: "OB", medium: "Oil" }),
    work({ id: "OC1", artistId: "OC", medium: "Oil" }),
    work({ id: "Fan1", artistId: "Fan", medium: "Ink" }),
    work({ id: "CA1", artistId: "CA", exhibitionIds: ["Ecur"] }),
    work({ id: "CA2", artistId: "CA" }),
    work({ id: "CA3", artistId: "CA" }),
    work({ id: "CA4", artistId: "CA" }),
    work({ id: "CT1", artistId: "CT" }),
    work({ id: "CT2", artistId: "CT" }),
    work({ id: "CT3", artistId: "CT" }),
    work({ id: "AL1", artistId: "A1" }),
    work({ id: "AL2", artistId: "A2" }),
    work({ id: "AL3", artistId: "A3" }),
    work({ id: "AL4", artistId: "A1" }),
    work({ id: "AL5", artistId: "A2" }),
    work({ id: "AL6", artistId: "A3" }),
    work({ id: "G1", artistId: "L2", exhibitionIds: ["Eseoul2"] }),
    work({ id: "G2", artistId: "L2", exhibitionIds: ["Eseoul2"] }),
    work({ id: "G3", artistId: "L2", exhibitionIds: ["Eseoul2"] }),
    work({ id: "L2w", artistId: "L2" }),
    work({ id: "S1", artistId: "Cart", exhibitionIds: ["Ecol"] }),
    work({ id: "S2", artistId: "Cart" }),
    work({ id: "S3", artistId: "Cart" }),
    work({ id: "K1", artistId: "KX" }),
    work({ id: "K2", artistId: "KX" }),
    work({ id: "K3", artistId: "KX" }),
    work({ id: "F1a", artistId: "F1" }),
    work({ id: "F2a", artistId: "F2" }),
    work({ id: "F3a", artistId: "F3" }),
    work({ id: "Pout1", artistId: "PubB" }),
    work({ id: "Pout2", artistId: "PubB" }),
    work({ id: "Pout3", artistId: "PubB" }),
    work({ id: "Pin1", artistId: "PubA", exhibitionIds: ["Epub"] }),
    work({ id: "Pin2", artistId: "PubA", exhibitionIds: ["Epub"] }),
    work({ id: "Pin3", artistId: "PubA", exhibitionIds: ["Epub"] }),
    work({ id: "Pmore1", artistId: "PubA" }),
    work({ id: "Pmore2", artistId: "PubA" }),
    work({ id: "Pmore3", artistId: "PubA" }),
  ];

  const exhibitions: WalkExhibition[] = [
    exhibition({
      id: "E1",
      title: "First Room",
      participantIds: ["V", "Co"],
      workIds: ["Co1"],
      curatorId: "Cur",
    }),
    exhibition({
      id: "E2",
      title: "Second Room",
      participantIds: ["Co", "R1", "R2"],
      workIds: ["R1a", "R1b", "R2a"],
      curatorId: "Cur",
    }),
    exhibition({
      id: "Eoil",
      title: "Oil Room",
      participantIds: ["OA"],
      workIds: ["OA1"],
      curatorId: "Cur",
    }),
    exhibition({
      id: "Ecur",
      title: "Curated Room",
      curatorId: "Cur",
      participantIds: ["Cur", "CA"],
      workIds: ["CA1"],
    }),
    exhibition({
      id: "Ect",
      title: "Target Room",
      curatorId: "Cur",
      participantIds: ["CT"],
      workIds: ["CT1"],
    }),
    exhibition({
      id: "Eal",
      title: "Alumni Room",
      curatorId: "Cur",
      participantIds: ["A1", "A2"],
      workIds: ["AL1"],
    }),
    exhibition({
      id: "Eseoul",
      title: "Seoul Room",
      city: "Seoul",
      hostName: "Gallery North",
      hostProfileId: "Host",
      curatorId: "Cur",
      participantIds: ["L1"],
      workIds: [],
    }),
    exhibition({
      id: "Elother",
      title: "Artist Other Room",
      curatorId: "Cur",
      participantIds: ["L2", "Lnet"],
      workIds: ["L2w"],
    }),
    exhibition({
      id: "Eseoul2",
      title: "North Annex",
      city: "Seoul",
      hostName: "Gallery North",
      hostProfileId: "Host",
      curatorId: "Cur",
      participantIds: ["L2"],
      workIds: ["G1", "G2", "G3"],
    }),
    exhibition({
      id: "Ecol",
      title: "Saved Room",
      curatorId: "Cur",
      participantIds: ["Cart"],
      workIds: ["S1"],
    }),
    exhibition({
      id: "Ecol2",
      title: "Network Room",
      curatorId: "Cur",
      participantIds: ["Cnet"],
      workIds: [],
    }),
    exhibition({
      id: "Epub",
      title: "Public Room",
      curatorId: "Cur",
      participantIds: ["PubA", "PubB"],
      workIds: ["Pin1", "Pin2", "Pin3"],
      hostName: "Public Gallery",
    }),
    exhibition({
      id: "Edecoy",
      title: "Quiet Trajectory",
      curatorId: "Decoy",
      participantIds: ["Decoy"],
      workIds: [],
      city: "Providence",
    }),
  ];

  const engagements: WalkEngagement[] = [
    { userId: "Lik", artworkId: "R1a", kind: "like" },
    { userId: "Fan", artworkId: "OA1", kind: "like" },
    { userId: "Cur", artworkId: "CT1", kind: "like" },
    { userId: "Cur", artworkId: "CT2", kind: "like" },
    { userId: "Cur", artworkId: "CT3", kind: "like" },
    { userId: "Cart", artworkId: "K1", kind: "like" },
    { userId: "Cart", artworkId: "K2", kind: "like" },
    { userId: "Cart", artworkId: "K3", kind: "like" },
  ];

  const follows: WalkFollow[] = [
    { followerId: "V", followingId: "Cur" },
    { followerId: "V", followingId: "F1" },
    { followerId: "V", followingId: "F2" },
    { followerId: "V", followingId: "F3" },
    { followerId: "Cart", followingId: "Cnet" },
    { followerId: "Ada", followingId: "Co" },
  ];

  return {
    viewer: viewer(),
    pools: { people, works, exhibitions, engagements, follows },
  };
}

function idsOf(modules: FeedModule[]): { people: string[]; works: string[]; exhibitions: string[] } {
  const people: string[] = [];
  const works: string[] = [];
  const exhibitions: string[] = [];
  for (const mod of modules) {
    if (mod.type === "artist_card") {
      people.push(mod.person.id);
      works.push(...mod.works.map((row) => row.id));
    } else if (mod.type === "related_network") {
      people.push(...mod.people.map((row) => row.id));
    } else if (mod.type === "exhibition_card") {
      exhibitions.push(mod.exhibition.id);
    } else {
      works.push(...mod.works.map((row) => row.id));
    }
  }
  return { people, works, exhibitions };
}

function assertReal(modules: FeedModule[], pools: WalkPools) {
  const ids = idsOf(modules);
  const people = new Set(pools.people.map((row) => row.id));
  const works = new Set(pools.works.map((row) => row.id));
  const exhibitions = new Set(pools.exhibitions.map((row) => row.id));
  for (const id of ids.people) assert.ok(people.has(id), `invented person ${id}`);
  for (const id of ids.works) assert.ok(works.has(id), `invented work ${id}`);
  for (const id of ids.exhibitions) assert.ok(exhibitions.has(id), `invented exhibition ${id}`);
  const blob = JSON.stringify(modules);
  assert.equal(blob.includes("Sienna Ko"), false);
  assert.equal(blob.includes("Quiet Trajectory"), false);
  assert.equal(blob.includes("RISD"), false);
  for (const mod of modules) {
    if (mod.type !== "artist_card") continue;
    const source = pools.people.find((row) => row.id === mod.person.id);
    assert.ok(source);
    assert.deepEqual(mod.person.mutualNames, source.mutualNames);
  }
}

const EXHIBITION_ORDER = [
  "artist_card",
  "exhibition_card",
  "related_network",
  "artwork_gallery",
  "artist_card",
] as const;

const MEDIUM_ORDER = [
  "artwork_gallery",
  "related_network",
  "exhibition_card",
  "related_artwork",
  "artist_card",
] as const;

function testOrderAndCursor() {
  const { viewer: me, pools } = world();
  const first = assembleWalk({ lane: "personalized", viewer: me, pools, cursor: null });
  assert.equal(first.scenario, "exhibition_network");
  assert.deepEqual(first.modules.map((mod) => mod.type), EXHIBITION_ORDER);
  assert.equal(first.modules[0]?.reason.params.exhibition, "First Room");
  assert.equal(first.modules[1]?.type === "exhibition_card" && first.modules[1].exhibition.title, "Second Room");
  assertReal(first.modules, pools);

  const cursor = decodeCursor(first.nextCursor);
  assert.ok(cursor);
  assert.equal(cursor.si, 1);
  assert.equal(cursor.off, 1);
  assert.ok(cursor.used.length > 0);

  const second = assembleWalk({ lane: "personalized", viewer: me, pools, cursor });
  assert.equal(second.scenario, "shared_medium");
  assert.deepEqual(second.modules.map((mod) => mod.type), MEDIUM_ORDER);
  assert.equal(second.modules[0]?.type, "artwork_gallery");
  assert.equal(second.modules[0]?.reason.params.medium, "Oil");
  assert.notEqual(second.nextCursor, first.nextCursor);
  assertReal(second.modules, pools);

  const firstIds = new Set(idsOf(first.modules).works);
  for (const id of idsOf(second.modules).works) {
    assert.equal(firstIds.has(id), false, `work ${id} repeated on the next page`);
  }
}

function testSkipWhenMissing() {
  const { pools } = world();
  const bare = viewer({
    school: null,
    city: null,
    medium: "Oil",
    exhibitionIds: [],
    followingIds: [],
    savedArtworkIds: [],
    inquiredArtworkIds: [],
    likedArtworkIds: [],
  });
  const page = assembleWalk({ lane: "personalized", viewer: bare, pools, cursor: null });
  assert.equal(page.scenario, "shared_medium");
  assert.equal(page.modules[0]?.type, "artwork_gallery");
  assert.equal(page.modules.some((mod) => mod.reason.key.startsWith("feed.walk.ex.")), false);
  assertReal(page.modules, pools);
}

function testEmptyWhenNothingReal() {
  const emptyViewer = viewer({
    id: "V",
    school: null,
    city: null,
    medium: null,
    exhibitionIds: [],
    followingIds: [],
    savedArtworkIds: [],
    inquiredArtworkIds: [],
    likedArtworkIds: [],
  });
  const pools: WalkPools = {
    people: [person({ id: "V", name: "Viewer" }), person({ id: "Only", name: "Only" })],
    works: [work({ id: "W1", artistId: "Only" })],
    exhibitions: [],
    engagements: [],
    follows: [],
  };
  const page = assembleWalk({
    lane: "personalized",
    viewer: emptyViewer,
    pools,
    cursor: null,
  });
  assert.equal(page.scenario, null);
  assert.deepEqual(page.modules, []);
  assert.equal(page.nextCursor, null);
}

function testCollectorEndsOnExhibition() {
  const { viewer: me, pools } = world();
  const si = PERSONALIZED_SCENARIOS.indexOf("collector");
  const page = assembleWalk({
    lane: "personalized",
    viewer: me,
    pools,
    cursor: decodeCursor(encodeCursor({ v: 1, si, off: 0, used: [] })),
  });
  assert.equal(page.scenario, "collector");
  assert.equal(page.modules.at(-1)?.type, "exhibition_card");
  assert.notEqual(page.modules.at(-1)?.type, "artist_card");
  assertReal(page.modules, pools);
}

function testLoggedOutIsPublic() {
  const { pools } = world();
  const anon = viewer({
    id: null,
    school: null,
    city: null,
    medium: null,
    exhibitionIds: [],
    followingIds: [],
    savedArtworkIds: [],
    artworkIds: [],
  });
  const page = assembleWalk({ lane: "personalized", viewer: anon, pools, cursor: null });
  assert.equal(page.scenario, "public");
  assert.ok(page.modules.length >= 3);
  for (const mod of page.modules) {
    assert.equal(mod.reason.key.startsWith("feed.walk.public."), true, mod.reason.key);
  }
  for (const mod of page.modules) {
    assert.equal(mod.reason.params.school, undefined);
    assert.equal(mod.title.params.school, undefined);
  }
  assertReal(page.modules, pools);

  const next = decodeCursor(page.nextCursor);
  assert.ok(next);
  assert.ok(next.off > 0);
  const again = assembleWalk({ lane: "public", viewer: anon, pools, cursor: next });
  if (again.modules.length > 0) {
    assert.equal(again.scenario, "public");
    const used = new Set(idsOf(page.modules).exhibitions);
    for (const id of idsOf(again.modules).exhibitions) {
      assert.equal(used.has(id), false);
    }
  }
}

function testFollowingGroupsRealFollows() {
  const { viewer: me, pools } = world();
  const page = assembleWalk({ lane: "following", viewer: me, pools, cursor: null });
  assert.equal(page.scenario, "following");
  assert.equal(page.modules[0]?.type, "artwork_gallery");
  const ids = idsOf(page.modules);
  for (const workId of ids.works) {
    const row = pools.works.find((work) => work.id === workId);
    assert.ok(row);
    assert.ok(me.followingIds.includes(row.artistId), workId);
  }
  for (const personId of ids.people) {
    assert.ok(me.followingIds.includes(personId), personId);
  }
  assertReal(page.modules, pools);
}

function testBadCursorRestarts() {
  const { viewer: me, pools } = world();
  assert.equal(decodeCursor("%%%"), null);
  const page = assembleWalk({
    lane: "personalized",
    viewer: me,
    pools,
    cursor: decodeCursor("not-a-cursor"),
  });
  assert.equal(page.scenario, "exhibition_network");
}

function anonViewer(): WalkViewer {
  return viewer({
    id: null,
    school: null,
    city: null,
    medium: null,
    role: null,
    exhibitionIds: [],
    artworkIds: [],
    followingIds: [],
    savedArtworkIds: [],
    inquiredArtworkIds: [],
    likedArtworkIds: [],
  });
}

function testPlaceholderExhibitionOmitsShells() {
  const enPeople = messages.en["feed.walk.public.people.reason"];
  const koPeople = messages.ko["feed.walk.public.people.reason"];
  const enShow = messages.en["feed.walk.public.show.reason"];
  const koShow = messages.ko["feed.walk.public.show.reason"];
  assert.equal(enPeople, "People in {exhibition}.");
  assert.equal(koPeople, "{exhibition}의 사람들입니다.");
  assert.equal(enShow, "Now on view: {exhibition}.");
  assert.equal(koShow, "지금 공개된 전시, {exhibition}.");
  assert.equal(fillTemplate(enPeople, { exhibition: "title" }), "");
  assert.equal(fillTemplate(koPeople, { exhibition: "title" }), "");
  assert.equal(fillTemplate(enShow, { exhibition: "Title" }), "");
  assert.equal(fillTemplate(koShow, { exhibition: "" }), "");
  assert.equal(fillTemplate(enPeople, { exhibition: "Public Room" }), "People in Public Room.");
  assert.equal(fillTemplate(messages.en["feed.walk.worksOf"], { name: "" }), "");
  assert.equal(fillTemplate(messages.ko["feed.walk.worksOf"], { name: " " }), "");
  assert.equal(fillTemplate(messages.en["feed.walk.worksOf"], { name: "Lea" }), "Lea's Artwork");

  const shellNetwork: FeedModule = {
    type: "related_network",
    key: "public:people:lea",
    title: { key: "feed.walk.public.people.title", params: {} },
    reason: { key: "feed.walk.public.people.reason", params: { exhibition: "title" } },
    people: [
      { ...person({ id: "Lea", name: "Lea", username: "lea" }), mutualAvatars: null },
    ],
  };
  assert.equal(visibleModule(shellNetwork), null);
  const shellShow: FeedModule = {
    type: "exhibition_card",
    key: "public:show:bad",
    title: { key: "feed.walk.public.show.title", params: {} },
    reason: { key: "feed.walk.public.show.reason", params: { exhibition: "title" } },
    exhibition: {
      id: "Ebad",
      title: "title",
      startDate: null,
      endDate: null,
      curator: { id: "Lea", name: "Lea", username: "lea", avatarUrl: null },
      gallery: { id: "Lea", name: "Lea", username: "lea", avatarUrl: null },
      coverPath: null,
      city: null,
    },
  };
  assert.equal(visibleModule(shellShow), null);
  const blankShow: FeedModule = {
    ...shellShow,
    exhibition: { ...shellShow.exhibition, title: "  " },
    reason: { key: "feed.walk.public.show.reason", params: { exhibition: "  " } },
  };
  assert.equal(visibleModule(blankShow), null);
  const emptyGallery: FeedModule = {
    type: "artwork_gallery",
    key: "public:works:empty",
    title: { key: "feed.walk.public.works.title", params: {} },
    reason: { key: "feed.walk.public.works.reason", params: {} },
    works: [],
  };
  assert.equal(visibleModule(emptyGallery), null);
  const realShow = visibleModule({
    ...shellShow,
    exhibition: { ...shellShow.exhibition, title: "Public Room", coverPath: null },
    reason: { key: "feed.walk.public.show.reason", params: { exhibition: "Public Room" } },
  });
  assert.equal(realShow?.type, "exhibition_card");

  for (const title of ["title", "Title", "TITLE", "", "   "]) {
    const pools: WalkPools = {
      people: [
        person({ id: "Lea", name: "Lea", username: "lea" }),
        person({ id: "Yoon", name: "Yoon Lee" }),
        person({ id: "Qiqi", name: "Qiqi Zhou" }),
        person({ id: "Jiwon", name: "지웬닛아트코리아" }),
      ],
      works: [
        work({ id: "W1", artistId: "Yoon", title: "Mother", imagePath: "mother.jpg" }),
        work({ id: "W2", artistId: "Qiqi", title: "Untitled", imagePath: "untitled.jpg" }),
        work({ id: "W3", artistId: "Jiwon", title: "Narrow Opening", imagePath: "narrow.jpg" }),
      ],
      exhibitions: [
        exhibition({
          id: "Ebad",
          title,
          curatorId: "Lea",
          hostProfileId: "Lea",
          hostName: "Lea",
          participantIds: ["Lea"],
          workIds: [],
          coverPath: null,
        }),
      ],
      engagements: [],
      follows: [],
    };
    const page = assembleWalk({
      lane: "public",
      viewer: anonViewer(),
      pools,
      cursor: null,
    });
    assert.equal(page.scenario, "public", title);
    assert.equal(
      page.modules.some((mod) => mod.type === "exhibition_card"),
      false,
      title
    );
    assert.equal(
      page.modules.some((mod) => mod.type === "related_network"),
      false,
      title
    );
    const gallery = page.modules.find((mod) => mod.type === "artwork_gallery");
    assert.ok(gallery && gallery.type === "artwork_gallery", title);
    assert.ok(gallery.works.length >= 1, title);
    assert.deepEqual(
      gallery.works.map((row) => row.title),
      ["Mother", "Untitled", "Narrow Opening"]
    );
    for (const mod of page.modules) {
      for (const value of Object.values(mod.reason.params)) {
        assert.notEqual(value.trim().toLowerCase(), "title");
        assert.notEqual(value.trim(), "");
      }
    }
    const blob = JSON.stringify(page.modules);
    assert.equal(blob.includes("People in title"), false);
    assert.equal(blob.includes("Now on view: title"), false);
  }
}

function isWorkModule(mod: FeedModule): boolean {
  return mod.type === "artwork_gallery" || mod.type === "related_artwork" || mod.type === "curators_view";
}

function isMixedPage(modules: FeedModule[]): boolean {
  const nonArtwork = modules.some(
    (mod) => mod.type === "artist_card" || mod.type === "exhibition_card" || mod.type === "related_network"
  );
  const works = modules.some(
    (mod) => isWorkModule(mod) || (mod.type === "artist_card" && mod.works.length > 0)
  );
  return nonArtwork && works && modules.length > 0 && modules.length <= 6;
}

function thinCatalog(): WalkPools {
  const people = [
    person({ id: "A", name: "Ada" }),
    person({ id: "B", name: "Bea" }),
    person({ id: "C", name: "Cara" }),
  ];
  const works = [
    work({ id: "W1", artistId: "A", title: "North Piece" }),
    work({ id: "W2", artistId: "B", title: "South Piece" }),
    work({ id: "W3", artistId: "C", title: "East Piece" }),
    work({ id: "W4", artistId: "A", title: "West Piece" }),
    work({ id: "W5", artistId: "B", title: "Later Piece" }),
    work({ id: "W6", artistId: "C", title: "Last Piece" }),
  ];
  const exhibitions = [
    exhibition({
      id: "E1",
      title: "North Hall",
      curatorId: "A",
      participantIds: [],
      workIds: [],
    }),
    exhibition({
      id: "E2",
      title: "South Hall",
      curatorId: "B",
      participantIds: [],
      workIds: [],
    }),
  ];
  return { people, works, exhibitions, engagements: [], follows: [] };
}

function testNextPageStaysMixed() {
  const { viewer: me, pools } = world();
  const first = assembleWalk({ lane: "personalized", viewer: me, pools, cursor: null });
  const second = assembleWalk({
    lane: "personalized",
    viewer: me,
    pools,
    cursor: decodeCursor(first.nextCursor),
  });
  assert.equal(isMixedPage(second.modules), true);
  assert.equal(second.modules.every(isWorkModule), false);

  const bare = viewer({
    id: "V",
    school: null,
    city: null,
    medium: null,
    exhibitionIds: [],
    followingIds: [],
    savedArtworkIds: [],
    inquiredArtworkIds: [],
    likedArtworkIds: [],
  });
  const thin = thinCatalog();
  const opened = assembleWalk({ lane: "personalized", viewer: bare, pools: thin, cursor: null });
  assert.equal(opened.scenario, "public");
  assert.equal(isMixedPage(opened.modules), true);
  for (const mod of opened.modules) {
    assert.equal(mod.reason.key.startsWith("feed.walk.public."), true, mod.reason.key);
    assert.equal(mod.reason.params.school, undefined);
  }
  const continued = assembleWalk({
    lane: "personalized",
    viewer: bare,
    pools: thin,
    cursor: decodeCursor(opened.nextCursor),
  });
  assert.equal(isMixedPage(continued.modules), true);
  assert.equal(continued.modules.every(isWorkModule), false);
  const seen = new Set(idsOf(opened.modules).exhibitions);
  assert.ok(seen.size > 0);
  for (const id of idsOf(continued.modules).exhibitions) {
    assert.equal(seen.has(id), false, id);
  }
  assertReal(opened.modules, thin);
  assertReal(continued.modules, thin);
}

function testArtworkOnlyWhenNoExhibitionsLeft() {
  const pools: WalkPools = {
    people: [
      person({ id: "A", name: "Ada" }),
      person({ id: "B", name: "Bea" }),
      person({ id: "C", name: "Cara" }),
    ],
    works: [
      work({ id: "W1", artistId: "A" }),
      work({ id: "W2", artistId: "B" }),
      work({ id: "W3", artistId: "C" }),
      work({ id: "W4", artistId: "A" }),
      work({ id: "W5", artistId: "B" }),
      work({ id: "W6", artistId: "C" }),
    ],
    exhibitions: [],
    engagements: [],
    follows: [],
  };
  const page = assembleWalk({ lane: "public", viewer: anonViewer(), pools, cursor: null });
  assert.ok(page.modules.length > 0);
  assert.equal(page.modules.every(isWorkModule), true);
}

function testNewPassWhenExhibitionsWereUsed() {
  const people = [
    person({ id: "A", name: "Ada" }),
    person({ id: "B", name: "Bea" }),
    person({ id: "C", name: "Cara" }),
  ];
  const works = [
    work({ id: "W1", artistId: "A" }),
    work({ id: "W2", artistId: "B" }),
    work({ id: "W3", artistId: "C" }),
    work({ id: "W4", artistId: "A" }),
    work({ id: "W5", artistId: "B" }),
    work({ id: "W6", artistId: "C" }),
  ];
  const exhibitions = [
    exhibition({ id: "E1", title: "Old Hall", curatorId: "A", participantIds: ["A"], workIds: [] }),
    exhibition({ id: "E2", title: "Mid Hall", curatorId: "B", participantIds: ["B"], workIds: [] }),
    exhibition({ id: "E3", title: "New Hall", curatorId: "C", participantIds: ["C"], workIds: [] }),
  ];
  const pools: WalkPools = { people, works, exhibitions, engagements: [], follows: [] };
  const cursor = decodeCursor(
    encodeCursor({
      v: 1,
      si: 0,
      off: 3,
      used: ["e:E1", "e:E2", "e:E3", "p:A", "p:B", "p:C", "w:W1"],
    })
  );
  const page = assembleWalk({ lane: "public", viewer: anonViewer(), pools, cursor });
  assert.equal(isMixedPage(page.modules), true);
  assert.equal(page.modules.every(isWorkModule), false);
  const shown = idsOf(page.modules).exhibitions;
  assert.ok(shown.includes("E1"));
  assert.equal(shown.includes("E2"), false);
  assert.equal(shown.includes("E3"), false);
  assertReal(page.modules, pools);
}

function testPlannedExhibitionStaysOffPublicWalk() {
  const people = [
    person({ id: "A", name: "규원", username: "lea" }),
    person({ id: "B", name: "Bea" }),
    person({ id: "C", name: "Cara" }),
  ];
  const works = [
    work({ id: "W1", artistId: "A" }),
    work({ id: "W2", artistId: "B" }),
    work({ id: "W3", artistId: "C" }),
  ];
  const draft = exhibition({
    id: "Test",
    title: "Test",
    status: "planned",
    curatorId: "A",
    participantIds: ["A"],
    workIds: [],
  });
  const live = exhibition({
    id: "Live",
    title: "North Hall",
    status: "live",
    curatorId: "B",
    participantIds: ["B"],
    workIds: [],
  });
  const pools: WalkPools = {
    people,
    works,
    exhibitions: [draft, live],
    engagements: [],
    follows: [],
  };
  const page = assembleWalk({ lane: "public", viewer: anonViewer(), pools, cursor: null });
  const shown = idsOf(page.modules).exhibitions;
  assert.equal(shown.includes("Test"), false);
  assert.ok(shown.includes("Live"));

  const onlyDraft = assembleWalk({
    lane: "public",
    viewer: anonViewer(),
    pools: { ...pools, exhibitions: [draft] },
    cursor: null,
  });
  assert.equal(idsOf(onlyDraft.modules).exhibitions.includes("Test"), false);
  assert.ok(onlyDraft.modules.length > 0);
  assert.equal(onlyDraft.modules.every(isWorkModule), true);
}

testOrderAndCursor();
testSkipWhenMissing();
testEmptyWhenNothingReal();
testCollectorEndsOnExhibition();
testLoggedOutIsPublic();
testFollowingGroupsRealFollows();
testBadCursorRestarts();
testPlaceholderExhibitionOmitsShells();
testNextPageStaysMixed();
testArtworkOnlyWhenNoExhibitionsLeft();
testNewPassWhenExhibitionsWereUsed();
testPlannedExhibitionStaysOffPublicWalk();

console.log("feed-walk-assemble: ok");
