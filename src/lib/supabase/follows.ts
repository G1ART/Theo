import { supabase } from "./client";

/**
 * Follow status for the viewer toward a given target.
 *
 *   - `none`     → no edge in `follows`
 *   - `pending`  → request was sent, target hasn't approved yet (private accounts)
 *   - `accepted` → following / mutual edge
 *
 * Mirrors the SQL helper `public.get_viewer_follow_status(uuid)`.
 */
export type FollowStatus = "none" | "pending" | "accepted";

export type FollowProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  main_role: string | null;
  roles: string[] | null;
  /**
   * Timestamp of the follow edge (follows.created_at). Surfaced for the
   * Network page "최신순" sort. Never null for rows returned by the
   * `getMyFollowers` / `getMyFollowing` helpers.
   */
  followed_at?: string | null;
};

const PROFILE_SELECT = "id, username, display_name, avatar_url, bio, main_role, roles";

export async function getMyFollowers(options: { limit?: number; cursor?: string } = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id)
    return { data: [], nextCursor: null, error: new Error("Not authenticated") };

  const { limit = 20, cursor } = options;
  const offset = Math.max(0, parseInt(cursor ?? "0", 10) || 0);

  const { data: rows, error } = await supabase
    .from("follows")
    .select(`follower_id, created_at, status, profiles!follower_id(${PROFILE_SELECT})`)
    .eq("following_id", session.user.id)
    .eq("status", "accepted")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);

  if (error) return { data: [], nextCursor: null, error };

  const raw = (rows ?? []) as Array<{
    follower_id: string;
    created_at: string;
    profiles: FollowProfileRow | FollowProfileRow[] | null;
  }>;
  const hasMore = raw.length > limit;
  const list = hasMore ? raw.slice(0, limit) : raw;
  const nextCursor = hasMore ? String(offset + limit) : null;

  const profiles: FollowProfileRow[] = list
    .map((r): FollowProfileRow | null => {
      const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
      if (!p || typeof (p as FollowProfileRow).id !== "string") return null;
      return { ...(p as FollowProfileRow), followed_at: r.created_at ?? null };
    })
    .filter((p): p is FollowProfileRow => p !== null);

  return { data: profiles, nextCursor, error: null };
}

export async function getMyFollowing(options: { limit?: number; cursor?: string } = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id)
    return { data: [], nextCursor: null, error: new Error("Not authenticated") };

  const { limit = 20, cursor } = options;
  const offset = Math.max(0, parseInt(cursor ?? "0", 10) || 0);

  const { data: rows, error } = await supabase
    .from("follows")
    .select(`following_id, created_at, status, profiles!following_id(${PROFILE_SELECT})`)
    .eq("follower_id", session.user.id)
    .eq("status", "accepted")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);

  if (error) return { data: [], nextCursor: null, error };

  const raw = (rows ?? []) as Array<{
    following_id: string;
    created_at: string;
    profiles: FollowProfileRow | FollowProfileRow[] | null;
  }>;
  const hasMore = raw.length > limit;
  const list = hasMore ? raw.slice(0, limit) : raw;
  const nextCursor = hasMore ? String(offset + limit) : null;

  const profiles: FollowProfileRow[] = list
    .map((r): FollowProfileRow | null => {
      const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
      if (!p || typeof (p as FollowProfileRow).id !== "string") return null;
      return { ...(p as FollowProfileRow), followed_at: r.created_at ?? null };
    })
    .filter((p): p is FollowProfileRow => p !== null);

  return { data: profiles, nextCursor, error: null };
}

/**
 * Returns true when the viewer is an *accepted* follower of `targetId`.
 * Pending requests deliberately count as "not following" for callers that
 * only care about content access (feed, artworks, etc).
 */
export async function isFollowing(targetId: string) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: false, error: null };
  const { count, error } = await supabase
    .from("follows")
    .select("*", { count: "exact", head: true })
    .eq("follower_id", session.user.id)
    .eq("following_id", targetId)
    .eq("status", "accepted");
  return { data: (count ?? 0) > 0, error };
}

/**
 * Returns the granular follow status for the viewer.
 * Useful when the UI must distinguish "Follow" / "Requested" / "Following".
 */
export async function getFollowStatus(targetId: string): Promise<{
  data: FollowStatus;
  error: unknown;
}> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: "none", error: null };
  const { data, error } = await supabase.rpc("get_viewer_follow_status", {
    p_target: targetId,
  });
  if (error) return { data: "none", error };
  const value = (data as string | null) ?? "none";
  if (value === "accepted" || value === "pending") return { data: value, error: null };
  return { data: "none", error: null };
}

