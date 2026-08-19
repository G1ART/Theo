/**
 * Plan ↔ feature matrix and per-feature quota ceilings.
 *
 * This file is the single source of truth for monetization gating. The seed
 * migration mirrors the same shape into `public.plan_feature_matrix` /
 * `public.plan_quota_matrix` so DB-level `SECURITY DEFINER` RPCs that need
 * to gate reveal operations (e.g. `get_profile_viewers`) can read from the
 * same table-of-truth without re-hardcoding plans in SQL.
 *
 * Guiding principles:
 *  - Every canonical `FeatureKey` appears exactly once here.
 *  - `free` entries stay short and deliberate — anything not listed under a
 *    plan is blocked for that plan (closed-by-default).
 *  - `hybrid_pro` = artist_pro ∪ discovery_pro (handled by resolver folding
 *    effective bundle, not redundant enumeration here).
 *  - `gallery_workspace` is a superset of hybrid_pro + workspace/delegation
 *    capabilities; listed explicitly to keep matrix grep-ability high.
 */

import type { FeatureKey } from "./featureKeys";
import type { PlanKey } from "./types";

export const PLAN_FEATURE_MATRIX: Record<FeatureKey, PlanKey[]> = {
  // Insights
  "insights.profile_viewer_identity": ["artist_pro", "hybrid_pro", "gallery_workspace"],
  "insights.artwork_viewer_identity": ["artist_pro", "hybrid_pro", "gallery_workspace"],
  "insights.board_saver_identity": ["artist_pro", "hybrid_pro", "gallery_workspace"],
  "insights.board_public_actor_details": ["artist_pro", "hybrid_pro", "gallery_workspace"],
  "insights.referrer_source": ["artist_pro", "hybrid_pro", "gallery_workspace"],
  "insights.interest_breakdown": ["artist_pro", "hybrid_pro", "gallery_workspace"],

  // AI — everyone gets a metered free tier, pro unlocks higher quotas
  "ai.bio_assist": ["free", "artist_pro", "discovery_pro", "hybrid_pro", "gallery_workspace"],
  "ai.inquiry_reply_assist": ["free", "artist_pro", "discovery_pro", "hybrid_pro", "gallery_workspace"],
  "ai.exhibition_copy_assist": ["free", "artist_pro", "discovery_pro", "hybrid_pro", "gallery_workspace"],
  "ai.intro_assist": ["free", "artist_pro", "discovery_pro", "hybrid_pro", "gallery_workspace"],
  "ai.studio_intelligence": ["artist_pro", "discovery_pro", "hybrid_pro", "gallery_workspace"],
  // P1 AI workflow assistants — beta-friendly, every plan including free.
  // Visible paywalls intentionally avoided; quotas may be added later.
  "ai.board_pitch_pack": ["free", "artist_pro", "discovery_pro", "hybrid_pro", "gallery_workspace"],
  "ai.exhibition_review": ["free", "artist_pro", "discovery_pro", "hybrid_pro", "gallery_workspace"],
  "ai.delegation_brief": ["free", "artist_pro", "discovery_pro", "hybrid_pro", "gallery_workspace"],
  // Bilingual translation drafts — open to every plan, but the free tier
  // has a monthly quota (see PLAN_QUOTA_MATRIX below) to keep the LLM
  // bill reasonable when users adopt the bulk dashboard.
  "ai.translate_draft": ["free", "artist_pro", "discovery_pro", "hybrid_pro", "gallery_workspace"],
  // Theo Image Enhance (Beta, 2026-08-05) — every plan opens by default
  // during the beta window; no quota rule set below so calls never gate.
  "ai.image_enhance": ["free", "artist_pro", "discovery_pro", "hybrid_pro", "gallery_workspace"],

  // Boards
  "board.pro_create": ["free", "artist_pro", "discovery_pro", "hybrid_pro", "gallery_workspace"],
  "board.room_analytics": ["discovery_pro", "hybrid_pro", "gallery_workspace"],
  "board.custom_branding": ["discovery_pro", "hybrid_pro", "gallery_workspace"],
  "board.embed_widget": ["discovery_pro", "hybrid_pro", "gallery_workspace"],
  "board.template": ["discovery_pro", "hybrid_pro", "gallery_workspace"],

  // Inquiries
  "inquiry.triage": ["artist_pro", "hybrid_pro", "gallery_workspace"],
  "inquiry.response_templates": ["artist_pro", "hybrid_pro", "gallery_workspace"],
  "inquiry.sla_badge": ["artist_pro", "hybrid_pro", "gallery_workspace"],

  // Discovery
  "discovery.artwork_alerts": ["discovery_pro", "hybrid_pro", "gallery_workspace"],
  "discovery.saved_searches": ["discovery_pro", "hybrid_pro", "gallery_workspace"],

  // Exhibitions
  "exhibition.co_curator_credits": ["artist_pro", "hybrid_pro", "gallery_workspace"],

  // Social
  "social.connection_unlimited": ["free", "artist_pro", "discovery_pro", "hybrid_pro", "gallery_workspace"],

  // Profile
  "profile.custom_slug": ["artist_pro", "discovery_pro", "hybrid_pro", "gallery_workspace"],
  "profile.referrer_analytics": ["artist_pro", "discovery_pro", "hybrid_pro", "gallery_workspace"],

  // Provenance
  "provenance.verified_badge": ["artist_pro", "hybrid_pro", "gallery_workspace"],

  // Workspace
  "workspace.create": ["gallery_workspace"],
  "workspace.seat_invite": ["gallery_workspace"],
  "workspace.bulk_ops": ["gallery_workspace"],

  // Delegation
  "delegation.operator_invite": ["artist_pro", "hybrid_pro", "gallery_workspace"],
  "delegation.multi_scope": ["gallery_workspace"],
  // Delegation UX Permissions Upgrade (2026-04-27) — beta-friendly: open to
  // every plan including free. Quotas (`plan_quota_matrix`) intentionally
  // unset so no visible paywall appears; ceilings can be added later.
  "delegation.account": ["free", "artist_pro", "discovery_pro", "hybrid_pro", "gallery_workspace"],
  "delegation.project": ["free", "artist_pro", "discovery_pro", "hybrid_pro", "gallery_workspace"],
  "delegation.permission_presets": ["free", "artist_pro", "discovery_pro", "hybrid_pro", "gallery_workspace"],
  "delegation.activity_log": ["free", "artist_pro", "discovery_pro", "hybrid_pro", "gallery_workspace"],

  // Display / Hang Simulation (P1, 2026-08-18). 2D room-photo hang view is
  // open to every plan with a lifetime space-creation ceiling. Share link +
  // image export are gated by the sub-key `simulation.2d.export` (Free is
  // intentionally excluded — must upgrade to share/export). 3D parametric
  // view is reserved for hybrid_pro + gallery_workspace.
  "simulation.2d": ["free", "artist_pro", "discovery_pro", "hybrid_pro", "gallery_workspace"],
  "simulation.2d.export": ["artist_pro", "discovery_pro", "hybrid_pro", "gallery_workspace"],
  "simulation.3d": ["hybrid_pro", "gallery_workspace"],
};

