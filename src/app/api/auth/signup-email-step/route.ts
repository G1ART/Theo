import { NextResponse } from "next/server";
import {
  decideSignupEmailStep,
  type SignupEmailStepFacts,
} from "@/lib/auth/signupEmailStep";
import { getServiceClient } from "@/lib/supabase/serviceClient";

/**
 * Step 1 email gate. Returns only `login` or `continue`.
 * Unknown addresses and unfinished invites share `continue`, so this
 * route does not say which of those two it was.
 * If the SQL function is not applied yet, we continue rather than
 * blocking invitees.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CONTINUE_FACTS: SignupEmailStepFacts = {
  accountExists: false,
  emailConfirmed: false,
  onboardingFinished: false,
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ action: "continue", checked: true });
  }

  const admin = getServiceClient();
  if (!admin) {
    return NextResponse.json({
      action: decideSignupEmailStep(CONTINUE_FACTS),
      checked: false,
    });
  }

  const { data, error } = await admin.rpc("signup_email_step_facts", {
    p_email: email,
  });
  if (error || data == null) {
    console.error("signup-email-step", error?.code ?? error?.message ?? "empty");
    return NextResponse.json({
      action: decideSignupEmailStep(CONTINUE_FACTS),
      checked: false,
    });
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        account_exists?: boolean;
        email_confirmed?: boolean;
        onboarding_finished?: boolean;
      }
    | null
    | undefined;
  if (!row) {
    return NextResponse.json({
      action: decideSignupEmailStep(CONTINUE_FACTS),
      checked: true,
    });
  }

  const facts: SignupEmailStepFacts = {
    accountExists: !!row.account_exists,
    emailConfirmed: !!row.email_confirmed,
    onboardingFinished: !!row.onboarding_finished,
  };
  return NextResponse.json({
    action: decideSignupEmailStep(facts),
    checked: true,
  });
}
