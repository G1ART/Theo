import { keepVisibleModules } from "./content";
import { encodeCursor } from "./cursor";
import { pickExhibitionThumbs } from "./exhibitionThumbs";
import { isFilledSlot } from "./fill";
import type {
  FeedModule,
  WalkCopy,
  WalkCredit,
  WalkExhibition,
  WalkExhibitionView,
  WalkLane,
  WalkPage,
  WalkPerson,
  WalkPersonView,
  WalkPools,
  WalkScenario,
  WalkViewer,
  WalkWork,
  WalkWorkView,
  WalkCursor,
} from "./types";

/**
 * Personalized walks, in story order. `public` is last so a signed-in
 * viewer whose own signals cannot fill a room still sees real catalog
 * rows, with public reasons — never a pretended school or exhibition.
 */
export const PERSONALIZED_SCENARIOS: readonly WalkScenario[] = [
  "exhibition_network",
  "shared_medium",
  "curatorial",
  "school",
  "local",
  "collector",
  "public",
];

const TRIO = 3;
const NETWORK_MAX = 4;
/** A scroll page stays a short chapter, not a second full feed. */
const PAGE_MAX = 6;
/** Exhibitions and people from the previous page stay blocked on a new pass. */
const IMMEDIATE_EXHIBITIONS = 2;
const IMMEDIATE_PEOPLE = 4;

export type AssembleInput = {
  lane: WalkLane;
  viewer: WalkViewer;
  pools: WalkPools;
  cursor: WalkCursor | null;
};

type Indexes = {
  people: Map<string, WalkPerson>;
  works: Map<string, WalkWork>;
  exhibitions: Map<string, WalkExhibition>;
  worksByArtist: Map<string, WalkWork[]>;
};

type Built = { modules: FeedModule[]; touch: string[] };

type Ctx = {
  viewer: WalkViewer;
  pools: WalkPools;
  idx: Indexes;
  used: Set<string>;
};

type FillMode = "strict" | "loose";

function blankPage(): WalkPage {
  return { scenario: null, modules: [], nextCursor: null };
}

export function assembleWalk(input: AssembleInput): WalkPage {
  const rotation = rotationFor(input.lane, input.viewer);
  if (rotation.length === 0) return blankPage();
  const start = input.cursor;
  const used = new Set(start?.used ?? []);
  const idx = indexPools(input.pools);
  const si0 = (start?.si ?? 0) % rotation.length;
  const off = start?.off ?? 0;
  const ctx: Ctx = { viewer: input.viewer, pools: input.pools, idx, used };

  // Following is its own lane. It does not borrow exhibition scenarios.
  if (rotation.length === 1 && rotation[0] === "following") {
    return walkRotation(ctx, rotation, si0, off, null, "strict") ?? blankPage();
  }

  const strict = walkRotation(ctx, rotation, si0, off, null, "strict");
  if (strict && hasNonArtwork(strict.modules)) return strict;

  const loose = walkRotation(ctx, rotation, si0, off, null, "loose");
  if (loose && hasNonArtwork(loose.modules)) return loose;

  // Used exhibitions/people blocked every scenario. Release older ids and
  // start at the next scenario instead of padding with artwork galleries.
  const released = releaseForNewPass(used);
  if (released.size < used.size && filledShows(ctx).length > 0) {
    const passCtx: Ctx = { viewer: ctx.viewer, pools: ctx.pools, idx: ctx.idx, used: released };
    const nextSi = (si0 + 1) % rotation.length;
    const againStrict = walkRotation(passCtx, rotation, nextSi, off, used, "strict");
    if (againStrict && hasNonArtwork(againStrict.modules)) return againStrict;
    const againLoose = walkRotation(passCtx, rotation, nextSi, off, used, "loose");
    if (againLoose && hasNonArtwork(againLoose.modules)) return againLoose;
  }

  if (unusedShows(ctx).length > 0) return blankPage();
  const worksOnly = publicWorksOnly(ctx, catalogWorks(ctx));
  if (!worksOnly) return blankPage();
  const modules = keepVisibleModules(worksOnly.modules).slice(0, PAGE_MAX);
  if (modules.length === 0) return blankPage();
  return finishPage("public", modules, worksOnly.touch, used, (si0 + 1) % rotation.length, off);
}

function rotationFor(lane: WalkLane, viewer: WalkViewer): WalkScenario[] {
  if (lane === "following") return viewer.id ? ["following"] : [];
  if (lane === "public" || !viewer.id) return ["public"];
  return [...PERSONALIZED_SCENARIOS];
}

function walkRotation(
  ctx: Ctx,
  rotation: readonly WalkScenario[],
  si0: number,
  off: number,
  history: Set<string> | null,
  mode: FillMode
): WalkPage | null {
  let si = si0;
  for (let n = 0; n < rotation.length; n++) {
    const name = rotation[si]!;
    const built = buildScenario(name, ctx, mode);
    const modules = built ? keepVisibleModules(built.modules).slice(0, PAGE_MAX) : [];
    const followingLane = rotation.length === 1 && rotation[0] === "following";
    if (built && modules.length > 0 && (followingLane || hasNonArtwork(modules))) {
      return finishPage(name, modules, built.touch, history ?? ctx.used, (si + 1) % rotation.length, off);
    }
    si = (si + 1) % rotation.length;
  }
  return null;
}

function finishPage(
  scenario: WalkScenario,
  modules: FeedModule[],
  touch: readonly string[],
  history: Set<string>,
  nextSi: number,
  off: number
): WalkPage {
  const committed = new Set(history);
  for (const key of touch) {
    committed.delete(key);
    committed.add(key);
  }
  return {
    scenario,
    modules,
    nextCursor: encodeCursor({
      v: 1,
      si: nextSi,
      off: off + 1,
      used: [...committed].slice(-400),
    }),
  };
}

function hasNonArtwork(modules: readonly FeedModule[]): boolean {
  return modules.some(
    (mod) => mod.type === "artist_card" || mod.type === "exhibition_card" || mod.type === "related_network"
  );
}

function filledShows(ctx: Ctx): WalkExhibition[] {
  return ctx.pools.exhibitions.filter((row) => isFilledSlot(row.title));
}

/** Draft rows stay in the owner's own scenarios. The public walk skips them. */
function isPublicExhibition(exhibition: WalkExhibition): boolean {
  if (exhibition.status === undefined) return true;
  return exhibition.status === "live" || exhibition.status === "ended";
}

function unusedShows(ctx: Ctx): WalkExhibition[] {
  return filledShows(ctx).filter((row) => isPublicExhibition(row) && !ctx.used.has(keyE(row.id)));
}

function catalogWorks(ctx: Ctx): WalkWork[] {
  return ctx.pools.works.filter((work) => ctx.idx.people.has(work.artistId));
}

function releaseForNewPass(used: Set<string>): Set<string> {
  const list = [...used];
  const keepE = new Set(list.filter((key) => key.startsWith("e:")).slice(-IMMEDIATE_EXHIBITIONS));
  const keepP = new Set(list.filter((key) => key.startsWith("p:")).slice(-IMMEDIATE_PEOPLE));
  const next = new Set<string>();
  for (const key of list) {
    if (key.startsWith("e:") && !keepE.has(key)) continue;
    if (key.startsWith("p:") && !keepP.has(key)) continue;
    next.add(key);
  }
  return next;
}

function buildScenario(name: WalkScenario, ctx: Ctx, mode: FillMode): Built | null {
  if (mode === "loose") return buildLoose(name, ctx);
  switch (name) {
    case "exhibition_network":
      return buildExhibitionNetwork(ctx);
    case "shared_medium":
      return buildSharedMedium(ctx);
    case "curatorial":
      return buildCuratorial(ctx);
    case "school":
      return buildSchool(ctx);
    case "local":
      return buildLocal(ctx);
    case "collector":
      return buildCollector(ctx);
    case "public":
      return buildPublic(ctx);
    case "following":
      return buildFollowing(ctx);
    default:
      return null;
  }
}

function buildLoose(name: WalkScenario, ctx: Ctx): Built | null {
  switch (name) {
    case "exhibition_network":
      return looseExhibitionNetwork(ctx);
    case "shared_medium":
      return looseSharedMedium(ctx);
    case "curatorial":
      return looseCuratorial(ctx);
    case "school":
      return looseSchool(ctx);
    case "local":
      return looseLocal(ctx);
    case "collector":
      return looseCollector(ctx);
    case "public":
      return loosePublic(ctx);
    default:
      return null;
  }
}

