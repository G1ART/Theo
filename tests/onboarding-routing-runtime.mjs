#!/usr/bin/env node
// Onboarding Sign-off Hardening — runtime routing smokes.
//
// Static grep (tests/onboarding-smoke.mjs) pins the shape of the
// front-door code. These tests go one step further and exercise the
// *real* `routeByAuthState` helper against the auth shapes each signup
// flavor actually produces, so a regression in the gate's decision
// logic would fail loudly instead of silently sending users to the
// wrong place.
//
// Scenarios (mirrors the brief's Track 2 list):
//   1. password signup (fresh account)   → /onboarding/identity
//   2. authenticated placeholder (e.g.
//      magic-link first hop)             → /onboarding/identity
//   3. completed user                    → `next` or /feed
//   4. invite signup: `next` survives
//      identity-finish, then resolves to
//      the invite page on completion      → /invites/delegation?...
//   5. No session                         → /login (with next)
//   6. Session present but state=null
//      (transient RPC blip)              → default destination, never
//                                          loops back to /login
//
// Runs with: `tsx tests/onboarding-routing-runtime.mjs` (wired via npm
// script `test:onboarding-runtime`). routing.ts imports through the `@/`
// path alias, which plain `node --experimental-strip-types` cannot resolve.

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const routingUrl = pathToFileURL(
  join(here, "..", "src", "lib", "identity", "routing.ts"),
).href;

const {
  routeByAuthState,
  safeNextPath,
  IDENTITY_FINISH_PATH,
  ONBOARDING_PATH,
  SET_PASSWORD_PATH,
  LOGIN_PATH,
  DEFAULT_DESTINATION,
  PUBLIC_FEED_DESTINATION,
  feedHomeHref,
  loginUrlWithNext,
} = await import(routingUrl);

