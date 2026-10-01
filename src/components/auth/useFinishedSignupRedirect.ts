"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  fetchSignupEmailStep,
  loginUrlForFinishedSignup,
} from "@/lib/auth/signupEmailStep";

/** If this email already finished onboarding, leave the wizard for login. */
export function useFinishedSignupRedirect(
  email: string,
  nextPath: string | null,
  enabled = true,
) {
  const router = useRouter();
  useEffect(() => {
    const trimmed = email.trim();
    if (!enabled || !trimmed) return;
    let cancelled = false;
    void fetchSignupEmailStep(trimmed).then((result) => {
      if (cancelled || result.action !== "login") return;
      router.replace(loginUrlForFinishedSignup(trimmed, nextPath));
    });
    return () => {
      cancelled = true;
    };
  }, [email, nextPath, enabled, router]);
}