function indexPools(pools: WalkPools): Indexes {
  const people = new Map(pools.people.map((p) => [p.id, p]));
  const works = new Map(pools.works.map((w) => [w.id, w]));
  const exhibitions = new Map(pools.exhibitions.map((e) => [e.id, e]));
  const worksByArtist = new Map<string, WalkWork[]>();
  for (const work of pools.works) {
    const list = worksByArtist.get(work.artistId) ?? [];
    list.push(work);
    worksByArtist.set(work.artistId, list);
  }
  return { people, works, exhibitions, worksByArtist };
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function same(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = norm(a);
  const right = norm(b);
  return left.length > 0 && left === right;
}

function keyP(id: string): string {
  return `p:${id}`;
}
function keyW(id: string): string {
  return `w:${id}`;
}
function keyE(id: string): string {
  return `e:${id}`;
}

type Gate = {
  takePerson: (person: WalkPerson | null | undefined) => WalkPerson | null;
  takeExhibition: (exhibition: WalkExhibition | null | undefined) => WalkExhibition | null;
  takeWorks: (works: WalkWork[], count: number) => WalkWork[] | null;
  takeSome: (works: WalkWork[], min: number, max: number) => WalkWork[] | null;
  takeArtistWorks: (artistId: string, min: number, max?: number) => WalkWork[] | null;
  takePeople: (ids: string[], min: number, max?: number) => WalkPerson[] | null;
  touch: string[];
};

function openGate(ctx: Ctx): Gate {
  const blocked = new Set(ctx.used);
  const touch: string[] = [];

  function claim(key: string) {
    blocked.add(key);
    touch.push(key);
  }

  function workOk(work: WalkWork): boolean {
    return ctx.idx.people.has(work.artistId) && !blocked.has(keyW(work.id));
  }

  return {
    touch,
    takePerson(person) {
      if (!person || person.id === ctx.viewer.id) return null;
      const key = keyP(person.id);
      if (blocked.has(key) || !ctx.idx.people.has(person.id)) return null;
      claim(key);
      return person;
    },
    takeExhibition(exhibition) {
      if (!exhibition || !isFilledSlot(exhibition.title)) return null;
      const key = keyE(exhibition.id);
      if (blocked.has(key)) return null;
      claim(key);
      return exhibition;
    },
    takeSome(works, min, max) {
      const picked: WalkWork[] = [];
      const cap = Math.max(min, max);
      for (const work of works) {
        if (picked.length === cap) break;
        if (!workOk(work)) continue;
        picked.push(work);
      }
      if (picked.length < min) return null;
      for (const work of picked) claim(keyW(work.id));
      return picked;
    },
    takeWorks(works, count) {
      return this.takeSome(works, count, count);
    },
    takeArtistWorks(artistId, min, max = 3) {
      const list = ctx.idx.worksByArtist.get(artistId) ?? [];
      const picked: WalkWork[] = [];
      for (const work of list) {
        if (picked.length === max) break;
        if (!workOk(work)) continue;
        picked.push(work);
      }
      if (picked.length < min) return null;
      for (const work of picked) claim(keyW(work.id));
      return picked;
    },
    takePeople(ids, min, max = NETWORK_MAX) {
      const picked: WalkPerson[] = [];
      const seen = new Set<string>();
      for (const id of ids) {
        if (picked.length === max) break;
        if (seen.has(id) || id === ctx.viewer.id) continue;
        const person = ctx.idx.people.get(id);
        if (!person) continue;
        const key = keyP(id);
        if (blocked.has(key)) continue;
        seen.add(id);
        picked.push(person);
      }
      if (picked.length < min) return null;
      for (const person of picked) claim(keyP(person.id));
      return picked;
    },
  };
}

function copy(key: string, params: Record<string, string> = {}): WalkCopy {
  return { key, params };
}

function toPerson(person: WalkPerson): WalkPersonView {
  return {
    id: person.id,
    name: person.name,
    username: person.username,
    avatarUrl: person.avatarUrl,
    oneLine: person.oneLine,
    school: person.school,
    city: person.city,
    role: person.role,
    mutualNames: person.mutualNames ? [...person.mutualNames] : person.mutualNames,
    mutualAvatars: person.mutualAvatars ? [...person.mutualAvatars] : person.mutualAvatars ?? null,
    viewerFollows: person.viewerFollows,
  };
}

function toCredit(person: WalkPerson | undefined, fallbackName: string | null): WalkCredit | null {
  const name = person?.name?.trim() || fallbackName?.trim() || "";
  if (!name) return null;
  return {
    id: person?.id ?? null,
    name,
    username: person?.username ?? null,
    avatarUrl: person?.avatarUrl ?? null,
  };
}

function galleryName(exhibition: WalkExhibition, idx: Indexes): string | null {
  if (exhibition.hostName && exhibition.hostName.trim()) return exhibition.hostName.trim();
  if (!exhibition.hostProfileId) return null;
  const host = idx.people.get(exhibition.hostProfileId);
  return host?.name?.trim() || null;
}

function toExhibition(exhibition: WalkExhibition, idx: Indexes): WalkExhibitionView {
  const curator = idx.people.get(exhibition.curatorId);
  const host = exhibition.hostProfileId ? idx.people.get(exhibition.hostProfileId) : undefined;
  return {
    id: exhibition.id,
    title: exhibition.title,
    startDate: exhibition.startDate,
    endDate: exhibition.endDate,
    curator: toCredit(curator, null),
    gallery: toCredit(host, galleryName(exhibition, idx)),
    coverPath: exhibition.coverPath,
    city: exhibition.city,
    works: exhibitionCardThumbs(exhibition, idx),
  };
}

function exhibitionCardThumbs(exhibition: WalkExhibition, idx: Indexes) {
  const options = { feedThumbWorkIds: exhibition.feedThumbWorkIds };
  if (exhibition.thumbs != null) {
    return pickExhibitionThumbs(exhibition.thumbs, options);
  }
  const fromPool = exhibition.workIds.flatMap((id) => {
    const work = idx.works.get(id);
    if (!work) return [];
    return [
      {
        id: work.id,
        imagePath: work.imagePath,
        artistId: work.artistId,
        visibility: "public" as const,
        workKind: "artwork" as const,
      },
    ];
  });
  return pickExhibitionThumbs(fromPool, options);
}

function toWork(work: WalkWork, idx: Indexes): WalkWorkView {
  const artist = idx.people.get(work.artistId);
  const exhibition =
    work.exhibitionIds
      .map((id) => idx.exhibitions.get(id))
      .find((row): row is WalkExhibition => !!row) ?? null;
  const curator = exhibition ? idx.people.get(exhibition.curatorId) : undefined;
  const host = exhibition?.hostProfileId ? idx.people.get(exhibition.hostProfileId) : undefined;
  return {
    id: work.id,
    title: work.title,
    year: work.year,
    medium: work.medium,
    artistId: work.artistId,
    artistName: artist?.name ?? "",
    artistUsername: artist?.username ?? null,
    artistAvatarUrl: artist?.avatarUrl ?? null,
    imagePath: work.imagePath,
    curator: toCredit(curator, null),
    gallery: exhibition ? toCredit(host, galleryName(exhibition, idx)) : null,
  };
}

function mod(
  type: FeedModule["type"],
  scenario: WalkScenario,
  slot: string,
  title: WalkCopy,
  reason: WalkCopy,
  extra: Record<string, unknown>
): FeedModule {
  const anchor = moduleAnchor(extra);
  return {
    type,
    key: `${scenario}:${slot}:${anchor}`,
    title,
    reason,
    ...extra,
  } as FeedModule;
}

function moduleAnchor(extra: Record<string, unknown>): string {
  const person = extra.person as { id?: string } | undefined;
  const exhibition = extra.exhibition as { id?: string } | undefined;
  const works = extra.works as { id?: string }[] | undefined;
  const people = extra.people as { id?: string }[] | undefined;
  return person?.id || exhibition?.id || works?.[0]?.id || people?.[0]?.id || "row";
}

function worksOfArtists(ids: string[], ctx: Ctx): WalkWork[] {
  const set = new Set(ids);
  return ctx.pools.works.filter((work) => set.has(work.artistId));
}

function likersOf(workIds: Set<string>, ctx: Ctx): WalkPerson[] {
  const seen = new Set<string>();
  const out: WalkPerson[] = [];
  for (const edge of ctx.pools.engagements) {
    if (edge.kind !== "like" || !workIds.has(edge.artworkId) || seen.has(edge.userId)) continue;
    const person = ctx.idx.people.get(edge.userId);
    if (!person || person.role !== "artist" || person.id === ctx.viewer.id) continue;
    seen.add(edge.userId);
    out.push(person);
  }
  return out;
}

function likedWorksBy(userId: string, ctx: Ctx): WalkWork[] {
  const out: WalkWork[] = [];
  const seen = new Set<string>();
  for (const edge of ctx.pools.engagements) {
    if (edge.kind !== "like" || edge.userId !== userId || seen.has(edge.artworkId)) continue;
    const work = ctx.idx.works.get(edge.artworkId);
    if (!work) continue;
    seen.add(work.id);
    out.push(work);
  }
  return out;
}

function networkIds(personId: string, ctx: Ctx): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  function add(id: string) {
    if (!id || id === personId || id === ctx.viewer.id || seen.has(id)) return;
    if (!ctx.idx.people.has(id)) return;
    seen.add(id);
    ids.push(id);
  }
  for (const edge of ctx.pools.follows) {
    if (edge.followerId === personId) add(edge.followingId);
    if (edge.followingId === personId) add(edge.followerId);
  }
  for (const exhibition of ctx.pools.exhibitions) {
    if (!exhibition.participantIds.includes(personId)) continue;
    for (const id of exhibition.participantIds) add(id);
  }
  return ids;
}

