// Artist + Collector profile, zero collected works (the @kyungeuh screen).
// Collector used to write active=OWNS. The strip omits OWNS when owns is 0,
// so the strip guard wrote active=all on the next commit. Those two
// commits painted the artist grid and the empty collected state forever.
// After one change, the view must stay. A later commit must not walk it back.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getOrderedPersonaTabs, getPersonaCounts, isOwnArtistWork } from "../src/lib/provenance/personaTabs";
import type { ArtworkWithLikes } from "../src/lib/supabase/artworks";
import {
  buildStudioStripTabs,
  filterStripForPublicView,
  type ActiveStudioTab,
} from "../src/lib/studio/studioPortfolioConfig";
import {
  isCollectedRoleView,
  profileActiveAfterRoleWriters,
  stripListsActive,
  type ProfileRoleTab,
  type ProfileStripRow,
} from "../src/lib/studio/profileRoleTab";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profileId = "00000000-0000-4000-8000-0000000000e1";
const customId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const authored = {
  id: "00000000-0000-4000-8000-0000000000a1",
  artist_id: profileId,
  title: "kids",
  claims: [],
} as unknown as ArtworkWithLikes;

// 7aaad9e: a claim does not make the artist, and an authored work with no
// OWNS claim is still the artist's work. It does not create a collected tab.
assert.equal(isOwnArtistWork(authored, profileId), true);
const counts = getPersonaCounts([authored], profileId);
assert.equal(counts.created, 1);
assert.equal(counts.owns, 0);
assert.equal(
  getOrderedPersonaTabs(
    counts,
    1,
    { main_role: "artist", roles: ["artist", "collector"] },
    null,
  ).some((item) => item.tab === "OWNS"),
  false,
);

const stripPublic = filterStripForPublicView(
  buildStudioStripTabs({
    profileId,
    artworks: [authored],
    exhibitionsCount: 1,
    mainRole: "artist",
    roles: ["artist", "collector"],
    portfolio: {
      version: 1,
      custom_tabs: [
        { id: customId, label: "굿즈", public: true, artwork_ids: [], kind: "art_goods" },
      ],
      tab_strip_order: ["all", "exhibitions", "CREATED", `c:${customId}`],
    },
    defaultTabLabels: {
      all: "All",
      exhibitions: "Shows",
      CREATED: "Work",
      OWNS: "Collected",
      INVENTORY: "Gallery",
      CURATED: "Curated",
    },
  }),
);
assert.equal(
  stripPublic.some((row) => row.kind === "persona" && row.personaTab === "OWNS"),
  false,
  "empty collection is not a strip tab",
);
assert.equal(
  stripPublic.some((row) => row.kind === "persona" && row.personaTab === "all"),
  true,
);
assert.equal(
  stripPublic.some((row) => row.kind === "persona" && row.personaTab === "exhibitions"),
  true,
);
assert.equal(
  stripPublic.some((row) => row.kind === "custom" && row.customId === customId),
  true,
);

function tabKey(active: ActiveStudioTab): string {
  return active.kind === "persona" ? active.tab : `custom:${active.id}`;
}

function viewKey(role: ProfileRoleTab, active: ActiveStudioTab): string {
  return isCollectedRoleView(role, true) ? "collected" : tabKey(active);
}

/**
 * The old pair of effects, modeled as separate commits.
 * Both close over the active value from that render. The strip effect is
 * declared first; the role effect is second and wins when both set state.
 */
function historicalFrames(role: ProfileRoleTab, start: ActiveStudioTab, frames = 6): string[] {
  const painted: string[] = [];
  let active = start;
  for (let i = 0; i < frames; i++) {
    let next = active;
    const stripRejects = !stripListsActive(stripPublic, active);
    const roleWritesOwns =
      role === "collector" && !(active.kind === "persona" && active.tab === "OWNS");
    const roleLeavesOwns =
      role === "artist" && active.kind === "persona" && active.tab === "OWNS";
    if (roleWritesOwns) next = { kind: "persona", tab: "OWNS" };
    else if (roleLeavesOwns) next = { kind: "persona", tab: "all" };
    else if (stripRejects) next = { kind: "persona", tab: "all" };
    painted.push(tabKey(next));
    active = next;
  }
  return painted;
}

function replay(role: ProfileRoleTab, start: ActiveStudioTab, frames = 6) {
  const activeKeys: string[] = [];
  const views: string[] = [];
  let active = start;
  for (let i = 0; i < frames; i++) {
    const next = profileActiveAfterRoleWriters({
      roleTab: role,
      active,
      showRoleTabs: true,
      stripLists: (tab) => stripListsActive(stripPublic, tab),
    });
    if (i > 0) {
      assert.equal(next, active, `${role} writer scheduled another commit at frame ${i}`);
    }
    activeKeys.push(tabKey(next));
    views.push(viewKey(role, next));
    active = next;
  }
  return { activeKeys, views, active };
}

const artistWorks: ActiveStudioTab = { kind: "persona", tab: "all" };
const created: ActiveStudioTab = { kind: "persona", tab: "CREATED" };
const exhibitions: ActiveStudioTab = { kind: "persona", tab: "exhibitions" };
const goods: ActiveStudioTab = { kind: "custom", id: customId };
const missingGoods: ActiveStudioTab = {
  kind: "custom",
  id: "bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff",
};

const bug = historicalFrames("collector", artistWorks);
assert.deepEqual(bug, ["OWNS", "all", "OWNS", "all", "OWNS", "all"]);
assert.notEqual(bug[0], bug[1]);
assert.equal(bug[2], bug[0], "the old commits walk back");

