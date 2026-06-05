// Sprint 5 — Gated copy helper.
//
// All visibility-gate copy lives here. UI components import these strings
// directly so we can tone-test the entire surface in one place. NEVER use
// paywall vocabulary ("locked", "upgrade to see", "pay to unlock",
// "subscribe to view price"); see FORBIDDEN_GATE_PHRASES + the static
// test in tests/visibility-copy.test.ts.

import type { RelationshipAudience } from "./types";

// Phrases the copy helper must never produce. Update both this list AND
// tests/visibility-copy.test.ts together if the product taxonomy changes.
export const FORBIDDEN_GATE_PHRASES: readonly string[] = [
  "pay to unlock",
  "upgrade to see",
  "locked",
  "subscribe to view price",
];

export type GateCopyLocale = "en" | "ko";

export type GateCopyInput = {
  fieldKey: string;
  requiredAudience: RelationshipAudience;
  ownerLabel?: string | null;
  locale?: GateCopyLocale;
};

const FIELD_NOUN_EN: Record<string, string> = {
  price: "price",
  availability: "availability",
  price_availability: "price and availability",
  description: "detailed studio notes",
  studio_note: "private studio notes",
  exhibition_preview: "upcoming exhibition previews",
  room: "this private room",
  "*": "this material",
};

const FIELD_NOUN_KO: Record<string, string> = {
  price: "가격",
  // QA 2026-06-05 — was the raw English "availability"; localized so the
  // Korean copy reads naturally and the object particle resolves cleanly.
  availability: "소장 가능 여부",
  price_availability: "가격과 소장 가능 여부",
  description: "더 자세한 작품 노트",
  studio_note: "private 스튜디오 노트",
  exhibition_preview: "전시 전 미리보기",
  room: "이 프라이빗 룸",
  "*": "이 정보",
};

// QA 2026-06-05 — Korean object particle (을/를) chosen from the noun's
// final syllable instead of the old hard-coded "을(를)" placeholder. A
// Hangul syllable carries a 받침 (jongseong) when (code - 0xAC00) % 28 !== 0.
// Non-Hangul endings fall back to the vowel-final "를", which reads
// naturally for the few loanword nouns we still surface.
function objectParticleKo(word: string): "을" | "를" {
  const trimmed = word.trim();
  if (!trimmed) return "를";
  const last = trimmed.charCodeAt(trimmed.length - 1);
  if (last >= 0xac00 && last <= 0xd7a3) {
    return (last - 0xac00) % 28 !== 0 ? "을" : "를";
  }
  return "를";
}

function resolveOwnerEn(ownerLabel?: string | null): string {
  return ownerLabel && ownerLabel.trim() ? ownerLabel.trim() : "This artist";
}
function resolveOwnerKo(ownerLabel?: string | null): string {
  return ownerLabel && ownerLabel.trim() ? `${ownerLabel.trim()}님은` : "이 작가는";
}

const HOSPITALITY_KEYWORDS = ["share", "shares", "공개"] as const;

function buildEn(
  audience: RelationshipAudience,
  fieldKey: string,
  ownerLabel?: string | null
): string {
  const owner = resolveOwnerEn(ownerLabel);
  const noun = FIELD_NOUN_EN[fieldKey] ?? FIELD_NOUN_EN["*"];
  switch (audience) {
    case "public":
      return `${owner} shares ${noun} openly.`;
    case "signed_in":
      return `${owner} shares ${noun} with signed-in visitors.`;
    case "followers":
      return `${owner} shares ${noun} with followers.`;
    case "following":
      return `${owner} shares ${noun} with people they follow.`;
    case "mutuals":
      return `${owner} shares ${noun} with mutual connections.`;
    case "approved":
      return `${owner} shares ${noun} with approved viewers.`;
    case "delegates":
      return `${owner} shares ${noun} with their delegates.`;
    case "owner_only":
      return `${owner} keeps ${noun} private for now.`;
  }
}

function buildKo(
  audience: RelationshipAudience,
  fieldKey: string,
  ownerLabel?: string | null
): string {
  const owner = resolveOwnerKo(ownerLabel);
  const noun = FIELD_NOUN_KO[fieldKey] ?? FIELD_NOUN_KO["*"];
  const obj = `${noun}${objectParticleKo(noun)}`;
  switch (audience) {
    case "public":
      return `${owner} ${obj} 누구에게나 공개합니다.`;
    case "signed_in":
      return `${owner} 로그인한 분들에게 ${obj} 공개합니다.`;
    case "followers":
      return `${owner} 팔로워에게 ${obj} 공개합니다.`;
    case "following":
      return `${owner} 본인이 팔로우하는 분들에게 ${obj} 공개합니다.`;
    case "mutuals":
      return `${owner} 맞팔로우 또는 승인된 연결에게 ${obj} 공개합니다.`;
    case "approved":
      return `${owner} 승인된 관람자에게 ${obj} 공개합니다.`;
    case "delegates":
      return `${owner} 활성 위임자에게 ${obj} 공개합니다.`;
    case "owner_only":
      return `${owner} ${obj} 당분간 비공개로 두었습니다.`;
  }
}

export function getVisibilityGateCopy(input: GateCopyInput): string {
  const locale = input.locale ?? "en";
  const text =
    locale === "ko"
      ? buildKo(input.requiredAudience, input.fieldKey, input.ownerLabel)
      : buildEn(input.requiredAudience, input.fieldKey, input.ownerLabel);
  return text;
}

// Exposed for tests.
export function copyContainsForbidden(text: string): string | null {
  const lower = text.toLowerCase();
  for (const phrase of FORBIDDEN_GATE_PHRASES) {
    if (lower.includes(phrase)) return phrase;
  }
  return null;
}

// Exposed for tests — returns true if copy includes any
// hospitality-flavored keyword (so tests can assert tone, not just absence
// of bad words).
export function copyHasHospitalityTone(text: string): boolean {
  const lower = text.toLowerCase();
  return HOSPITALITY_KEYWORDS.some((kw) => lower.includes(kw));
}
