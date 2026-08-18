/**
 * Central registry of usage event names. Each constant mirrors a member
 * of `UsageEventKey` in `./types.ts` so call sites pick string literals
 * the compiler checks.
 */

export const USAGE_KEYS = {
  // AI
  AI_BIO_ASSIST_GENERATED: "ai.bio_assist.generated",
  AI_INQUIRY_REPLY_ASSIST_GENERATED: "ai.inquiry_reply_assist.generated",
  AI_EXHIBITION_COPY_ASSIST_GENERATED: "ai.exhibition_copy_assist.generated",
  AI_INTRO_ASSIST_GENERATED: "ai.intro_assist.generated",
  AI_STUDIO_INTELLIGENCE_GENERATED: "ai.studio_intelligence.generated",
  AI_PROFILE_COPILOT_GENERATED: "ai.profile_copilot.generated",
  AI_PORTFOLIO_COPILOT_GENERATED: "ai.portfolio_copilot.generated",
  AI_STUDIO_DIGEST_GENERATED: "ai.studio_digest.generated",
  AI_MATCHMAKER_RATIONALES_GENERATED: "ai.matchmaker_rationales.generated",
  AI_BOARD_PITCH_PACK_GENERATED: "ai.board_pitch_pack.generated",
  AI_EXHIBITION_REVIEW_GENERATED: "ai.exhibition_review.generated",
  AI_DELEGATION_BRIEF_GENERATED: "ai.delegation_brief.generated",
  AI_CV_IMPORT_GENERATED: "ai.cv_import.generated",
  /**
   * QA 2026-07-29 (Track α) — 이중언어 인풋의 "AI 초안" 버튼 (짧은 필드 +
   * 산문) 이 실제로 draft 를 생성했을 때 emit. Bulk 대시보드 (`/settings/
   * bilingual`) 의 quota chip 이 남은 회수를 계산할 때 이 키의 rolling
   * count 를 읽는다. 자동 저장은 아니라 사용자가 draft 를 채택하지 않아도
   * generation 은 카운트된다 — LLM 콜 비용이 이미 발생했기 때문.
   */
  AI_TRANSLATE_DRAFT_GENERATED: "ai.translate_draft.generated",
  /**
   * Theo Image Enhance (Beta, 2026-08-05) — lifecycle metering. Every
   * `metadata` payload must carry `{ mode, provider, latency_ms, source }`
   * so the beta cohort dashboard can slice usage by pipeline and
   * upload surface (single / bulk / exhibition_single / exhibition_bulk).
   */
  /**
   * Pre-flight artwork quality gate (2026-08-19). Fired once per
   * successful vision-LLM verdict on an uploaded photo (single OR
   * bulk). Metadata carries `{ severity, issues, source }` so the
   * beta dashboard can slice false-block vs. warn rates and see
   * which upload surface produced them.
   *
   * Skipped when the vision call was degraded (no key, timeout, rate
   * limit, …) — degraded gates emit an `ai_events` row via
   * `handleAiRoute` for diagnostics but don't touch this meter.
   */
  AI_ARTWORK_QUALITY_GATE_EVALUATED: "ai.artwork_quality_gate.evaluated",
  AI_IMAGE_ENHANCE_REQUESTED: "ai.image_enhance.requested",
  /**
   * Fires when the enhancement pipeline (local flat OR photoroom hybrid)
   * produced a *preview* the user is looking at. Reserve `.completed`
   * for the moment an approved enhancement lands in the *published*
   * artwork_images row.
   *
   * Historical note (2026-08-07): before this batch `.completed` fired
   * at preview time. Data migration for archival clarity is optional —
   * dashboards should treat any pre-2026-08-07 `.completed` events as
   * `.previewed`.
   */
  AI_IMAGE_ENHANCE_PREVIEWED: "ai.image_enhance.previewed",
  AI_IMAGE_ENHANCE_COMPLETED: "ai.image_enhance.completed",
  AI_IMAGE_ENHANCE_ACCEPTED: "ai.image_enhance.accepted",
  AI_IMAGE_ENHANCE_REJECTED: "ai.image_enhance.rejected",
  AI_IMAGE_ENHANCE_FAILED: "ai.image_enhance.failed",
  AI_ACCEPTED: "ai.accepted",
  // Boards
  BOARD_CREATED: "board.created",
  BOARD_SAVED_ARTWORK: "board.saved_artwork",
  BOARD_SAVED_EXHIBITION: "board.saved_exhibition",
  BOARD_PROMOTED_TO_EXHIBITION: "board.promoted_to_exhibition",
  BOARD_ROOM_VIEWED: "board.room_viewed",
  // Inquiries
  INQUIRY_CREATED: "inquiry.created",
  INQUIRY_REPLIED: "inquiry.replied",
  // Social
  CONNECTION_MESSAGE_SENT: "connection.message_sent",
  // Exhibitions
  EXHIBITION_CREATED: "exhibition.created",
  // Artwork
  ARTWORK_UPLOADED: "artwork.uploaded",
  IMPORT_WEBSITE_SCANNED: "import.website_scanned",
  IMPORT_WEBSITE_MATCHED: "import.website_matched",
  IMPORT_WEBSITE_APPLIED: "import.website_applied",
  // Display / Hang Simulation (P1, 2026-08-18)
  //
  // Emitted when a user creates a new hanging space (`simulation.2d`
  // lifetime quota) and when the simulation renderer produces an export
  // artifact (2D or 3D). Both keys are consumed by the entitlement
  // resolver via `PLAN_QUOTA_MATRIX["simulation.2d"|"simulation.3d"]`.
  SIMULATION_SPACE_CREATED: "simulation.space.created",
  SIMULATION_RENDER_EXPORTED: "simulation.render.exported",
  // Delegation
  DELEGATION_ACTING_AS_ENTERED: "delegation.acting_as_entered",
  DELEGATION_ACTING_AS_EXITED: "delegation.acting_as_exited",
  // Resolver
  FEATURE_IMPRESSION: "feature.impression",
  FEATURE_UPGRADE_HINT_SHOWN: "feature.upgrade_hint_shown",
  FEATURE_UPGRADE_HINT_CLICKED: "feature.upgrade_hint_clicked",
  FEATURE_GATE_BLOCKED: "feature.gate_blocked",
  ENTITLEMENT_DECISION_LOGGED: "entitlement.decision_logged",
} as const;