function sameGallery(a: WalkExhibition, b: WalkExhibition): boolean {
  if (a.id === b.id) return false;
  if (a.hostProfileId && b.hostProfileId && a.hostProfileId === b.hostProfileId) return true;
  return same(a.hostName, b.hostName);
}

function buildExhibitionNetwork(ctx: Ctx): Built | null {
  if (!ctx.viewer.id) return null;
  for (const exhibitionId of ctx.viewer.exhibitionIds) {
    const shared = ctx.idx.exhibitions.get(exhibitionId);
    if (!shared) continue;
    for (const personId of shared.participantIds) {
      if (personId === ctx.viewer.id) continue;
      const person = ctx.idx.people.get(personId);
      if (!person) continue;
      const built = storyExhibition(ctx, person, shared);
      if (built) return built;
    }
  }
  return null;
}

function artistRail(ctx: Ctx, gate: Gate, person: WalkPerson): WalkWork[] | null {
  const fresh = gate.takeArtistWorks(person.id, 1, 3);
  if (fresh) return fresh;
  const any = (ctx.idx.worksByArtist.get(person.id) ?? [])
    .filter((work) => ctx.idx.people.has(work.artistId))
    .slice(0, 3);
  return any.length > 0 ? any : null;
}

function storyExhibition(ctx: Ctx, person: WalkPerson, shared: WalkExhibition): Built | null {
  const gate = openGate(ctx);
  const heroWorks = artistRail(ctx, gate, person);
  const hero = gate.takePerson(person);
  if (!hero || !heroWorks) return null;
  if (!gate.takeExhibition(shared)) return null;

  const other = ctx.pools.exhibitions.find(
    (row) =>
      row.id !== shared.id &&
      row.participantIds.includes(person.id) &&
      !ctx.used.has(keyE(row.id))
  );
  const otherTaken = gate.takeExhibition(other);
  if (!otherTaken) return null;

  const room = gate.takePeople(
    otherTaken.participantIds.filter((id) => id !== person.id),
    1
  );
  if (!room) return null;

  const roomWorks = gate.takeWorks(worksOfArtists(room.map((p) => p.id), ctx), TRIO);
  if (!roomWorks) return null;

  let engagedPerson: WalkPerson | null = null;
  let engagedWorks: WalkWork[] | null = null;
  for (const candidate of likersOf(new Set(otherTaken.workIds), ctx)) {
    if (candidate.id === person.id || room.some((p) => p.id === candidate.id)) continue;
    const works = artistRail(ctx, gate, candidate);
    const taken = works ? gate.takePerson(candidate) : null;
    if (works && taken) {
      engagedPerson = taken;
      engagedWorks = works;
      break;
    }
  }
  if (!engagedPerson || !engagedWorks) return null;

  const exhibitionName = shared.title;
  const otherName = otherTaken.title;
  return {
    touch: gate.touch,
    modules: [
      mod("artist_card", "exhibition_network", "person", copy("feed.walk.ex.person.title"), copy("feed.walk.ex.person.reason", { exhibition: exhibitionName, name: hero.name }), {
        person: toPerson(hero),
        works: heroWorks.map((work) => toWork(work, ctx.idx)),
      }),
      mod("exhibition_card", "exhibition_network", "next", copy("feed.walk.ex.nextShow.title"), copy("feed.walk.ex.nextShow.reason", { name: hero.name, exhibition: otherName }), {
        exhibition: toExhibition(otherTaken, ctx.idx),
      }),
      mod("related_network", "exhibition_network", "room", copy("feed.walk.ex.room.title"), copy("feed.walk.ex.room.reason", { exhibition: otherName }), {
        people: room.map(toPerson),
      }),
      mod("artwork_gallery", "exhibition_network", "works", copy("feed.walk.ex.works.title"), copy("feed.walk.ex.works.reason", { exhibition: otherName }), {
        works: roomWorks.map((work) => toWork(work, ctx.idx)),
      }),
      mod("artist_card", "exhibition_network", "engaged", copy("feed.walk.ex.engaged.title"), copy("feed.walk.ex.engaged.reason", { name: engagedPerson.name, exhibition: otherName }), {
        person: toPerson(engagedPerson),
        works: engagedWorks.map((work) => toWork(work, ctx.idx)),
      }),
    ],
  };
}

function buildSharedMedium(ctx: Ctx): Built | null {
  if (!ctx.viewer.id || !ctx.viewer.medium) return null;
  const medium = ctx.viewer.medium;
  const matching = ctx.pools.works.filter(
    (work) => work.artistId !== ctx.viewer.id && same(work.medium, medium)
  );
  const artistIds: string[] = [];
  for (const person of ctx.pools.people) {
    if (person.id === ctx.viewer.id) continue;
    const listed = person.mediums.some((item) => same(item, medium));
    const made = (ctx.idx.worksByArtist.get(person.id) ?? []).some((work) => same(work.medium, medium));
    if (listed || made) artistIds.push(person.id);
  }
  const shows = ctx.pools.exhibitions.filter((row) =>
    row.workIds.some((id) => {
      const work = ctx.idx.works.get(id);
      return !!work && same(work.medium, medium);
    })
  );
  for (const exhibition of shows) {
    const built = storySharedMedium(ctx, medium, matching, artistIds, exhibition);
    if (built) return built;
  }
  return null;
}

function storySharedMedium(
  ctx: Ctx,
  medium: string,
  matching: WalkWork[],
  artistIds: string[],
  exhibition: WalkExhibition
): Built | null {
  const gate = openGate(ctx);
  const gallery = gate.takeWorks(matching, TRIO);
  const artists = gate.takePeople(artistIds, 1);
  const show = gate.takeExhibition(exhibition);
  if (!gallery || !artists || !show) return null;
  const more = gate.takeWorks(worksOfArtists(artists.map((p) => p.id), ctx), TRIO);
  if (!more) return null;
  let interestedPerson: WalkPerson | null = null;
  let interestedWorks: WalkWork[] | null = null;
  for (const candidate of likersOf(new Set(show.workIds), ctx)) {
    if (artists.some((row) => row.id === candidate.id)) continue;
    const works = artistRail(ctx, gate, candidate);
    const taken = works ? gate.takePerson(candidate) : null;
    if (works && taken) {
      interestedPerson = taken;
      interestedWorks = works;
      break;
    }
  }
  if (!interestedPerson || !interestedWorks) return null;

  return {
    touch: gate.touch,
    modules: [
      mod("artwork_gallery", "shared_medium", "works", copy("feed.walk.medium.works.title"), copy("feed.walk.medium.works.reason", { medium }), {
        works: gallery.map((work) => toWork(work, ctx.idx)),
      }),
      mod("related_network", "shared_medium", "artists", copy("feed.walk.medium.artists.title"), copy("feed.walk.medium.artists.reason", { medium }), {
        people: artists.map(toPerson),
      }),
      mod("exhibition_card", "shared_medium", "show", copy("feed.walk.medium.show.title"), copy("feed.walk.medium.show.reason", { exhibition: show.title, medium }), {
        exhibition: toExhibition(show, ctx.idx),
      }),
      mod("related_artwork", "shared_medium", "more", copy("feed.walk.medium.more.title"), copy("feed.walk.medium.more.reason", { medium }), {
        works: more.map((work) => toWork(work, ctx.idx)),
      }),
      mod("artist_card", "shared_medium", "interested", copy("feed.walk.medium.interested.title"), copy("feed.walk.medium.interested.reason", { name: interestedPerson.name, exhibition: show.title }), {
        person: toPerson(interestedPerson),
        works: interestedWorks.map((work) => toWork(work, ctx.idx)),
      }),
    ],
  };
}

function buildCuratorial(ctx: Ctx): Built | null {
  if (!ctx.viewer.id) return null;
  const curators = ctx.pools.people.filter(
    (person) => person.role === "curator" && ctx.viewer.followingIds.includes(person.id)
  );
  for (const curator of curators) {
    const shows = ctx.pools.exhibitions.filter((row) => row.curatorId === curator.id);
    for (const show of shows) {
      const built = storyCuratorial(ctx, curator, show);
      if (built) return built;
    }
  }
  return null;
}

