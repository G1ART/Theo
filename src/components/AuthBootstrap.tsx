"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

/**
 * Global auth state listener. On SIGNED_IN/SIGNED_OUT/USER_UPDATED:
 * - Clears profile caches (via router refresh so pages re-fetch)
 * - On SIGNED_OUT redirects to /login
 * Prevents stale session / wrong-user-id after account switch.
 *
 * TOKEN_REFRESHED is intentionally ignored: it fires on ordinary reloads
 * when the JWT is near expiry, and router.refresh() there blanks
 * client layouts (AuthGate) on Safari.
 */
export function AuthBootstrap() {
  const router = useRouter();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        router.replace("/login");
        router.refresh();
        return;
      }
      // TOKEN_REFRESHED fires on ordinary page load when the JWT is
      // near expiry. Calling router.refresh() then remounts client
      // layouts (AuthGate resets to a blank canvas) on Safari.
      // The in-memory session is already updated; skip a full refresh.
      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        router.refresh();
      }
    });

    return () => sub.subscription.unsubscribe();
  }, [router]);

  return null;
}
