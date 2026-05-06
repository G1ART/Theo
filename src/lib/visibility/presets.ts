// Sprint 5 — Visibility presets.
//
// Maps every supported preset to a set of *default* audiences for first-class
// fields. This map mirrors the SQL fallback logic inside
// resolve_visibility_for_viewer; both sources agree because the server is
// authoritative but the UI needs the same values to render the preset cards.
//
// IMPORTANT: presets only set defaults. Existing explicit overrides on
// visibility_policies are NEVER touched by set_visibility_preset.

import type { RelationshipAudience, VisibilityPresetKey } from "./types";

export const PRESET_LABELS_EN: Record<VisibilityPresetKey, string> = {
  open_studio: "Open Studio",
  follower_aware: "Follower-Aware",
  mutual_first: "Mutual-First",
  private_studio: "Private Studio",
};

export const PRESET_LABELS_KO: Record<VisibilityPresetKey, string> = {
  open_studio: "오픈 스튜디오",
  follower_aware: "팔로워 우선",
  mutual_first: "맞팔로우 중심",
  private_studio: "프라이빗 스튜디오",
};

export const PRESET_DESCRIPTIONS_EN: Record<VisibilityPresetKey, string> = {
  open_studio:
    "Profile and works are public. Price and availability are reserved for mutual connections.",
  follower_aware:
    "Followers see fuller artwork details. Price and availability stay closer to mutuals.",
  mutual_first:
    "Casual visitors see a teaser. Mutual connections see the studio fully.",
  private_studio:
    "Public sees a minimum profile. Approved viewers see works, details, and price.",
};

export const PRESET_DESCRIPTIONS_KO: Record<VisibilityPresetKey, string> = {
  open_studio:
    "프로필과 작품은 공개. 가격과 availability 는 맞팔로우에게만 공개됩니다.",
  follower_aware:
    "팔로워에게 더 자세한 작품 정보를 공개. 가격과 availability 는 맞팔로우에 가깝게 유지됩니다.",
  mutual_first:
    "비로그인 방문자는 티저만, 맞팔로우는 스튜디오 전부를 봅니다.",
  private_studio:
    "공개 영역은 최소한의 프로필만. 승인한 사람에게 작품·세부사항·가격을 공개합니다.",
};

// Default audience map per preset & field. Keep in sync with the
// PL/pgSQL resolve_visibility_for_viewer fallback ladder.
export type FieldDefaultMap = Record<string, RelationshipAudience>;

export const PRESET_FIELD_DEFAULTS: Record<VisibilityPresetKey, FieldDefaultMap> = {
  open_studio: {
    "*": "public",
    price: "mutuals",
    availability: "mutuals",
    description: "public",
    studio_note: "owner_only",
  },
  follower_aware: {
    "*": "public",
    price: "mutuals",
    availability: "mutuals",
    description: "followers",
    studio_note: "followers",
  },
  mutual_first: {
    "*": "public",
    price: "mutuals",
    availability: "mutuals",
    description: "mutuals",
    studio_note: "mutuals",
  },
  private_studio: {
    "*": "signed_in",
    price: "approved",
    availability: "approved",
    description: "approved",
    studio_note: "approved",
  },
};

export function defaultAudienceForField(
  preset: VisibilityPresetKey,
  fieldKey: string
): RelationshipAudience {
  const map = PRESET_FIELD_DEFAULTS[preset];
  return map[fieldKey] ?? map["*"] ?? "public";
}