/**
 * Idempotent follow / follow-request entry point.
 *
 * Always goes through the SECURITY DEFINER RPC `request_follow_or_follow`
 * which handles the public/private decision atomically:
 *   - target.is_public = true  → row inserted with status='accepted'
 *   - target.is_public = false → row inserted with status='pending'
 *
 * The `error` shape is preserved for backwards compatibility with the
 * legacy `follow()` callers (FollowButton, IntroMessageAssist, etc).
 */
export async function follow(
  targetId: string
): Promise<{ data: FollowStatus | null; error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    return { data: null, error: new Error("Not authenticated") };
  }
  const { data, error } = await supabase.rpc("request_follow_or_follow", {
    p_target: targetId,
  });
  if (error) return { data: null, error };
  const value = (data as string | null) ?? "accepted";
  const status: FollowStatus = value === "pending" ? "pending" : "accepted";
  // Sprint 5 — when an accepted edge lands AND the target was already
  // following us, the relationship just turned mutual. We fire the event
  // here (the single fire-site) so analytics see one row per
  // freshly-formed mutual connection. No payload identifiers leak (we
  // pass only target_profile_id, which is already the URL the viewer is
  // standing on).
  if (status === "accepted") {
    try {
      const { data: backRow } = await supabase
        .from("follows")
        .select("status")
        .eq("follower_id", targetId)
        .eq("following_id", session.user.id)
        .maybeSingle();
      if (backRow && (backRow as { status?: string }).status === "accepted") {
        const { logBetaEventSync } = await import("@/lib/beta/logEvent");
        logBetaEventSync("mutual_connection_created", {
          target_profile_id: targetId,
          surface: "follow",
        });
      }
    } catch {
      // Telemetry fire-and-forget; never block the user-facing follow.
    }
  }
  return { data: status, error: null };
}

/**
 * Unfollow OR cancel a pending request — single API surface for the
 * "undo" intent. Removes any (accepted or pending) edge from the viewer
 * to `targetId`.
 */
export async function unfollow(targetId: string) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { error: new Error("Not authenticated") };
  return supabase
    .from("follows")
    .delete()
    .eq("follower_id", session.user.id)
    .eq("following_id", targetId);
}

/**
 * Cancel a still-pending follow request without affecting accepted edges.
 * UI uses this when the user clicks the "Requested" pill before approval.
 */
export async function cancelFollowRequest(targetId: string): Promise<{
  data: boolean;
  error: unknown;
}> {
  const { data, error } = await supabase.rpc("cancel_follow_request", {
    p_target: targetId,
  });
  if (error) return { data: false, error };
  return { data: !!data, error: null };
}

/**
 * Principal-side: approve a pending follow request from `followerId`.
 * Returns true when a row was actually flipped.
 */
export async function acceptFollowRequest(followerId: string): Promise<{
  data: boolean;
  error: unknown;
}> {
  const { data, error } = await supabase.rpc("accept_follow_request", {
    p_follower: followerId,
  });
  if (error) return { data: false, error };
  return { data: !!data, error: null };
}

/**
 * Principal-side: decline a pending follow request from `followerId`.
 * Deletes the row, leaving the requester back at "Follow".
 */
export async function declineFollowRequest(followerId: string): Promise<{
  data: boolean;
  error: unknown;
}> {
  const { data, error } = await supabase.rpc("decline_follow_request", {
    p_follower: followerId,
  });
  if (error) return { data: false, error };
  return { data: !!data, error: null };
}

/**
 * Principal-side: list pending incoming follow requests. Used by the
 * private-account inbox / notification expansion to show approve / decline
 * controls.
 */
export async function listIncomingFollowRequests(options: {
  limit?: number;
} = {}): Promise<{
  data: Array<{
    follower_id: string;
    created_at: string;
    profile: FollowProfileRow | null;
  }>;
  error: unknown;
}> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    return { data: [], error: new Error("Not authenticated") };
  }
  const { limit = 50 } = options;
  const { data, error } = await supabase
    .from("follows")
    .select(`follower_id, created_at, status, profiles!follower_id(${PROFILE_SELECT})`)
    .eq("following_id", session.user.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { data: [], error };
  const rows = (data ?? []) as Array<{
    follower_id: string;
    created_at: string;
    profiles: FollowProfileRow | FollowProfileRow[] | null;
  }>;
  return {
    data: rows.map((r) => ({
      follower_id: r.follower_id,
      created_at: r.created_at,
      profile: Array.isArray(r.profiles) ? r.profiles[0] ?? null : r.profiles ?? null,
    })),
    error: null,
  };
}
