"use client";

import { supabase } from "@/lib/supabase/client";
import type {
  AiDegradation,
  AiFeatureKey,
  ArtworkQualityGateResult,
  BioDraftResult,
  BoardPitchPackResult,
  CvImportResult,
  DelegationBriefResult,
  ExhibitionDraftResult,
  ExhibitionReviewResult,
  InquiryReplyDraftResult,
  IntroMessageDraftResult,
  MatchmakerRationalesResult,
  PortfolioSuggestionsResult,
  ProfileSuggestionsResult,
  SpaceCalibrateResult,
  StudioDigestResult,
  TranslateDraftFieldKind,
  TranslateDraftResult,
} from "./types";

const FEATURE_TO_PATH: Record<AiFeatureKey, string> = {
  profile_copilot: "/api/ai/profile-copilot",
  portfolio_copilot: "/api/ai/portfolio-copilot",
  studio_digest: "/api/ai/studio-digest",
  bio_draft: "/api/ai/bio-draft",
  exhibition_draft: "/api/ai/exhibition-draft",
  inquiry_reply_draft: "/api/ai/inquiry-reply-draft",
  intro_message_draft: "/api/ai/intro-message-draft",
  matchmaker_rationales: "/api/ai/matchmaker-rationales",
  board_pitch_pack: "/api/ai/board-pitch-pack",
  exhibition_review: "/api/ai/exhibition-review",
  delegation_brief: "/api/ai/delegation-brief",
  cv_import: "/api/ai/cv-import",
  translate_draft: "/api/ai/translate-draft",
  "space.calibrate": "/api/ai/space-calibrate",
  artwork_quality_gate: "/api/ai/artwork-quality-gate",
};

export type CallAiOptions = {
  signal?: AbortSignal;
};

function degradedFallback<T extends AiDegradation>(
  reason: AiDegradation["reason"],
  base: Omit<T, keyof AiDegradation>,
): T {
  return { ...(base as object), degraded: true, reason } as T;
}

/**
 * When the server returns a JSON error contract (`degraded: true` + `reason`),
 * merge it with the feature fallback shape so callers still get typed arrays.
 */
async function mergeDegradedResponseBody<T extends AiDegradation>(
  resp: Response,
  fallback: Omit<T, keyof AiDegradation>,
): Promise<T | null> {
  const ct = resp.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return null;
  try {
    const body = (await resp.json()) as Record<string, unknown>;
    if (body && body.degraded === true && typeof body.reason === "string") {
      return { ...(fallback as object), ...body } as T;
    }
  } catch {
    return null;
  }
  return null;
}

async function getAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Low-level wrapper that flips `ai_events.accepted = true` via
 * `/api/ai/accept`. Prefer `markAiAccepted` from `src/lib/ai/accept.ts`
 * in new code — it co-locates the analytics ("ai_accepted" beta event)
 * with the DB flip so the two signals never drift. This helper stays
 * exported for existing integrations and to keep `markAiAccepted`'s
 * implementation simple. Fails silently so telemetry never blocks UX.
 */
export async function acceptAiEvent(aiEventId: string | null | undefined): Promise<void> {
  if (!aiEventId) return;
  const token = await getAccessToken();
  if (!token) return;
  try {
    await fetch("/api/ai/accept", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ aiEventId }),
      cache: "no-store",
      keepalive: true,
    });
  } catch {
    // telemetry must never block UX
  }
}

export async function callAi<T extends AiDegradation>(
  feature: AiFeatureKey,
  body: Record<string, unknown>,
  fallback: Omit<T, keyof AiDegradation>,
  opts?: CallAiOptions,
): Promise<T> {
  const path = FEATURE_TO_PATH[feature];
  const token = await getAccessToken();
  if (!token) return degradedFallback<T>("unauthorized", fallback);

  try {
    const resp = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: opts?.signal,
      cache: "no-store",
    });
    if (resp.status === 503) {
      try {
        const body = (await resp.json()) as T;
        return body;
      } catch {
        return degradedFallback<T>("no_key", fallback);
      }
    }
    if (!resp.ok) {
      const merged = await mergeDegradedResponseBody<T>(resp, fallback);
      if (merged) return merged;
      if (resp.status === 400) return degradedFallback<T>("invalid_input", fallback);
      if (resp.status === 401) return degradedFallback<T>("unauthorized", fallback);
      if (resp.status === 429) return degradedFallback<T>("cap", fallback);
      return degradedFallback<T>("error", fallback);
    }
    const json = (await resp.json()) as T;
    return json;
  } catch (err) {
    const name = (err as { name?: string } | null)?.name ?? "";
    if (name === "AbortError") return degradedFallback<T>("timeout", fallback);
    return degradedFallback<T>("error", fallback);
  }
}

