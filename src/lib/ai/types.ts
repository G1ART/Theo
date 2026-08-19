// Result shapes for the AI-Native Studio Layer (Wave 1).
// Each route returns a typed JSON body that the UI renders into editable
// preview cards. All variants carry a `degraded` flag so the UI can fall
// back to static copy when OpenAI is unavailable, the soft cap is hit, or
// JSON parsing fails.

export type AiDegradation = {
  degraded?: boolean;
  reason?:
    | "no_key"
    | "timeout"
    | "cap"
    | "parse"
    | "error"
    | "unauthorized"
    | "invalid_input"
    /** OpenAI or upstream rate limit (distinct from product soft cap). */
    | "rate_limit"
    /** Prompt or combined context too large for the model. */
    | "context_limit"
    /** Upstream rejected API credentials (distinct from our 401). */
    | "upstream_auth";
  /**
   * Row id of the `ai_events` record for this call. Clients send this back
   * to `/api/ai/accept` when the user adopts the draft so the analytics row
   * flips from `accepted IS NULL` → `accepted = true`. Absent on degraded
   * or pre-request failures.
   */
  aiEventId?: string;
  /** Present on some `invalid_input` responses from `/api/ai/*` routes. */
  validation?: string;
  /** Optional machine-readable error from the server (do not show raw to users). */
  error?: string;
};

export type AiLocale = "en" | "ko";

/** Optional grouping for profile copilot suggestions (model-supplied). */
export type ProfileSuggestionCategory =
  | "basics"
  | "public_clarity"
  | "discoverability"
  | "other";

export type ProfileViewerLens = "curator" | "collector" | "gallery";

export type ProfileViewerNote = {
  lens: ProfileViewerLens;
  note: string;
};

export type ProfileSuggestion = {
  id: string;
  title: string;
  detail: string;
  actionLabel?: string;
  actionHref?: string;
  /** When absent, UI groups under “other”. */
  category?: ProfileSuggestionCategory;
};

export type ProfileSuggestionsResult = AiDegradation & {
  completeness: number; // 0-100 (may be computed client-side if degraded)
  missing: string[]; // short bullet points describing what's weak
  suggestions: ProfileSuggestion[];
  /**
   * Wave 2: 1–3 alternative bios the artist can adopt wholesale. Theo
   * does not store these server-side; adoption happens through the
   * settings page.
   */
  bioDrafts?: string[];
  /**
   * Wave 2: 1–2 short one-liners (≤ 90 chars) the artist can use on
   * portfolios, exhibition invites, or external bios.
   */
  headlineDrafts?: string[];
  /**
   * Wave 2: short paragraph explaining why the suggested changes would
   * improve discoverability (themes, mediums, locale density, etc.).
   */
  discoverabilityRationale?: string;
  /**
   * Up to three short “visitor perspective” notes — humble tone, no scoring.
   */
  viewerNotes?: ProfileViewerNote[];
  /**
   * P1-0: 2–3 candidate artist statement passages produced when the route
   * is called with mode=statement. The UI lets the artist copy or directly
   * paste a draft into the statement textarea — Theo never auto-applies.
   */
  statementDrafts?: string[];
};

/** Deterministic counts from the client; sent with portfolio copilot context. */
export type PortfolioMetadataGaps = {
  missing_title: number;
  missing_year: number;
  missing_medium: number;
  missing_size: number;
  no_image: number;
  drafts_not_public: number;
};

export type PortfolioSuggestion = {
  id: string;
  kind: "reorder" | "series" | "metadata" | "exhibition_link" | "feature";
  title: string;
  detail: string;
  actionLabel?: string;
  actionHref?: string;
  /**
   * Wave 2: ids the artist's own works referenced by this suggestion
   * (series grouping, featured picks, exhibition links). UI renders
   * per-artwork deep links instead of free-form prose.
   */
  artworkIds?: string[];
};

export type PortfolioSuggestionsResult = AiDegradation & {
  suggestions: PortfolioSuggestion[];
  /**
   * Wave 2: optional ordering hint. Theo never auto-reorders — the
   * UI shows the rationale and links, and the artist still chooses.
   */
  ordering?: {
    rationale: string;
    artworkIds: string[];
  };
};

export type StudioDigestResult = AiDegradation & {
  headline: string;
  changes: string[]; // 2–3 bullet points
  nextActions: Array<{ label: string; href?: string }>;
};

export type BioDraftResult = AiDegradation & {
  tone: "concise" | "warm" | "curatorial";
  drafts: string[]; // up to 3 alternatives
};

