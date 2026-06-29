/**
 * Canonical feature key registry — the single source of truth for every
 * gated capability in Theo. The registry is a TypeScript literal union
 * so mis-typed keys fail at compile time; it is also mirrored into the
 * `plan_feature_matrix` table via the seed migration so DB-level gates
 * (RPCs with `SECURITY DEFINER`) can reference the same values.
 *
 * Naming: `<domain>.<capability>` — always lower-case, dot-separated, no
 * verbs. Avoid renaming an existing key; add a new one and soft-deprecate
 * via `LEGACY_FEATURE_KEY_ALIAS` below.
 */

export const FEATURE_KEYS = [
  // Insights (audience / viewer identity surfaces)
  "insights.profile_viewer_identity",
  "insights.artwork_viewer_identity",
  "insights.board_saver_identity",
  "insights.board_public_actor_details",
  "insights.referrer_source",
  "insights.interest_breakdown",

  // AI-Native Studio Layer
  "ai.bio_assist",
  "ai.inquiry_reply_assist",
  "ai.exhibition_copy_assist",
  "ai.intro_assist",
  "ai.studio_intelligence",
  // P1 AI workflow assistants — additive. plan_matrix seeds them open
  // for every plan during beta so no visible paywall appears; ceilings
  // can be added later via plan_quota_matrix without code changes.
  "ai.board_pitch_pack",
  "ai.exhibition_review",
  "ai.delegation_brief",

  // Boards (shortlists + rooms)
  "board.pro_create",
  "board.room_analytics",
  "board.custom_branding",
  "board.embed_widget",
  "board.template",

  // Inquiries
  "inquiry.triage",
  "inquiry.response_templates",
  "inquiry.sla_badge",

  // Discovery
  "discovery.artwork_alerts",
  "discovery.saved_searches",

  // Exhibitions
  "exhibition.co_curator_credits",

  // Social
  "social.connection_unlimited",

  // Profile
  "profile.custom_slug",
  "profile.referrer_analytics",

  // Provenance
  "provenance.verified_badge",

  // Workspace (org/gallery seat container)
  "workspace.create",
  "workspace.seat_invite",
  "workspace.bulk_ops",

  // Delegation (personal operator invite)
  "delegation.operator_invite",
  "delegation.multi_scope",
  // Delegation UX Permissions Upgrade (2026-04-27)
  "delegation.account",
  "delegation.project",
  "delegation.permission_presets",
  "delegation.activity_log",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

/**
 * Back-compat map: old SCREAMING_SNAKE_CASE keys (used by `hasFeature` call
 * sites before the spine) -> canonical namespaced keys. Call sites are
 * migrated incrementally; the shim in `legacy.ts` resolves through this
 * map so no consumer crashes mid-rollout.
 */
export const LEGACY_FEATURE_KEY_ALIAS: Record<string, FeatureKey> = {
  VIEW_PROFILE_VIEWERS_LIST: "insights.profile_viewer_identity",
  VIEW_ARTWORK_VIEWERS_LIST: "insights.artwork_viewer_identity",
  SEE_BOARD_SAVER_IDENTITY: "insights.board_saver_identity",
  SEE_BOARD_PUBLIC_ACTOR_DETAILS: "insights.board_public_actor_details",
};

export function resolveFeatureKey(input: string): FeatureKey | null {
  if ((FEATURE_KEYS as readonly string[]).includes(input)) {
    return input as FeatureKey;
  }
  return LEGACY_FEATURE_KEY_ALIAS[input] ?? null;
}

/**
 * Namespace a feature key falls into — used by the resolver to pick the
 * right billing subject when `actingAsProfileId` is present. Delegation /
 * workspace keys bill the **delegate (acting user)** because those are
 * personal capabilities; every other namespace bills the **principal**
 * (whose resources are being touched).
 */
export function featureKeyNamespace(key: FeatureKey): string {
  const idx = key.indexOf(".");
  return idx === -1 ? key : key.slice(0, idx);
}