// Typed shortcuts consumers can import.
export const aiApi = {
  profileCopilot: (body: Record<string, unknown>, opts?: CallAiOptions) =>
    callAi<ProfileSuggestionsResult>(
      "profile_copilot",
      body,
      { completeness: 0, missing: [], suggestions: [] },
      opts,
    ),
  portfolioCopilot: (body: Record<string, unknown>, opts?: CallAiOptions) =>
    callAi<PortfolioSuggestionsResult>(
      "portfolio_copilot",
      body,
      { suggestions: [] },
      opts,
    ),
  studioDigest: (body: Record<string, unknown>, opts?: CallAiOptions) =>
    callAi<StudioDigestResult>(
      "studio_digest",
      body,
      { headline: "", changes: [], nextActions: [] },
      opts,
    ),
  bioDraft: (body: Record<string, unknown>, opts?: CallAiOptions) =>
    callAi<BioDraftResult>(
      "bio_draft",
      body,
      { tone: (body.tone as BioDraftResult["tone"]) || "concise", drafts: [] },
      opts,
    ),
  exhibitionDraft: (body: Record<string, unknown>, opts?: CallAiOptions) =>
    callAi<ExhibitionDraftResult>(
      "exhibition_draft",
      body,
      { kind: (body.kind as ExhibitionDraftResult["kind"]) || "description", drafts: [] },
      opts,
    ),
  inquiryReplyDraft: (body: Record<string, unknown>, opts?: CallAiOptions) =>
    callAi<InquiryReplyDraftResult>(
      "inquiry_reply_draft",
      body,
      {
        tone: (body.tone as InquiryReplyDraftResult["tone"]) || "warm",
        kind: (body.kind as InquiryReplyDraftResult["kind"]) || "reply",
        drafts: [] as InquiryReplyDraftResult["drafts"],
      },
      opts,
    ),
  introMessageDraft: (body: Record<string, unknown>, opts?: CallAiOptions) =>
    callAi<IntroMessageDraftResult>(
      "intro_message_draft",
      body,
      { drafts: [] },
      opts,
    ),
  matchmakerRationales: (body: Record<string, unknown>, opts?: CallAiOptions) =>
    callAi<MatchmakerRationalesResult>(
      "matchmaker_rationales",
      body,
      { rationales: [] },
      opts,
    ),
  boardPitchPack: (body: Record<string, unknown>, opts?: CallAiOptions) =>
    callAi<BoardPitchPackResult>(
      "board_pitch_pack",
      body,
      { summary: "", throughline: "", missingInfo: [], drafts: [] },
      opts,
    ),
  exhibitionReview: (body: Record<string, unknown>, opts?: CallAiOptions) =>
    callAi<ExhibitionReviewResult>(
      "exhibition_review",
      body,
      { readiness: 0, issues: [] },
      opts,
    ),
  delegationBrief: (body: Record<string, unknown>, opts?: CallAiOptions) =>
    callAi<DelegationBriefResult>(
      "delegation_brief",
      body,
      { priorities: [], watchItems: [] },
      opts,
    ),
  cvImport: (body: Record<string, unknown>, opts?: CallAiOptions) =>
    callAi<CvImportResult>(
      "cv_import",
      body,
      { entries: [], confidence: 0, note: null },
      opts,
    ),
  /**
   * Track C (2026-07-28) — 이중언어 인풋 "AI 초안" 버튼. Request body
   * shape: `{ translate: { fieldKind, sourceLocale, targetLocale,
   * sourceText, styleAnchors? } }`. Degraded shape returns `draft: ""`
   * so the caller can distinguish "empty" from "error" via `degraded`.
   */
  /**
   * P1 (2026-08-19) — Space calibrate (measurement-based scale detection).
   * Body: `{ spaceId, imageBase64, mime, imagePxWidth, imagePxHeight }`.
   * Degraded shape returns `candidates: []` so the caller can just check
   * `.candidates.length` and silently fall through to the manual entry
   * point when the model / key / entitlement fails.
   */
  spaceCalibrate: (body: Record<string, unknown>, opts?: CallAiOptions) =>
    callAi<SpaceCalibrateResult>(
      "space.calibrate",
      body,
      { candidates: [] },
      opts,
    ),
  /**
   * 2026-08-19 — Pre-flight artwork quality gate. Body shape:
   * `{ imageBase64, mime, imagePxWidth, imagePxHeight, contextHint? }`.
   *
   * The fallback intentionally returns `severity: "ok"` + `usable:
   * true` so any degraded response (`degraded === true`) never
   * hard-blocks the upload — the DSP pipeline's own quality checks
   * still run on the full-res image afterwards. Callers should treat
   * `degraded === true` as "gate not conclusive, proceed normally".
   */
  artworkQualityGate: (body: Record<string, unknown>, opts?: CallAiOptions) =>
    callAi<ArtworkQualityGateResult>(
      "artwork_quality_gate",
      body,
      {
        usable: true,
        severity: "ok",
        issues: [],
        reshootAdviceKo: "",
        reshootAdviceEn: "",
        scores: { sharpness: 0.5, glare: 0, exposure: 0.5, framing: 0.5 },
      },
      opts,
    ),
  translateDraft: (body: Record<string, unknown>, opts?: CallAiOptions) => {
    const translate = (body.translate ?? {}) as {
      fieldKind?: TranslateDraftFieldKind;
      sourceLocale?: TranslateDraftResult["sourceLocale"];
      targetLocale?: TranslateDraftResult["targetLocale"];
    };
    const fieldKind: TranslateDraftFieldKind = translate.fieldKind ?? "title";
    const sourceLocale = translate.sourceLocale ?? "ko";
    const targetLocale = translate.targetLocale ?? "en";
    return callAi<TranslateDraftResult>(
      "translate_draft",
      body,
      { fieldKind, sourceLocale, targetLocale, draft: "" },
      opts,
    );
  },
};
