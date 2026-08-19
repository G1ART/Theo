/**
 * `/legal/terms` — placeholder page (Signup v2 Phase 1, 2026-08-19).
 *
 * Signup v2's passive-consent footer under Step 2 links here so the
 * user always has a target for the "이용약관" link. Real legal copy
 * ships in Phase 4 (spec §11.7); this placeholder exists only to
 * prevent 404s on the front door. Kept as a server component with no
 * data reads so it stays fast and cacheable.
 */

import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service · Theo",
};

export default function LegalTermsPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-6 py-16">
      <Link
        href="/"
        className="text-xs uppercase tracking-[0.22em] text-zinc-500 hover:text-zinc-800"
      >
        ← Theo
      </Link>
      <h1 className="mt-10 text-3xl font-light tracking-tight text-zinc-900">
        Terms of Service
      </h1>
      <p className="mt-2 text-sm text-zinc-500">이용약관 (Preview)</p>

      <section className="mt-8 space-y-4 text-sm leading-relaxed text-zinc-700">
        <p>
          약관 준비 중입니다. 조만간 업데이트할 예정이에요.
        </p>
        <p className="text-zinc-500">
          Terms coming soon. This page is a placeholder while our legal team
          finalizes the language for the Theo platform. Signing up before
          Phase 4 ships still records your passive consent (per the current
          Theo TOS defaults). If you have questions, please reach out to
          the team.
        </p>
      </section>
    </main>
  );
}