function storyCuratorial(ctx: Ctx, curator: WalkPerson, show: WalkExhibition): Built | null {
  const gate = openGate(ctx);
  const exhibition = gate.takeExhibition(show);
  if (!exhibition) return null;
  const artistCandidate = show.participantIds
    .map((id) => ctx.idx.people.get(id))
    .find((person) => person && person.id !== curator.id && person.role === "artist");
  const artistWorks = artistCandidate ? artistRail(ctx, gate, artistCandidate) : null;
  const artist = artistCandidate && artistWorks ? gate.takePerson(artistCandidate) : null;
  if (!artist || !artistWorks) return null;

  const curatorLikes = likedWorksBy(curator.id, ctx);
  const liked = gate.takeWorks(curatorLikes, TRIO);
  if (!liked) return null;

  let engagedPerson: WalkPerson | null = null;
  let engagedWorks: WalkWork[] | null = null;
  for (const person of ctx.pools.people) {
    if (person.id === artist.id || person.id === curator.id || person.role !== "artist") continue;
    if (!curatorLikes.some((work) => work.artistId === person.id)) continue;
    const works = artistRail(ctx, gate, person);
    const taken = works ? gate.takePerson(person) : null;
    if (works && taken) {
      engagedPerson = taken;
      engagedWorks = works;
      break;
    }
  }
  if (!engagedPerson || !engagedWorks) return null;

  const other = ctx.pools.exhibitions.find(
    (row) => row.id !== show.id && row.participantIds.includes(engagedPerson.id)
  );
  const otherShow = gate.takeExhibition(other);
  if (!otherShow) return null;

  const roomArtists = show.participantIds.filter((id) => {
    const person = ctx.idx.people.get(id);
    return person?.role === "artist";
  });
  const more = gate.takeWorks(worksOfArtists(roomArtists, ctx), TRIO);
  if (!more) return null;

  return {
    touch: gate.touch,
    modules: [
      mod("exhibition_card", "curatorial", "show", copy("feed.walk.curator.show.title"), copy("feed.walk.curator.show.reason", { name: curator.name, exhibition: exhibition.title }), {
        exhibition: toExhibition(exhibition, ctx.idx),
      }),
      mod("artist_card", "curatorial", "artist", copy("feed.walk.curator.artist.title"), copy("feed.walk.curator.artist.reason", { name: artist.name, exhibition: exhibition.title }), {
        person: toPerson(artist),
        works: artistWorks.map((work) => toWork(work, ctx.idx)),
      }),
      mod("curators_view", "curatorial", "works", copy("feed.walk.curator.works.title"), copy("feed.walk.curator.works.reason", { name: curator.name }), {
        works: liked.map((work) => toWork(work, ctx.idx)),
      }),
      mod("artist_card", "curatorial", "engaged", copy("feed.walk.curator.engagedArtist.title"), copy("feed.walk.curator.engagedArtist.reason", { curator: curator.name, name: engagedPerson.name }), {
        person: toPerson(engagedPerson),
        works: engagedWorks.map((work) => toWork(work, ctx.idx)),
      }),
      mod("exhibition_card", "curatorial", "other", copy("feed.walk.curator.otherShow.title"), copy("feed.walk.curator.otherShow.reason", { name: engagedPerson.name, exhibition: otherShow.title }), {
        exhibition: toExhibition(otherShow, ctx.idx),
      }),
      mod("related_artwork", "curatorial", "more", copy("feed.walk.curator.more.title"), copy("feed.walk.curator.more.reason", { exhibition: exhibition.title }), {
        works: more.map((work) => toWork(work, ctx.idx)),
      }),
    ],
  };
}

function buildSchool(ctx: Ctx): Built | null {
  if (!ctx.viewer.id || !ctx.viewer.school) return null;
  const school = ctx.viewer.school;
  const alumni = ctx.pools.people.filter(
    (person) => person.id !== ctx.viewer.id && same(person.school, school)
  );
  const alumniIds = alumni.map((person) => person.id);
  const shows = ctx.pools.exhibitions.filter((row) =>
    row.participantIds.some((id) => alumniIds.includes(id))
  );
  for (const exhibition of shows) {
    const built = storySchool(ctx, school, alumniIds, exhibition);
    if (built) return built;
  }
  return null;
}

function storySchool(ctx: Ctx, school: string, alumniIds: string[], exhibition: WalkExhibition): Built | null {
  const gate = openGate(ctx);
  const gallery = gate.takeWorks(worksOfArtists(alumniIds, ctx), TRIO);
  const show = gate.takeExhibition(exhibition);
  if (!gallery || !show) return null;
  const fromRoom = exhibition.participantIds
    .map((id) => ctx.idx.people.get(id))
    .find((person) => person && person.role === "artist" && same(person.school, school));
  const fromWorks = fromRoom ? artistRail(ctx, gate, fromRoom) : null;
  const fromPerson = fromRoom && fromWorks ? gate.takePerson(fromRoom) : null;
  if (!fromPerson || !fromWorks) return null;
  const network = gate.takePeople(
    alumniIds.filter((id) => id !== fromPerson.id),
    1
  );
  const more = gate.takeWorks(worksOfArtists(alumniIds, ctx), TRIO);
  if (!network || !more) return null;
  return {
    touch: gate.touch,
    modules: [
      mod("artwork_gallery", "school", "works", copy("feed.walk.school.works.title"), copy("feed.walk.school.works.reason", { school }), {
        works: gallery.map((work) => toWork(work, ctx.idx)),
      }),
      mod("related_network", "school", "people", copy("feed.walk.school.people.title"), copy("feed.walk.school.people.reason", { school }), {
        people: network.map(toPerson),
      }),
      mod("exhibition_card", "school", "show", copy("feed.walk.school.show.title"), copy("feed.walk.school.show.reason", { school, exhibition: show.title }), {
        exhibition: toExhibition(show, ctx.idx),
      }),
      mod("artist_card", "school", "artist", copy("feed.walk.school.artist.title"), copy("feed.walk.school.artist.reason", { name: fromPerson.name, exhibition: show.title }), {
        person: toPerson(fromPerson),
        works: fromWorks.map((work) => toWork(work, ctx.idx)),
      }),
      mod("related_artwork", "school", "more", copy("feed.walk.school.more.title"), copy("feed.walk.school.more.reason", { school }), {
        works: more.map((work) => toWork(work, ctx.idx)),
      }),
    ],
  };
}

function buildLocal(ctx: Ctx): Built | null {
  if (!ctx.viewer.id || !ctx.viewer.city) return null;
  const city = ctx.viewer.city;
  for (const candidate of ctx.pools.exhibitions) {
    if (!same(candidate.city, city)) continue;
    const built = storyLocal(ctx, candidate, city);
    if (built) return built;
  }
  return null;
}

function storyLocal(ctx: Ctx, seed: WalkExhibition, city: string): Built | null {
  const gate = openGate(ctx);
  const show = gate.takeExhibition(seed);
  if (!show) return null;
  const artistIds = seed.participantIds.filter((id) => ctx.idx.people.get(id)?.role === "artist");
  const artists = gate.takePeople(artistIds, 1);
  if (!artists) return null;

  const galleryWorks = ctx.pools.works.filter((work) =>
    work.exhibitionIds.some((id) => {
      const row = ctx.idx.exhibitions.get(id);
      return !!row && sameGallery(seed, row);
    })
  );
  const others = gate.takeWorks(galleryWorks, TRIO);
  if (!others) return null;

  const shownIds = new Set<string>();
  for (const exhibition of ctx.pools.exhibitions) {
    if (exhibition.id !== seed.id && !sameGallery(seed, exhibition)) continue;
    for (const id of exhibition.participantIds) shownIds.add(id);
  }
  const another = [...shownIds]
    .map((id) => ctx.idx.people.get(id))
    .find((person) => person && person.role === "artist" && !artists.some((row) => row.id === person.id));
  const anotherWorks = another ? artistRail(ctx, gate, another) : null;
  const anotherPerson = another && anotherWorks ? gate.takePerson(another) : null;
  if (!anotherPerson || !anotherWorks) return null;

  const otherShow = ctx.pools.exhibitions.find(
    (row) => row.id !== seed.id && row.participantIds.includes(anotherPerson.id)
  );
  const other = gate.takeExhibition(otherShow);
  if (!other) return null;
  const room = gate.takePeople(
    other.participantIds.filter((id) => id !== anotherPerson.id),
    1
  );
  if (!room) return null;
  const gallery = galleryName(seed, ctx.idx) ?? seed.hostName ?? "";
  if (!gallery) return null;

  return {
    touch: gate.touch,
    modules: [
      mod("exhibition_card", "local", "show", copy("feed.walk.local.show.title"), copy("feed.walk.local.show.reason", { exhibition: show.title, city }), {
        exhibition: toExhibition(show, ctx.idx),
      }),
      mod("related_network", "local", "artists", copy("feed.walk.local.artists.title"), copy("feed.walk.local.artists.reason", { exhibition: show.title }), {
        people: artists.map(toPerson),
      }),
      mod("artwork_gallery", "local", "works", copy("feed.walk.local.works.title"), copy("feed.walk.local.works.reason", { gallery }), {
        works: others.map((work) => toWork(work, ctx.idx)),
      }),
      mod("artist_card", "local", "artist", copy("feed.walk.local.artist.title"), copy("feed.walk.local.artist.reason", { name: anotherPerson.name, gallery }), {
        person: toPerson(anotherPerson),
        works: anotherWorks.map((work) => toWork(work, ctx.idx)),
      }),
      mod("exhibition_card", "local", "other", copy("feed.walk.local.other.title"), copy("feed.walk.local.other.reason", { name: anotherPerson.name, exhibition: other.title }), {
        exhibition: toExhibition(other, ctx.idx),
      }),
      mod("related_network", "local", "network", copy("feed.walk.local.network.title"), copy("feed.walk.local.network.reason", { exhibition: other.title }), {
        people: room.map(toPerson),
      }),
    ],
  };
}

