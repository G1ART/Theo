"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useT } from "@/lib/i18n/useT";

function FollowingRedirectInner() {
  const router = useRouter();
  const { t } = useT();
  useEffect(() => {
    router.replace("/my/network?tab=following");
  }, [router]);
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-center text-sm text-zinc-500">
      {t("common.loading")}
    </main>
  );
}

export default function FollowingRedirectPage() {
  return (
    <AuthGate>
      <FollowingRedirectInner />
    </AuthGate>
  );
}
