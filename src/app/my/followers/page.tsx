"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useT } from "@/lib/i18n/useT";

function FollowersRedirectInner() {
  const router = useRouter();
  const { t } = useT();
  useEffect(() => {
    router.replace("/my/network?tab=followers");
  }, [router]);
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-center text-sm text-zinc-500">
      {t("common.loading")}
    </main>
  );
}

export default function FollowersRedirectPage() {
  return (
    <AuthGate>
      <FollowersRedirectInner />
    </AuthGate>
  );
}
