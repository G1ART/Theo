"use client";

// Sprint 6.2 — /my/access-requests is now a thin redirect to the
// unified Network hub at /my/network?tab=requests. The actual inbox UI
// (LaneChips filter, expandable rows, approve/decline) lives in
// `src/components/network/AccessRequestsPanel.tsx` and is mounted as a
// tab inside /my/network. Keeping this route as a redirect preserves
// every old bookmark, email link, and in-app deep link from prior
// sprints without forking the panel implementation.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useT } from "@/lib/i18n/useT";

function AccessRequestsRedirectInner() {
  const router = useRouter();
  const { t } = useT();
  useEffect(() => {
    router.replace("/my/network?tab=requests");
  }, [router]);
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-center text-sm text-zinc-500">
      {t("common.loading")}
    </main>
  );
}

export default function AccessRequestsRedirectPage() {
  return (
    <AuthGate>
      <AccessRequestsRedirectInner />
    </AuthGate>
  );
}
