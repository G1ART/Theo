"use client";

// Sprint 6.2 — /my/relationships is now a thin redirect to the unified
// Network hub at /my/network?tab=relationships. The full Relationship
// Desk experience (acting-as, principal-aware RPCs, private notes, card
// drawer, suggested next action) lives in
// `src/components/network/RelationshipDeskPanel.tsx` and is mounted as
// a tab inside /my/network. Keeping this route as a redirect preserves
// every old bookmark, email link, and in-app deep link from prior
// sprints without forking the panel implementation.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useT } from "@/lib/i18n/useT";

function RelationshipsRedirectInner() {
  const router = useRouter();
  const { t } = useT();
  useEffect(() => {
    router.replace("/my/network?tab=relationships");
  }, [router]);
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-center text-sm text-zinc-500">
      {t("common.loading")}
    </main>
  );
}

export default function RelationshipsRedirectPage() {
  return (
    <AuthGate>
      <RelationshipsRedirectInner />
    </AuthGate>
  );
}
