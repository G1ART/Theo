/**
 * The other-artist choice on a bulk upload is made before the files.
 * It has to survive a refresh, and every card created while it is
 * active — including the next drop after that refresh — belongs to
 * that artist. The uploading account stays the provenance subject.
 */

import {
  draftArtistIdForInsert,
  planOnboardedArtistPublish,
  resolveUploadedArtworkArtist,
  type ListerClaimType,
  type OnboardedArtistPublishPlan,
} from "@/lib/upload/artworkOwner";

export const BULK_SESSION_ARTIST_KEY = "bulk.otherArtist.v1";

export type BulkSessionArtist = {
  artistId: string;
  username: string | null;
  displayName: string | null;
  displayNameKo: string | null;
  displayNameEn: string | null;
  intent: ListerClaimType;
};

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function isListerIntent(value: unknown): value is ListerClaimType {
  return value === "OWNS" || value === "INVENTORY" || value === "CURATED";
}

export function bulkSessionFromArtist(
  artist: {
    id: string;
    username?: string | null;
    display_name?: string | null;
    display_name_ko?: string | null;
    display_name_en?: string | null;
  },
  intent: ListerClaimType | "CREATED" | null | undefined,
): BulkSessionArtist | null {
  const artistId = artist.id?.trim() || "";
  if (!artistId) return null;
  return {
    artistId,
    username: artist.username?.trim() || null,
    displayName: artist.display_name?.trim() || null,
    displayNameKo: artist.display_name_ko?.trim() || null,
    displayNameEn: artist.display_name_en?.trim() || null,
    intent: isListerIntent(intent) ? intent : "CURATED",
  };
}

export function serializeBulkSessionArtist(value: BulkSessionArtist): string {
  return JSON.stringify(value);
}

export function parseBulkSessionArtist(raw: string | null | undefined): BulkSessionArtist | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BulkSessionArtist>;
    const artistId = typeof parsed.artistId === "string" ? parsed.artistId.trim() : "";
    if (!artistId || !isListerIntent(parsed.intent)) return null;
    return {
      artistId,
      username: typeof parsed.username === "string" && parsed.username.trim() ? parsed.username.trim() : null,
      displayName:
        typeof parsed.displayName === "string" && parsed.displayName.trim()
          ? parsed.displayName.trim()
          : null,
      displayNameKo:
        typeof parsed.displayNameKo === "string" && parsed.displayNameKo.trim()
          ? parsed.displayNameKo.trim()
          : null,
      displayNameEn:
        typeof parsed.displayNameEn === "string" && parsed.displayNameEn.trim()
          ? parsed.displayNameEn.trim()
          : null,
      intent: parsed.intent,
    };
  } catch {
    return null;
  }
}

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readBulkSessionArtist(storage?: StorageLike | null): BulkSessionArtist | null {
  const store = storage === undefined ? browserStorage() : storage;
  if (!store) return null;
  try {
    return parseBulkSessionArtist(store.getItem(BULK_SESSION_ARTIST_KEY));
  } catch {
    return null;
  }
}

export function writeBulkSessionArtist(
  value: BulkSessionArtist,
  storage?: StorageLike | null,
): void {
  const store = storage === undefined ? browserStorage() : storage;
  if (!store) return;
  try {
    store.setItem(BULK_SESSION_ARTIST_KEY, serializeBulkSessionArtist(value));
  } catch {
    // sessionStorage disabled — the in-memory choice still applies this visit.
  }
}

export function clearBulkSessionArtist(storage?: StorageLike | null): void {
  const store = storage === undefined ? browserStorage() : storage;
  if (!store) return;
  try {
    store.removeItem(BULK_SESSION_ARTIST_KEY);
  } catch {
    // ignore
  }
}

export type BulkCardArtist = {
  artistId: string;
  createdBy: string;
  plan: OnboardedArtistPublishPlan | null;
};

/**
 * Who a new bulk card belongs to.
 *
 * The in-memory pick wins. After a refresh that pick is gone, so the
 * session artist — stored when the operator chose them, before any
 * file — is used. Acting-as never replaces that artist with the
 * delegate or the gallery.
 */
export function resolveBulkCardArtist(input: {
  sessionUserId: string;
  actingAsProfileId?: string | null;
  memoryArtistId?: string | null;
  sessionArtistId?: string | null;
  intent?: "CREATED" | ListerClaimType | null;
}): BulkCardArtist {
  const selected = input.memoryArtistId?.trim() || input.sessionArtistId?.trim() || "";
  const owner = resolveUploadedArtworkArtist({
    sessionUserId: input.sessionUserId,
    actingAsProfileId: input.actingAsProfileId,
    selectedArtistId: selected || null,
  });
  const intent: ListerClaimType = isListerIntent(input.intent) ? input.intent : "CURATED";
  const plan = selected
    ? planOnboardedArtistPublish({
        sessionUserId: input.sessionUserId,
        actingAsProfileId: input.actingAsProfileId,
        selectedArtistId: selected,
        intent,
      })
    : null;
  return {
    artistId: plan?.artistId ?? owner.artistId,
    createdBy: owner.createdBy,
    plan,
  };
}

/** `artworks.artist_id` for a card. The acting principal is not the artist when a plan exists. */
export function bulkDraftInsertArtistId(input: {
  sessionUserId: string;
  actingAsProfileId?: string | null;
  card: BulkCardArtist;
}): string {
  return draftArtistIdForInsert({
    sessionUserId: input.sessionUserId,
    forProfileId: input.actingAsProfileId,
    artistProfileId: input.card.plan ? input.card.artistId : null,
  });
}