export type QuotaRule = {
  /** Numeric ceiling for rolling window; null == unlimited. */
  limit: number | null;
  /** Rolling window size. 0 means "ever" (lifetime). */
  windowDays: number;
  /**
   * Usage event keys that count against this quota. Multiple keys can be
   * summed (e.g. an AI feature counts every successful generation).
   */
  countEventKeys: string[];
};

/**
 * Per-plan-per-feature quotas. Absent entries == unlimited for that plan.
 * Free-tier quotas are intentionally conservative but **active**: during
 * beta they are shadow-tracked (BETA_ALL_PAID=true bypasses enforcement)
 * so when paid tiers flip on, we already have the usage baseline.
 */
export const PLAN_QUOTA_MATRIX: Partial<
  Record<FeatureKey, Partial<Record<PlanKey, QuotaRule>>>
> = {
  "ai.bio_assist": {
    free: { limit: 8, windowDays: 30, countEventKeys: ["ai.bio_assist.generated"] },
    artist_pro: { limit: 200, windowDays: 30, countEventKeys: ["ai.bio_assist.generated"] },
    discovery_pro: { limit: 40, windowDays: 30, countEventKeys: ["ai.bio_assist.generated"] },
    hybrid_pro: { limit: 200, windowDays: 30, countEventKeys: ["ai.bio_assist.generated"] },
    gallery_workspace: { limit: null, windowDays: 30, countEventKeys: ["ai.bio_assist.generated"] },
  },
  "ai.inquiry_reply_assist": {
    free: { limit: 20, windowDays: 30, countEventKeys: ["ai.inquiry_reply_assist.generated"] },
    artist_pro: { limit: null, windowDays: 30, countEventKeys: ["ai.inquiry_reply_assist.generated"] },
    discovery_pro: { limit: 60, windowDays: 30, countEventKeys: ["ai.inquiry_reply_assist.generated"] },
    hybrid_pro: { limit: null, windowDays: 30, countEventKeys: ["ai.inquiry_reply_assist.generated"] },
    gallery_workspace: { limit: null, windowDays: 30, countEventKeys: ["ai.inquiry_reply_assist.generated"] },
  },
  "ai.exhibition_copy_assist": {
    free: { limit: 10, windowDays: 30, countEventKeys: ["ai.exhibition_copy_assist.generated"] },
    artist_pro: { limit: 100, windowDays: 30, countEventKeys: ["ai.exhibition_copy_assist.generated"] },
    discovery_pro: { limit: 30, windowDays: 30, countEventKeys: ["ai.exhibition_copy_assist.generated"] },
    hybrid_pro: { limit: 100, windowDays: 30, countEventKeys: ["ai.exhibition_copy_assist.generated"] },
    gallery_workspace: { limit: null, windowDays: 30, countEventKeys: ["ai.exhibition_copy_assist.generated"] },
  },
  "ai.intro_assist": {
    free: { limit: 15, windowDays: 30, countEventKeys: ["ai.intro_assist.generated"] },
    artist_pro: { limit: 150, windowDays: 30, countEventKeys: ["ai.intro_assist.generated"] },
    discovery_pro: { limit: 150, windowDays: 30, countEventKeys: ["ai.intro_assist.generated"] },
    hybrid_pro: { limit: 300, windowDays: 30, countEventKeys: ["ai.intro_assist.generated"] },
    gallery_workspace: { limit: null, windowDays: 30, countEventKeys: ["ai.intro_assist.generated"] },
  },
  "ai.studio_intelligence": {
    artist_pro: { limit: null, windowDays: 30, countEventKeys: ["ai.studio_intelligence.generated"] },
    discovery_pro: { limit: null, windowDays: 30, countEventKeys: ["ai.studio_intelligence.generated"] },
    hybrid_pro: { limit: null, windowDays: 30, countEventKeys: ["ai.studio_intelligence.generated"] },
    gallery_workspace: { limit: null, windowDays: 30, countEventKeys: ["ai.studio_intelligence.generated"] },
  },
  "board.pro_create": {
    // Free tier: up to 3 boards. Beyond that the UI should prompt upgrade.
    free: { limit: 3, windowDays: 0, countEventKeys: ["board.created"] },
    artist_pro: { limit: 20, windowDays: 0, countEventKeys: ["board.created"] },
    discovery_pro: { limit: null, windowDays: 0, countEventKeys: ["board.created"] },
    hybrid_pro: { limit: null, windowDays: 0, countEventKeys: ["board.created"] },
    gallery_workspace: { limit: null, windowDays: 0, countEventKeys: ["board.created"] },
  },
  /**
   * QA 2026-07-29 — Bilingual "AI 초안" 버튼 + `/settings/bilingual`
   * bulk 대시보드. 프리 티어에도 열려 있지만 짧은 필드/산문 draft 를
   * 지나치게 뽑아 쓰면 LLM 비용이 급증하므로 월간 상한을 둔다. 유료
   * 티어는 (프로 계열 위주로) 훨씬 넉넉하게, 갤러리는 무제한.
   *
   * 40 회 = 프리 사용자가 프로필 (name/bio/statement, 3) + 작품 10점의
   * 3개 필드 (title/medium/story, 30) + 전시 몇 개 (host_name, ~5)
   * 정도까지 draft 로 채울 수 있는 여유. 사용자가 "모두 AI 초안" 을
   * 눌러도 대부분 사용자는 한 번의 대시보드 세션 안에 완료할 수 있다.
   */
  "ai.translate_draft": {
    free: { limit: 40, windowDays: 30, countEventKeys: ["ai.translate_draft.generated"] },
    artist_pro: { limit: 300, windowDays: 30, countEventKeys: ["ai.translate_draft.generated"] },
    discovery_pro: { limit: 60, windowDays: 30, countEventKeys: ["ai.translate_draft.generated"] },
    hybrid_pro: { limit: 300, windowDays: 30, countEventKeys: ["ai.translate_draft.generated"] },
    gallery_workspace: { limit: null, windowDays: 30, countEventKeys: ["ai.translate_draft.generated"] },
  },
  "social.connection_unlimited": {
    // Cold intros are spam-prone — quota-backed for everyone. Pro tiers lift the ceiling.
    free: { limit: 5, windowDays: 30, countEventKeys: ["connection.message_sent"] },
    artist_pro: { limit: 100, windowDays: 30, countEventKeys: ["connection.message_sent"] },
    discovery_pro: { limit: 100, windowDays: 30, countEventKeys: ["connection.message_sent"] },
    hybrid_pro: { limit: 300, windowDays: 30, countEventKeys: ["connection.message_sent"] },
    gallery_workspace: { limit: null, windowDays: 30, countEventKeys: ["connection.message_sent"] },
  },
  // ────────────────────────────────────────────────────────────────
  // BETA_UNLIMITED (2026-08-18): Display / Hang Simulation quotas are
  // opened up for every plan during the closed beta so we can watch
  // the space-first flow without artificial slot pressure. `limit:
  // null` == unlimited (computeQuotaInfo returns Infinity). The
  // `count_event_keys` are kept as-is so `usage_events` continues to
  // accrue a faithful baseline — post-beta we can drop the null and
  // restore the pricing-plan caps below in one edit.
  //
  // Mirror change: `supabase/migrations/20260819030000_beta_unlimited
  // _simulation_quotas.sql` UPDATEs `plan_quota_matrix.quota_limit`
  // → null for the same (plan, feature) rows so DB-driven consumers
  // stay in sync.
  //
  // TODO (post-beta) — restore these exact caps here AND in the
  // matching migration (rollback SQL is inlined at the top of the
  // migration file):
  //   simulation.2d              (lifetime, count `simulation.space.created`)
  //     free              = 2
  //     artist_pro        = 5
  //     discovery_pro     = 5
  //     hybrid_pro        = 20
  //     gallery_workspace = null (unlimited)
  //   simulation.2d.export       (monthly, count `simulation.render.exported`;
  //                               free is not in PLAN_FEATURE_MATRIX so it
  //                               stays blocked at the feature gate)
  //     artist_pro        = 5
  //     discovery_pro     = 20
  //     hybrid_pro        = 50
  //     gallery_workspace = null (unlimited)
  //   simulation.3d              (monthly, count `simulation.render.exported`;
  //                               only hybrid_pro/gallery in PLAN_FEATURE_MATRIX)
  //     hybrid_pro        = 30
  //     gallery_workspace = null (unlimited)
  //
  // Non-goal reminder: `deleteSpace` is a soft delete, so the
  // `simulation.space.created` counter does NOT decrement when a
  // user deletes a space. During beta this is invisible (quotas
  // are Infinity). When we re-cap the free tier post-beta, decide
  // whether to (a) purge the matching usage_events row from
  // `deleteSpace` (needs a new DELETE grant on `usage_events`) or
  // (b) switch the counter to a live row count. See the parent
  // hand-off note dated 2026-08-18.
  // ────────────────────────────────────────────────────────────────
  "simulation.2d": {
    free: { limit: null, windowDays: 0, countEventKeys: ["simulation.space.created"] },
    artist_pro: { limit: null, windowDays: 0, countEventKeys: ["simulation.space.created"] },
    discovery_pro: { limit: null, windowDays: 0, countEventKeys: ["simulation.space.created"] },
    hybrid_pro: { limit: null, windowDays: 0, countEventKeys: ["simulation.space.created"] },
    gallery_workspace: { limit: null, windowDays: 0, countEventKeys: ["simulation.space.created"] },
  },
  "simulation.2d.export": {
    artist_pro: { limit: null, windowDays: 30, countEventKeys: ["simulation.render.exported"] },
    discovery_pro: { limit: null, windowDays: 30, countEventKeys: ["simulation.render.exported"] },
    hybrid_pro: { limit: null, windowDays: 30, countEventKeys: ["simulation.render.exported"] },
    gallery_workspace: { limit: null, windowDays: 30, countEventKeys: ["simulation.render.exported"] },
  },
  "simulation.3d": {
    hybrid_pro: { limit: null, windowDays: 30, countEventKeys: ["simulation.render.exported"] },
    gallery_workspace: { limit: null, windowDays: 30, countEventKeys: ["simulation.render.exported"] },
  },
};

/**
 * When a user is missing access, suggest the single cheapest plan that would
 * unlock `featureKey`. Used purely for UI copy ("Upgrade to Artist Pro") —
 * the resolver never picks a plan for the user.
 */
export function recommendPaywallPlan(featureKey: FeatureKey): Exclude<PlanKey, "free"> | null {
  const allowed = PLAN_FEATURE_MATRIX[featureKey] ?? [];
  // Ordered cheapest-first (illustrative ordering — actual pricing lives in
  // a later patch). The resolver uses this ordering only for UI hints.
  const preference: Array<Exclude<PlanKey, "free">> = [
    "artist_pro",
    "discovery_pro",
    "hybrid_pro",
    "gallery_workspace",
  ];
  for (const p of preference) {
    if (allowed.includes(p)) return p;
  }
  return null;
}
