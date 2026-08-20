"use client";

/**
 * AuthShell — Signup v2 primitive (Phase 1, 2026-08-19).
 *
 * Shared frame for /signup, /login (v2), password reset, and other
 * "brand-facing" surfaces (Option C hybrid, spec §4.2). Single centered
 * narrow column, huge top padding, thin visual language. Slots:
 *
 *   - `logo`          — brand mark (defaults to `<TheoLogo/>` sm).
 *   - `back`          — optional back arrow (auto-renders when `onBack`).
 *   - `eyebrow`       — small uppercase label above the title
 *                       ("Step 1 / 3").
 *   - `title`         — large H1.
 *   - `subtitle`      — supporting body copy.
 *   - `children`      — form area.
 *   - `footer`        — passive-consent copy, ToS link block, etc.
 *   - `alternate`     — bottom row for the alternate CTA
 *                       ("이미 계정이 있으신가요? 로그인").
 *
 * Example:
 *   <AuthShell
 *     onBack={() => router.back()}
 *     eyebrow="Step 1 of 3"
 *     title="Enter your email"
 *     subtitle="계정을 만들 이메일 주소를 입력해 주세요."
 *     alternate={<Link href="/login">이미 계정이 있으신가요? 로그인</Link>}
 *   >
 *     <OvalInput label="Email" ... />
 *   </AuthShell>
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { TheoLogo } from "@/components/brand/TheoLogo";

export type AuthShellProps = {
  logo?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  eyebrow?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  alternate?: ReactNode;
  /** Home link href for the top-left brand mark. Defaults to `/`. */
  homeHref?: string;
};

export function AuthShell(props: AuthShellProps) {
  const {
    logo,
    onBack,
    backLabel = "Back",
    eyebrow,
    title,
    subtitle,
    children,
    footer,
    alternate,
    homeHref = "/",
  } = props;

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <header className="flex items-center justify-between px-4 pt-4 sm:px-8 sm:pt-6">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={backLabel}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            >
              <span aria-hidden className="text-lg leading-none">
                ←
              </span>
            </button>
          )}
        </div>
        <Link
          href={homeHref}
          aria-label="Theo"
          className="inline-flex items-center"
        >
          {logo ?? <TheoLogo size="sm" className="h-8" />}
        </Link>
        <span aria-hidden className="inline-block h-9 w-9" />
      </header>

      <main className="mx-auto flex w-full max-w-md flex-col justify-center px-6 pb-16 pt-16 sm:pt-24">
        {(eyebrow || title || subtitle) && (
          <div className="mb-8">
            {eyebrow && (
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-500">
                {eyebrow}
              </p>
            )}
            {title && (
              <h1 className="mt-3 text-4xl font-light tracking-tight text-zinc-900 sm:text-5xl">
                {title}
              </h1>
            )}
            {subtitle && (
              <p className="mt-4 text-base leading-relaxed text-zinc-600">
                {subtitle}
              </p>
            )}
          </div>
        )}

        {children}

        {footer && <div className="mt-8 text-xs text-zinc-500">{footer}</div>}

        {alternate && (
          <div className="mt-10 text-center text-sm text-zinc-500">
            {alternate}
          </div>
        )}
      </main>
    </div>
  );
}
