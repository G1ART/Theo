import type { ExhibitionThumb, ExhibitionThumbInput } from "./exhibitionThumbs";

/**
 * Modular main-feed walk.
 *
 * The assembler only arranges rows it was given. Reason copy is a
 * translation key plus names taken from those rows.
 */

export type WalkRole = "artist" | "curator" | "gallery" | "collector" | "other";

export type WalkPerson = {
  id: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  /** Structured one-liner (education program / school). Never a bio. */
  oneLine: string | null;
  school: string | null;
  city: string | null;
  role: WalkRole;
  mediums: string[];
  /**
   * Mutual connection names computed from stored follow edges.
   * `null` means the graph was not queried — the UI omits the line.
   */
  mutualNames: string[] | null;
  /** Avatars aligned with `mutualNames`. Absent when the graph was not queried. */
  mutualAvatars?: (string | null)[] | null;
  viewerFollows: boolean;
};

export type WalkWork = {
  id: string;
  title: string;
  year: string | null;
  medium: string | null;
  artistId: string;
  imagePath: string | null;
  exhibitionIds: string[];
};

export type WalkExhibition = {
  id: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  curatorId: string;
  hostProfileId: string | null;
  hostName: string | null;
  coverPath: string | null;
  participantIds: string[];
  workIds: string[];
  /**
   * Participating works already resolved for the highlight card.
   * Omitted by older fixtures, which fall back to `workIds`.
   */
  thumbs?: ExhibitionThumbInput[];
  /** Host or curator profile city. Null when neither profile has a city. */
  city: string | null;
  /**
   * `live` and `ended` belong on the public walk. `planned` is still a draft.
   * Omitted only by older fixtures, which stay eligible.
   */
  status?: string | null;
};

export type WalkEngagement = {
  userId: string;
  artworkId: string;
  kind: "like" | "save" | "inquiry";
};

export type WalkFollow = {
  followerId: string;
  followingId: string;
};

export type WalkViewer = {
  id: string | null;
  school: string | null;
  city: string | null;
  medium: string | null;
  role: WalkRole | null;
  exhibitionIds: string[];
  artworkIds: string[];
  followingIds: string[];
  savedArtworkIds: string[];
  inquiredArtworkIds: string[];
  likedArtworkIds: string[];
};

export type WalkPools = {
  people: WalkPerson[];
  works: WalkWork[];
  exhibitions: WalkExhibition[];
  engagements: WalkEngagement[];
  follows: WalkFollow[];
};

export type WalkCursor = {
  v: 1;
  /** Next scenario index inside the lane rotation. */
  si: number;
  /** Pages already produced. Advances even when a scenario is skipped. */
  off: number;
  /** `p:|w:|e:` keys already placed, so the next page does not repeat them. */
  used: string[];
};

export type WalkCopy = {
  key: string;
  params: Record<string, string>;
};

export type WalkCredit = {
  id: string | null;
  name: string;
  username: string | null;
  avatarUrl: string | null;
};

export type WalkPersonView = {
  id: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  oneLine: string | null;
  school: string | null;
  city: string | null;
  role: WalkRole;
  mutualNames: string[] | null;
  mutualAvatars: (string | null)[] | null;
  viewerFollows: boolean;
};

export type WalkWorkView = {
  id: string;
  title: string;
  year: string | null;
  medium: string | null;
  artistId: string;
  artistName: string;
  artistUsername: string | null;
  artistAvatarUrl: string | null;
  imagePath: string | null;
  curator: WalkCredit | null;
  gallery: WalkCredit | null;
};

export type WalkExhibitionView = {
  id: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  curator: WalkCredit | null;
  gallery: WalkCredit | null;
  coverPath: string | null;
  city: string | null;
  /** Up to six image-only works. Empty when the exhibition has none to show. */
  works: ExhibitionThumb[];
};

type ModuleBase = {
  key: string;
  title: WalkCopy;
  reason: WalkCopy;
};

export type ArtistCardModule = ModuleBase & {
  type: "artist_card";
  person: WalkPersonView;
  works: WalkWorkView[];
};

export type ArtworkGalleryModule = ModuleBase & {
  type: "artwork_gallery";
  works: WalkWorkView[];
};

export type ExhibitionCardModule = ModuleBase & {
  type: "exhibition_card";
  exhibition: WalkExhibitionView;
};

export type RelatedNetworkModule = ModuleBase & {
  type: "related_network";
  people: WalkPersonView[];
};

export type CuratorsViewModule = ModuleBase & {
  type: "curators_view";
  works: WalkWorkView[];
};

export type RelatedArtworkModule = ModuleBase & {
  type: "related_artwork";
  works: WalkWorkView[];
};

export type FeedModule =
  | ArtistCardModule
  | ArtworkGalleryModule
  | ExhibitionCardModule
  | RelatedNetworkModule
  | CuratorsViewModule
  | RelatedArtworkModule;

export type WalkScenario =
  | "exhibition_network"
  | "shared_medium"
  | "curatorial"
  | "school"
  | "local"
  | "collector"
  | "public"
  | "following";

export type WalkLane = "personalized" | "public" | "following";

export type WalkPage = {
  scenario: WalkScenario | null;
  modules: FeedModule[];
  nextCursor: string | null;
};