function buildCollector(ctx: Ctx): Built | null {
  if (!ctx.viewer.id) return null;
  const savedIds = [...ctx.viewer.savedArtworkIds, ...ctx.viewer.inquiredArtworkIds];
  const saved: WalkWork[] = [];
  const seen = new Set<string>();
  for (const id of savedIds) {
    if (seen.has(id)) continue;
    const work = ctx.idx.works.get(id);
    if (!work) continue;
    seen.add(id);
    saved.push(work);
  }
  if (saved.length < TRIO) return null;
  const shows = ctx.pools.exhibitions.filter((row) =>
    row.workIds.some((id) => savedIds.includes(id) || ctx.viewer.likedArtworkIds.includes(id))
  );
  for (const exhibition of shows) {
    const built = storyCollector(ctx, saved, exhibition);
    if (built) return built;
  }
  return null;
}

function storyCollector(ctx: Ctx, saved: WalkWork[], exhibition: WalkExhibition): Built | null {
  const gate = openGate(ctx);
  const gallery = gate.takeWorks(saved, TRIO);
  const show = gate.takeExhibition(exhibition);
  if (!gallery || !show) return null;
  const artistCandidate = exhibition.participantIds
    .map((id) => ctx.idx.people.get(id))
    .find((person) => person && person.role === "artist");
  const artistWorks = artistCandidate ? artistRail(ctx, gate, artistCandidate) : null;
  const artist = artistCandidate && artistWorks ? gate.takePerson(artistCandidate) : null;
  if (!artist || !artistWorks) return null;

  const engagedWorks = gate.takeWorks(likedWorksBy(artist.id, ctx), TRIO);
  if (!engagedWorks) return null;
  const network = gate.takePeople(networkIds(artist.id, ctx), 1);
  if (!network) return null;
  const next = ctx.pools.exhibitions.find(
    (row) =>
      row.id !== exhibition.id &&
      row.participantIds.some((id) => network.some((person) => person.id === id))
  );
  const nextShow = gate.takeExhibition(next);
  if (!nextShow) return null;

  return {
    touch: gate.touch,
    modules: [
      mod("artwork_gallery", "collector", "works", copy("feed.walk.collect.works.title"), copy("feed.walk.collect.works.reason"), {
        works: gallery.map((work) => toWork(work, ctx.idx)),
      }),
      mod("exhibition_card", "collector", "show", copy("feed.walk.collect.show.title"), copy("feed.walk.collect.show.reason", { exhibition: show.title }), {
        exhibition: toExhibition(show, ctx.idx),
      }),
      mod("artist_card", "collector", "artist", copy("feed.walk.collect.artist.title"), copy("feed.walk.collect.artist.reason", { name: artist.name, exhibition: show.title }), {
        person: toPerson(artist),
        works: artistWorks.map((work) => toWork(work, ctx.idx)),
      }),
      mod("related_artwork", "collector", "engaged", copy("feed.walk.collect.engaged.title"), copy("feed.walk.collect.engaged.reason", { name: artist.name }), {
        works: engagedWorks.map((work) => toWork(work, ctx.idx)),
      }),
      mod("related_network", "collector", "network", copy("feed.walk.collect.network.title"), copy("feed.walk.collect.network.reason", { name: artist.name }), {
        people: network.map(toPerson),
      }),
      mod("exhibition_card", "collector", "next", copy("feed.walk.collect.next.title"), copy("feed.walk.collect.next.reason", { exhibition: nextShow.title }), {
        exhibition: toExhibition(nextShow, ctx.idx),
      }),
    ],
  };
}

function publishLoose(ctx: Ctx, gate: Gate, modules: FeedModule[]): Built | null {
  const visible = keepVisibleModules(modules).slice(0, PAGE_MAX);
  if (!hasNonArtwork(visible)) return null;
  const carriesWorks = visible.some((mod) => mod.type !== "exhibition_card" && mod.type !== "related_network");
  const worksRemain = catalogWorks(ctx).some((work) => !ctx.used.has(keyW(work.id)));
  if (!carriesWorks && worksRemain) return null;
  return { touch: gate.touch, modules: visible };
}

function looseExhibitionNetwork(ctx: Ctx): Built | null {
  if (!ctx.viewer.id) return null;
  for (const exhibitionId of ctx.viewer.exhibitionIds) {
    const shared = ctx.idx.exhibitions.get(exhibitionId);
    if (!shared || !isFilledSlot(shared.title)) continue;
    for (const personId of shared.participantIds) {
      if (personId === ctx.viewer.id) continue;
      const person = ctx.idx.people.get(personId);
      if (!person) continue;
      const built = looseStoryExhibition(ctx, person, shared);
      if (built) return built;
    }
  }
  return null;
}

function looseStoryExhibition(ctx: Ctx, person: WalkPerson, shared: WalkExhibition): Built | null {
  const gate = openGate(ctx);
  const modules: FeedModule[] = [];
  const heroWorks = gate.takeArtistWorks(person.id, 1, 3);
  const hero = heroWorks ? gate.takePerson(person) : null;
  if (hero && heroWorks) {
    modules.push(
      mod("artist_card", "exhibition_network", "person", copy("feed.walk.ex.person.title"), copy("feed.walk.ex.person.reason", { exhibition: shared.title, name: hero.name }), {
        person: toPerson(hero),
        works: heroWorks.map((work) => toWork(work, ctx.idx)),
      })
    );
  }
  const other = ctx.pools.exhibitions.find(
    (row) => row.id !== shared.id && row.participantIds.includes(person.id) && isFilledSlot(row.title)
  );
  const otherTaken = gate.takeExhibition(other);
  if (otherTaken) {
    modules.push(
      mod("exhibition_card", "exhibition_network", "next", copy("feed.walk.ex.nextShow.title"), copy("feed.walk.ex.nextShow.reason", { name: person.name, exhibition: otherTaken.title }), {
        exhibition: toExhibition(otherTaken, ctx.idx),
      })
    );
    const room = gate.takePeople(
      otherTaken.participantIds.filter((id) => id !== person.id),
      1
    );
    if (room) {
      modules.push(
        mod("related_network", "exhibition_network", "room", copy("feed.walk.ex.room.title"), copy("feed.walk.ex.room.reason", { exhibition: otherTaken.title }), {
          people: room.map(toPerson),
        })
      );
      const roomWorks = gate.takeSome(worksOfArtists(room.map((row) => row.id), ctx), 1, 3);
      if (roomWorks) {
        modules.push(
          mod("artwork_gallery", "exhibition_network", "works", copy("feed.walk.ex.works.title"), copy("feed.walk.ex.works.reason", { exhibition: otherTaken.title }), {
            works: roomWorks.map((work) => toWork(work, ctx.idx)),
          })
        );
      }
    }
    for (const candidate of likersOf(new Set(otherTaken.workIds), ctx)) {
      if (candidate.id === person.id) continue;
      const works = gate.takeArtistWorks(candidate.id, 1, 3);
      const taken = works ? gate.takePerson(candidate) : null;
      if (!works || !taken) continue;
      modules.push(
        mod("artist_card", "exhibition_network", "engaged", copy("feed.walk.ex.engaged.title"), copy("feed.walk.ex.engaged.reason", { name: taken.name, exhibition: otherTaken.title }), {
          person: toPerson(taken),
          works: works.map((work) => toWork(work, ctx.idx)),
        })
      );
      break;
    }
  }
  return publishLoose(ctx, gate, modules);
}