export type ExhibitionDraftKind =
  | "title"
  | "description"
  | "wall_text"
  | "invite_blurb";

export type ExhibitionDraftResult = AiDegradation & {
  kind: ExhibitionDraftKind;
  drafts: string[]; // 1–3 alternatives
};

export type InquiryReplyDraftLength = "short" | "long";

export type InquiryReplyDraft = {
  body: string;
  length?: InquiryReplyDraftLength;
};

export type InquiryTriagePriority = "normal" | "time_sensitive" | "opportunity";

/** Lightweight triage before reply drafts (model-supplied, optional). */
export type InquiryReplyTriage = {
  /** Short intent label (e.g. price, availability); UI maps known values to i18n. */
  intent?: string;
  priority?: InquiryTriagePriority;
  missingInfo?: string[];
};

export type InquiryReplyDraftResult = AiDegradation & {
  tone: "concise" | "warm" | "curatorial";
  kind: "reply" | "followup";
  triage?: InquiryReplyTriage;
  /**
   * Wave 2: drafts are objects carrying an optional length badge. Until
   * the model adopts the new shape everywhere we keep the UI layer
   * tolerant of bare strings via a normalizer (see InquiryReplyAssist).
   */
  drafts: InquiryReplyDraft[];
};

export type IntroMessageDraftResult = AiDegradation & {
  drafts: string[]; // 1–3 alternatives
};

export type MatchmakerSuggestedAction =
  | "follow"
  | "intro_note"
  | "exhibition_share"
  | "save_for_later";

export type MatchmakerRationale = {
  profileId: string;
  rationale: string;
  /**
   * Wave 2: the single action most relevant to this peer. The card
   * renders a matching 2nd-tier chip button; auto-sending is never
   * permitted — everything is copy / inline drafts / local saves.
   */
  suggestedAction?: MatchmakerSuggestedAction;
  /**
   * Wave 2: up to 3 of the *viewer's* own artwork ids that would make
   * a natural mention in the outreach note.
   */
  suggestedArtworkIds?: string[];
};

export type MatchmakerRationalesResult = AiDegradation & {
  rationales: MatchmakerRationale[];
};

export type AiFeatureKey =
  | "profile_copilot"
  | "portfolio_copilot"
  | "studio_digest"
  | "bio_draft"
  | "exhibition_draft"
  | "inquiry_reply_draft"
  | "intro_message_draft"
  | "matchmaker_rationales"
  | "board_pitch_pack"
  | "exhibition_review"
  | "delegation_brief"
  | "cv_import"
  /**
   * QA 2026-07-28 (Track C) — 이중언어 인풋 옆에 붙는 "AI 초안" 버튼이
   * 사용하는 짧은 번역 draft 라우트. 원문(sourceText)을 상대 언어로 옮겨
   * 편집 가능한 draft 한 개를 반환한다. 절대 자동 저장하지 않고, UI 는
   * 입력창에 채워 넣기만 한다 (사용자가 폼 저장을 눌러야 반영).
   */
  | "translate_draft"
  /**
   * P1 (2026-08-19) — Display / Hang Simulation의 "측정 기반" 스케일
   * 보정. 방 사진 한 장을 vision LLM 으로 분석해 창문/문/TV/소파 등
   * 사용자가 실측 값을 알 만한 물건 2-4 개를 후보로 반환한다. 사용자가
   * 하나의 후보에 실치수(cm) 를 입력하면 클라이언트가 픽셀 대비 cm 을
   * 역산해 벽 너비/높이를 `space_surfaces.width_cm/height_cm` 에
   * 반영한다. entitlement 는 기존 `simulation.2d` 를 그대로 쓴다.
   */
  | "space.calibrate"
  /**
   * P1 (2026-08-19) — Display / Hang Simulation의 자동 벽 클린업.
   * 방 사진 업로드 직후 vision LLM 이 방 안의 주요 타깃 벽면 폴리곤과
   * 벽면의 중앙값 RGB (그리고 광원 방향 힌트) 를 반환한다. 클라이언트는
   * 이 폴리곤을 페더링된 마스크로 사용해 벽 영역 안쪽에서만 저주파
   * 조도를 평탄화해 사진의 `photo_storage_path` 를 교체한다. 원본은
   * `photo_original_storage_path` 로 보존되어 사용자가 "원본 사용"
   * 토글로 되돌릴 수 있다. entitlement 는 기존 `simulation.2d` 를
   * 그대로 쓰고, degraded/저신뢰 결과는 조용히 스킵한다.
   */
  | "space.wall_detect"
  /**
   * 2026-08-19 — 업로드 파이프라인 pre-flight 품질 게이트. 사용자가
   * 업로드한 원본 사진 한 장을 vision LLM 으로 판정해 심각한 품질
   * 이슈(모션 블러, 스크린 촬영 모아레, 극단적 클리핑, 대부분 잘림
   * 등) 만 "재촬영 권장" 으로 조기 경고한다. DSP 파이프라인(perspective
   * / AWB / Pro Look) 앞단에서만 동작하며 게이트가 실패(no_key, timeout
   * 등) 하면 조용히 통과시킨다 — AI 인프라 장애가 정상 업로드를 막지
   * 않도록. entitlement 없음, 소프트캡만 공유.
   */
  | "artwork_quality_gate"
  /**
   * 2026-08-20 (Display Simulation Phase 2, Track 1) — 업로드된 작품
   * 사진 내부에서 실제 페인팅 / 사진 영역의 정규화 bbox 를 vision LLM
   * 으로 감지한다. 벽, 매트, 프레임, 촬영 여백을 제외한 가장 큰 사각형만
   * 반환. 클라이언트는 결과를 canvas 로 크롭해 `artwork_images` 의
   * `view_type='cutout'` sibling row 로 저장하고, 시뮬레이션 렌더러는
   * cutout 을 우선 사용한다. 원본은 절대 대체하지 않고 sibling 으로만
   * 붙는다. 이미 `alreadyTight: true` 이면 renderer 는 기존 primary 를
   * 그대로 쓴다.
   */
  | "artwork_painting_bbox";

