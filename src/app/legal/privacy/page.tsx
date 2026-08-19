/**
 * `/legal/privacy` — placeholder page (Signup v2 Phase 1, 2026-08-19).
 *
 * See `/legal/terms/page.tsx` for the rationale. Real privacy-policy
 * copy ships in Phase 4 (spec §11.7).
 */

import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy · Theo",
};

export default function LegalPrivacyPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-6 py-16">
      <Link
        href="/"
        className="text-xs uppercase tracking-[0.22em] text-zinc-500 hover:text-zinc-800"
      >
        ← Theo
      </Link>
      <h1 className="mt-10 text-3xl font-light tracking-tight text-zinc-900">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-zinc-500">개인정보처리방침 (Preview)</p>

      <section className="mt-8 space-y-4 text-sm leading-relaxed text-zinc-700">
        <p>개인정보처리방침 준비 중입니다. 조만간 업데이트할 예정이에요.</p>
        <p className="text-zinc-500">
          Privacy Policy coming soon. This page is a placeholder while
          our team finalizes the plain-language version of how Theo
          handles data collection, cookies, and account deletion. The
          product-level defaults still apply — please reach out with
          questions.
        </p>
      </section>
    </main>
  );
}
