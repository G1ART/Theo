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
  RelationshipAudience,
  ViewerRelationshipContext,
  VisibilityOwnerSettings,
  VisibilityPolicy,
  VisibilityPresetKey,
  VisibilityRequestMode,
  VisibilityResolution,
  VisibilitySubjectType,
} from "@/lib/visibility/types";

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

export async function createAccessRequest(
  args: CreateAccessRequestArgs
): Promise<{ data: AccessRequest | null; error: Error | null }> {
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
  if (error) return { data: null, error };
  return { data: (data ?? null) as AccessRequest | null, error: null };
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

export async function cancelAccessRequest(
  requestId: string
): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from("access_requests")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "pending");
  return { error };
}

// Exposed for tests.
export const _testing = { sanitizeAccessSourcePayload, SECRET_KEY_RE };