/**
 * QA 2026-07-28 (Track C) — 번역 draft 결과. 짧은 필드(title, medium,
 * host_name)와 산문(bio, statement, preface, story) 모두 draft 한 개만
 * 반환한다. 여러 대안이 필요해지면 `drafts: string[]` 로 확장하되, 현재
 * 사용자 흐름(입력창을 바로 채움)에는 단일 draft 가 자연스럽다.
 */
export type TranslateDraftFieldKind =
  | "title"
  | "preface"
  | "bio"
  | "statement"
  | "medium"
  | "story"
  | "host_name";

export type TranslateDraftResult = AiDegradation & {
  fieldKind: TranslateDraftFieldKind;
  sourceLocale: AiLocale;
  targetLocale: AiLocale;
  draft: string;
};

/**
 * CV Import (P6.2) — structured CV extraction from a homepage URL or
 * an uploaded resume file (PDF / DOCX). The extractor lives server-side
 * (see `src/lib/cv/extract.ts`); the LLM step normalizes the raw text
 * into typed entries the editor can render. Each entry's `fields` map
 * carries the same keys our manual editor uses (school / program /
 * year / type, title / venue / city / year, name / organization /
 * year, name / location / year_from / year_to) so import results drop
 * straight into the existing CRUD UI.
 */
export type CvImportCategory = "education" | "exhibitions" | "awards" | "residencies";

export type CvImportEntry = {
  category: CvImportCategory;
  fields: Record<string, string>;
};

export type CvImportResult = AiDegradation & {
  entries: CvImportEntry[];
  /** Self-reported model confidence in the structuring (0..1). */
  confidence?: number;
  /** Optional: short note from the model when the input was thin. */
  note?: string | null;
};

/**
 * P1-A — Board Pitch Pack: a small "press kit" for an existing board so
 * curators/galleries can copy a 3-paragraph summary, a single throughline,
 * and a per-work pitch line without leaking price / collection info.
 */
export type BoardPitchPackDraftKind = "summary" | "outreach" | "wall_text";

export type BoardPitchPackDraft = {
  kind: BoardPitchPackDraftKind;
  body: string;
};

export type BoardPitchPackResult = AiDegradation & {
  /** 1–2 sentence elevator summary of the board's editorial throughline. */
  summary: string;
  /** Single sentence the artist or gallery can re-use as a "what is this?" line. */
  throughline: string;
  /** Specific facts the model would have liked but the board didn't supply. */
  missingInfo: string[];
  /** Up to 3 free-form passages, e.g. summary / outreach / wall text. */
  drafts: BoardPitchPackDraft[];
  /**
   * Optional per-work talking points keyed by artwork id from the board.
   * Each entry is one sentence; never includes price or collection info.
   */
  perWork?: Array<{ artworkId: string; line: string }>;
};

/**
 * P1-B — Exhibition Review: a pre-publish review for an exhibition draft.
 * The model returns a checklist of editorial gaps + 2–3 alternative copy
 * blocks the curator can paste back into the exhibition editor.
 */
export type ExhibitionReviewSeverity = "info" | "suggest" | "warn";