function looseSharedMedium(ctx: Ctx): Built | null {
  if (!ctx.viewer.id || !ctx.viewer.medium) return null;
  const medium = ctx.viewer.medium;
  const matching = ctx.pools.works.filter((work) => work.artistId !== ctx.viewer.id && same(work.medium, medium));
  const artistIds: string[] = [];
  for (const person of ctx.pools.people) {
    if (person.id === ctx.viewer.id) continue;
    const listed = person.mediums.some((item) => same(item, medium));
    const made = (ctx.idx.worksByArtist.get(person.id) ?? []).some((work) => same(work.medium, medium));
    if (listed || made) artistIds.push(person.id);
  }
  const shows = ctx.pools.exhibitions.filter((row) =>
    row.workIds.some((id) => {
      const work = ctx.idx.works.get(id);
      return !!work && same(work.medium, medium);
    })
  );
  for (const exhibition of shows) {
    const built = looseStoryMedium(ctx, medium, matching, artistIds, exhibition);
    if (built) return built;
  }
  if (artistIds.length === 0) return null;
  return looseStoryMedium(ctx, medium, matching, artistIds, null);
}

function looseStoryMedium(
  ctx: Ctx,
  medium: string,
  matching: WalkWork[],
  artistIds: string[],
  exhibition: WalkExhibition | null
): Built | null {
  const gate = openGate(ctx);
  const modules: FeedModule[] = [];
  const gallery = gate.takeSome(matching, 1, 3);
  const artists = gate.takePeople(artistIds, 1);
  const show = exhibition ? gate.takeExhibition(exhibition) : null;
  if (exhibition && !show) return null;
  if (!artists && !show) return null;
  if (gallery) {
    modules.push(
      mod("artwork_gallery", "shared_medium", "works", copy("feed.walk.medium.works.title"), copy("feed.walk.medium.works.reason", { medium }), {
        works: gallery.map((work) => toWork(work, ctx.idx)),
      })
    );
  }
  if (artists) {
    modules.push(
      mod("related_network", "shared_medium", "artists", copy("feed.walk.medium.artists.title"), copy("feed.walk.medium.artists.reason", { medium }), {
        people: artists.map(toPerson),
      })
    );
  }
  if (show) {
    modules.push(
      mod("exhibition_card", "shared_medium", "show", copy("feed.walk.medium.show.title"), copy("feed.walk.medium.show.reason", { exhibition: show.title, medium }), {
        exhibition: toExhibition(show, ctx.idx),
      })
    );
  }
  if (artists) {
    const more = gate.takeSome(worksOfArtists(artists.map((row) => row.id), ctx), 1, 3);
    if (more) {
      modules.push(
        mod("related_artwork", "shared_medium", "more", copy("feed.walk.medium.more.title"), copy("feed.walk.medium.more.reason", { medium }), {
          works: more.map((work) => toWork(work, ctx.idx)),
        })
      );
    }
  }
  if (show) {
    for (const candidate of likersOf(new Set(show.workIds), ctx)) {
      if (artists?.some((row) => row.id === candidate.id)) continue;
      const works = gate.takeArtistWorks(candidate.id, 1, 3);
      const taken = works ? gate.takePerson(candidate) : null;
      if (!works || !taken) continue;
      modules.push(
        mod("artist_card", "shared_medium", "interested", copy("feed.walk.medium.interested.title"), copy("feed.walk.medium.interested.reason", { name: taken.name, exhibition: show.title }), {
          person: toPerson(taken),
          works: works.map((work) => toWork(work, ctx.idx)),
        })
      );
      break;
    }
  }
  return publishLoose(ctx, gate, modules);
}

function looseCuratorial(ctx: Ctx): Built | null {
  if (!ctx.viewer.id) return null;
  const curators = ctx.pools.people.filter(
    (person) => person.role === "curator" && ctx.viewer.followingIds.includes(person.id)
  );
  for (const curator of curators) {
    const shows = ctx.pools.exhibitions.filter((row) => row.curatorId === curator.id && isFilledSlot(row.title));
    for (const show of shows) {
      const built = looseStoryCuratorial(ctx, curator, show);
      if (built) return built;
    }
  }
  return null;
}

function looseStoryCuratorial(ctx: Ctx, curator: WalkPerson, show: WalkExhibition): Built | null {
  const gate = openGate(ctx);
  const exhibition = gate.takeExhibition(show);
  if (!exhibition) return null;
  const modules: FeedModule[] = [
    mod("exhibition_card", "curatorial", "show", copy("feed.walk.curator.show.title"), copy("feed.walk.curator.show.reason", { name: curator.name, exhibition: exhibition.title }), {
      exhibition: toExhibition(exhibition, ctx.idx),
    }),
  ];
  const artistCandidate = show.participantIds
    .map((id) => ctx.idx.people.get(id))
    .find((person) => person && person.id !== curator.id && person.role === "artist");
  const artistWorks = artistCandidate ? gate.takeArtistWorks(artistCandidate.id, 1, 3) : null;
  const artist = artistCandidate && artistWorks ? gate.takePerson(artistCandidate) : null;
  if (artist && artistWorks) {
    modules.push(
      mod("artist_card", "curatorial", "artist", copy("feed.walk.curator.artist.title"), copy("feed.walk.curator.artist.reason", { name: artist.name, exhibition: exhibition.title }), {
        person: toPerson(artist),
        works: artistWorks.map((work) => toWork(work, ctx.idx)),
      })
    );
  }
  const liked = gate.takeSome(likedWorksBy(curator.id, ctx), 1, 3);
  if (liked) {
    modules.push(
      mod("curators_view", "curatorial", "works", copy("feed.walk.curator.works.title"), copy("feed.walk.curator.works.reason", { name: curator.name }), {
        works: liked.map((work) => toWork(work, ctx.idx)),
      })
    );
  }
  if (artist) {
    const other = ctx.pools.exhibitions.find(
      (row) => row.id !== show.id && isFilledSlot(row.title) && row.participantIds.includes(artist.id)
    );
    const otherShow = gate.takeExhibition(other);
    if (otherShow) {
      modules.push(
        mod("exhibition_card", "curatorial", "other", copy("feed.walk.curator.otherShow.title"), copy("feed.walk.curator.otherShow.reason", { name: artist.name, exhibition: otherShow.title }), {
          exhibition: toExhibition(otherShow, ctx.idx),
        })
      );
    }
  }
  return publishLoose(ctx, gate, modules);
}

function looseSchool(ctx: Ctx): Built | null {
  if (!ctx.viewer.id || !ctx.viewer.school) return null;
  const school = ctx.viewer.school;
  const alumni = ctx.pools.people.filter((person) => person.id !== ctx.viewer.id && same(person.school, school));
  const alumniIds = alumni.map((person) => person.id);
  if (alumniIds.length === 0) return null;
  const shows = ctx.pools.exhibitions.filter(
    (row) => isFilledSlot(row.title) && row.participantIds.some((id) => alumniIds.includes(id))
  );
  for (const exhibition of shows) {
    const built = looseStorySchool(ctx, school, alumniIds, exhibition);
    if (built) return built;
  }
  const gate = openGate(ctx);
  const modules: FeedModule[] = [];
  const gallery = gate.takeSome(worksOfArtists(alumniIds, ctx), 1, 3);
  const network = gate.takePeople(alumniIds, 1);
  if (gallery) {
    modules.push(
      mod("artwork_gallery", "school", "works", copy("feed.walk.school.works.title"), copy("feed.walk.school.works.reason", { school }), {
        works: gallery.map((work) => toWork(work, ctx.idx)),
      })
    );
  }
  if (network) {
    modules.push(
      mod("related_network", "school", "people", copy("feed.walk.school.people.title"), copy("feed.walk.school.people.reason", { school }), {
        people: network.map(toPerson),
      })
    );
  }
  return publishLoose(ctx, gate, modules);
}

