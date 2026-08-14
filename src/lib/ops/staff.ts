import { supabase } from "@/lib/supabase/client";

export type StaffRole = "moderator" | "ops" | "admin";

export const STAFF_ROLES: readonly StaffRole[] = ["moderator", "ops", "admin"] as const;

const ROLE_RANK: Record<StaffRole, number> = {
  moderator: 1,
  ops: 2,
  admin: 3,
};

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

export type StaffRow = {
  profile_id: string;
  role: StaffRole;
  granted_at: string | null;
  note: string | null;
  username: string | null;
  display_name: string | null;
};

export async function isStaffAtLeast(min: StaffRole): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_staff_at_least", { p_min: min });
  if (error) return false;
  return !!data;
}

export async function getStaffRole(): Promise<StaffRole | null> {
  const { data, error } = await supabase
    .from("platform_admins")
    .select("role")
    .maybeSingle();
  if (!error && data) {
    const role = (data as { role?: string }).role;
    if (role && isStaffRole(role)) return role;
    // Pre-role rows (should already be backfilled to ops).
    return "ops";
  }

  if (await isStaffAtLeast("admin")) return "admin";
  if (await isStaffAtLeast("ops")) return "ops";
  if (await isStaffAtLeast("moderator")) return "moderator";
  return null;
}

export function staffRoleAtLeast(role: StaffRole | null, min: StaffRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export async function listStaff(): Promise<{ data: StaffRow[]; error: unknown }> {
  const { data, error } = await supabase.rpc("staff_list");
  if (error) return { data: [], error };
  if (!Array.isArray(data)) return { data: [], error: null };
  return {
    data: data.map((r) => {
      const row = r as Record<string, unknown>;
      const roleRaw = String(row.role ?? "ops");
      return {
        profile_id: String(row.profile_id ?? ""),
        role: isStaffRole(roleRaw) ? roleRaw : "ops",
        granted_at: (row.granted_at as string | null) ?? null,
        note: (row.note as string | null) ?? null,
        username: (row.username as string | null) ?? null,
        display_name: (row.display_name as string | null) ?? null,
      };
    }),
    error: null,
  };
}

export async function grantStaff(
  profileId: string,
  role: StaffRole,
  note?: string | null,
): Promise<{ data: Record<string, unknown> | null; error: unknown }> {
  const { data, error } = await supabase.rpc("staff_grant", {
    p_profile_id: profileId,
    p_role: role,
    p_note: note ?? null,
  });
  if (error) return { data: null, error };
  return { data: (data as Record<string, unknown> | null) ?? null, error: null };
}

export async function revokeStaff(
  profileId: string,
): Promise<{ data: Record<string, unknown> | null; error: unknown }> {
  const { data, error } = await supabase.rpc("staff_revoke", {
    p_profile_id: profileId,
  });
  if (error) return { data: null, error };
  return { data: (data as Record<string, unknown> | null) ?? null, error: null };
}

/** Founder self-grant for henry@g-1.art. Fail-soft if the RPC is missing. */
export async function claimFounder(): Promise<{
  ok: boolean;
  role: StaffRole | null;
}> {
  const { data, error } = await supabase.rpc("staff_claim_founder");
  if (error || !data || typeof data !== "object") return { ok: false, role: null };
  const row = data as { ok?: unknown; role?: unknown };
  const roleRaw = typeof row.role === "string" ? row.role : "";
  return {
    ok: row.ok === true,
    role: isStaffRole(roleRaw) ? roleRaw : null,
  };
}

export type StaffLookupRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  email: string | null;
};

/** Admin-only people search. Fail-soft if the RPC is missing. */
export async function lookupStaffCandidates(
  q: string,
  limit = 8,
): Promise<{ data: StaffLookupRow[]; error: unknown }> {
  const trimmed = q.trim();
  if (!trimmed) return { data: [], error: null };
  const { data, error } = await supabase.rpc("staff_lookup", {
    p_q: trimmed,
    p_limit: Math.min(20, Math.max(1, limit)),
  });
  if (error) return { data: [], error };
  if (!Array.isArray(data)) return { data: [], error: null };
  return {
    data: data.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id ?? ""),
        username: (row.username as string | null) ?? null,
        display_name: (row.display_name as string | null) ?? null,
        email: (row.email as string | null) ?? null,
      };
    }),
    error: null,
  };
}