export type ExhibitionReviewIssue = {
  id: string;
  severity: ExhibitionReviewSeverity;
  /** Short label e.g. "missing_dates", "wall_text_thin". */
  code: string;
  /** Human prose. */
  message: string;
  /** Suggested fix copy (optional). */
  suggestion?: string;
};

export type ExhibitionReviewResult = AiDegradation & {
  readiness: number; // 0-100
  issues: ExhibitionReviewIssue[];
  /** Optional revised copy blocks (title / description / wall_text variants). */
  drafts?: { kind: ExhibitionDraftKind; body: string }[];
};

/**
 * P1-C — Delegation Brief: a calm, prioritised brief for an operator
 * (delegate) acting on behalf of an artist. Only effective-profile
 * signals are sent to the model — never another principal's data.
 */
export type DelegationBriefPriority = {
  id: string;
  /** Free-form headline e.g. "Fill 3 incomplete drafts". */
  title: string;
  /** Why this matters in one sentence. */
  reason: string;
  /** Optional path the operator can deep-link to. */
  href?: string;
};

export type DelegationBriefResult = AiDegradation & {
  /** 2–4 prioritised actions the operator should take this session. */
  priorities: DelegationBriefPriority[];
  /** "Watch items" — risks the operator should keep an eye on. */
  watchItems: string[];
  /** Optional draft message the operator can paste back to the principal. */
  draftMessage?: string;
};

/**
 * P1 (2026-08-19) — Space calibrate (measurement-based scale detection).
 *
 * A candidate is a physical object visible in the uploaded room photo
 * whose real-world size a typical homeowner would know (window width,
 * door height, TV diagonal, etc.). The client renders one candidate at a
 * time as a dashed bounding-box overlay with a compact question card;
 * on Apply the client derives `pxPerCm` from the candidate's normalized
 * bbox extent + user-supplied length and writes `widthCm`/`heightCm`
 * back to the primary surface. No auto-write from the model; the user
 * always confirms.
 */
export type SpaceCalibrateCandidateKind =
  | "window"
  | "door"
  | "tv"
  | "sofa"
  | "table"
  | "bookshelf"
  | "counter"
  | "rug"
  | "other";

export type SpaceCalibrateDimension =
  | "width"
  | "height"
  | "diagonal"
  | "seat_back";

export type SpaceCalibrateCandidate = {
  /** Stable id so the UI can key the "Try another" cycle. */
  id: string;
  kind: SpaceCalibrateCandidateKind;
  label_ko: string;
  label_en: string;
  /** Normalized image-space bbox (0.0 – 1.0), origin at top-left. */
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** Which side of the bbox the user should measure. */
  dimension: SpaceCalibrateDimension;
  ask_ko: string;
  ask_en: string;
  /** Sensible cm range shown as a placeholder / hint. */
  typical_range_cm: { min: number; max: number };
};

export type SpaceCalibrateResult = AiDegradation & {
  candidates: SpaceCalibrateCandidate[];
};

/**
 * P1 (2026-08-19) — Automatic wall-region cleanup.
 *
 * The upload pipeline sends ONE room photo (downscaled to 768 px long
 * edge, JPEG q=0.85) to the model. The response describes the primary
 * target wall (the flat vertical surface where a person would hang
 * art — typically the wall facing the camera) as a normalized polygon
 * plus its dominant paint color. The client uses these to build a
 * feathered mask and flatten low-frequency lighting artefacts INSIDE
 * the wall only. Furniture, floor, windows, and any framed art stay
 * completely untouched.
 *
 * Contract
 * --------
 *   • `wallPolygon` is a 4–8 vertex polygon in normalized image
 *     coordinates (0..1, origin top-left), CLOCKWISE from top-left.
 *     Fewer than 3 vertices signals "no usable wall detected" and the
 *     client skips cleanup entirely.
 *   • `wallMedianRgb` is the dominant paint color of the wall
 *     (0..255 per channel), sampled to ignore shadow / highlight
 *     regions. Used as the target luminance / chroma reference during
 *     the client-side flatten.
 *   • `confidence < 0.4` also skips cleanup — a low-confidence
 *     detection is more likely to distort the photo than help it.
 *   • `lightDirection` is a coarse hint reserved for future passes
 *     (e.g. rim-shadow reconstruction) — the current pipeline doesn't
 *     use it, but shipping it now avoids a schema bump later.
 *
 * Degraded fallback: `{ wallPolygon: [], wallMedianRgb: [255,255,255],
 * confidence: 0, lightDirection: "unknown" }` — every consumer must
 * check `.confidence` and `.wallPolygon.length` before proceeding.
 */
