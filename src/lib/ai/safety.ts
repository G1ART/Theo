import type { AiFeatureKey } from "./types";

/**
 * Trust boundary for the AI-Native Studio Layer.
 *
 * The model is NEVER allowed to:
 *  - approve / reject claim requests
 *  - confirm provenance / ownership
 *  - merge identities
 *  - send outbound messages on behalf of the user
 *
 * These are human-in-the-loop decisions. Every AI surface MUST be a
 * preview that the user explicitly accepts, edits, or discards.
 */
export const FORBIDDEN_ACTIONS = Object.freeze({
  no_claim_approval: true,
  no_provenance_confirmation: true,
  no_ownership_assertion: true,
  no_identity_merge: true,
  no_auto_send: true,
} as const);

const ALLOWED_FEATURES: Readonly<Record<AiFeatureKey, true>> = Object.freeze({
  profile_copilot: true,
  portfolio_copilot: true,
  studio_digest: true,
  bio_draft: true,
  exhibition_draft: true,
  inquiry_reply_draft: true,
  intro_message_draft: true,
  matchmaker_rationales: true,
  board_pitch_pack: true,
  exhibition_review: true,
  delegation_brief: true,
  cv_import: true,
});

export function assertSafePrompt(feature: AiFeatureKey): void {
  if (!ALLOWED_FEATURES[feature]) {
    throw new Error(`[ai/safety] unknown feature: ${feature}`);
  }
}

export const SAFETY_FOOTER = [
  "You are a drafting assistant inside an artist-centric platform called Theo.",
  "You never approve claim requests, never confirm provenance, never assert ownership,",
  "never merge identities, and never send messages — you only produce previewable drafts",
  "that the user will edit or discard before acting. Write drafts in the same language as",
  "the user inputs (default: the user's stated locale; otherwise mirror the inputs).",
  "Keep drafts concise, specific, and grounded in the supplied context. Do NOT invent",
  "facts that are not in the context. Do NOT claim to be an AI. Do NOT add disclaimers.",
].join(" ");
