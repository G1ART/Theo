"use client";

import { getSession } from "@/lib/supabase/auth";

export type DelegationEmailOutcome = {
  emailed: boolean;
  alreadySent: boolean;
  skipped?: boolean;
  error?: "email_unconfigured" | "unauthorized" | "send_failed" | "not_found" | "missing_email" | "blocked" | "unexpected";
};

/**
 * Ask the server to mail a delegation the signed-in user owns.
 * `resend` must be true to mail again after a successful send.
 */
export async function sendDelegationInviteEmail(
  delegationId: string,
  resend = false,
): Promise<DelegationEmailOutcome> {
  const {
    data: { session },
  } = await getSession();
  const token = session?.access_token;
  if (!token) return { emailed: false, alreadySent: false, error: "unauthorized" };

  try {
    const resp = await fetch("/api/delegation-invite-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ delegationId, resend }),
    });
    const data = (await resp.json().catch(() => ({}))) as {
      emailed?: boolean;
      alreadySent?: boolean;
      skipped?: string;
      error?: string;
    };
    if (data.skipped === "ir_demo") {
      return { emailed: false, alreadySent: false, skipped: true };
    }
    if (data.alreadySent) return { emailed: false, alreadySent: true };
    if (data.emailed) return { emailed: true, alreadySent: false };
    const error = data.error === "email_unconfigured"
      || data.error === "unauthorized"
      || data.error === "send_failed"
      || data.error === "not_found"
      || data.error === "missing_email"
      || data.error === "blocked"
      ? data.error
      : resp.status === 503
        ? "email_unconfigured"
        : "send_failed";
    return { emailed: false, alreadySent: false, error };
  } catch {
    return { emailed: false, alreadySent: false, error: "unexpected" };
  }
}
