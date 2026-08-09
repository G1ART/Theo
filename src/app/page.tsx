"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession, getMyAuthState } from "@/lib/supabase/auth";
import { routeByAuthState, DEFAULT_DESTINATION } from "@/lib/identity/routing";
import { TheoLoadingMark } from "@/components/brand/TheoLoadingMark";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Mobile Safari private mode, storage partitioning, or a flaky
      // network can make supabase-js `getSession()` hang or throw. Never
      // strand the visitor on the loading mark: race the check against a
      // short timeout and, on ANY failure, fall through to the public feed.
      try {
        const {
          data: { session },
        } = await Promise.race([
          getSession(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("getSession timeout")), 4000)
          ),
        ]);
        if (cancelled) return;
        if (!session) {
          // REVOCABLE DECISION (2026-08-07): feed-first cold front door.
          // A visitor with no session hitting `/` now lands on the PUBLIC
          // feed (DEFAULT_DESTINATION) instead of being walled behind
          // /onboarding. Browsing is the landing experience; login/sign-up
          // is surfaced *naturally* by deeper actions — the app shell's
          // "로그인 / 시작하기" affordance + the inline auth gate on gated
          // sections (artwork price/inquiry, artist Statement/CV, follow,
          // personalized "For you" tab), each routing through
          // onboardingUrlWithNext / loginUrlWithNext so the user round-trips
          // back. To restore the old signup-first wall, flip this back to
          // ONBOARDING_PATH (and update tests/onboarding-smoke.mjs invariant 6a).
          router.replace(DEFAULT_DESTINATION);
          return;
        }
        const state = await getMyAuthState();
        if (cancelled) return;
        // Session was just verified above. If the RPC is transiently
        // unhappy, route the user to the default destination rather
        // than kicking them back to login.
        const { to } = routeByAuthState(state, { sessionPresent: true });
        router.replace(to);
      } catch {
        if (cancelled) return;
        router.replace(DEFAULT_DESTINATION);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <TheoLoadingMark />
    </div>
  );
}
