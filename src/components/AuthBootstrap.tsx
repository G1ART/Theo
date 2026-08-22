"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

/**
 * Global auth state listener. SIGNED_OUT redirects to /login and
 * refreshes so server components drop the old session.
 *
 * SIGNED_IN / TOKEN_REFRESHED / USER_UPDATED must not call
 * `router.refresh()`. supabase-js emits SIGNED_IN on every page load
 * when it recovers a session from storage (`_recoverAndRefresh`), and
 * TOKEN_REFRESHED when the JWT is near expiry. Refresh remounts client
 * layouts: AuthGate resets to `ready=false`, and on `/upload` the
 * desktop Header is hidden — a blank white canvas. The in-memory
 * session is already updated. Login and `/auth/callback` navigate
 * themselves after a real sign-in.
 */
export function AuthBootstrap() {
  const router = useRouter();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        router.replace("/login");
        router.refresh();
      }
    });

    return () => sub.subscription.unsubscribe();
  }, [router]);

  return null;
}
