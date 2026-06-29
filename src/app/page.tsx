"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession, getMyAuthState } from "@/lib/supabase/auth";
import { routeByAuthState, LOGIN_PATH } from "@/lib/identity/routing";
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
        router.replace(LOGIN_PATH);
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