export type SpaceWallDetectLightDirection =
  | "top"
  | "top_left"
  | "left"
  | "bottom_left"
  | "bottom"
  | "bottom_right"
  | "right"
  | "top_right"
  | "diffuse"
  | "unknown";

export type SpaceWallDetectResult = AiDegradation & {
  wallPolygon: Array<[number, number]>;
  wallMedianRgb: [number, number, number];
  wallColorName?: string;
  confidence: number;
  lightDirection?: SpaceWallDetectLightDirection;
};

/**
 * 2026-08-19 — Artwork upload pre-flight quality gate.
 *
 * A verdict about whether the just-uploaded artwork photo is usable
 * for Theo's catalog. The gate runs BEFORE the DSP enhancement
 * pipeline (perspective / AWB / Pro Look) fires, so we can warn the
 * artist about issues DSP can't rescue (motion blur, screen-photo
 * moiré, majority-out-of-frame framing) before they spend attention
 * on the enhance step.
 *
 * Design contract
 * ---------------
 *   - The model is intentionally **conservative** — false blocks are
 *     worse than false warns for artist trust. When uncertain the
 *     prompt is instructed to prefer `warn` over `block`, and `warn`
 *     over `ok`.
 *   - `usable === false` iff `severity === "block"`. Callers should
 *     treat `warn` as "banner shown, upload still allowed".
 *   - On any AI infrastructure failure (no OpenAI key, timeout, rate
 *     limit, upstream auth, parse error) the browser helper falls back
 *     to `{ severity: "ok", usable: true, degraded: true }`. This is a
 *     deliberate "fail open" — the DSP pipeline still enforces its own
 *     quality heuristics (`analyzeImageFile`) so we never hard-block a
 *     legitimate upload because a vision route was down.
 */
export type ArtworkQualityGateIssue =
  | "blur"
  | "motion_blur"
  | "glare"
  | "highlight_clip"
  | "shadow_clip"
  | "low_resolution"
  | "moire"
  | "reproduction"
  | "occlusion"
  | "poor_framing";

export type ArtworkQualityGateSeverity = "ok" | "warn" | "block";

export type ArtworkQualityGateResult = AiDegradation & {
  usable: boolean;
  severity: ArtworkQualityGateSeverity;
  issues: ArtworkQualityGateIssue[];
  reshootAdviceKo: string;
  reshootAdviceEn: string;
  scores: {
    /** 0-1, higher = sharper. */
    sharpness: number;
    /** 0-1, higher = more severe glare. */
    glare: number;
    /** 0-1, 0.5 = ideally exposed. */
    exposure: number;
    /** 0-1, higher = better framing. */
    framing: number;
  };
};

/**
 * Display Simulation Phase 2 — Track 1 (2026-08-20)
 *
 * Painting-region bbox inside an uploaded artwork photo. The upload
 * pipeline (or the SpaceEditor "여백 자동 제거" CTA) sends a single
 * image to the vision route. The response describes the largest
 * physical painting / photograph subject and lets the client crop it
 * out into a sibling `artwork_images` row (`view_type='cutout'`)
 * without touching the original upload.
 *
 * Contract:
 *   • `bbox` is a normalized rectangle in [0, 1] × [0, 1], origin at
 *     the image's top-left. Client validation clamps out-of-range
 *     values before the crop runs.
 *   • `confidence` is the model's self-reported certainty that the
 *     bbox brackets the actual artwork subject. Clients should skip
 *     the crop below ~0.7 to avoid mangling in-situ shots the model
 *     misread.
 *   • `alreadyTight === true` signals the source image already
 *     appears to be a tight crop of the subject (bbox covers > 95%
 *     of the image). Clients skip the crop in that case — the
 *     original serves as its own "cutout".
 *   • `hasVisibleFrame` reports whether a picture frame (matte, wood
 *     border, glass reflection) is visible around the subject. Used
 *     by future passes and by the "고급 배경 분리" upsell copy.
 *
 * Fallback shape: `{ bbox: {x:0,y:0,width:1,height:1}, confidence:
 * 0, alreadyTight: true, hasVisibleFrame: false }` — every consumer
 * short-circuits on `alreadyTight` or `confidence < 0.7`, so a
 * degraded / no-key response is guaranteed to preserve the primary
 * image as-is.
 */
export type ArtworkPaintingBboxResult = AiDegradation & {
  bbox: { x: number; y: number; width: number; height: number };
  confidence: number;
  alreadyTight: boolean;
  hasVisibleFrame: boolean;
};
