// Sprint 5 — Supabase wrappers for the relationship/access RPCs.
//
// Surface convention (matches the Sprint 5 amendments):
//   - VIEWER-FACING: only `getViewerRelationshipContext` and
//     `resolveVisibilityForViewer`. Both are server-resolved, so client
//     code can never spoof a `required_audience`.
//   - OWNER/DELEGATE-WRITER FACING: preset/policy mutation, preview-as
//     dry-run, request resolution.
//   - REQUESTER FACING: createAccessRequest / cancel / list-mine.
//
// `can_view_by_relationship` is intentionally NOT re-exported. It lives
// on the database as an internal helper; callers must use
// `resolveVisibilityForViewer` for any UI gating decision.

import { supabase } from "./client";
import type {
  AccessGrant,
  AccessRequest,
  AccessRequestStatus,
  AccessRequestType,
  ArtworkFieldPresence,
  ArtworkPassportForViewer,
  RedactedArtworkPassport,
  RelationshipAudience,
  RelationshipCard,
  RelationshipDeskFilter,
  RelationshipDeskRow,
  RoomForViewer,
  RoomItemForViewer,
  RoomMetaForViewer,
  RoomSourceFromToken,
  ViewerRelationshipContext,
  VisibilityOwnerSettings,
  VisibilityPolicy,
  VisibilityPresetKey,
  VisibilityRequestMode,
  VisibilityResolution,
  VisibilitySubjectType,
} from "@/lib/visibility/types";

type ResolutionRow = {
  can_view?: boolean | null;
  required_audience?: RelationshipAudience | null;
  request_mode?: VisibilityRequestMode;
  reason?: string | null;
};

function normalizeResolution(
  row: ResolutionRow | null | undefined
): VisibilityResolution {
  // Defensive normalizer used by the redacted RPCs. Any missing field
  // becomes a fail-closed default so the UI never accidentally shows
  // gated content because of a malformed payload.
  return {
    canView: !!row?.can_view,
    requiredAudience:
      (row?.required_audience as RelationshipAudience) ?? "owner_only",
    requestMode: row?.request_mode ?? null,
    reason: row?.reason ?? "",
  };
}

function normalizeRelationship(
  row: Partial<ViewerRelationshipContext> | null | undefined,
  fallbackTarget: string
): ViewerRelationshipContext {
  return {
    viewer_id: row?.viewer_id ?? null,
    target_profile_id: row?.target_profile_id ?? fallbackTarget,
    is_self: !!row?.is_self,
    viewer_follows_target: !!row?.viewer_follows_target,
    target_follows_viewer: !!row?.target_follows_viewer,
    is_mutual: !!row?.is_mutual,
    follow_status:
      (row?.follow_status as ViewerRelationshipContext["follow_status"]) ??
      "none",
    target_is_public: row?.target_is_public ?? true,
    viewer_role: row?.viewer_role ?? null,
    is_delegate: !!row?.is_delegate,
    has_any_approved_access: !!row?.has_any_approved_access,
  };
}

// Forbidden secret-shaped keys for source_payload. Matches the Sprint 4
// expansion in src/lib/supabase/priceInquiries.ts so we have a single
// privacy floor across both inquiry and access-request surfaces.
const SECRET_KEY_RE =
  /(token|password|secret|apikey|authorization|cookie|bearer|magic)/i;

/** Sanitize a free-form jsonb-ish payload before submitting it to RPCs. */
export function sanitizeAccessSourcePayload(
  input: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (SECRET_KEY_RE.test(k)) continue;
    if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean" ||
      v == null
    ) {
      cleaned[k] = v;
    }
  }
  try {
    if (JSON.stringify(cleaned).length > 1024) return null;
  } catch {
    return null;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

// ─────────────────────────────────────────────────────────────────────
// Viewer-facing surface
// ─────────────────────────────────────────────────────────────────────

export async function getViewerRelationshipContext(
  targetProfileId: string
): Promise<{ data: ViewerRelationshipContext | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("get_viewer_relationship_context", {
    p_target_profile_id: targetProfileId,
  });
  if (error) return { data: null, error };
  return { data: (data ?? null) as ViewerRelationshipContext | null, error: null };
}

export type ResolveVisibilityArgs = {
  ownerProfileId: string;
  subjectType: VisibilitySubjectType;
  subjectId: string | null;
  fieldKey: string;
};

type ResolveVisibilityRpcRow = {
  can_view: boolean;
  required_audience: RelationshipAudience;
  request_mode: VisibilityRequestMode;
  reason: string;
};

export async function resolveVisibilityForViewer(
  args: ResolveVisibilityArgs
): Promise<{ data: VisibilityResolution | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("resolve_visibility_for_viewer", {
    p_owner: args.ownerProfileId,
    p_subject_type: args.subjectType,
    p_subject_id: args.subjectId,
    p_field_key: args.fieldKey,
  });
  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };
  const row = data as ResolveVisibilityRpcRow;
  return {
    data: {
      canView: !!row.can_view,
      requiredAudience: row.required_audience,
      requestMode: row.request_mode ?? null,
      reason: row.reason ?? "",
    },
    error: null,
  };
}

