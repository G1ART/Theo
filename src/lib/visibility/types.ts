// Sprint 5 — Relationship Access Layer
//
// Type-only module for visibility/access primitives. Keep this small and
// stable — it's imported by both server-bound RPC wrappers and client UI.

export type RelationshipAudience =
  | "public"
  | "signed_in"
  | "followers"
  | "following"
  | "mutuals"
  | "approved"
  | "delegates"
  | "owner_only";

export type VisibilitySubjectType =
  | "profile_section"
  | "artwork"
  | "artwork_field"
  | "exhibition"
  | "room";

export type VisibilityPresetKey =
  | "open_studio"
  | "follower_aware"
  | "mutual_first"
  | "private_studio";

// Standardised request_mode taxonomy (Sprint 5 mandatory amendment).
//   null            → derive from audience (audience-based default).
//   'inquiry'       → route the gated CTA into createPriceInquiry.
//   'access_request'→ route into createAccessRequest. NEVER use 'request'.
//   'none'          → owner explicitly hides any CTA.
export type VisibilityRequestMode = null | "inquiry" | "access_request" | "none";

// Coarse relationship signals returned by get_viewer_relationship_context.
// IMPORTANT: this object intentionally does NOT carry approved_audience_ids
// or any list/VIP membership — that information must never reach viewers.
// Subject/field-specific approval is resolved server-side inside
// resolve_visibility_for_viewer.
export type ViewerRelationshipContext = {
  viewer_id: string | null;
  target_profile_id: string;
  is_self: boolean;
  viewer_follows_target: boolean;
  target_follows_viewer: boolean;
  is_mutual: boolean;
  follow_status: "none" | "pending" | "accepted";
  target_is_public: boolean;
  viewer_role: string | null;
  is_delegate: boolean;
  has_any_approved_access: boolean;
};

// The single object viewer surfaces consume. Always produced by the
// server (resolve_visibility_for_viewer); never assembled client-side.
export type VisibilityResolution = {
  canView: boolean;
  requiredAudience: RelationshipAudience;
  requestMode: VisibilityRequestMode;
  reason: string;
};

export type VisibilityPolicy = {
  id: string;
  owner_profile_id: string;
  subject_type: VisibilitySubjectType;
  subject_id: string | null;
  field_key: string;
  audience: RelationshipAudience;
  request_mode: VisibilityRequestMode;
  source_preset: string | null;
  created_at: string;
  updated_at: string;
};

export type VisibilityOwnerSettings = {
  owner_profile_id: string;
  preset_key: VisibilityPresetKey;
  created_at: string;
  updated_at: string;
};

export type AccessRequestType =
  | "price_inquiry"
  | "availability_request"
  | "room_access"
  | "vip_preview"
  | "studio_note_access"
  | "general_access";

export type AccessRequestStatus =
  | "pending"
  | "approved"
  | "declined"
  | "expired"
  | "cancelled";

export type AccessRequest = {
  id: string;
  requester_profile_id: string;
  owner_profile_id: string;
  subject_type: VisibilitySubjectType;
  subject_id: string | null;
  field_key: string;
  request_type: AccessRequestType;
  status: AccessRequestStatus;
  message: string | null;
  source_surface: string | null;
  source_payload: Record<string, unknown> | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AccessGrantType =
  | "manual"
  | "request_approved"
  | "audience_list"
  | "room_invite"
  | "subscription_ready_later";

export type AccessGrant = {
  id: string;
  owner_profile_id: string;
  grantee_profile_id: string;
  subject_type: VisibilitySubjectType;
  subject_id: string | null;
  field_key: string;
  grant_type: AccessGrantType;
  source_request_id: string | null;
  expires_at: string | null;
  created_at: string;
  created_by: string | null;
};

// Audience values surfaced in the basic owner picker. `delegates` is
// intentionally hidden — delegates inherit operational access through
// delegation logic, not through a public-facing visibility tier.
export const PUBLIC_AUDIENCE_PICKER_ORDER: RelationshipAudience[] = [
  "public",
  "signed_in",
  "followers",
  "following",
  "mutuals",
  "approved",
  "owner_only",
];

export const PRESET_ORDER: VisibilityPresetKey[] = [
  "open_studio",
  "follower_aware",
  "mutual_first",
  "private_studio",
];

// First-class field keys covered by Sprint 5 v1 owner UI.
export const FIRST_CLASS_ARTWORK_FIELDS = [
  "price",
  "availability",
  "description",
] as const;
export type FirstClassArtworkField = (typeof FIRST_CLASS_ARTWORK_FIELDS)[number];
