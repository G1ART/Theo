/**
 * Profile tab kind and the public kind stored on a work.
 * The feed and 전체 read this stored kind. They do not read the tab label.
 */
import { resolveUploadedArtworkArtist } from "@/lib/upload/artworkOwner";

export const PROFILE_CONTENT_KINDS = [
  "artwork",
  "print_edition",
  "art_goods",
  "collected",
] as const;

export type ProfileContentKind = (typeof PROFILE_CONTENT_KINDS)[number];

export type KnownProfileTab = {
  id: string;
  kind: ProfileContentKind;
  ownerProfileId: string;
  label?: string;
};

const KIND_SET = new Set<string>(PROFILE_CONTENT_KINDS);

export function normalizeProfileContentKind(raw: unknown): ProfileContentKind {
  if (typeof raw === "string" && KIND_SET.has(raw)) return raw as ProfileContentKind;
  return "artwork";
}

/** Main feed. Goods and collected stays are not posts. Missing kind is an older artwork row. */
export function isMainFeedKind(kind: ProfileContentKind | null | undefined): boolean {
  if (kind == null) return true;
  return kind === "artwork" || kind === "print_edition";
}

/** 전체. Artwork and print/edition only. */
export function isProfileAllKind(kind: ProfileContentKind | null | undefined): boolean {
  return isMainFeedKind(kind);
}

export function isGoodsOrCollectedKind(kind: ProfileContentKind | null | undefined): boolean {
  return kind === "art_goods" || kind === "collected";
}

type CollectedMembershipWork = {
  id: string;
  artist_id?: string | null;
  work_kind?: string | null;
  claims?: Array<{
    claim_type?: string | null;
    subject_profile_id?: string | null;
    artist_profile_id?: string | null;
  }> | null;
};

/**
 * On this profile only because a collected tab lists it.
 * The artist stays the artist, so it is not this profile's 내 작품 or 전체.
 */
export function isCollectedMembershipOnly(
  artwork: CollectedMembershipWork,
  profileId: string,
  tabs: Array<{ kind?: string | null; artwork_ids?: string[] | null }> | null | undefined,
): boolean {
  if (artwork.artist_id != null && artwork.artist_id === profileId) return false;
  const inCollected = (tabs ?? []).some(
    (tab) => tab.kind === "collected" && (tab.artwork_ids ?? []).includes(artwork.id),
  );
  if (!inCollected) return false;
  const ownsAsArtist = (artwork.claims ?? []).some(
    (claim) =>
      claim.claim_type === "CREATED" &&
      artwork.artist_id == null &&
      (claim.subject_profile_id === profileId || claim.artist_profile_id === profileId),
  );
  return !ownsAsArtist;
}

export type UploadFilingChannel = "own" | "gallery" | "collector";

export function filingChannel(input: {
  uploadingForOther: boolean;
  intent: string | null;
  roles: string[];
}): UploadFilingChannel {
  if (!input.uploadingForOther) return "own";
  if (
    input.intent === "OWNS" ||
    (input.roles.includes("collector") &&
      input.intent !== "CURATED" &&
      input.intent !== "INVENTORY")
  ) {
    return "collector";
  }
  return "gallery";
}

/**
 * A gallery or curator cannot add a tab on the artist's profile.
 * Only the profile itself (or a delegate acting as that profile) can.
 */
export function canCreateArtistProfileTab(input: {
  actorRoles: string[];
  targetProfileId: string;
  actorProfileId: string;
}): boolean {
  const target = input.targetProfileId.trim();
  const actor = input.actorProfileId.trim();
  if (!target || !actor) return false;
  if (target === actor) return true;
  return false;
}

export function canDeleteAsCustomFolder(input: {
  kind: "persona" | "custom";
  personaTab?: string | null;
}): boolean {
  if (input.kind !== "custom") return false;
  return true;
}