// ─── Sprint 5.2 — Redacted viewer-facing RPCs ────────────────────────
//
// These wrappers replace ad-hoc client-side fetches on the artwork detail
// and room pages. The server already redacts sensitive fields and gates
// room items, so the client just consumes the result.

export async function getArtworkPassportForViewer(
  artworkId: string
): Promise<{ data: ArtworkPassportForViewer | null; error: Error | null }> {
  const { data, error } = await supabase.rpc(
    "get_artwork_passport_for_viewer",
    { p_artwork_id: artworkId }
  );
  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };
  const obj = data as {
    artwork: RedactedArtworkPassport | null;
    visibility?: {
      price?: ResolutionRow | null;
      availability?: ResolutionRow | null;
      description?: ResolutionRow | null;
    } | null;
    presence?: Partial<ArtworkFieldPresence> | null;
    relationship?: Partial<ViewerRelationshipContext> | null;
  };
  if (!obj.artwork) return { data: null, error: null };
  const owner = obj.artwork.artist_id;
  return {
    data: {
      artwork: obj.artwork,
      visibility: {
        price: normalizeResolution(obj.visibility?.price),
        availability: normalizeResolution(obj.visibility?.availability),
        description: normalizeResolution(obj.visibility?.description),
      },
      presence: {
        price: !!obj.presence?.price,
        availability: !!obj.presence?.availability,
        description: !!obj.presence?.description,
      },
      relationship: normalizeRelationship(obj.relationship, owner),
    },
    error: null,
  };
}

export async function getRoomForViewerByToken(
  token: string
): Promise<{ data: RoomForViewer | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("get_room_for_viewer_by_token", {
    p_token: token,
  });
  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };
  const obj = data as {
    room: RoomMetaForViewer | null;
    items?: RoomItemForViewer[] | null;
    visibility?: ResolutionRow | null;
    relationship?: Partial<ViewerRelationshipContext> | null;
    can_view?: boolean | null;
  };
  if (!obj.room) return { data: null, error: null };
  return {
    data: {
      room: obj.room,
      items: Array.isArray(obj.items) ? obj.items : [],
      visibility: normalizeResolution(obj.visibility),
      relationship: normalizeRelationship(obj.relationship, obj.room.owner_id),
      canView: !!obj.can_view,
    },
    error: null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Owner / delegate-writer surface
// ─────────────────────────────────────────────────────────────────────

export type PreviewAsFakeState = {
  signed_in?: boolean;
  viewer_follows_target?: boolean;
  target_follows_viewer?: boolean;
  has_grant?: boolean;
  is_delegate?: boolean;
};

export async function canViewByRelationshipDryRun(args: {
  ownerProfileId: string;
  subjectType: VisibilitySubjectType;
  subjectId: string | null;
  fieldKey: string;
  requiredAudience: RelationshipAudience;
  fakeViewerId?: string | null;
  fakeState?: PreviewAsFakeState;
}): Promise<{ canView: boolean; error: Error | null }> {
  const { data, error } = await supabase.rpc("can_view_by_relationship_dryrun", {
    p_owner: args.ownerProfileId,
    p_subject_type: args.subjectType,
    p_subject_id: args.subjectId,
    p_field_key: args.fieldKey,
    p_required_audience: args.requiredAudience,
    p_fake_viewer_id: args.fakeViewerId ?? null,
    p_fake_state: (args.fakeState ?? {}) as Record<string, unknown>,
  });
  if (error) return { canView: false, error };
  return { canView: !!data, error: null };
}

/**
 * Sprint 5.2 — owner/delegate-only effective preview. Walks the same
 * policy ladder as `resolve_visibility_for_viewer` (so explicit
 * per-artwork/per-field overrides are honored), then evaluates the
 * audience against `fakeState` (instead of `auth.uid()`). Replaces the
 * preset-only dry-run path on `/my/visibility`.
 */
export async function resolveVisibilityForPreview(args: {
  ownerProfileId: string;
  subjectType: VisibilitySubjectType;
  subjectId: string | null;
  fieldKey: string;
  fakeState?: PreviewAsFakeState;
}): Promise<{ data: VisibilityResolution | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("resolve_visibility_for_preview", {
    p_owner: args.ownerProfileId,
    p_subject_type: args.subjectType,
    p_subject_id: args.subjectId,
    p_field_key: args.fieldKey,
    p_fake_state: (args.fakeState ?? {}) as Record<string, unknown>,
  });
  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };
  return { data: normalizeResolution(data as ResolutionRow), error: null };
}

