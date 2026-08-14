"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { OpsBackLink } from "@/components/ops/OpsBackLink";
import { useT } from "@/lib/i18n/useT";
import { isStaffAtLeast } from "@/lib/ops/staff";

function PeopleSkeleton() {
  const { t } = useT();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    void (async () => {
      const ok = await isStaffAtLeast("ops");
      setAllowed(ok);
      setChecking(false);
    })();
  }, []);

  if (checking) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8 text-sm text-zinc-500">
        {t("common.loading")}
      </main>
    );
  }

  if (!allowed) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <OpsBackLink />
        <h1 className="mb-4 text-xl font-semibold text-zinc-900">
          {t("ops.people.title")}
        </h1>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {t("ops.people.noAccess")}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <OpsBackLink />
      <h1 className="mb-2 text-xl font-semibold text-zinc-900">
        {t("ops.people.title")}
      </h1>
      <p className="mb-4 text-sm text-zinc-600">{t("ops.people.lead")}</p>
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
        <p>{t("ops.people.lookupNote")}</p>
        <p className="mt-2 text-zinc-500">{t("ops.people.mutationNote")}</p>
        <Link
          href="/my/ops"
          className="mt-4 inline-block text-sm font-medium text-zinc-800 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-950"
        >
          {t("ops.people.backToHub")}
        </Link>
      </div>
    </main>
  );
}

export default function OpsPeoplePage() {
  return (
    <AuthGate>
      <PeopleSkeleton />
    </AuthGate>
  );
}