function looseStorySchool(ctx: Ctx, school: string, alumniIds: string[], exhibition: WalkExhibition): Built | null {
  const gate = openGate(ctx);
  const modules: FeedModule[] = [];
  const gallery = gate.takeSome(worksOfArtists(alumniIds, ctx), 1, 3);
  const show = gate.takeExhibition(exhibition);
  if (!show) return null;
  if (gallery) {
    modules.push(
      mod("artwork_gallery", "school", "works", copy("feed.walk.school.works.title"), copy("feed.walk.school.works.reason", { school }), {
        works: gallery.map((work) => toWork(work, ctx.idx)),
      })
    );
  }
  const fromRoom = exhibition.participantIds
    .map((id) => ctx.idx.people.get(id))
    .find((person) => person && person.role === "artist" && same(person.school, school));
  const fromWorks = fromRoom ? gate.takeArtistWorks(fromRoom.id, 1, 3) : null;
  const fromPerson = fromRoom && fromWorks ? gate.takePerson(fromRoom) : null;
  const network = gate.takePeople(
    alumniIds.filter((id) => id !== fromPerson?.id),
    1
  );
  if (network) {
    modules.push(
      mod("related_network", "school", "people", copy("feed.walk.school.people.title"), copy("feed.walk.school.people.reason", { school }), {
        people: network.map(toPerson),
      })
    );
  }
  modules.push(
    mod("exhibition_card", "school", "show", copy("feed.walk.school.show.title"), copy("feed.walk.school.show.reason", { school, exhibition: show.title }), {
      exhibition: toExhibition(show, ctx.idx),
    })
  );
  if (fromPerson && fromWorks) {
    modules.push(
      mod("artist_card", "school", "artist", copy("feed.walk.school.artist.title"), copy("feed.walk.school.artist.reason", { name: fromPerson.name, exhibition: show.title }), {
        person: toPerson(fromPerson),
        works: fromWorks.map((work) => toWork(work, ctx.idx)),
      })
    );
  }
  return publishLoose(ctx, gate, modules);
}

function looseLocal(ctx: Ctx): Built | null {
  if (!ctx.viewer.id || !ctx.viewer.city) return null;
  const city = ctx.viewer.city;
  for (const candidate of ctx.pools.exhibitions) {
    if (!same(candidate.city, city) || !isFilledSlot(candidate.title)) continue;
    const built = looseStoryLocal(ctx, candidate, city);
    if (built) return built;
  }
  return null;
}

function looseStoryLocal(ctx: Ctx, seed: WalkExhibition, city: string): Built | null {
  const gate = openGate(ctx);
  const show = gate.takeExhibition(seed);
  if (!show) return null;
  const modules: FeedModule[] = [
    mod("exhibition_card", "local", "show", copy("feed.walk.local.show.title"), copy("feed.walk.local.show.reason", { exhibition: show.title, city }), {
      exhibition: toExhibition(show, ctx.idx),
    }),
  ];
  const artistIds = seed.participantIds.filter((id) => ctx.idx.people.get(id)?.role === "artist");
  const artists = gate.takePeople(artistIds, 1);
  if (artists) {
    modules.push(
      mod("related_network", "local", "artists", copy("feed.walk.local.artists.title"), copy("feed.walk.local.artists.reason", { exhibition: show.title }), {
        people: artists.map(toPerson),
      })
    );
  }
  const galleryLabel = galleryName(seed, ctx.idx) ?? seed.hostName ?? "";
  if (isFilledSlot(galleryLabel)) {
    const galleryWorks = ctx.pools.works.filter((work) =>
      work.exhibitionIds.some((id) => {
        const row = ctx.idx.exhibitions.get(id);
        return !!row && sameGallery(seed, row);
      })
    );
    const others = gate.takeSome(galleryWorks, 1, 3);
    if (others) {
      modules.push(
        mod("artwork_gallery", "local", "works", copy("feed.walk.local.works.title"), copy("feed.walk.local.works.reason", { gallery: galleryLabel }), {
          works: others.map((work) => toWork(work, ctx.idx)),
        })
      );
    }
  }
  if (artists) {
    const theirs = gate.takeSome(worksOfArtists(artists.map((row) => row.id), ctx), 1, 3);
    if (theirs) {
      modules.push(
        mod("artwork_gallery", "local", "works", copy("feed.walk.local.works.title"), copy("feed.walk.ex.works.reason", { exhibition: show.title }), {
          works: theirs.map((work) => toWork(work, ctx.idx)),
        })
      );
    }
  }
  return publishLoose(ctx, gate, modules);
}

function looseCollector(ctx: Ctx): Built | null {
  if (!ctx.viewer.id) return null;
  const savedIds = [...ctx.viewer.savedArtworkIds, ...ctx.viewer.inquiredArtworkIds];
  const saved: WalkWork[] = [];
  const seen = new Set<string>();
  for (const id of savedIds) {
    if (seen.has(id)) continue;
    const work = ctx.idx.works.get(id);
    if (!work) continue;
    seen.add(id);
    saved.push(work);
  }
  const shows = ctx.pools.exhibitions.filter(
    (row) =>
      isFilledSlot(row.title) &&
      row.workIds.some((id) => savedIds.includes(id) || ctx.viewer.likedArtworkIds.includes(id))
  );
  for (const exhibition of shows) {
    const built = looseStoryCollector(ctx, saved, exhibition);
    if (built) return built;
  }
  return null;
}

function looseStoryCollector(ctx: Ctx, saved: WalkWork[], exhibition: WalkExhibition): Built | null {
  const gate = openGate(ctx);
  const show = gate.takeExhibition(exhibition);
  if (!show) return null;
  const modules: FeedModule[] = [];
  const gallery = gate.takeSome(saved, 1, 3);
  if (gallery) {
    modules.push(
      mod("artwork_gallery", "collector", "works", copy("feed.walk.collect.works.title"), copy("feed.walk.collect.works.reason"), {
        works: gallery.map((work) => toWork(work, ctx.idx)),
      })
    );
  }
  const artistCandidate = exhibition.participantIds
    .map((id) => ctx.idx.people.get(id))
    .find((person) => person && person.role === "artist");
  const artistWorks = artistCandidate ? gate.takeArtistWorks(artistCandidate.id, 1, 3) : null;
  const artist = artistCandidate && artistWorks ? gate.takePerson(artistCandidate) : null;
  if (artist && artistWorks) {
    modules.push(
      mod("artist_card", "collector", "artist", copy("feed.walk.collect.artist.title"), copy("feed.walk.collect.artist.reason", { name: artist.name, exhibition: show.title }), {
        person: toPerson(artist),
        works: artistWorks.map((work) => toWork(work, ctx.idx)),
      })
    );
  }
  if (artist) {
    const engagedWorks = gate.takeSome(likedWorksBy(artist.id, ctx), 1, 3);
    if (engagedWorks) {
      modules.push(
        mod("related_artwork", "collector", "engaged", copy("feed.walk.collect.engaged.title"), copy("feed.walk.collect.engaged.reason", { name: artist.name }), {
          works: engagedWorks.map((work) => toWork(work, ctx.idx)),
        })
      );
    }
    const network = gate.takePeople(networkIds(artist.id, ctx), 1);
    if (network) {
      modules.push(
        mod("related_network", "collector", "network", copy("feed.walk.collect.network.title"), copy("feed.walk.collect.network.reason", { name: artist.name }), {
          people: network.map(toPerson),
        })
      );
    }
  }
  const next = ctx.pools.exhibitions.find(
    (row) =>
      row.id !== exhibition.id &&
      isFilledSlot(row.title) &&
      (artist
        ? row.participantIds.includes(artist.id)
        : row.participantIds.some((id) => exhibition.participantIds.includes(id)))
  );
  const nextShow = gate.takeExhibition(next);
  if (nextShow) {
    modules.splice(
      gallery ? 1 : 0,
      0,
      mod("exhibition_card", "collector", "show", copy("feed.walk.collect.show.title"), copy("feed.walk.collect.show.reason", { exhibition: show.title }), {
        exhibition: toExhibition(show, ctx.idx),
      })
    );
    modules.push(
      mod("exhibition_card", "collector", "next", copy("feed.walk.collect.next.title"), copy("feed.walk.collect.next.reason", { exhibition: nextShow.title }), {
        exhibition: toExhibition(nextShow, ctx.idx),
      })
    );
  } else {
    modules.push(
      mod("exhibition_card", "collector", "show", copy("feed.walk.collect.show.title"), copy("feed.walk.collect.show.reason", { exhibition: show.title }), {
        exhibition: toExhibition(show, ctx.idx),
      })
    );
  }
  if (modules.at(-1)?.type !== "exhibition_card") return null;
  return publishLoose(ctx, gate, modules);
}

function loosePublic(ctx: Ctx): Built | null {
  const works = catalogWorks(ctx);
  for (const exhibition of ctx.pools.exhibitions) {
    if (!isFilledSlot(exhibition.title) || !isPublicExhibition(exhibition)) continue;
    const built = loosePublicShow(ctx, exhibition, works);
    if (built) return built;
  }
  return null;
}

