// Context builders turn raw DB rows into the minimal, sanitized summaries we
// send to the model. Keep these pure (no DB calls) so they stay easy to test
// and so routes can audit exactly what text is shipped across the wire.

import type { AiLocale, PortfolioMetadataGaps } from "./types";

export type ProfileContextInput = {
  display_name?: string | null;
  username?: string | null;
  role?: string | null;
  bio?: string | null;
  themes?: string[] | null;
  mediums?: string[] | null;
  /**
   * QA P0.5-B (row 24): Statement draft must reflect the artist's chosen
   * styles too — not just theme/medium. The artist taxonomy section in
   * /settings exposes a styles chip group, and we now forward those slugs
   * into the prompt so the model can ground its drafts in formal/visual
   * approach as well as subject and material.
   */
  styles?: string[] | null;
  city?: string | null;
  locale?: string | null;
  counts?: {
    artworks?: number;
    exhibitions?: number;
    shortlists?: number;
    follows?: number;
    views7d?: number;
    views30d?: number;
  };
  /**
   * P1-0 Statement extension. When `mode === "statement"`, the route picks
   * the statement system prompt and the model returns 2-3 statementDrafts
   * grounded in the supplied themes/mediums/styles/selectedArtworks.
   */
  mode?: "general" | "statement";
  /** Existing statement (if any) so the model can re-anchor instead of inventing. */
  currentStatement?: string | null;
  /** Optional themes detail (richer than the chip slugs) the user has elaborated on. */
  themesDetail?: string | null;
  /**
   * Tokens the artist has explicitly removed from their profile during the
   * current /settings session — themes / mediums / styles chips that they
   * pulled off the chip group. The model must treat this as a hard
   * negative list so the previous statement's vocabulary doesn't keep
   * re-anchoring deleted concepts back into new drafts.
   */
  excludedKeywords?: string[] | null;
  /** Optional artworks the artist wants the statement to gesture at by title. */
  selectedArtworks?: { title?: string | null; year?: string | number | null; medium?: string | null }[];
};

export function buildProfileCopilotContext(input: ProfileContextInput): string {
  const base: string[] = [
    `display_name: ${input.display_name ?? ""}`,
    `username: ${input.username ?? ""}`,
    `role: ${input.role ?? ""}`,
    `bio: ${(input.bio ?? "").slice(0, 400)}`,
    `themes: ${(input.themes ?? []).slice(0, 6).join(", ")}`,
    `mediums: ${(input.mediums ?? []).slice(0, 6).join(", ")}`,
    // QA P0.5-B (row 24): forward selected styles so the model grounds the
    // statement in the artist's formal/visual approach (e.g. minimalism,
    // figurative, …), not just subjects and materials.
    `styles: ${(input.styles ?? []).slice(0, 6).join(", ")}`,
    `city: ${input.city ?? ""}`,
    `locale: ${input.locale ?? "ko"}`,
    `counts: ${JSON.stringify(input.counts ?? {})}`,
  ];
  if (input.mode === "statement") {
    base.push(`mode: statement`);
    base.push(`current_statement: ${(input.currentStatement ?? "").slice(0, 1200)}`);
    base.push(`themes_detail: ${(input.themesDetail ?? "").slice(0, 600)}`);
    base.push(
      `excluded_keywords: ${JSON.stringify(
        (input.excludedKeywords ?? []).slice(0, 12),
      )}`,
    );
    const works = (input.selectedArtworks ?? []).slice(0, 6).map((a) => ({
      title: a.title ?? "",
      year: a.year ?? "",
      medium: a.medium ?? "",
    }));
    base.push(`selected_artworks: ${JSON.stringify(works)}`);
  }
  return base.join("\n");
}

export type ArtworkLite = {
  id: string;
  title?: string | null;
  year?: string | number | null;
  medium?: string | null;
  dimensions?: string | null;
  keywords?: string[] | null;
};

export type ExhibitionLite = {
  id: string;
  title?: string | null;
  year?: string | number | null;
  venue?: string | null;
};

