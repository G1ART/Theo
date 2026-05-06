"use client";

import { supabase } from "@/lib/supabase/client";

export type BetaEventName =
  | "signup_started"
  | "signup_completed"
  | "profile_completed"
  | "upload_started"
  | "upload_completed"
  | "bulk_publish_completed"
  | "artwork_liked"
  | "profile_followed"
  | "profile_follow_requested"
  | "inquiry_created"
  | "inquiry_replied"
  | "exhibition_created"
  | "exhibition_artwork_added"
  | "feed_first_paint"
  | "feed_loaded"
  | "feed_load_more"
  | "feed_item_impression"
  | "feed_item_click"
  | "feed_item_like_or_save"
  | "feed_item_follow"
  | "feed_item_inquiry_click"
  | "profile_view_from_feed"
  | "exhibition_view_from_feed"
  | "shortlist_item_added"
  | "shortlist_item_removed"
  | "shortlist_collaborator_added"
  | "room_viewed"
  | "room_opened_artwork"
  | "room_inquiry_clicked"
  | "room_copy_link"
  | "ai_accepted"
  | "connection_message_sent"
  | "board_promote_started"
  | "board_promote_bulk_added"
  | "monetization_hint_shown"
  | "monetization_hint_clicked"
  | "feature_gate_blocked"
  | "tour_shown"
  | "tour_step_advanced"
  | "tour_skipped"
  | "tour_completed"
  | "tour_reopened"
  // ─── Sprint 5 — Relationship Access Layer (15 events) ───
  | "visibility_policy_changed"
  | "visibility_preset_changed"
  | "visibility_gate_seen"
  | "visibility_gate_cta_clicked"
  | "follow_request_from_visibility_gate"
  | "mutual_connection_created"
  | "approved_viewer_added"
  | "artwork_sensitive_field_viewed"
  | "price_inquiry_from_gate"
  | "room_access_requested"
  | "vip_access_requested"
  | "preview_as_used"
  | "access_request_created"
  | "access_request_resolved"
  | "access_grant_created";

/**
 * Best-effort first-party analytics for beta (RLS: insert own user_id only).
 * Never throw; failures are silent.
 */
export async function logBetaEvent(
  eventName: BetaEventName,
  payload: Record<string, unknown> = {}
): Promise<void> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const uid = session?.user?.id ?? null;
    await supabase.from("beta_analytics_events").insert({
      user_id: uid,
      event_name: eventName,
      payload,
      client_ts: new Date().toISOString(),
    });
  } catch {
    /* ignore */
  }
}

export function logBetaEventSync(eventName: BetaEventName, payload: Record<string, unknown> = {}): void {
  void logBetaEvent(eventName, payload);
}
