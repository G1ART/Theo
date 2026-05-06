// Sprint 5 — Audience labels and ordering.
//
// Locale-aware label helpers. UI never hard-codes audience copy; both
// /my/visibility and GatedField go through these functions so we can
// retune wording without touching components.

import type { RelationshipAudience } from "./types";

export type AudienceLocale = "en" | "ko";

export const AUDIENCE_LABELS_EN: Record<RelationshipAudience, string> = {
  public: "Everyone",
  signed_in: "Signed-in users",
  followers: "Followers",
  following: "People I follow",
  mutuals: "Mutual connections",
  approved: "Approved viewers",
  delegates: "Delegates",
  owner_only: "Only me",
};

export const AUDIENCE_LABELS_KO: Record<RelationshipAudience, string> = {
  public: "전체 공개",
  signed_in: "로그인 유저",
  followers: "나를 팔로우하는 사람",
  following: "내가 팔로우하는 사람",
  mutuals: "맞팔로우",
  approved: "승인한 사람",
  delegates: "위임자",
  owner_only: "나만 보기",
};

export const AUDIENCE_DESCRIPTIONS_EN: Record<RelationshipAudience, string> = {
  public: "Visible to anyone, including signed-out visitors.",
  signed_in: "Visible to anyone with an account.",
  followers: "Visible to people who follow you.",
  following: "Visible to people you follow.",
  mutuals: "Visible to people who follow you and whom you follow back.",
  approved: "Visible to viewers you've approved or added to a list.",
  delegates: "Visible to your active delegates.",
  owner_only: "Visible only to you.",
};

export const AUDIENCE_DESCRIPTIONS_KO: Record<RelationshipAudience, string> = {
  public: "비로그인 방문자를 포함해 누구에게나 보입니다.",
  signed_in: "로그인한 사람에게 보입니다.",
  followers: "나를 팔로우하는 사람에게 보입니다.",
  following: "내가 팔로우하는 사람에게 보입니다.",
  mutuals: "서로 팔로우한 사람에게 보입니다.",
  approved: "내가 승인했거나 리스트에 포함한 사람에게 보입니다.",
  delegates: "활성 위임자에게 보입니다.",
  owner_only: "오직 나에게만 보입니다.",
};

export function audienceLabel(
  audience: RelationshipAudience,
  locale: AudienceLocale = "en"
): string {
  return locale === "ko"
    ? AUDIENCE_LABELS_KO[audience]
    : AUDIENCE_LABELS_EN[audience];
}

export function audienceDescription(
  audience: RelationshipAudience,
  locale: AudienceLocale = "en"
): string {
  return locale === "ko"
    ? AUDIENCE_DESCRIPTIONS_KO[audience]
    : AUDIENCE_DESCRIPTIONS_EN[audience];
}