export type PortfolioContextInput = {
  username?: string | null;
  artworks: ArtworkLite[];
  exhibitions: ExhibitionLite[];
  /** Optional counts computed client-side from live artworks. */
  metadataGaps?: PortfolioMetadataGaps | null;
  /** UI locale so the model writes copy in one language (see portfolio copilot prompt). */
  locale?: AiLocale | null;
};

const PORTFOLIO_CTX_MAX_CHARS = 18_000;

/** Keeps portfolio copilot prompts under typical model context limits. */
function clipPromptText(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export function buildPortfolioCopilotContext(input: PortfolioContextInput): string {
  const summarized = input.artworks.slice(0, 20).map((a) => ({
    id: clipPromptText(String(a.id ?? ""), 72),
    title: clipPromptText(String(a.title ?? ""), 160),
    year: clipPromptText(String(a.year ?? ""), 24),
    medium: clipPromptText(String(a.medium ?? ""), 120),
    dimensions: clipPromptText(String(a.dimensions ?? ""), 120),
    keywords: (a.keywords ?? []).slice(0, 4).map((k) => clipPromptText(k, 48)),
  }));
  const ex = input.exhibitions.slice(0, 10).map((e) => ({
    id: clipPromptText(String(e.id ?? ""), 72),
    title: clipPromptText(String(e.title ?? ""), 160),
    year: clipPromptText(String(e.year ?? ""), 24),
    venue: clipPromptText(String(e.venue ?? ""), 120),
  }));
  const gaps =
    input.metadataGaps != null && typeof input.metadataGaps === "object"
      ? `\nmetadataGaps: ${JSON.stringify(input.metadataGaps)}`
      : "";
  const loc = input.locale ?? "en";
  const line = `locale: ${loc}\nusername: ${clipPromptText(String(input.username ?? ""), 64)}\nartworks: ${JSON.stringify(summarized)}\nexhibitions: ${JSON.stringify(ex)}${gaps}`;
  if (line.length <= PORTFOLIO_CTX_MAX_CHARS) return line;
  return `${line.slice(0, PORTFOLIO_CTX_MAX_CHARS - 20)}\n…[truncated]`;
}

export type StudioDigestInput = {
  views7d?: number;
  views30d?: number;
  followsDelta7d?: number;
  inquiries7d?: number;
  shortlistEvents7d?: number;
  /** Works in the studio list that are not yet public (e.g. draft visibility). */
  draftsNotPublicCount?: number;
  /** Works missing title, year, medium, size, or primary image (client count). */
  incompleteMetadataCount?: number;
  recentExhibitions?: Array<{ title: string; year?: string | number }>;
  /**
   * Wave 2: up to 3 of the artist's most recent uploads so the digest
   * can mention "your new work from this week" without inventing titles.
   */
  recentUploads?: Array<{ id?: string; title?: string | null; createdAt?: string | null }>;
  /**
   * Wave 2: artist's username so nextActions can deep-link to their
   * public profile (reorder / share) without the prompt guessing.
   */
  username?: string | null;
  locale?: string | null;
};

export function buildStudioDigestContext(input: StudioDigestInput): string {
  return [
    `locale: ${input.locale ?? "ko"}`,
    `username: ${input.username ?? ""}`,
    `views7d: ${input.views7d ?? 0}`,
    `views30d: ${input.views30d ?? 0}`,
    `followsDelta7d: ${input.followsDelta7d ?? 0}`,
    `inquiries7d: ${input.inquiries7d ?? 0}`,
    `shortlistEvents7d: ${input.shortlistEvents7d ?? 0}`,
    `drafts_not_public_count: ${input.draftsNotPublicCount ?? 0}`,
    `incomplete_metadata_count: ${input.incompleteMetadataCount ?? 0}`,
    `recentExhibitions: ${JSON.stringify((input.recentExhibitions ?? []).slice(0, 5))}`,
    `recentUploads: ${JSON.stringify(
      (input.recentUploads ?? []).slice(0, 3).map((u) => ({
        title: u.title ?? "",
        createdAt: u.createdAt ?? "",
      })),
    )}`,
  ].join("\n");
}

export type BioDraftInput = {
  tone: "concise" | "warm" | "curatorial";
  display_name?: string | null;
  role?: string | null;
  themes?: string[] | null;
  mediums?: string[] | null;
  city?: string | null;
  selectedArtworks?: ArtworkLite[];
  locale?: string | null;
};

export function buildBioDraftContext(input: BioDraftInput): string {
  const works = (input.selectedArtworks ?? []).slice(0, 5).map((a) => ({
    title: a.title ?? "",
    year: a.year ?? "",
    medium: a.medium ?? "",
  }));
  return [
    `tone: ${input.tone}`,
    `locale: ${input.locale ?? "ko"}`,
    `display_name: ${input.display_name ?? ""}`,
    `role: ${input.role ?? ""}`,
    `themes: ${(input.themes ?? []).slice(0, 6).join(", ")}`,
    `mediums: ${(input.mediums ?? []).slice(0, 6).join(", ")}`,
    `city: ${input.city ?? ""}`,
    `selected_artworks: ${JSON.stringify(works)}`,
  ].join("\n");
}

export type ExhibitionDraftInput = {
  kind: "title" | "description" | "wall_text" | "invite_blurb";
  title?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  venueLabel?: string | null;
  curatorLabel?: string | null;
  hostLabel?: string | null;
  locale?: string | null;
  works?: ArtworkLite[];
};

export function buildExhibitionProducerContext(input: ExhibitionDraftInput): string {
  const works = (input.works ?? []).slice(0, 20).map((a) => ({
    title: a.title ?? "",
    year: a.year ?? "",
    medium: a.medium ?? "",
  }));
  return [
    `kind: ${input.kind}`,
    `locale: ${input.locale ?? "ko"}`,
    `title: ${input.title ?? ""}`,
    `startDate: ${input.startDate ?? ""}`,
    `endDate: ${input.endDate ?? ""}`,
    `venue: ${input.venueLabel ?? ""}`,
    `curator: ${input.curatorLabel ?? ""}`,
    `host: ${input.hostLabel ?? ""}`,
    `works: ${JSON.stringify(works)}`,
  ].join("\n");
}

export type InquiryReplyInput = {
  tone: "concise" | "warm" | "curatorial";
  kind: "reply" | "followup";
  locale?: string | null;
  /** Wave 2: caller-selected length preference. "short" keeps drafts ~2 sentences; "long" ~4–6. */
  lengthPreference?: "short" | "long";
  artwork?: {
    title?: string | null;
    year?: string | number | null;
    medium?: string | null;
    artistName?: string | null;
    pricePolicy?: string | null;
  };
  exhibitionTitle?: string | null;
  thread?: Array<{ from: "inquirer" | "owner"; text: string }>;
};

export function buildInquiryReplyContext(input: InquiryReplyInput): string {
  const thread = (input.thread ?? []).slice(-3).map((m) => ({
    from: m.from,
    text: m.text.slice(0, 400),
  }));
  return [
    `tone: ${input.tone}`,
    `kind: ${input.kind}`,
    `lengthPreference: ${input.lengthPreference ?? "short"}`,
    `locale: ${input.locale ?? "ko"}`,
    `artwork: ${JSON.stringify(input.artwork ?? {})}`,
    `exhibition: ${input.exhibitionTitle ?? ""}`,
    `thread: ${JSON.stringify(thread)}`,
  ].join("\n");
}

export type IntroMessageInput = {
  locale?: string | null;
  me: {
    display_name?: string | null;
    role?: string | null;
    themes?: string[] | null;
    mediums?: string[] | null;
    city?: string | null;
    /**
     * Wave 2: optional list of the sender's own works the user wants
     * referenced in the intro note. Only title is used — ids are kept
     * client-side for deep-link rendering.
     */
    artworks?: Array<{ title: string }> | null;
  };
  recipient: {
    display_name?: string | null;
    role?: string | null;
    themes?: string[] | null;
    mediums?: string[] | null;
    city?: string | null;
    sharedSignals?: string[] | null;
  };
};

export function buildIntroMessageContext(input: IntroMessageInput): string {
  return [
    `locale: ${input.locale ?? "ko"}`,
    `me: ${JSON.stringify({
      display_name: input.me.display_name ?? "",
      role: input.me.role ?? "",
      themes: (input.me.themes ?? []).slice(0, 6),
      mediums: (input.me.mediums ?? []).slice(0, 6),
      city: input.me.city ?? "",
      artworks: (input.me.artworks ?? []).slice(0, 3).map((a) => a.title),
    })}`,
    `recipient: ${JSON.stringify({
      display_name: input.recipient.display_name ?? "",
      role: input.recipient.role ?? "",
      themes: (input.recipient.themes ?? []).slice(0, 6),
      mediums: (input.recipient.mediums ?? []).slice(0, 6),
      city: input.recipient.city ?? "",
      sharedSignals: (input.recipient.sharedSignals ?? []).slice(0, 6),
    })}`,
  ].join("\n");
}

export type MatchmakerRationaleCandidate = {
  profileId: string;
  display_name?: string | null;
  role?: string | null;
  themes?: string[] | null;
  mediums?: string[] | null;
  city?: string | null;
  sharedSignals?: string[] | null;
};

export type MatchmakerRationaleInput = {
  locale?: string | null;
  me: {
    themes?: string[] | null;
    mediums?: string[] | null;
    city?: string | null;
    /**
     * Wave 2: the viewer's own artworks — used so the rationales and
     * `suggestedArtworkIds` can pull from a concrete set instead of
     * hallucinating titles.
     */
    artworks?: Array<{ id: string; title?: string | null }> | null;
  };
  candidates: MatchmakerRationaleCandidate[];
};

export function buildMatchmakerRationaleContext(
  input: MatchmakerRationaleInput,
): string {
  const candidates = input.candidates.slice(0, 6).map((c) => ({
    profileId: c.profileId,
    display_name: c.display_name ?? "",
    role: c.role ?? "",
    themes: (c.themes ?? []).slice(0, 4),
    mediums: (c.mediums ?? []).slice(0, 4),
    city: c.city ?? "",
    sharedSignals: (c.sharedSignals ?? []).slice(0, 4),
  }));
  const myArtworks = (input.me.artworks ?? []).slice(0, 6).map((a) => ({
    id: a.id,
    title: a.title ?? "",
  }));
  return [
    `locale: ${input.locale ?? "ko"}`,
    `me: ${JSON.stringify({
      themes: (input.me.themes ?? []).slice(0, 6),
      mediums: (input.me.mediums ?? []).slice(0, 6),
      city: input.me.city ?? "",
      artworks: myArtworks,
    })}`,
    `candidates: ${JSON.stringify(candidates)}`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────
// P1-A — Board Pitch Pack
// ─────────────────────────────────────────────────────────────────────

export type BoardPitchPackArtwork = {
  id: string;
  title?: string | null;
  year?: string | number | null;
  medium?: string | null;
  themes?: string[] | null;
};

export type BoardPitchPackExhibition = {
  id: string;
  title?: string | null;
  year?: string | number | null;
  venue?: string | null;
};

export type BoardPitchPackInput = {
  locale?: string | null;
  boardTitle?: string | null;
  boardDescription?: string | null;
  /** Curator-supplied editorial note (optional). */
  editorialNote?: string | null;
  artworks?: BoardPitchPackArtwork[];
  exhibitions?: BoardPitchPackExhibition[];
};

export function buildBoardPitchPackContext(input: BoardPitchPackInput): string {
  const artworks = (input.artworks ?? []).slice(0, 12).map((a) => ({
    id: a.id,
    title: a.title ?? "",
    year: a.year ?? "",
    medium: a.medium ?? "",
    themes: (a.themes ?? []).slice(0, 4),
  }));
  const exhibitions = (input.exhibitions ?? []).slice(0, 6).map((e) => ({
    id: e.id,
    title: e.title ?? "",
    year: e.year ?? "",
    venue: e.venue ?? "",
  }));
  return [
    `locale: ${input.locale ?? "ko"}`,
    `board_title: ${(input.boardTitle ?? "").slice(0, 200)}`,
    `board_description: ${(input.boardDescription ?? "").slice(0, 600)}`,
    `editorial_note: ${(input.editorialNote ?? "").slice(0, 600)}`,
    `artworks: ${JSON.stringify(artworks)}`,
    `exhibitions: ${JSON.stringify(exhibitions)}`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────
// P1-B — Exhibition Review
// ─────────────────────────────────────────────────────────────────────

export type ExhibitionReviewInput = {
  locale?: string | null;
  title?: string | null;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  venueLabel?: string | null;
  curatorLabel?: string | null;
  hostLabel?: string | null;
  hasCover?: boolean;
  workCount?: number;
  works?: ArtworkLite[];
  /** Optional curatorial wall-text or artist note already in the draft. */
  wallText?: string | null;
};

export function buildExhibitionReviewContext(input: ExhibitionReviewInput): string {
  const works = (input.works ?? []).slice(0, 12).map((a) => ({
    id: a.id,
    title: a.title ?? "",
    year: a.year ?? "",
    medium: a.medium ?? "",
  }));
  return [
    `locale: ${input.locale ?? "ko"}`,
    `title: ${(input.title ?? "").slice(0, 200)}`,
    `description: ${(input.description ?? "").slice(0, 800)}`,
    `wall_text: ${(input.wallText ?? "").slice(0, 800)}`,
    `start_date: ${input.startDate ?? ""}`,
    `end_date: ${input.endDate ?? ""}`,
    `venue: ${input.venueLabel ?? ""}`,
    `curator: ${input.curatorLabel ?? ""}`,
    `host: ${input.hostLabel ?? ""}`,
    `has_cover: ${input.hasCover ? "true" : "false"}`,
    `work_count: ${input.workCount ?? works.length}`,
    `works: ${JSON.stringify(works)}`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────
// P1-C — Delegation Brief
// ─────────────────────────────────────────────────────────────────────

export type DelegationBriefInput = {
  locale?: string | null;
  /** Effective profile display name + username for natural references. */
  principalDisplayName?: string | null;
  principalUsername?: string | null;
  /** Calendar/operations counts. All optional, all default to 0. */
  incompleteDraftCount?: number;
  unansweredInquiryCount?: number;
  oldestUnansweredInquiryDays?: number;
  exhibitionGapsCount?: number;
  upcomingExhibitionsCount?: number;
  profileReadinessPercent?: number;
  /** Whether the principal's profile is currently public. */
  profileIsPublic?: boolean;
};

export function buildDelegationBriefContext(input: DelegationBriefInput): string {
  return [
    `locale: ${input.locale ?? "ko"}`,
    `principal_display_name: ${(input.principalDisplayName ?? "").slice(0, 120)}`,
    `principal_username: ${(input.principalUsername ?? "").slice(0, 64)}`,
    `incomplete_draft_count: ${input.incompleteDraftCount ?? 0}`,
    `unanswered_inquiry_count: ${input.unansweredInquiryCount ?? 0}`,
    `oldest_unanswered_inquiry_days: ${input.oldestUnansweredInquiryDays ?? 0}`,
    `exhibition_gaps_count: ${input.exhibitionGapsCount ?? 0}`,
    `upcoming_exhibitions_count: ${input.upcomingExhibitionsCount ?? 0}`,
    `profile_readiness_percent: ${input.profileReadinessPercent ?? 0}`,
    `profile_is_public: ${input.profileIsPublic ? "true" : "false"}`,
  ].join("\n");
}

/**
 * P6.2 — CV Import context. The route extracts plain text from the URL
 * or file upload server-side (see `src/lib/cv/extract.ts`) and passes
 * it here. We cap the text at ~24KB so the prompt stays well below
 * the model's context window — anything past the cap is truncated
 * with a marker so the model knows the source was longer.
 */
export type CvImportContextInput = {
  locale: AiLocale | string | null;
  /** Where the text came from — included in the prompt so the model
   *  can lean toward formats typical to that source. */
  sourceKind: "url" | "pdf" | "docx" | "text";
  sourceLabel?: string | null;
  text: string;
};

const CV_IMPORT_TEXT_CAP = 24_000;

export function buildCvImportContext(input: CvImportContextInput): string {
  const raw = (input.text ?? "").trim();
  const truncated = raw.length > CV_IMPORT_TEXT_CAP;
  const text = truncated ? `${raw.slice(0, CV_IMPORT_TEXT_CAP)}\n\n[...truncated]` : raw;
  return [
    `locale: ${input.locale ?? "ko"}`,
    `source_kind: ${input.sourceKind}`,
    `source_label: ${(input.sourceLabel ?? "").slice(0, 200)}`,
    `text_length: ${raw.length}`,
    `text_truncated: ${truncated ? "true" : "false"}`,
    "---",
    text,
  ].join("\n");
}

/**
 * P6.4 — Vision context. The user message text is short because the
 * heavy lifting is the attached images. We tell the model how many
 * pages we sent and which language the artist's locale is so it
 * mirrors the on-page language in its output.
 */
export type CvImportVisionContextInput = {
  locale: AiLocale | string | null;
  /** "image" for a photographed resume or "scanned_pdf" for client-rendered pages. */
  sourceKind: "image" | "scanned_pdf";
  sourceLabel?: string | null;
  /** Number of images attached. The route already enforces the 8-image cap. */
  imageCount: number;
};

export function buildCvImportVisionContext(input: CvImportVisionContextInput): string {
  return [
    `locale: ${input.locale ?? "ko"}`,
    `source_kind: ${input.sourceKind}`,
    `source_label: ${(input.sourceLabel ?? "").slice(0, 200)}`,
    `image_count: ${input.imageCount}`,
    `note: ${
      input.sourceKind === "scanned_pdf"
        ? "Each attached image is one page of a scanned CV PDF, in reading order."
        : "Each attached image is a CV page; read all visible text and ignore decorative elements."
    }`,
    "---",
    "Read the attached image(s) and extract the structured CV per the schema. Do not describe the image; emit JSON only.",
  ].join("\n");
}

/**
 * Track C — Translate draft context. Kept intentionally small so a
 * bilingual "AI 초안" click is cheap. Style anchors are the same
 * author's own prose in the target (or source) locale — used only
 * for prose kinds; the short kinds ignore them to keep titles/media
 * labels tight.
 */
export type TranslateDraftContextInput = {
  fieldKind:
    | "title"
    | "preface"
    | "bio"
    | "statement"
    | "medium"
    | "story"
    | "host_name";
  sourceLocale: AiLocale;
  targetLocale: AiLocale;
  sourceText: string;
  styleAnchors?: string[] | null;
};

const PROSE_TRANSLATE_KINDS = new Set([
  "preface",
  "bio",
  "statement",
  "story",
]);

export function buildTranslateDraftContext(
  input: TranslateDraftContextInput,
): string {
  const source = (input.sourceText ?? "").trim();
  const isProse = PROSE_TRANSLATE_KINDS.has(input.fieldKind);
  const anchors = isProse
    ? (input.styleAnchors ?? [])
        .filter((s) => typeof s === "string" && s.trim().length > 0)
        .slice(0, 3)
        .map((s) => s.trim().slice(0, 800))
    : [];
  const lines = [
    `fieldKind: ${input.fieldKind}`,
    `sourceLocale: ${input.sourceLocale}`,
    `targetLocale: ${input.targetLocale}`,
    `source_text: ${source.slice(0, 4000)}`,
  ];
  if (anchors.length > 0) {
    lines.push(`style_anchors: ${JSON.stringify(anchors)}`);
  }
  return lines.join("\n");
}