export async function setVisibilityPreset(args: {
  ownerProfileId: string;
  presetKey: VisibilityPresetKey;
}): Promise<{ data: VisibilityOwnerSettings | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("set_visibility_preset", {
    p_owner: args.ownerProfileId,
    p_preset_key: args.presetKey,
  });
  if (error) return { data: null, error };
  return { data: (data ?? null) as VisibilityOwnerSettings | null, error: null };
}

export async function getMyOwnerVisibilitySettings(
  ownerProfileId: string
): Promise<{ data: VisibilityOwnerSettings | null; error: Error | null }> {
  const { data, error } = await supabase
    .from("visibility_owner_settings")
    .select("owner_profile_id, preset_key, created_at, updated_at")
    .eq("owner_profile_id", ownerProfileId)
    .maybeSingle();
  if (error) return { data: null, error };
  return { data: (data ?? null) as VisibilityOwnerSettings | null, error: null };
}

export async function upsertVisibilityPolicy(args: {
  ownerProfileId: string;
  subjectType: VisibilitySubjectType;
  subjectId: string | null;
  fieldKey: string;
  audience: RelationshipAudience;
  requestMode?: VisibilityRequestMode;
  sourcePreset?: string | null;
}): Promise<{ data: VisibilityPolicy | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("upsert_visibility_policy", {
    p_owner: args.ownerProfileId,
    p_subject_type: args.subjectType,
    p_subject_id: args.subjectId,
    p_field_key: args.fieldKey,
    p_audience: args.audience,
    p_request_mode: args.requestMode ?? null,
    p_source_preset: args.sourcePreset ?? null,
  });
  if (error) return { data: null, error };
  return { data: (data ?? null) as VisibilityPolicy | null, error: null };
}

export async function listMyVisibilityPolicies(
  ownerProfileId: string
): Promise<{ data: VisibilityPolicy[]; error: Error | null }> {
  const { data, error } = await supabase
    .from("visibility_policies")
    .select(
      "id, owner_profile_id, subject_type, subject_id, field_key, audience, request_mode, source_preset, created_at, updated_at"
    )
    .eq("owner_profile_id", ownerProfileId)
    .order("updated_at", { ascending: false });
  if (error) return { data: [], error };
  return { data: (data ?? []) as VisibilityPolicy[], error: null };
}

export async function listAccessRequestsForMe(args: {
  ownerProfileId: string;
  status?: AccessRequestStatus | "all";
  limit?: number;
}): Promise<{ data: AccessRequest[]; error: Error | null }> {
  let q = supabase
    .from("access_requests")
    .select(
      "id, requester_profile_id, owner_profile_id, subject_type, subject_id, field_key, request_type, status, message, source_surface, source_payload, resolved_by, resolved_at, created_at, updated_at"
    )
    .eq("owner_profile_id", args.ownerProfileId)
    .order("created_at", { ascending: false });
  if (args.status && args.status !== "all") {
    q = q.eq("status", args.status);
  }
  if (args.limit) {
    q = q.limit(args.limit);
  }
  const { data, error } = await q;
  if (error) return { data: [], error };
  return { data: (data ?? []) as AccessRequest[], error: null };
}

export async function resolveAccessRequest(args: {
  requestId: string;
  action: "approve" | "decline";
}): Promise<{ data: AccessRequest | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("resolve_access_request", {
    p_request_id: args.requestId,
    p_action: args.action,
  });
  if (error) return { data: null, error };
  return { data: (data ?? null) as AccessRequest | null, error: null };
}