function loosePublicShow(ctx: Ctx, exhibition: WalkExhibition, works: WalkWork[]): Built | null {
  const gate = openGate(ctx);
  const show = gate.takeExhibition(exhibition);
  if (!show) return null;
  const modules: FeedModule[] = [];
  const gallery = gate.takeSome(works, 1, 3);
  if (gallery) {
    modules.push(
      mod("artwork_gallery", "public", "works", copy("feed.walk.public.works.title"), copy("feed.walk.public.works.reason"), {
        works: gallery.map((work) => toWork(work, ctx.idx)),
      })
    );
  }
  modules.push(
    mod("exhibition_card", "public", "show", copy("feed.walk.public.show.title"), copy("feed.walk.public.show.reason", { exhibition: show.title }), {
      exhibition: toExhibition(show, ctx.idx),
    })
  );
  const people = gate.takePeople(exhibition.participantIds, 1);
  if (people) {
    modules.push(
      mod("related_network", "public", "people", copy("feed.walk.public.people.title"), copy("feed.walk.public.people.reason", { exhibition: show.title }), {
        people: people.map(toPerson),
      })
    );
  }
  const artistCandidate = exhibition.participantIds
    .map((id) => ctx.idx.people.get(id))
    .find((person) => person && person.role === "artist");
  const artistWorks = artistCandidate ? gate.takeArtistWorks(artistCandidate.id, 1, 3) : null;
  const artist = artistCandidate && artistWorks ? gate.takePerson(artistCandidate) : null;
  if (artist && artistWorks) {
    modules.push(
      mod("artist_card", "public", "artist", copy("feed.walk.public.artist.title"), copy("feed.walk.public.artist.reason", { name: artist.name, exhibition: show.title }), {
        person: toPerson(artist),
        works: artistWorks.map((work) => toWork(work, ctx.idx)),
      })
    );
  }
  const more = gate.takeSome(
    worksOfArtists(
      exhibition.participantIds.filter((id) => ctx.idx.people.get(id)?.role === "artist"),
      ctx
    ),
    1,
    3
  );
  if (more) {
    modules.push(
      mod("related_artwork", "public", "more", copy("feed.walk.public.more.title"), copy("feed.walk.public.more.reason", { exhibition: show.title }), {
        works: more.map((work) => toWork(work, ctx.idx)),
      })
    );
  }
  return publishLoose(ctx, gate, modules);
}

function buildPublic(ctx: Ctx): Built | null {
  const loose = ctx.pools.works.filter((work) => ctx.idx.people.has(work.artistId));
  for (const exhibition of ctx.pools.exhibitions) {
    if (!isFilledSlot(exhibition.title) || !isPublicExhibition(exhibition)) continue;
    const full = storyPublic(ctx, exhibition, loose, true);
    if (full) return full;
  }
  for (const exhibition of ctx.pools.exhibitions) {
    if (!isFilledSlot(exhibition.title) || !isPublicExhibition(exhibition)) continue;
    const short = storyPublic(ctx, exhibition, loose, false);
    if (short) return short;
  }
  return null;
}

/** Recent public works still render when every exhibition title is blank or "title". */
function publicWorksOnly(ctx: Ctx, loose: WalkWork[]): Built | null {
  const gate = openGate(ctx);
  const gallery = gate.takeWorks(loose, TRIO);
  if (!gallery) return null;
  return {
    touch: gate.touch,
    modules: [
      mod(
        "artwork_gallery",
        "public",
        "works",
        copy("feed.walk.public.works.title"),
        copy("feed.walk.public.works.reason"),
        {
          works: gallery.map((work) => toWork(work, ctx.idx)),
        }
      ),
    ],
  };
}

function storyPublic(
  ctx: Ctx,
  exhibition: WalkExhibition,
  loose: WalkWork[],
  full: boolean
): Built | null {
  const gate = openGate(ctx);
  const showWorks = exhibition.workIds
    .map((id) => ctx.idx.works.get(id))
    .filter((work): work is WalkWork => !!work);
  const showIds = new Set(showWorks.map((work) => work.id));
  const outside = loose.filter((work) => !showIds.has(work.id));
  const gallery = gate.takeWorks(outside.length >= TRIO ? outside : loose, TRIO);
  const show = gate.takeExhibition(exhibition);
  if (!gallery || !show) return null;

  const curated = full ? gate.takeWorks(showWorks, TRIO) : null;
  // Reserve the artist before the room claims every participant.
  const artistCandidate = full
    ? exhibition.participantIds
        .map((id) => ctx.idx.people.get(id))
        .find((person) => person && person.role === "artist")
    : undefined;
  const artistWorks = artistCandidate ? artistRail(ctx, gate, artistCandidate) : null;
  const artist = artistCandidate && artistWorks ? gate.takePerson(artistCandidate) : null;

  const people = gate.takePeople(exhibition.participantIds, 1);
  if (!people) return null;

  const modules: FeedModule[] = [
    mod("artwork_gallery", "public", "works", copy("feed.walk.public.works.title"), copy("feed.walk.public.works.reason"), {
      works: gallery.map((work) => toWork(work, ctx.idx)),
    }),
    mod("exhibition_card", "public", "show", copy("feed.walk.public.show.title"), copy("feed.walk.public.show.reason", { exhibition: show.title }), {
      exhibition: toExhibition(show, ctx.idx),
    }),
    mod("related_network", "public", "people", copy("feed.walk.public.people.title"), copy("feed.walk.public.people.reason", { exhibition: show.title }), {
      people: people.map(toPerson),
    }),
  ];

  if (!full) {
    return { touch: gate.touch, modules };
  }

  const more = gate.takeWorks(
    worksOfArtists(
      exhibition.participantIds.filter((id) => ctx.idx.people.get(id)?.role === "artist"),
      ctx
    ),
    TRIO
  );
  if (!curated || !artist || !artistWorks || !more) return null;
  modules.push(
    mod("curators_view", "public", "curated", copy("feed.walk.public.curated.title"), copy("feed.walk.public.curated.reason", { exhibition: show.title }), {
      works: curated.map((work) => toWork(work, ctx.idx)),
    }),
    mod("artist_card", "public", "artist", copy("feed.walk.public.artist.title"), copy("feed.walk.public.artist.reason", { name: artist.name, exhibition: show.title }), {
      person: toPerson(artist),
      works: artistWorks.map((work) => toWork(work, ctx.idx)),
    }),
    mod("related_artwork", "public", "more", copy("feed.walk.public.more.title"), copy("feed.walk.public.more.reason", { exhibition: show.title }), {
      works: more.map((work) => toWork(work, ctx.idx)),
    })
  );
  return { touch: gate.touch, modules };
}

function buildFollowing(ctx: Ctx): Built | null {
  if (!ctx.viewer.id || ctx.viewer.followingIds.length === 0) return null;
  const followed = ctx.viewer.followingIds
    .map((id) => ctx.idx.people.get(id))
    .filter((person): person is WalkPerson => !!person);
  const theirWorks = worksOfArtists(followed.map((person) => person.id), ctx);
  const gate = openGate(ctx);
  const gallery = gate.takeWorks(theirWorks, TRIO);
  if (!gallery) {
    const only = followed.find((person) => (ctx.idx.worksByArtist.get(person.id) ?? []).length > 0);
    if (!only) return null;
    const soloGate = openGate(ctx);
    const works = artistRail(ctx, soloGate, only);
    const person = soloGate.takePerson(only);
    if (!works || !person) return null;
    return {
      touch: soloGate.touch,
      modules: [
        mod("artist_card", "following", "artist", copy("feed.walk.follow.artist.title"), copy("feed.walk.follow.artist.reason", { name: person.name }), {
          person: toPerson(person),
          works: works.map((work) => toWork(work, ctx.idx)),
        }),
      ],
    };
  }

  const lead = ctx.idx.people.get(gallery[0]!.artistId);
  const leadWorks = lead ? artistRail(ctx, gate, lead) : null;
  const leadPerson = lead && leadWorks ? gate.takePerson(lead) : null;
  const modules: FeedModule[] = [
    mod("artwork_gallery", "following", "works", copy("feed.walk.follow.works.title"), copy("feed.walk.follow.works.reason"), {
      works: gallery.map((work) => toWork(work, ctx.idx)),
    }),
  ];
  if (leadPerson && leadWorks) {
    modules.push(
      mod("artist_card", "following", "artist", copy("feed.walk.follow.artist.title"), copy("feed.walk.follow.artist.reason", { name: leadPerson.name }), {
        person: toPerson(leadPerson),
        works: leadWorks.map((work) => toWork(work, ctx.idx)),
      })
    );
  }
  const others = gate.takePeople(
    followed.map((person) => person.id).filter((id) => id !== leadPerson?.id),
    1
  );
  if (others) {
    modules.push(
      mod("related_network", "following", "network", copy("feed.walk.follow.network.title"), copy("feed.walk.follow.network.reason"), {
        people: others.map(toPerson),
      })
    );
  }
  return { touch: gate.touch, modules };
}
