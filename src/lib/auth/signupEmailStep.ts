/**
 * Step 1 of signup / onboarding: what to do with the email they typed.
 *
 * Finished accounts go to login before password or profile.
 * Unknown emails and invited-but-incomplete accounts (unconfirmed
 * ghost, stub profile, identity still open) both continue, so a person
 * who was invited and did not open the link can still attach to the
 * works. The two continue cases are the same action on purpose.
 */

export type SignupEmailStepAction = "login" | "continue";

export type SignupEmailStepFacts = {
  /** A row in auth.users for this address. */
  accountExists: boolean;
  /** auth.users.email_confirmed_at is set. Not enough to send them to login. */
  emailConfirmed: boolean;
  /**
   * Profile exists and identity is complete: real username, display
   * name, roles, and main role. Same bar as get_my_auth_state when
   * needs_onboarding and needs_identity_setup are both false.
   */
  onboardingFinished: boolean;
};

export function decideSignupEmailStep(
  facts: SignupEmailStepFacts,
): SignupEmailStepAction {
  if (facts.accountExists && facts.onboardingFinished) return "login";
  return "continue";
}

/** Login URL for someone who already finished onboarding. */
export function loginUrlForFinishedSignup(
  email: string,
  nextPath: string | null,
): string {
  const params = new URLSearchParams();
  const trimmed = email.trim();
  if (trimmed) params.set("email", trimmed);
  params.set("notice", "finished");
  if (nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")) {
    params.set("next", nextPath);
  }
  return `/login?${params.toString()}`;
}

export type SignupEmailStepResult = {
  action: SignupEmailStepAction;
  /**
   * False when the server could not read account state (SQL not applied,
   * network, missing service key). Callers must not treat that as
   * "this invite is unfinished" — a finished account could be hiding.
   */
  checked: boolean;
};

/**
 * Ask the server which action this email should take.
 * A failed check continues at Step 1 so an invitee is not stuck, and
 * reports `checked: false` so later steps do not send a sign-in link
 * to someone who may already have finished.
 */
export async function fetchSignupEmailStep(
  email: string,
): Promise<SignupEmailStepResult> {
  const trimmed = email.trim();
  if (!trimmed) return { action: "continue", checked: false };
  try {
    const res = await fetch("/api/auth/signup-email-step", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: trimmed }),
    });
    if (!res.ok) return { action: "continue", checked: false };
    const body = (await res.json()) as { action?: unknown; checked?: unknown };
    if (body.checked === false) return { action: "continue", checked: false };
    return {
      action: body.action === "login" ? "login" : "continue",
      checked: true,
    };
  } catch {
    return { action: "continue", checked: false };
  }
}
