"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession, getMyAuthState } from "@/lib/supabase/auth";
import { routeByAuthState, ONBOARDING_PATH } from "@/lib/identity/routing";
import { useT } from "@/lib/i18n/useT";

export default function Home() {
  const router = useRouter();
  const { t } = useT();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await getSession();
      if (cancelled) return;
      if (!session) {
        // REVOCABLE DECISION (2026-07-10): cold front-door is signup-first.
        // A visitor with no session hitting `/` is sent to /onboarding, not
        // /login — returning users still reach login via the "이미 계정이
        // 있나요?" link on the onboarding surface. If we ever want the bare
        // domain to greet returning users with login instead, flip this back
        // to LOGIN_PATH (and update onboarding-smoke.mjs accordingly).
        router.replace(ONBOARDING_PATH);
        return;
      }
      const state = await getMyAuthState();
      if (cancelled) return;
      // Session was just verified above. If the RPC is transiently
      // unhappy, route the user to the default destination rather
      // than kicking them back to login.
      const { to } = routeByAuthState(state, { sessionPresent: true });
      router.replace(to);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <p className="text-lg font-semibold text-zinc-900">Theo</p>
      <p className="text-zinc-600">{t("common.loading")}</p>
    </div>
  );
}
