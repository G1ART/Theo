"use client";

/**
 * AuthShell — Signup v2 primitive (Phase 1, 2026-08-19; login
 * pixel-fidelity pass 2026-08-20).
 *
 * Shared frame for /signup, /login (v2), password reset, and other
 * "brand-facing" surfaces. Single centered narrow column.
 *
 * ## Brand placement (2026-08-20 login wireframe)
 *
 *   - `"header"` — small mark in a top bar (legacy). Unused by the
 *     current login/signup frames.
 *   - `"hero"` — logo + quiet tagline above the form (login). The
 *     page column is centered on the viewport, but logo, catchphrase,
 *     and fields share a **left** edge — same as signup "Step N".
 *     Do not `text-center` the hero copy.
 *   - `"none"` — no mark. Signup steps open on a huge "Step N" title
 *     with no logo (designer frames).
 *
 * ## Title tone
 *
 *   - `"display"` — 4xl/5xl light (signup "Step N").
 *   - `"quiet"` — small body copy (login taglines).
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { TheoLogo } from "@/components/brand/TheoLogo";
import { useT } from "@/lib/i18n/useT";

export type AuthShellContentWidth = "xs" | "sm" | "md" | "lg";
export type AuthShellBrandPlacement = "header" | "hero" | "none";
export type AuthShellTitleTone = "display" | "quiet";

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
  /** Home link href for the brand mark. Defaults to `/`. */
  homeHref?: string;
  /** Central column width. Login uses `"xs"` (wireframe ~344px).
   *  Signup v2: Steps 1–3 stay `"sm"` (max-w-md), Step 4 `"lg"`. */
  contentWidth?: AuthShellContentWidth;
  /** Where the Theo mark lives. See file header. Default `"header"`. */
  brandPlacement?: AuthShellBrandPlacement;
  /** Visual weight of `title`. Default `"display"`. */
  titleTone?: AuthShellTitleTone;
  /** Tiny EN/KO control in the top-right. Login/signup hide the
   *  global Header, so this is the only locale affordance on those
   *  surfaces. */
  showLocale?: boolean;
};

const CONTENT_WIDTH_CLASS: Record<AuthShellContentWidth, string> = {
  xs: "max-w-[21.5rem]",
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

function LocaleChip() {
  const { locale, setLocale } = useT();
  return (
    <div className="absolute right-4 top-4 z-10 flex items-center gap-1 text-xs text-zinc-400 sm:right-8 sm:top-6">
      <button
        type="button"
        onClick={() => setLocale("en")}
        className={
          locale === "en"
            ? "font-medium text-zinc-800"
            : "hover:text-zinc-700"
        }
      >
        EN
      </button>
      <span>/</span>
      <button
        type="button"
        onClick={() => setLocale("ko")}
        className={
          locale === "ko"
            ? "font-medium text-zinc-800"
            : "hover:text-zinc-700"
        }
      >
        KO
      </button>
    </div>
  );
}

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
    contentWidth = "sm",
    brandPlacement = "header",
    titleTone = "display",
    showLocale = false,
  } = props;
  const widthClass = CONTENT_WIDTH_CLASS[contentWidth];
  const isHero = brandPlacement === "hero";
  const showHeaderBar = brandPlacement === "header" || !!onBack;

  const titleClass =
    titleTone === "quiet"
      ? "text-[13px] font-normal leading-[1.7] text-zinc-600"
      : "mt-3 text-4xl font-light tracking-tight text-zinc-900 sm:text-5xl";
  const subtitleClass =
    titleTone === "quiet"
      ? "mt-5 whitespace-pre-line text-[13px] leading-relaxed text-zinc-600"
      : "mt-3 whitespace-pre-line text-sm leading-relaxed text-zinc-600";

  const mark = logo ?? (
    <TheoLogo
      size={isHero ? "md" : "sm"}
      className={isHero ? "h-24" : "h-8"}
      priority={isHero}
    />
  );

  return (
    <div className="relative min-h-screen bg-white text-zinc-900">
      {showLocale && <LocaleChip />}

      {showHeaderBar && (
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
          {brandPlacement === "header" ? (
            <Link
              href={homeHref}
              aria-label="Theo"
              className="inline-flex items-center"
            >
              {mark}
            </Link>
          ) : (
            <span aria-hidden className="inline-block h-9 w-9" />
          )}
          <span aria-hidden className="inline-block h-9 w-9" />
        </header>
      )}

      <main
        className={`mx-auto flex w-full flex-col px-6 pb-16 ${widthClass} ${
          isHero
            ? "min-h-screen justify-center py-16"
            : "justify-center pt-16 sm:pt-24"
        }`}
      >
        {isHero && (
          <Link
            href={homeHref}
            aria-label="Theo"
            className="mb-5 inline-flex"
          >
            {mark}
          </Link>
        )}

        {(eyebrow || title || subtitle) && (
          <div className="mb-8">
            {eyebrow && (
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-500">
                {eyebrow}
              </p>
            )}
            {title && <h1 className={titleClass}>{title}</h1>}
            {subtitle && <p className={subtitleClass}>{subtitle}</p>}
          </div>
        )}

        {children}

        {footer && (
          <div className="mt-8 text-center text-[10px] leading-relaxed text-zinc-400">
            {footer}
          </div>
        )}

        {alternate && (
          <div className="mt-10 text-center text-sm text-zinc-500">
            {alternate}
          </div>
        )}
      </main>
    </div>
  );
}
