/**
 * Signup v2 route — `/signup` (Phase 1, 2026-08-19).
 *
 * Feature-flag gated (spec §11.8): when `NEXT_PUBLIC_SIGNUP_V2` is
 * `false`, we transparently forward to the legacy `/onboarding` flow
 * so cold traffic doesn't hit a dead route. The forward happens at the
 * server-render layer (`redirect()`) so we avoid a flash of the wizard
 * shell for gated-off environments.
 */

import { redirect } from "next/navigation";
import { Suspense } from "react";
import { isSignupV2Enabled } from "@/lib/featureFlags/signupV2";
import { SignupWizardShell } from "@/components/auth/SignupWizardShell";
import { TheoLoadingMark } from "@/components/brand/TheoLoadingMark";

export const metadata = {
  title: "Sign up · Theo",
};

type SignupSearchParams = { step?: string; next?: string; email?: string };

export default async function SignupPage(props: {
  searchParams: Promise<SignupSearchParams>;
}) {
  if (!isSignupV2Enabled()) {
    const params = await props.searchParams;
    const query = new URLSearchParams();
    const email = typeof params?.email === "string" ? params.email.trim() : "";
    const next = typeof params?.next === "string" ? params.next.trim() : "";
    if (email) query.set("email", email);
    if (next) query.set("next", next);
    const qs = query.toString();
    redirect(qs ? `/onboarding?${qs}` : "/onboarding");
  }
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center">
          <TheoLoadingMark />
        </div>
      }
    >
      <SignupWizardShell />
    </Suspense>
  );
}
