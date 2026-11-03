import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OAUTH_SIGNUP_SCOPES,
  buildOAuthCallbackUrl,
  classifyOAuthCallbackFailure,
  messageKeyForOAuthCode,
  oauthFailureHref,
  oauthProviderScopes,
  parseOAuthAttempt,
} from "../src/lib/auth/oauthSignup";

test("google signup scopes are identity only", () => {
  assert.equal(OAUTH_SIGNUP_SCOPES, "openid email profile");
  assert.equal(oauthProviderScopes("google"), "openid email profile");
  assert.equal(/calendar/i.test(OAUTH_SIGNUP_SCOPES), false);
  assert.equal(oauthProviderScopes("apple"), undefined);
});

test("callback url keeps provider, surface, and next", () => {
  const url = buildOAuthCallbackUrl("https://withtheo.art/", {
    provider: "google",
    from: "signup",
    next: "/invites/delegation?token=abc",
  });
  assert.equal(
    url,
    "https://withtheo.art/auth/callback?provider=google&from=signup&next=%2Finvites%2Fdelegation%3Ftoken%3Dabc",
  );
  assert.equal(url.includes("calendar"), false);
});

test("org_internal returns to the form that started Google", () => {
  assert.equal(
    classifyOAuthCallbackFailure(
      "?provider=google&from=signup&next=%2Ffeed",
      "#error=org_internal&error_description=Error+403:+org_internal",
    ),
    "org_blocked",
  );
  assert.equal(
    classifyOAuthCallbackFailure("", "?error=org_internal"),
    "org_blocked",
  );
  assert.equal(
    oauthFailureHref({
      from: "signup",
      next: "/invites/delegation?token=abc",
      kind: "org_blocked",
    }),
    "/signup?oauth=org_blocked&next=%2Finvites%2Fdelegation%3Ftoken%3Dabc",
  );
  assert.equal(
    oauthFailureHref({ from: "onboarding", kind: "org_blocked" }),
    "/onboarding?oauth=org_blocked",
  );
  assert.equal(
    oauthFailureHref({ from: "https://evil.example", kind: "error" }),
    "/login?oauth=error",
  );
});

test("a cancelled Google screen is not an expired email link", () => {
  assert.equal(
    classifyOAuthCallbackFailure(
      "?provider=google&from=login",
      "#error=access_denied&error_description=User+cancelled",
    ),
    "cancelled",
  );
  assert.equal(
    classifyOAuthCallbackFailure(
      "?error=access_denied&error_code=otp_expired",
      "",
    ),
    null,
  );
  assert.equal(
    messageKeyForOAuthCode("org_blocked"),
    "auth.loginV2.oauth.orgBlocked",
  );
  assert.equal(
    messageKeyForOAuthCode("unfinished"),
    "auth.loginV2.oauth.orgBlocked",
  );
});

test("a stored Google attempt expires", () => {
  const now = 1_700_000_000_000;
  const fresh = JSON.stringify({
    provider: "google",
    from: "onboarding",
    next: "/signup",
    at: now,
  });
  assert.deepEqual(parseOAuthAttempt(fresh, now + 1000), {
    provider: "google",
    from: "onboarding",
    next: "/signup",
  });
  assert.equal(parseOAuthAttempt(fresh, now + 16 * 60 * 1000), null);
  assert.equal(
    parseOAuthAttempt(
      JSON.stringify({ provider: "google", from: "login", next: "https://evil.example", at: now }),
      now,
    )?.next,
    null,
  );
});