export type UploadFilingInput = {
  actor: {
    sessionUserId: string;
    actingAsProfileId?: string | null;
    selectedArtistId?: string | null;
    roles: string[];
  };
  channel: UploadFilingChannel;
  entryTab: KnownProfileTab | null;
  sharedTab: KnownProfileTab | null;
  cardTab: KnownProfileTab | null;
  collectorTab: KnownProfileTab | null;
  artistTab: KnownProfileTab | null;
  /** Gallery/curator asked to create a tab on the artist. Always refused. */
  createArtistTab: boolean;
};

export type UploadFilingMembership = {
  profileId: string;
  tabId: string;
};

export type UploadFilingResult = {
  artistId: string;
  workKind: ProfileContentKind;
  memberships: UploadFilingMembership[];
  appearsOnMainFeed: boolean;
  appearsInProfileAll: boolean;
  /** True only when this filing would count as the collector's 내 작품. */
  inCollectorCreated: boolean;
  rejectedCreateArtistTab: boolean;
};

function feedFlags(kind: ProfileContentKind): {
  appearsOnMainFeed: boolean;
  appearsInProfileAll: boolean;
} {
  const show = isMainFeedKind(kind);
  return { appearsOnMainFeed: show, appearsInProfileAll: show };
}

function ownTab(input: UploadFilingInput): KnownProfileTab | null {
  return input.cardTab ?? input.sharedTab ?? input.entryTab;
}

/**
 * Where a new work is filed, and which public kind it stores.
 * A delegate never becomes the artist when an artist or an acting principal was chosen.
 * A collector filing does not move artist_id onto the collector.
 */
export function planFromUploadSelection(input: {
  selection: {
    channel: UploadFilingChannel;
    actorProfileId: string;
    actorRoles: string[];
    entryTab: KnownProfileTab | null;
    sharedTab: KnownProfileTab | null;
    collectorTab: KnownProfileTab | null;
    artistTab: KnownProfileTab | null;
  };
  sessionUserId: string;
  actingAsProfileId?: string | null;
  selectedArtistId?: string | null;
  mode: "all" | "each";
  cardTab: KnownProfileTab | null;
}): UploadFilingResult {
  const each = input.mode === "each";
  return planUploadFiling({
    actor: {
      sessionUserId: input.sessionUserId,
      actingAsProfileId: input.actingAsProfileId,
      selectedArtistId: input.selectedArtistId,
      roles: input.selection.actorRoles,
    },
    channel: input.selection.channel,
    entryTab: input.selection.entryTab,
    sharedTab: each ? null : input.selection.sharedTab,
    cardTab: each ? input.cardTab : null,
    collectorTab: input.selection.collectorTab,
    artistTab: each ? input.cardTab : input.selection.artistTab,
    createArtistTab: false,
  });
}

export function planUploadFiling(input: UploadFilingInput): UploadFilingResult {
  const resolved = resolveUploadedArtworkArtist({
    sessionUserId: input.actor.sessionUserId,
    actingAsProfileId: input.actor.actingAsProfileId,
    selectedArtistId: input.actor.selectedArtistId,
  });
  const actorProfileId = input.actor.actingAsProfileId?.trim() || input.actor.sessionUserId;
  const artistId = resolved.artistId;
  const uploadingForOther = artistId !== actorProfileId;
  const empty: UploadFilingResult = {
    artistId,
    workKind: "artwork",
    memberships: [],
    appearsOnMainFeed: true,
    appearsInProfileAll: true,
    inCollectorCreated: false,
    rejectedCreateArtistTab: false,
  };

  if (input.createArtistTab && uploadingForOther) {
    return { ...empty, rejectedCreateArtistTab: true };
  }

  if (input.channel === "collector" && uploadingForOther) {
    const artistTab = input.cardTab ?? input.artistTab ?? input.sharedTab;
    const publicKind: ProfileContentKind =
      artistTab && artistTab.ownerProfileId === artistId && artistTab.kind !== "collected"
        ? artistTab.kind
        : "artwork";
    const memberships: UploadFilingMembership[] = [];
    const collectorTab = input.collectorTab;
    if (
      collectorTab &&
      collectorTab.kind === "collected" &&
      collectorTab.ownerProfileId === actorProfileId
    ) {
      memberships.push({ profileId: actorProfileId, tabId: collectorTab.id });
    }
    if (artistTab && artistTab.ownerProfileId === artistId) {
      memberships.push({ profileId: artistId, tabId: artistTab.id });
    }
    return {
      artistId,
      workKind: publicKind,
      memberships,
      ...feedFlags(publicKind),
      inCollectorCreated: false,
      rejectedCreateArtistTab: false,
    };
  }

  if (input.channel === "gallery" && uploadingForOther) {
    const tab = input.cardTab ?? input.artistTab ?? input.sharedTab;
    if (!tab || tab.ownerProfileId !== artistId) return empty;
    const kind = tab.kind === "collected" ? "artwork" : tab.kind;
    return {
      artistId,
      workKind: kind,
      memberships: [{ profileId: artistId, tabId: tab.id }],
      ...feedFlags(kind),
      inCollectorCreated: false,
      rejectedCreateArtistTab: false,
    };
  }

  const tab = ownTab(input);
  if (!tab || tab.ownerProfileId !== artistId) return empty;
  return {
    artistId,
    workKind: tab.kind,
    memberships: [{ profileId: artistId, tabId: tab.id }],
    ...feedFlags(tab.kind),
    inCollectorCreated: false,
    rejectedCreateArtistTab: false,
  };
}