export async function listMyAccessGrants(
  ownerProfileId: string
): Promise<{ data: AccessGrant[]; error: Error | null }> {
  const { data, error } = await supabase
    .from("access_grants")
    .select(
      "id, owner_profile_id, grantee_profile_id, subject_type, subject_id, field_key, grant_type, source_request_id, expires_at, created_at, created_by"
    )
    .eq("owner_profile_id", ownerProfileId)
    .order("created_at", { ascending: false });
  if (error) return { data: [], error };
  return { data: (data ?? []) as AccessGrant[], error: null };
}

// ─────────────────────────────────────────────────────────────────────
// Requester (viewer) surface
// ─────────────────────────────────────────────────────────────────────

export type CreateAccessRequestArgs = {
  ownerProfileId: string;
  subjectType: VisibilitySubjectType;
  subjectId: string | null;
  fieldKey: string;
  requestType: AccessRequestType;
  message?: string | null;
  sourceSurface?: string | null;
  sourcePayload?: Record<string, unknown> | null;
};

/**
 * Sprint 5.2 — `create_access_request` now returns
 * `{ request, duplicate }` jsonb so the client never has to compare
 * `created_at !== updated_at` to guess whether the row is new. The
 * wrapper preserves the legacy `data` field (the access_request row)
 * and adds an explicit `duplicate` boolean.
 */
export async function createAccessRequest(
  args: CreateAccessRequestArgs
): Promise<{
  data: AccessRequest | null;
  duplicate: boolean;
  error: Error | null;
}> {
  const sanitizedPayload = sanitizeAccessSourcePayload(args.sourcePayload ?? null);
  const { data, error } = await supabase.rpc("create_access_request", {
    p_owner: args.ownerProfileId,
    p_subject_type: args.subjectType,
    p_subject_id: args.subjectId,
    p_field_key: args.fieldKey,
    p_request_type: args.requestType,
    p_message: args.message ?? null,
    p_source_surface: args.sourceSurface ?? null,
    p_source_payload: sanitizedPayload,
  });
  if (error) return { data: null, duplicate: false, error };
  if (!data) return { data: null, duplicate: false, error: null };
  // The new RPC returns { request, duplicate }. Be defensive against
  // legacy rollouts (server still returning the bare row): when the
  // payload looks like a row, treat it as a fresh insert.
  const obj = data as { request?: AccessRequest | null; duplicate?: boolean };
  if (obj && typeof obj === "object" && "request" in obj) {
    return {
      data: (obj.request ?? null) as AccessRequest | null,
      duplicate: !!obj.duplicate,
      error: null,
    };
  }
  return { data: data as AccessRequest, duplicate: false, error: null };
}

export async function listMyAccessRequests(
  requesterProfileId: string
): Promise<{ data: AccessRequest[]; error: Error | null }> {
  const { data, error } = await supabase
    .from("access_requests")
    .select(
      "id, requester_profile_id, owner_profile_id, subject_type, subject_id, field_key, request_type, status, message, source_surface, source_payload, resolved_by, resolved_at, created_at, updated_at"
    )
    .eq("requester_profile_id", requesterProfileId)
    .order("created_at", { ascending: false });
  if (error) return { data: [], error };
  return { data: (data ?? []) as AccessRequest[], error: null };
}

/**
 * Sprint 5.2 — cancellation is now RPC-only. The direct requester
 * UPDATE policy on `access_requests` was dropped in
 * `20260607000000_relationship_access_enforcement_hardening.sql`; the
 * RPC enforces requester-only + pending-only + status/updated_at-only.
 */
export async function cancelAccessRequest(
  requestId: string
): Promise<{ data: AccessRequest | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("cancel_access_request", {
    p_request_id: requestId,
  });
  if (error) return { data: null, error };
  return { data: (data ?? null) as AccessRequest | null, error: null };
}

// ─────────────────────────────────────────────────────────────────────
// Sprint 6 Phase 0 — minimum attribution resolver
// ─────────────────────────────────────────────────────────────────────

/**
 * Phase 0 — replaces the legacy `getRoomByToken` call from the artwork
 * viewer attribution path. Returns ONLY `{ room_id, source_surface }`
 * — no room title, description, owner names, or item list. The server
 * additionally validates that the artwork really belongs to that room
 * before answering, so a hostile `?fromRoom=` query string can never
 * inflate room attribution for an unrelated artwork.
 */
