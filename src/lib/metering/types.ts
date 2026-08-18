/**
 * Metering types. `UsageEventKey` is a literal union so mistyped event
 * names fail at compile time in callers. `UsageEventPayload` mirrors the
 * shape of the `public.usage_events` row.
 */

import type { FeatureKey } from "@/lib/entitlements/featureKeys";

export type UsageEventKey =
  // AI generation meters
  | "ai.bio_assist.generated"
  | "ai.inquiry_reply_assist.generated"
  | "ai.exhibition_copy_assist.generated"
  | "ai.intro_assist.generated"
  | "ai.studio_intelligence.generated"
  | "ai.profile_copilot.generated"
  | "ai.portfolio_copilot.generated"
  | "ai.studio_digest.generated"
  | "ai.matchmaker_rationales.generated"
  | "ai.board_pitch_pack.generated"
  | "ai.exhibition_review.generated"
  | "ai.delegation_brief.generated"
  // Theo Image Enhance (Beta, 2026-08-05)
  //
  // 2026-08-07 semantic split — `.previewed` fires when the pipeline
  // produces a preview the user is looking at; `.completed` is reserved
  // for the point at which an approved enhancement lands in the
  // published storage row. Prior batches used `.completed` for the
  // preview stage; historical events in `usage_events` for that period
  // should be interpreted as "previewed" (see HANDOFF 2026-08-07).
  | "ai.image_enhance.requested"
  | "ai.image_enhance.previewed"
  | "ai.image_enhance.completed"
  | "ai.image_enhance.accepted"
  | "ai.image_enhance.rejected"
  | "ai.image_enhance.failed"
  // Pre-flight artwork quality gate (2026-08-19). Fires once per
  // successful (non-degraded) vision-LLM verdict on an uploaded
  // photo; degraded verdicts skip the meter and only leave an
  // `ai_events` row for diagnostics.
  | "ai.artwork_quality_gate.evaluated"
  | "ai.accepted"
  // Boards / shortlists
  | "board.created"
  | "board.saved_artwork"
  | "board.saved_exhibition"
  | "board.promoted_to_exhibition"
  | "board.room_viewed"
  // Inquiries
  | "inquiry.created"
  | "inquiry.replied"
  // Connections / social
  | "connection.message_sent"
  // Exhibitions
  | "exhibition.created"
  // Artworks
  | "artwork.uploaded"
  | "import.website_scanned"
  | "import.website_matched"
  | "import.website_applied"
  // Display / Hang Simulation (P1, 2026-08-18)
  | "simulation.space.created"
  | "simulation.render.exported"
  // Delegation / acting-as
  | "delegation.acting_as_entered"
  | "delegation.acting_as_exited"
  // Resolver instrumentation
  | "feature.impression"
  | "feature.upgrade_hint_shown"
  | "feature.upgrade_hint_clicked"
  | "feature.gate_blocked"
  | "entitlement.decision_logged";

export type UsageEventPayload = {
  key: UsageEventKey;
  featureKey?: FeatureKey | string;
  valueInt?: number;
  workspaceId?: string | null;
  metadata?: Record<string, unknown>;
  userId?: string | null;
};

export type UsageEventMeta = {
  startedAt: string | null;
  endedAt: string | null;
  windowDays: number;
};
