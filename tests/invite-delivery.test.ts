// A failed or never-sent invite can be mailed again.
// A pending invite that already has a successful send is not mailed again
// unless the inviter explicitly asks. Active access is not re-invited.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decideInviteDelivery,
  shouldDispatchInviteEmail,
  shouldSendOnboardingEmail,
} from "../src/lib/invites/deliveryPolicy";

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const pendingUnsent = { status: "pending", emailSentAt: null, expiresAt: null };
const pendingSent = {
  status: "pending",
  emailSentAt: "2026-09-10T21:56:24.372Z",
  expiresAt: null,
};

const unsentDecision = decideInviteDelivery(pendingUnsent);
assert.equal(unsentDecision.kind, "send");
assert.equal(shouldDispatchInviteEmail(unsentDecision, false), true);

const failedSend = decideInviteDelivery({ status: "pending", emailSentAt: null, expiresAt: null });
assert.equal(shouldDispatchInviteEmail(failedSend, false), true);

const sentDecision = decideInviteDelivery(pendingSent);
assert.equal(sentDecision.kind, "offer_resend");
assert.equal(shouldDispatchInviteEmail(sentDecision, false), false);
assert.equal(shouldDispatchInviteEmail(sentDecision, true), true);

assert.equal(decideInviteDelivery(null).kind, "create");
for (const status of ["revoked", "declined", "expired", "failed"]) {
  assert.equal(
    decideInviteDelivery({ status, emailSentAt: "2026-01-01T00:00:00.000Z", expiresAt: null }).kind,
    "create",
    status,
  );
}

const expiredPending = decideInviteDelivery(
  { status: "pending", emailSentAt: null, expiresAt: "2020-01-01T00:00:00.000Z" },
  Date.parse("2026-10-05T00:00:00.000Z"),
);
assert.equal(expiredPending.kind, "create");
assert.equal(shouldDispatchInviteEmail(expiredPending, true), false);

const active = decideInviteDelivery({
  status: "active",
  emailSentAt: "2026-01-01T00:00:00.000Z",
  expiresAt: null,
});
assert.equal(active.kind, "block_active");
assert.equal(shouldDispatchInviteEmail(active, true), false);

assert.equal(shouldSendOnboardingEmail({ state: "none", explicitResend: false }), true);
assert.equal(shouldSendOnboardingEmail({ state: "unsent", explicitResend: false }), true);
assert.equal(shouldSendOnboardingEmail({ state: "sent", explicitResend: false }), false);
assert.equal(shouldSendOnboardingEmail({ state: "sent", explicitResend: true }), true);
assert.equal(shouldSendOnboardingEmail({ state: "claimed", explicitResend: true }), false);

const migration = read("supabase/migrations/20261005190000_invite_email_resend.sql");
assert.match(migration, /already_pending/);
assert.match(migration, /email_sent/);
assert.match(migration, /raise exception 'already_active'/);
assert.doesNotMatch(migration, /raise exception 'duplicate_pending_invite'/);
assert.match(migration, /status = 'revoked'|status = 'expired'/);
assert.match(migration, /invite_email_sent_at is not null/);
assert.match(migration, /target_type = 'email'/);
assert.match(migration, /cannot_invite_self/);

const delegationRoute = read("src/app/api/delegation-invite-email/route.ts");
assert.match(delegationRoute, /shouldDispatchInviteEmail/);
assert.match(delegationRoute, /alreadySent: true/);
assert.match(delegationRoute, /email_unconfigured/);
assert.match(delegationRoute, /status: 503/);
assert.match(delegationRoute, /requireUserFromRequest/);
assert.doesNotMatch(delegationRoute, /toEmail required/);

const artistRoute = read("src/app/api/artist-invite-email/route.ts");
assert.match(artistRoute, /shouldSendOnboardingEmail/);
assert.match(artistRoute, /email_unconfigured/);
assert.match(artistRoute, /status: 503/);
assert.match(artistRoute, /alreadySent: true/);
assert.doesNotMatch(artistRoute, /ok: true \}/);

const wizard = read("src/components/delegation/CreateDelegationWizard.tsx");
assert.match(wizard, /sendDelegationInviteEmail\(created\.id, false\)/);
assert.match(wizard, /mode: "already"/);
assert.match(wizard, /sendDelegationInviteEmail\(emailFailedResult\.id, true\)/);

console.log("invite-delivery tests ok");