export async function resolveRoomSourceFromToken(
  token: string,
  artworkId: string
): Promise<{ data: RoomSourceFromToken; error: Error | null }> {
  const empty: RoomSourceFromToken = { room_id: null, source_surface: null };
  if (!token || !artworkId) return { data: empty, error: null };
  const { data, error } = await supabase.rpc("resolve_room_source_from_token", {
    p_token: token,
    p_artwork_id: artworkId,
  });
  if (error) return { data: empty, error };
  if (!data) return { data: empty, error: null };
  const obj = data as Partial<RoomSourceFromToken>;
  return {
    data: {
      room_id: obj.room_id ?? null,
      source_surface: obj.source_surface === "room" ? "room" : null,
    },
    error: null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Sprint 6 — Relationship Desk wrappers (owner/delegate-only)
// ─────────────────────────────────────────────────────────────────────
//
// Acting-as / delegate principal correctness (Sprint 6.1):
//   `auth.uid()` does NOT swap when a delegate is acting as a principal.
//   The acting-as state is a CLIENT product context. To act on behalf of
//   a principal, the wrapper must send `p_owner_profile_id` explicitly;
//   the SQL RPCs validate that `auth.uid() = p_owner_profile_id` OR
//   `is_active_account_delegate_writer(p_owner_profile_id)`. When the
//   wrapper is called without an `ownerProfileId` arg we send null and
//   the RPC defaults to `auth.uid()` (legacy behavior).

export async function getRelationshipDeskForOwner(args?: {
  ownerProfileId?: string | null;
  limit?: number;
  offset?: number;
  filter?: RelationshipDeskFilter;
}): Promise<{ data: RelationshipDeskRow[]; error: Error | null }> {
  const filter = args?.filter ?? "all";
  const { data, error } = await supabase.rpc("get_relationship_desk_for_owner", {
    p_owner_profile_id: args?.ownerProfileId ?? null,
    p_limit: args?.limit ?? 50,
    p_offset: args?.offset ?? 0,
    p_status: filter === "all" ? null : filter,
  });
  if (error) return { data: [], error };
  if (!Array.isArray(data)) return { data: [], error: null };
  return { data: data as RelationshipDeskRow[], error: null };
}

export async function getRelationshipCardForOwner(
  ownerProfileId: string | null,
  targetProfileId: string
): Promise<{ data: RelationshipCard | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("get_relationship_card_for_owner", {
    p_owner_profile_id: ownerProfileId,
    p_target_profile_id: targetProfileId,
  });
  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };
  return { data: data as RelationshipCard, error: null };
}

export async function upsertRelationshipPrivateNote(args: {
  ownerProfileId?: string | null;
  targetProfileId: string;
  note: string;
}): Promise<{
  data:
    | {
        id: string;
        owner_profile_id: string;
        target_profile_id: string;
        note: string;
        updated_at: string;
      }
    | null;
  error: Error | null;
}> {
  const clean = (args.note ?? "").slice(0, 4000);
  const { data, error } = await supabase.rpc("upsert_relationship_private_note", {
    p_owner_profile_id: args.ownerProfileId ?? null,
    p_target_profile_id: args.targetProfileId,
    p_note: clean,
  });
  if (error) return { data: null, error };
  return { data: (data ?? null) as never, error: null };
}

// ─────────────────────────────────────────────────────────────────────
// Sprint 6 Phase E — additive grant lifecycle
// ─────────────────────────────────────────────────────────────────────

/**
 * Phase E — additive RPC. Owner approval can narrow the resulting
 * access_grant: optional `subjectType / subjectId / fieldKey` override
 * (e.g. approve a profile-wide request only for one artwork's price)
 * and an optional `expiresAt`. Backwards compatible: omit the optional
 * params and the legacy behavior is preserved (grant inherits the
 * request's own subject/field).
 */
export async function resolveAccessRequestV2(args: {
  requestId: string;
  action: "approve" | "decline";
  grantSubjectType?: VisibilitySubjectType | null;
  grantSubjectId?: string | null;
  grantFieldKey?: string | null;
  expiresAt?: string | null;
}): Promise<{ data: AccessRequest | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("resolve_access_request_v2", {
    p_request_id: args.requestId,
    p_action: args.action,
    p_grant_subject_type: args.grantSubjectType ?? null,
    p_grant_subject_id: args.grantSubjectId ?? null,
    p_grant_field_key: args.grantFieldKey ?? null,
    p_expires_at: args.expiresAt ?? null,
  });
  if (error) return { data: null, error };
  return { data: (data ?? null) as AccessRequest | null, error: null };
}

// Exposed for tests.
export const _testing = { sanitizeAccessSourcePayload, SECRET_KEY_RE };