const collected = replay("collector", artistWorks);
assert.deepEqual(collected.views, ["collected", "collected", "collected", "collected", "collected", "collected"]);
assert.deepEqual(collected.activeKeys, ["all", "all", "all", "all", "all", "all"]);
assert.equal(collected.active, artistWorks, "collector click does not replace the artist tab object");
assert.notDeepEqual(collected.views, bug);

const backToArtist = replay("artist", collected.active);
assert.deepEqual(backToArtist.views, ["all", "all", "all", "all", "all", "all"]);
assert.equal(backToArtist.views.includes("collected"), false);
assert.equal(backToArtist.views.includes("OWNS"), false);

const fromCreated = replay("collector", created);
assert.deepEqual(fromCreated.views, ["collected", "collected", "collected", "collected", "collected", "collected"]);
assert.deepEqual(fromCreated.activeKeys, ["CREATED", "CREATED", "CREATED", "CREATED", "CREATED", "CREATED"]);
const createdAgain = replay("artist", fromCreated.active);
assert.deepEqual(createdAgain.views, ["CREATED", "CREATED", "CREATED", "CREATED", "CREATED", "CREATED"]);
assert.equal(createdAgain.active, created);

const fromShows = replay("collector", exhibitions);
assert.deepEqual(fromShows.views, ["collected", "collected", "collected", "collected", "collected", "collected"]);
assert.equal(tabKey(fromShows.active), "exhibitions");
const showsAgain = replay("artist", fromShows.active);
assert.deepEqual(showsAgain.views, [
  "exhibitions",
  "exhibitions",
  "exhibitions",
  "exhibitions",
  "exhibitions",
  "exhibitions",
]);
assert.equal(showsAgain.active, exhibitions);

const fromGoods = replay("collector", goods);
assert.deepEqual(fromGoods.views, ["collected", "collected", "collected", "collected", "collected", "collected"]);
assert.equal(tabKey(fromGoods.active), `custom:${customId}`);
const goodsAgain = replay("artist", fromGoods.active);
assert.deepEqual(goodsAgain.views, [
  `custom:${customId}`,
  `custom:${customId}`,
  `custom:${customId}`,
  `custom:${customId}`,
  `custom:${customId}`,
  `custom:${customId}`,
]);
assert.equal(goodsAgain.active, goods);

const dropped = replay("artist", missingGoods);
assert.deepEqual(dropped.views, ["all", "all", "all", "all", "all", "all"]);
assert.notEqual(dropped.active, missingGoods);

// Owns count > 0 lists OWNS. Collector still must not bounce through it.
const ownedStrip: ProfileStripRow[] = [
  ...stripPublic,
  { kind: "persona", personaTab: "OWNS" },
];
{
  let active: ActiveStudioTab = artistWorks;
  const views: string[] = [];
  for (let i = 0; i < 6; i++) {
    const next = profileActiveAfterRoleWriters({
      roleTab: "collector",
      active,
      showRoleTabs: true,
      stripLists: (tab) => stripListsActive(ownedStrip, tab),
    });
    if (i > 0) assert.equal(next, active);
    views.push(isCollectedRoleView("collector", true) ? "collected" : tabKey(next));
    active = next;
  }
  assert.deepEqual(views, ["collected", "collected", "collected", "collected", "collected", "collected"]);
  assert.equal(tabKey(active), "all");
}

// Artist role does not keep a collected filter, and does not oscillate.
{
  const owns: ActiveStudioTab = { kind: "persona", tab: "OWNS" };
  const left = replay("artist", owns);
  assert.deepEqual(left.views, ["all", "all", "all", "all", "all", "all"]);
  assert.equal(left.activeKeys.includes("OWNS"), false);
}

// No role tabs (solo profile): a listed tab stays, a missing one falls back once.
{
  const owns: ActiveStudioTab = { kind: "persona", tab: "OWNS" };
  let active: ActiveStudioTab = owns;
  const keys: string[] = [];
  for (let i = 0; i < 4; i++) {
    const next = profileActiveAfterRoleWriters({
      roleTab: "artist",
      active,
      showRoleTabs: false,
      stripLists: (tab) => stripListsActive(ownedStrip, tab),
    });
    if (i > 0) assert.equal(next, active);
    keys.push(tabKey(next));
    active = next;
  }
  assert.deepEqual(keys, ["OWNS", "OWNS", "OWNS", "OWNS"]);
}

const profileSrc = readFileSync(path.join(root, "src/components/UserProfileContent.tsx"), "utf8");
assert.equal(profileSrc.includes('setActive({ kind: "persona", tab: "OWNS" })'), false);
assert.match(profileSrc, /profileActiveAfterRoleWriters\(/);
assert.match(profileSrc, /const collectedView = isCollectedRoleView\(roleTab, showRoleTabs\)/);
assert.match(
  profileSrc,
  /if \(collectedView\) \{\s*return filterArtworksByPersona\(artworks, profile\.id, "OWNS"\);/,
);
assert.match(profileSrc, /!collectedView && active\.kind === "persona" && active\.tab === "exhibitions"/);
assert.match(profileSrc, /setLikesOpen\(false\); setRoleTab\("collector"\)/);
assert.match(profileSrc, /setLikesOpen\(false\); setRoleTab\("artist"\)/);
assert.match(profileSrc, /t\("profile\.collectorEmpty"\)/);
const collectorClick = profileSrc.slice(
  profileSrc.indexOf('setRoleTab("collector")') - 120,
  profileSrc.indexOf('setRoleTab("collector")') + 30,
);
assert.equal(collectorClick.includes("setActive"), false);
assert.equal(collectorClick.includes("router."), false);
assert.equal(collectorClick.includes("replaceState"), false);

console.log("profile-role-tab.test.ts: ok");