export type TabDeleteMode = "move_all" | "delete_all" | "delete_selected_move_rest";

/**
 * Moving into a collected tab that belongs to someone other than the artist
 * keeps the artist's public kind, so the feed still shows that one post.
 * Moving between the artist's own tabs updates the stored kind.
 */
export function workKindAfterMove(
  destination: KnownProfileTab,
  artworkArtistId: string,
): ProfileContentKind | null {
  if (destination.kind === "collected" && artworkArtistId !== destination.ownerProfileId) {
    return null;
  }
  return destination.kind;
}

export function planCustomTabDelete(input: {
  isCustomTab: boolean;
  sourceTabId: string;
  artworkIds: string[];
  mode: TabDeleteMode;
  destination: KnownProfileTab | null;
  selectedIds: string[];
  artistIdByArtwork: Record<string, string>;
}): {
  ok: boolean;
  reason?: "system_tab" | "need_destination";
  removeTabId: string;
  deleteArtworkIds: string[];
  moveIds: string[];
  destinationTabId: string | null;
  kindByArtworkId: Record<string, ProfileContentKind | null>;
} {
  const none = {
    ok: false as const,
    removeTabId: input.sourceTabId,
    deleteArtworkIds: [] as string[],
    moveIds: [] as string[],
    destinationTabId: null as string | null,
    kindByArtworkId: {} as Record<string, ProfileContentKind | null>,
  };
  if (!input.isCustomTab) return { ...none, reason: "system_tab" };
  const ids = input.artworkIds.filter(Boolean);
  const selected = new Set(input.selectedIds.filter((id) => ids.includes(id)));
  const needsMove = input.mode === "move_all" || input.mode === "delete_selected_move_rest";
  const moveIds =
    input.mode === "move_all"
      ? ids
      : input.mode === "delete_selected_move_rest"
        ? ids.filter((id) => !selected.has(id))
        : [];
  if (needsMove && moveIds.length > 0 && !input.destination) {
    return { ...none, reason: "need_destination" };
  }
  if (needsMove && input.destination && input.destination.id === input.sourceTabId) {
    return { ...none, reason: "need_destination" };
  }
  const deleteArtworkIds =
    input.mode === "delete_all" ? ids : input.mode === "delete_selected_move_rest" ? [...selected] : [];
  const kindByArtworkId: Record<string, ProfileContentKind | null> = {};
  if (input.destination) {
    for (const id of moveIds) {
      kindByArtworkId[id] = workKindAfterMove(
        input.destination,
        input.artistIdByArtwork[id] ?? "",
      );
    }
  }
  return {
    ok: true,
    removeTabId: input.sourceTabId,
    deleteArtworkIds,
    moveIds,
    destinationTabId: moveIds.length > 0 ? input.destination?.id ?? null : null,
    kindByArtworkId,
  };
}
