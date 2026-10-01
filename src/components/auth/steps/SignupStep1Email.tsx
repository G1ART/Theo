"use client";

/**
 * Signup v2 · Step 1.
 *
 * Same account form as `/onboarding`: email, password, confirm, the
 * finished-account redirect, and the verification modal. Profile
 * fields are Step 2 at `/onboarding/identity`.
 */

import { useRouter } from "next/navigation";
import { OnboardingAccountForm } from "@/app/onboarding/page";
import { ensureFreeEntitlement } from "@/lib/entitlements";
import { pathAfterNewAccount } from "@/lib/auth/signupDestination";
import { routeByAuthState } from "@/lib/identity/routing";
import { getMyAuthState } from "@/lib/supabase/auth";
import type { SignupStepApi } from "../SignupWizardShell";

export function SignupStep1Email({ api }: { api: SignupStepApi }) {
  const router = useRouter();
  return (
    <OnboardingAccountForm
      initialEmail={api.state.email}
      nextPath={api.nextPath}
      onAccountReady={async (userId) => {
        await ensureFreeEntitlement(userId);
        const state = await getMyAuthState();
        const { to } = routeByAuthState(state, {
          nextPath: api.nextPath,
          sessionPresent: true,
        });
        api.clearDraft();
        router.replace(pathAfterNewAccount(to, api.nextPath));
      }}
    />
  );
}
