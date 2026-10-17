/**
 * Helpers around `public.acting_context_events` — an append-only audit log
 * of actions a delegate performs while operating another profile. The log
 * is the ground truth for "who did what on behalf of whom", which we will
 * need when delegation features stop being free (the `delegation.*`
 * feature namespace) and when gallery workspaces start paying for seats.
 *
 * Best-effort: failures never break the user flow, we just swallow them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as defaultClient } from "@/lib/supabase/client";
import { recordUsageEvent } from "@/lib/metering";
import { USAGE_KEYS } from "@/lib/metering/usageKeys";

export type ActingContextAction =
  | "artwork.create_draft"
  | "artwork.update"
  | "artwork.publish"
  | "bulk.artwork.update"
  | "exhibition.create"
  | "exhibition.update"
  | "exhibition.publish"
  | "exhibition_work.add"
  | "inquiry.reply"
  | "connection.message_sent"
  | "board.create"
  | "board.save_artwork";

/**
 * Map a high-level acting-context action to the canonical event-type
 * string that lives in `delegation_activity_events`. Returning null
 * means we deliberately don't surface this mutation in the delegator's
 * audit drawer (e.g. board interactions are personal to the delegate).
 */
function mutationEventTypeFor(action: string): string | null {
  switch (action) {
    case "artwork.create_draft": return "delegated_artwork_created";
    case "artwork.update":       return "delegated_artwork_updated";
    case "artwork.publish":      return "delegated_artwork_published";
    case "bulk.artwork.update":  return "delegated_artwork_bulk_updated";
    case "exhibition.create":    return "delegated_exhibition_created";
    case "exhibition.update":    return "delegated_exhibition_updated";
    case "exhibition.publish":   return "delegated_exhibition_published";
    case "exhibition_work.add":  return "delegated_exhibition_work_added";
    case "inquiry.reply":        return "delegated_inquiry_replied";
    case "profile.update":       return "delegated_profile_updated";
    default:                     return null;
  }
}

export type RecordActingContextOptions = {
  client?: SupabaseClient;
  /** Explicit delegate user id. Defaults to the logged-in session user. */
  actorUserId?: string | null;
  subjectProfileId: string;
  action: ActingContextAction | string;
  resourceType?: string | null;
  resourceId?: string | null;
  payload?: Record<string, unknown> | null;
};

export async function recordActingContextEvent(
  opts: RecordActingContextOptions,
): Promise<void> {
  const client = opts.client ?? defaultClient;
  try {
    let actorUserId = opts.actorUserId ?? null;
    if (!actorUserId) {
      const {
        data: { session },
      } = await client.auth.getSession();
      actorUserId = session?.user?.id ?? null;
    }
    if (!actorUserId) return;
    if (actorUserId === opts.subjectProfileId) {
      // Not an acting-as scenario — no audit row needed.
      return;
    }

    const { error } = await client.from("acting_context_events").insert({
      actor_user_id: actorUserId,
      subject_profile_id: opts.subjectProfileId,
      action: opts.action,
      resource_type: opts.resourceType ?? null,
      resource_id: opts.resourceId ?? null,
      payload: opts.payload ?? {},
    });
    if (error && process.env.NODE_ENV !== "production") {
      console.warn("[acting_context] insert failed", error.message);
    }

    // Audit-trail twin: when the action represents a mutation we want
    // the delegator to see in their detail drawer, also fire
    // `record_delegated_mutation`. The RPC is security-definer and
    // self-validates against active delegations, so a flaky local row
    // can't escalate privileges. Best-effort: failures are swallowed.
    const evt = mutationEventTypeFor(opts.action);
    if (evt) {
      try {
        const targetIdValid =
          typeof opts.resourceId === "string" && opts.resourceId.length > 0
            ? opts.resourceId
            : null;
        const { error: rpcErr } = await client.rpc("record_delegated_mutation", {
          p_owner_profile_id: opts.subjectProfileId,
          p_event_type: evt,
          p_target_type: opts.resourceType ?? null,
          p_target_id: targetIdValid,
          p_summary: null,
          p_metadata: (opts.payload ?? {}) as unknown as Record<string, unknown>,
        });
        if (rpcErr && process.env.NODE_ENV !== "production") {
          console.warn("[delegated_mutation] rpc failed", rpcErr.message);
        }
      } catch (rpcErr) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[delegated_mutation] threw", rpcErr);
        }
      }
    }
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[acting_context] threw", err);
    }
  }
}

/**
 * Convenience: record both the delegation.acting_as usage event and a
 * context row when the delegate consciously changes scope. Called by the
 * ActingAsContext provider whenever `setActingAs` flips.
 */
export async function logActingScopeChange(params: {
  subjectProfileId: string | null;
  previousSubjectProfileId: string | null;
  actorUserId?: string | null;
  client?: SupabaseClient;
}): Promise<void> {
  if (params.subjectProfileId && params.subjectProfileId !== params.previousSubjectProfileId) {
    await recordUsageEvent(
      {
        userId: params.actorUserId ?? undefined,
        key: USAGE_KEYS.DELEGATION_ACTING_AS_ENTERED,
        featureKey: "delegation.operator_invite",
        metadata: { subject_profile_id: params.subjectProfileId },
      },
      { client: params.client, dualWriteBeta: false },
    );
  }
  if (!params.subjectProfileId && params.previousSubjectProfileId) {
    await recordUsageEvent(
      {
        userId: params.actorUserId ?? undefined,
        key: USAGE_KEYS.DELEGATION_ACTING_AS_EXITED,
        featureKey: "delegation.operator_invite",
        metadata: { subject_profile_id: params.previousSubjectProfileId },
      },
      { client: params.client, dualWriteBeta: false },
    );
  }
}