const failures = [];
function expect(label, actual, expected) {
  if (actual !== expected) {
    failures.push(
      `  - [${label}] expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function makeState(overrides) {
  return {
    user_id: "u_test",
    has_password: true,
    is_email_confirmed: true,
    needs_onboarding: false,
    username: "ada",
    display_name: "Ada",
    is_placeholder_username: false,
    needs_identity_setup: false,
    ...overrides,
  };
}

// --- 1. Password signup (fresh account) -------------------------------
// Right after signUpWithPassword the server reports
// `needs_identity_setup: true` (no profile row, no display_name).
{
  const state = makeState({
    needs_onboarding: true,
    needs_identity_setup: true,
    is_placeholder_username: true,
    username: null,
    display_name: null,
  });
  const { to } = routeByAuthState(state, { sessionPresent: true });
  const ok = to.startsWith(IDENTITY_FINISH_PATH + "?next=");
  if (!ok) failures.push(`  - [1-password-signup] expected identity-finish, got ${to}`);
}

// --- 2. Authenticated placeholder (magic-link first hop) --------------
// User has a session and an auto-created placeholder profile but has
// not completed identity. Must be rescued into identity-finish.
{
  const state = makeState({
    username: "user_abc123",
    display_name: null,
    is_placeholder_username: true,
    needs_identity_setup: true,
  });
  const { to } = routeByAuthState(state, { sessionPresent: true });
  const ok = to.startsWith(IDENTITY_FINISH_PATH);
  if (!ok)
    failures.push(`  - [2-placeholder-rescue] expected identity-finish, got ${to}`);
}

// --- 3. Completed user skips identity-finish --------------------------
{
  const state = makeState();
  const { to } = routeByAuthState(state, { sessionPresent: true });
  expect("3-complete-default", to, DEFAULT_DESTINATION);
}
{
  const state = makeState();
  const { to } = routeByAuthState(state, {
    sessionPresent: true,
    nextPath: "/studio",
  });
  expect("3-complete-next", to, "/studio");
}

// --- 4. Invite signup round-trip --------------------------------------
// (a) Brand-new user arrives via /invites/delegation?token=abc, signs
// up with password. `next` must be preserved through identity-finish.
{
  const invitePath = "/invites/delegation?token=abc";
  const state = makeState({
    needs_onboarding: true,
    needs_identity_setup: true,
    is_placeholder_username: true,
    username: null,
    display_name: null,
  });
  const { to } = routeByAuthState(state, {
    sessionPresent: true,
    nextPath: invitePath,
  });
  const expectedQs = `?next=${encodeURIComponent(invitePath)}`;
  expect("4a-invite-preserve-next", to, IDENTITY_FINISH_PATH + expectedQs);
}
// (b) After identity-finish completes, the same `next` should land the
// user back on the invite page.
{
  const invitePath = "/invites/delegation?token=abc";
  const state = makeState();
  const { to } = routeByAuthState(state, {
    sessionPresent: true,
    nextPath: invitePath,
  });
  expect("4b-invite-return", to, invitePath);
}

// --- 5. No session → /login (with next preserved) ---------------------
{
  const { to } = routeByAuthState(null, { sessionPresent: false });
  expect("5a-no-session-bare", to, LOGIN_PATH);
}
{
  const { to } = routeByAuthState(null, {
    sessionPresent: false,
    nextPath: "/studio",
  });
  expect(
    "5b-no-session-next",
    to,
    `${LOGIN_PATH}?next=${encodeURIComponent("/studio")}`,
  );
}

// --- 6. Session present but state=null (RPC blip) ---------------------
// The original "post-login loop" bug. Must never bounce back to /login.
{
  const { to } = routeByAuthState(null, { sessionPresent: true });
  expect("6a-rpc-blip-default", to, DEFAULT_DESTINATION);
}
{
  const { to } = routeByAuthState(null, {
    sessionPresent: true,
    nextPath: "/studio",
  });
  expect("6b-rpc-blip-next", to, "/studio");
}

// --- 7. Password-less account needs set-password ---------------------
// Completed identity but no password yet → set-password gate.
{
  const state = makeState({ has_password: false });
  const { to } = routeByAuthState(state, { sessionPresent: true });
  expect("7-set-password", to, SET_PASSWORD_PATH);
}

// --- 8. needs_onboarding (legacy profile-missing) ---------------------
// When the new identity flag is clear but the legacy onboarding flag
// is still set, the user must land on /onboarding (not /feed).
{
  const state = makeState({
    needs_onboarding: true,
    needs_identity_setup: false,
  });
  const { to } = routeByAuthState(state, { sessionPresent: true });
  expect("8-needs-onboarding", to, ONBOARDING_PATH);
}

// --- 10. Feed homes ---------------------------------------------------
// Signed-in default (login, onboarding, password flows without `next`)
// is For you. `tab=all` is the whole public feed for everyone.
expect("10a-default-for-you", DEFAULT_DESTINATION, "/feed?tab=foryou&sort=latest");
expect("10b-public-feed-all", PUBLIC_FEED_DESTINATION, "/feed?tab=all&sort=latest");
expect("10c-logo-signed-in", feedHomeHref(true), DEFAULT_DESTINATION);
expect("10d-logo-visitor", feedHomeHref(false), PUBLIC_FEED_DESTINATION);
expect(
  "10e-gate-keeps-page",
  loginUrlWithNext({ nextPath: "/my/messages/ada?x=1" }),
  `${LOGIN_PATH}?next=${encodeURIComponent("/my/messages/ada?x=1")}`,
);

// --- 9. Open-redirect safety -----------------------------------------
// `next` sanitizer must reject protocol-relative and absolute URLs.
expect("9a-reject-proto-relative", safeNextPath("//evil.com/x"), null);
expect("9b-reject-absolute", safeNextPath("https://evil.com"), null);
expect("9c-accept-relative", safeNextPath("/studio?tab=1"), "/studio?tab=1");

if (failures.length) {
  console.error("Onboarding routing runtime regressions:");
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log("Onboarding routing runtime: all scenarios hold.");
