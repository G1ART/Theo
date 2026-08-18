import { supabase } from "./client";

export type DelegationScopeType = "account" | "project" | "inventory";

export type DelegationStatus =
  | "pending"
  | "active"
  | "revoked"
  | "declined"
  | "expired";

export type DelegationPreset =
  | "operations"
  | "content"
  | "review"
  | "project_co_edit"
  | "project_works_only"
  | "project_review";

export const ACCOUNT_PRESETS: DelegationPreset[] = ["operations", "content", "review"];
export const PROJECT_PRESETS: DelegationPreset[] = [
  "project_co_edit",
  "project_works_only",
  "project_review",
];

export type DelegationRow = {
  id: string;
  delegator_profile_id: string;
  delegate_profile_id: string | null;
  delegate_email: string;
  scope_type: DelegationScopeType;
  project_id: string | null;
  permissions: string[];
  preset: DelegationPreset | null;
  note: string | null;
  invite_token?: string;
  status: DelegationStatus;
  invited_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DelegationParticipant = {
  id: string;
  username: string | null;
  display_name: string | null;
  /** QA 2026-08-17 bilingual — populated when the delegation RPC
   *  surfaces the KO/EN slots. Consumers should route through
   *  `formatDisplayName(profile, t, locale)`. */
  display_name_ko?: string | null;
  display_name_en?: string | null;
  avatar_url?: string | null;
};

export type DelegationProjectInfo = {
  id: string;
  title: string;
  /** QA 2026-08-17 bilingual — populated when the delegation RPC
   *  surfaces the KO/EN slots. Consumers should route through
   *  `pickLocalizedTitle(project, locale)`. */
  title_ko?: string | null;
  title_en?: string | null;
};

export type DelegationWithDetails = DelegationRow & {
  delegator_profile?: DelegationParticipant | null;
  project?: DelegationProjectInfo | null;
  delegate_profile?: DelegationParticipant | null;
};

export type ListMyDelegationsResult = {
  sent: DelegationWithDetails[];
  received: DelegationWithDetails[];
};

export type GetDelegationByTokenResult = {
  found: boolean;
  id?: string;
  delegate_email?: string;
  scope_type?: DelegationScopeType;
  status?: string;
  /**
   * Permission preset granted by this invite. Surfaced to the
   * invite-landing page so the recipient can review WHAT they are
   * accepting before clicking "accept". Older invites created before
   * presets existed will report null here.
   */
  preset?: DelegationPreset | null;
  delegator?: {
    id: string;
    username: string | null;
    display_name: string | null;
    /** QA 2026-08-17 bilingual — populated when the delegation RPC
     *  surfaces the KO/EN slots. Consumers should route through
     *  `formatDisplayName(delegator, t, locale)`. */
    display_name_ko?: string | null;
    display_name_en?: string | null;
  };
  project?: {
    id: string;
    title: string;
    /** QA 2026-08-17 bilingual — populated when the delegation RPC
     *  surfaces the KO/EN slots. */
    title_ko?: string | null;
    title_en?: string | null;
  } | null;
};

export type DelegationActivityEvent = {
  id: string;
  event_type: string;
  target_type: string | null;
  target_id: string | null;
  summary: string | null;
  metadata: Record<string, unknown>;
  actor_profile_id: string | null;
  created_at: string;
};

export type DelegationDetail = {
  ok: true;
  delegation: DelegationRow;
  delegator_profile: DelegationParticipant | null;
  delegate_profile: DelegationParticipant | null;
  project: DelegationProjectInfo | null;
  events: DelegationActivityEvent[];
};

export type DelegationDetailError = {
  ok: false;
  code: "permission_denied" | "not_found" | string;
};

const DEFAULT_PERMISSIONS = ["view", "edit_metadata", "manage_works"];

/** Create a delegation invite (email-based); returns invite_token. */
export async function createDelegationInvite(args: {
  delegateEmail: string;
  scopeType: DelegationScopeType;
  projectId?: string | null;
  permissions?: string[];
  preset?: DelegationPreset | null;
  note?: string | null;
}): Promise<{ data: { id: string; invite_token: string } | null; error: unknown }> {
  const { data, error } = await supabase.rpc("create_delegation_invite", {
    p_delegate_email: args.delegateEmail.trim().toLowerCase(),
    p_scope_type: args.scopeType,
    p_project_id: args.projectId ?? null,
    p_permissions: args.preset ? null : args.permissions ?? DEFAULT_PERMISSIONS,
    p_preset: args.preset ?? null,
    p_note: args.note ?? null,
  });
  if (error) return { data: null, error };
  return { data: data as { id: string; invite_token: string } | null, error: null };
}

/** Invite an existing user by profile (in-app accept). */
export async function createDelegationInviteForProfile(args: {
  delegateProfileId: string;
  scopeType: DelegationScopeType;
  projectId?: string | null;
  permissions?: string[];
  preset?: DelegationPreset | null;
  note?: string | null;
}): Promise<{ data: { id: string; invite_token: string } | null; error: unknown }> {
  const { data, error } = await supabase.rpc("create_delegation_invite_for_profile", {
    p_delegate_profile_id: args.delegateProfileId,
    p_scope_type: args.scopeType,
    p_project_id: args.projectId ?? null,
    p_permissions: args.preset ? null : args.permissions ?? DEFAULT_PERMISSIONS,
    p_preset: args.preset ?? null,
    p_note: args.note ?? null,
  });
  if (error) return { data: null, error };
  return { data: data as { id: string; invite_token: string } | null, error: null };
}

export async function getDelegationByToken(
  token: string
): Promise<{ data: GetDelegationByTokenResult | null; error: unknown }> {
  const { data, error } = await supabase.rpc("get_delegation_by_token", {
    p_token: token,
  });
  if (error) return { data: null, error };
  return { data: data as GetDelegationByTokenResult, error: null };
}

export async function acceptDelegationByToken(
  token: string
): Promise<{ data: { ok: boolean; reason?: string; code?: string; id?: string } | null; error: unknown }> {
  const { data, error } = await supabase.rpc("accept_delegation_by_token", {
    p_token: token,
  });
  if (error) return { data: null, error };
  return { data: data as { ok: boolean; reason?: string; code?: string; id?: string }, error: null };
}

export async function revokeDelegation(
  delegationId: string
): Promise<{ data: { ok: boolean; code?: string } | null; error: unknown }> {
  const { data, error } = await supabase.rpc("revoke_delegation", {
    p_delegation_id: delegationId,
  });
  if (error) return { data: null, error };
  return { data: data as { ok: boolean; code?: string }, error: null };
}

/**
 * Sender-side cancel of a *pending* invite. Distinct from
 * `revokeDelegation` so the recipient sees "초대 취소" wording instead of
 * "위임 해지" — the SQL RPC differentiates via a separate
 * `delegation_invite_canceled` notification type. Falls back to ok=false
 * with `code='not_found_or_not_pending'` if the invite was already
 * accepted, declined, or revoked.
 */
export async function cancelDelegationInvite(
  delegationId: string
): Promise<{ data: { ok: boolean; code?: string } | null; error: unknown }> {
  const { data, error } = await supabase.rpc("cancel_delegation_invite", {
    p_delegation_id: delegationId,
  });
  if (error) return { data: null, error };
  return { data: data as { ok: boolean; code?: string }, error: null };
}

/**
 * Sender-side permission edit for an *active* delegation. The SQL
 * sanitizes the permission set against a server-side whitelist, so
 * unknown tokens are silently dropped. Returns the diff
 * (`added`/`removed`) so the UI can render a confirmation toast like
 * "권한 2개 추가, 1개 제거" without a second round-trip.
 */
export async function updateDelegationPermissions(
  delegationId: string,
  permissions: string[]
): Promise<{
  data:
    | {
        ok: boolean;
        code?: string;
        noop?: boolean;
        added?: string[];
        removed?: string[];
      }
    | null;
  error: unknown;
}> {
  const { data, error } = await supabase.rpc("update_delegation_permissions", {
    p_delegation_id: delegationId,
    p_permissions: permissions,
  });
  if (error) return { data: null, error };
  return {
    data: data as {
      ok: boolean;
      code?: string;
      noop?: boolean;
      added?: string[];
      removed?: string[];
    },
    error: null,
  };
}

/**
 * Recipient-side withdrawal from an *active* delegation. Sets
 * `status='declined'` server-side; the audit log differentiates this
 * from a pending-stage decline via the `delegate_resigned` event_type.
 */
export async function resignDelegationByDelegate(
  delegationId: string
): Promise<{ data: { ok: boolean; code?: string } | null; error: unknown }> {
  const { data, error } = await supabase.rpc("resign_delegation_by_delegate", {
    p_delegation_id: delegationId,
  });
  if (error) return { data: null, error };
  return { data: data as { ok: boolean; code?: string }, error: null };
}

/**
 * Recipient-side request asking the sender to adjust permissions on an
 * active delegation. No state transition — purely a notification +
 * audit event with the proposed permission set + a free-text memo.
 * The sender's notification deep-links them to the permission editor.
 */
export async function requestDelegationPermissionChange(args: {
  delegationId: string;
  message?: string | null;
  proposedPermissions?: string[];
}): Promise<{ data: { ok: boolean; code?: string } | null; error: unknown }> {
  const { data, error } = await supabase.rpc(
    "request_delegation_permission_change",
    {
      p_delegation_id: args.delegationId,
      p_message: args.message ?? null,
      p_proposed_permissions: args.proposedPermissions ?? [],
    }
  );
  if (error) return { data: null, error };
  return { data: data as { ok: boolean; code?: string }, error: null };
}

/**
 * Sender-side explicit decline of a pending permission-change request
 * filed by the recipient. The delegation row state is unchanged — the
 * recipient continues with their existing permissions; only the
 * pending notification + audit trail flip to "dismissed".
 */
export async function dismissDelegationPermissionChangeRequest(args: {
  delegationId: string;
  message?: string | null;
}): Promise<{ data: { ok: boolean; code?: string } | null; error: unknown }> {
  const { data, error } = await supabase.rpc(
    "dismiss_delegation_permission_change_request",
    {
      p_delegation_id: args.delegationId,
      p_message: args.message ?? null,
    }
  );
  if (error) return { data: null, error };
  return { data: data as { ok: boolean; code?: string }, error: null };
}

export async function acceptDelegationById(
  delegationId: string
): Promise<{ data: { ok: boolean; reason?: string; code?: string } | null; error: unknown }> {
  const { data, error } = await supabase.rpc("accept_delegation_by_id", {
    p_delegation_id: delegationId,
  });
  if (error) return { data: null, error };
  return { data: data as { ok: boolean; reason?: string; code?: string }, error: null };
}

export async function declineDelegationById(
  delegationId: string
): Promise<{ data: { ok: boolean; reason?: string; code?: string } | null; error: unknown }> {
  const { data, error } = await supabase.rpc("decline_delegation_by_id", {
    p_delegation_id: delegationId,
  });
  if (error) return { data: null, error };
  return { data: data as { ok: boolean; reason?: string; code?: string }, error: null };
}

export async function listMyDelegations(): Promise<{
  data: ListMyDelegationsResult | null;
  error: unknown;
}> {
  const { data, error } = await supabase.rpc("list_my_delegations");
  if (error) return { data: null, error };
  const raw = data as { sent: DelegationWithDetails[]; received: DelegationWithDetails[] };
  return {
    data: {
      sent: Array.isArray(raw?.sent) ? raw.sent : [],
      received: Array.isArray(raw?.received) ? raw.received : [],
    },
    error: null,
  };
}

/**
 * Lightweight server-side check used by `ActingAsProvider` to detect
 * a stale local "acting as" target. Returns true iff the current
 * session user holds AT LEAST one ACTIVE delegation against `ownerId`
 * (any scope, any preset). Failures are swallowed by the caller —
 * we never want a flaky probe to clear a legitimately-active banner.
 */
export async function isActiveDelegateOf(
  ownerId: string
): Promise<{ data: boolean | null; error: unknown }> {
  const { data, error } = await supabase.rpc("is_active_delegate_of", {
    p_owner_profile_id: ownerId,
  });
  if (error) return { data: null, error };
  return { data: Boolean(data), error: null };
}

/** Fetch a delegation detail bundle (delegation + parties + project + events). */
export async function getDelegationDetail(
  delegationId: string
): Promise<{ data: DelegationDetail | null; error: unknown }> {
  const { data, error } = await supabase.rpc("get_delegation_detail", {
    p_delegation_id: delegationId,
  });
  if (error) return { data: null, error };
  const raw = data as DelegationDetail | DelegationDetailError | null;
  if (!raw || !("ok" in raw)) return { data: null, error: new Error("invalid_response") };
  if (raw.ok === false) return { data: null, error: new Error(raw.code || "unknown") };
  return { data: raw, error: null };
}

/** Permission lists per preset (single source of truth, kept in sync with
 *  public.delegation_preset_permissions). UI uses this to render allow/deny
 *  bullets; security still flows through the SQL function on the server. */
export const PRESET_PERMISSIONS: Record<DelegationPreset, string[]> = {
  operations: [
    "view",
    "edit_metadata",
    "manage_works",
    "manage_artworks",
    "manage_exhibitions",
    "manage_inquiries",
    "manage_claims",
  ],
  content: [
    "view",
    "edit_metadata",
    "manage_works",
    "manage_artworks",
    "manage_exhibitions",
    "edit_profile_public_content",
  ],
  review: ["view"],
  project_co_edit: ["view", "edit_metadata", "manage_works"],
  project_works_only: ["view", "manage_works"],
  project_review: ["view"],
};

export function presetForScope(scope: DelegationScopeType, preset: DelegationPreset): boolean {
  if (scope === "account") return ACCOUNT_PRESETS.includes(preset);
  if (scope === "project") return PROJECT_PRESETS.includes(preset);
  return false;
}
