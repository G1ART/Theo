import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSignupEmailStep } from "./signupEmailStep";

test("finished email goes to login", () => {
  assert.equal(
    decideSignupEmailStep({
      accountExists: true,
      emailConfirmed: true,
      onboardingFinished: true,
    }),
    "login",
  );
});

test("finished email goes to login even if the confirm flag is stale", () => {
  assert.equal(
    decideSignupEmailStep({
      accountExists: true,
      emailConfirmed: false,
      onboardingFinished: true,
    }),
    "login",
  );
});

test("invited but onboarding is incomplete continues", () => {
  assert.equal(
    decideSignupEmailStep({
      accountExists: true,
      emailConfirmed: false,
      onboardingFinished: false,
    }),
    "continue",
  );
  assert.equal(
    decideSignupEmailStep({
      accountExists: true,
      emailConfirmed: true,
      onboardingFinished: false,
    }),
    "continue",
  );
});

test("unknown email continues", () => {
  assert.equal(
    decideSignupEmailStep({
      accountExists: false,
      emailConfirmed: false,
      onboardingFinished: false,
    }),
    "continue",
  );
});

test("a finished flag without an account still continues", () => {
  assert.equal(
    decideSignupEmailStep({
      accountExists: false,
      emailConfirmed: false,
      onboardingFinished: true,
    }),
    "continue",
  );
});
