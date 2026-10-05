/**
 * Whether an invite email should go out.
 *
 * A past row is not proof that a message was delivered. Pending invites
 * that were never emailed (or whose send failed) can be mailed again on
 * the same row. A pending invite that already has a successful send is
 * not mailed again unless the inviter explicitly asks to resend. Active
 * access is never re-invited. Revoked, declined, expired, and failed
 * rows do not block a new invite.
 */

export type ExistingInviteDelivery = {
  status: string;
  emailSentAt: string | null;
  expiresAt?: string | null;
};

export type InviteDeliveryDecision =
  | { kind: "create" }
  | { kind: "send" }
  | { kind: "offer_resend" }
  | { kind: "block_active" };

const CLOSED_STATUSES = new Set(["revoked", "declined", "expired", "failed"]);

export function decideInviteDelivery(
  existing: ExistingInviteDelivery | null,
  nowMs = Date.now(),
): InviteDeliveryDecision {
  if (!existing) return { kind: "create" };
  const status = existing.status.trim().toLowerCase();
  if (status === "active") return { kind: "block_active" };
  if (CLOSED_STATUSES.has(status)) return { kind: "create" };
  if (status !== "pending") return { kind: "create" };

  if (existing.expiresAt) {
    const expiresMs = Date.parse(existing.expiresAt);
    if (!Number.isNaN(expiresMs) && expiresMs <= nowMs) return { kind: "create" };
  }

  if (!existing.emailSentAt) return { kind: "send" };
  return { kind: "offer_resend" };
}

/** True only when this attempt should call the mail provider. */
export function shouldDispatchInviteEmail(
  decision: InviteDeliveryDecision,
  explicitResend: boolean,
): boolean {
  if (decision.kind === "send") return true;
  if (decision.kind === "offer_resend") return explicitResend;
  return false;
}

export type OnboardingEmailState = "none" | "unsent" | "sent" | "claimed";

/** External-artist / claim onboarding. Claimed accounts are not re-invited. */
export function shouldSendOnboardingEmail(args: {
  state: OnboardingEmailState;
  explicitResend: boolean;
}): boolean {
  if (args.state === "claimed") return false;
  if (args.state === "sent") return args.explicitResend;
  return true;
}