/** Maps a canonical AI feature key to the meter event it should emit. */
export const AI_FEATURE_TO_METER_KEY: Record<string, string> = {
  bio_draft: USAGE_KEYS.AI_BIO_ASSIST_GENERATED,
  inquiry_reply_draft: USAGE_KEYS.AI_INQUIRY_REPLY_ASSIST_GENERATED,
  exhibition_draft: USAGE_KEYS.AI_EXHIBITION_COPY_ASSIST_GENERATED,
  intro_message_draft: USAGE_KEYS.AI_INTRO_ASSIST_GENERATED,
  profile_copilot: USAGE_KEYS.AI_PROFILE_COPILOT_GENERATED,
  portfolio_copilot: USAGE_KEYS.AI_PORTFOLIO_COPILOT_GENERATED,
  studio_digest: USAGE_KEYS.AI_STUDIO_DIGEST_GENERATED,
  matchmaker_rationales: USAGE_KEYS.AI_MATCHMAKER_RATIONALES_GENERATED,
  board_pitch_pack: USAGE_KEYS.AI_BOARD_PITCH_PACK_GENERATED,
  exhibition_review: USAGE_KEYS.AI_EXHIBITION_REVIEW_GENERATED,
  delegation_brief: USAGE_KEYS.AI_DELEGATION_BRIEF_GENERATED,
  cv_import: USAGE_KEYS.AI_CV_IMPORT_GENERATED,
  /**
   * QA 2026-07-29 (Track α) — translate_draft 는 짧은 이중언어 필드
   * (title/medium/host_name) 부터 산문(bio/statement/story/preface) 까지
   * 커버한다. bio_assist 와 같은 캡을 공유하지 않고 자체 캡 (아래
   * plan_quota_matrix + PLAN_QUOTA_MATRIX 상수) 을 갖는다.
   */
  translate_draft: USAGE_KEYS.AI_TRANSLATE_DRAFT_GENERATED,
  /**
   * P1 (2026-08-19) — measurement-based scale calibration for a hanging
   * space. We piggyback on the existing `simulation.space.created` meter
   * to keep the P1 dashboard slice shape unchanged; the emitted event
   * carries `metadata.ai_feature = "space.calibrate"` so analytics can
   * separate the calibration slice when needed. No new usage key is
   * added to `USAGE_KEYS` for MVP scope.
   */
  "space.calibrate": USAGE_KEYS.SIMULATION_SPACE_CREATED,
  /**
   * 2026-08-19 — Artwork upload pre-flight quality gate. Emitted for
   * every successful (non-degraded) verdict; the DSP enhancement
   * pipeline still has its own `.previewed` / `.completed` meters
   * downstream, so this key stays isolated to the pre-flight step.
   */
  artwork_quality_gate: USAGE_KEYS.AI_ARTWORK_QUALITY_GATE_EVALUATED,
};

/** Maps a canonical AI feature key to the entitlement feature key that
 *  governs it. Used by handleAiRoute to decide gating + quota shape. */
export const AI_FEATURE_TO_ENTITLEMENT_KEY: Record<string, string> = {
  bio_draft: "ai.bio_assist",
  inquiry_reply_draft: "ai.inquiry_reply_assist",
  exhibition_draft: "ai.exhibition_copy_assist",
  intro_message_draft: "ai.intro_assist",
  profile_copilot: "ai.studio_intelligence",
  portfolio_copilot: "ai.studio_intelligence",
  studio_digest: "ai.studio_intelligence",
  matchmaker_rationales: "ai.studio_intelligence",
  board_pitch_pack: "ai.board_pitch_pack",
  exhibition_review: "ai.exhibition_review",
  delegation_brief: "ai.delegation_brief",
  /**
   * QA 2026-07-29 (Track α) — 이중언어 번역 draft 는 새 entitlement key
   * `ai.translate_draft` 를 통해 게이팅한다. plan_matrix 는 모든 플랜에
   * 열려 있고, quota 만 프리 티어에 있어 sensible 한 상한을 건다 (아래
   * PLAN_QUOTA_MATRIX 참조).
   */
  translate_draft: "ai.translate_draft",
  /**
   * P1 (2026-08-19) — Space calibrate reuses the `simulation.2d` gate so
   * we don't add a plan_feature_matrix row for a single automation
   * behavior. Users who can create a hanging space also get AI scale
   * detection; if they can't (soft cap / no plan), the resolver
   * short-circuits before we spend a vision token.
   */
  "space.calibrate": "simulation.2d",
};
