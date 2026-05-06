"use client";

/**
 * Room → artwork → inquiry attribution breadcrumb (Sprint 3).
 *
 * Mirrors the `setFeedSource` / `peekFeedSource` / `consumeFeedSource`
 * pattern from `lib/feed/telemetry.ts` but lives next to the room
 * vocabulary so the room page never has to import from the feed module.
 *
 * Privacy invariant — read before extending:
 *   - We deliberately store the **shortlist `roomId` (uuid)** instead of
 *     the URL share-token. The token is a bearer-secret that grants
 *     access to the room view; it has no business living in
 *     sessionStorage breadcrumbs that could outlive the original click.
 *   - The token *is* allowed to flow through the URL (`?fromRoom=token`)
 *     because that's what unlocks the artwork's "Back to room" affordance
 *     — but the resolved `roomId` is what gets persisted for inquiry
 *     attribution downstream.
 *
 * TTL matches the feed source (30 min) so the breadcrumb auto-evicts
 * before becoming stale enough to misattribute a later inquiry.
 */

const ROOM_SOURCE_KEY = "ab_room_click_source";
const ROOM_SOURCE_TTL_MS = 30 * 60 * 1000;

export type RoomSourceContext = {
  /** Resolved shortlist UUID. Never the share-token. */
  room_id: string;
  /** The artwork id the user clicked from the room, if any. */
  artwork_id?: string | null;
  /** Wall-clock ms epoch the breadcrumb was written. */
  ts: number;
};

export function setRoomSource(ctx: Omit<RoomSourceContext, "ts">): void {
  if (typeof window === "undefined") return;
  if (!ctx.room_id) return;
  try {
    const payload: RoomSourceContext = { ...ctx, ts: Date.now() };
    window.sessionStorage.setItem(ROOM_SOURCE_KEY, JSON.stringify(payload));
  } catch {
    /* storage quota / private mode — drop silently */
  }
}

/**
 * Read the latest room source breadcrumb without consuming it. Returns
 * `null` if no breadcrumb is present, the value cannot be parsed, or it's
 * older than `ROOM_SOURCE_TTL_MS`. Use this when the destination needs
 * to attribute multiple downstream events (e.g. inquiry click + inquiry
 * created) from the same room visit.
 */
export function peekRoomSource(): RoomSourceContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ROOM_SOURCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RoomSourceContext | null;
    if (!parsed || typeof parsed !== "object" || !parsed.room_id) return null;
    if (typeof parsed.ts !== "number" || Date.now() - parsed.ts > ROOM_SOURCE_TTL_MS) {
      window.sessionStorage.removeItem(ROOM_SOURCE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Read and clear the room source — call this once after attribution. */
export function consumeRoomSource(): RoomSourceContext | null {
  const value = peekRoomSource();
  if (!value) return null;
  if (typeof window === "undefined") return value;
  try {
    window.sessionStorage.removeItem(ROOM_SOURCE_KEY);
  } catch {
    /* ignore */
  }
  return value;
}
