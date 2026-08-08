"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/useT";
import {
  loginUrlWithNext,
  onboardingUrlWithNext,
} from "@/lib/identity/routing";

/**
 * Reusable inline auth gate (feed-first cold front door, 2026-08-07).
 *
 * The platform's landing experience is public browsing — anonymous
 * visitors can enter the feed, open an artwork, and view a public
 * profile. Deeper / owner-consented surfaces (Statement, CV, price,
 * inquiry, follow, personalized "For you") instead render this compact
 * "Join now to explore more" card, matching the wireframe's Statement
 * gate. Sign-up is primary (cold-visitor convention is onboarding-first),
 * with a secondary "Log in" link for returning members.
 *
 * URLs always flow through the identity routing helpers so `next`
 * round-trips through `safeNextPath` (no open redirect) and the user
 * returns to where they were after auth.
 */
type Props = {
  /** Optional heading override. Defaults to `authGate.title`. */
  title?: string;
  /** Optional body override. Defaults to `authGate.description`. */
  description?: string;
  /** Where to return the user after auth (run through `safeNextPath`). */
  nextPath?: string | null;
  /**
   * Visual treatment:
   *   - `card`    (default) — bordered standalone card, used in place of
   *     a whole gated section (e.g. artist Statement/CV).
   *   - `inline`  — lighter, tucked inside an existing block.
   *   - `overlay` — centered treatment for image/hero overlays.
   */
  variant?: "card" | "inline" | "overlay";
  className?: string;
};

export function InlineAuthGate({
  title,
  description,
  nextPath = null,
  variant = "card",
  className = "",
}: Props) {
  const { t } = useT();

  const heading = title ?? t("authGate.title");
  const body = description ?? t("authGate.description");
  const onboardingHref = onboardingUrlWithNext({ nextPath });
  const loginHref = loginUrlWithNext({ nextPath });

  const containerClass =
    variant === "card"
      ? "rounded-2xl border border-zinc-200 bg-white p-6 text-center"
      : variant === "overlay"
        ? "rounded-2xl border border-zinc-200 bg-white/90 p-6 text-center shadow-sm backdrop-blur"
        : "rounded-xl bg-zinc-50/70 p-4 text-center";

  return (
    <div className={`${containerClass} ${className}`.trim()}>
      <p className="text-sm font-semibold text-zinc-900">{heading}</p>
      {body && (
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-zinc-600">
          {body}
        </p>
      )}
      <div className="mt-4 flex flex-col items-center justify-center gap-2 sm:flex-row">
        <Link
          href={onboardingHref}
          className="inline-flex w-full items-center justify-center rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 sm:w-auto"
        >
          {t("authGate.primaryCta")}
        </Link>
        <Link
          href={loginHref}
          className="inline-flex w-full items-center justify-center rounded-full border border-zinc-300 bg-white px-5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 sm:w-auto"
        >
          {t("authGate.secondaryCta")}
        </Link>
      </div>
    </div>
  );
}
