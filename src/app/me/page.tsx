"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { TheoLoadingMark } from "@/components/brand/TheoLoadingMark";
import { ownAccountProfileHref } from "@/lib/delegation/principalProfileHref";
import { getMyProfile } from "@/lib/supabase/profiles";

/**
 * `/me` is "my profile": the signed-in account's public profile, the
 * same place as the account icon. The session lives in the browser, so
 * the handle is read here rather than in a server redirect.
 */
function MeRedirect() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    void getMyProfile().then(({ data }) => {
      if (!cancelled) router.replace(ownAccountProfileHref(data?.username ?? null));
    });
    return () => {
      cancelled = true;
    };
  }, [router]);
  return (
    <div className="flex justify-center px-4 py-12">
      <TheoLoadingMark />
    </div>
  );
}

export default function MeRedirectPage() {
  return (
    <AuthGate>
      <MeRedirect />
    </AuthGate>
  );
}
