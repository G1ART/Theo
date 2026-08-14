"use client";

/**
 * Profile Surface Cards — Artist Statement + CV.
 *
 * Public profile audit (Salon v2 P5): the previous full-section card for
 * Artist Statement was pushing the artworks tab off the first viewport
 * whenever the statement ran long or carried a hero image. We replaced it
 * with two compact, eye-catching trigger buttons placed where the section
 * card used to live; clicking either one opens an in-page modal so the
 * artworks grid never moves.
 *
 *   Visitor view : show only the buttons that have content.
 *   Owner view   : always show both buttons; modals carry an empty state
 *                  + CTA to /settings#statement or /my/profile/cv.
 *
 * Persona gating happens in the parent (UserProfileContent) — both
 * surfaces stay artist-only, matching the statement gating that already
 * lived in `ArtistStatementSection`.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useT } from "@/lib/i18n/useT";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import type { CvEntry } from "@/lib/supabase/profiles";
import { getProfileCvPdfUrl } from "@/lib/supabase/storage";

type Props = {
  statement: string | null | undefined;
  heroImagePath: string | null | undefined;
  education: CvEntry[] | null | undefined;
  exhibitionsCv: CvEntry[] | null | undefined;
  awards: CvEntry[] | null | undefined;
  residencies: CvEntry[] | null | undefined;
  // QA 2026-06-26 (#6): optional CV PDF download path (artworks bucket).
  cvPdfPath?: string | null | undefined;
  isOwner: boolean;
  ownerStatementHref?: string;
  ownerCvHref?: string;
};

type ModalKind = "statement" | "cv" | null;

function resolveHero(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return getArtworkImageUrl(path, "medium");
}

export function ProfileSurfaceCards({
  statement,
  heroImagePath,
  education,
  exhibitionsCv,
  awards,
  residencies,
  cvPdfPath,
  isOwner,
  ownerStatementHref = "/settings#statement",
  ownerCvHref = "/my/profile/cv",
}: Props) {
  const { t } = useT();
  const [open, setOpen] = useState<ModalKind>(null);

  const trimmedStatement = (statement ?? "").trim();
  const hasStatement = trimmedStatement.length > 0;

  const cvSections = useMemo(
    () => [
      { key: "education" as const, label: t("profile.cv.education"), entries: education ?? [] },
      { key: "exhibitions" as const, label: t("profile.cv.exhibitions"), entries: exhibitionsCv ?? [] },
      { key: "awards" as const, label: t("profile.cv.awards"), entries: awards ?? [] },
      { key: "residencies" as const, label: t("profile.cv.residencies"), entries: residencies ?? [] },
    ],
    [t, education, exhibitionsCv, awards, residencies],
  );

  const hasCv = cvSections.some((s) => s.entries.length > 0);
  // QA 2026-06-26 (#6): the CV PDF download counts as CV content too,
  // so the visitor-side surface stays visible when the artist only
  // uploaded a PDF without filling in the structured editor.
  const cvPdfUrl = getProfileCvPdfUrl(cvPdfPath ?? null);
  const hasCvAny = hasCv || !!cvPdfUrl;

  // Visitor with both surfaces empty → render nothing.
  if (!isOwner && !hasStatement && !hasCvAny) return null;

  const showStatementButton = isOwner || hasStatement;
  const showCvButton = isOwner || hasCvAny;

  return (
    <section className="mb-6">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {showStatementButton && (
          <SurfaceCardButton
            label={
              hasStatement || !isOwner
                ? t("profile.surface.statementButton")
                : t("profile.surface.statementOwnerEmptyButton")
            }
            hint={t("profile.surface.statementHint")}
            icon={<StatementIcon />}
            empty={isOwner && !hasStatement}
            onClick={() => setOpen("statement")}
          />
        )}
        {showCvButton && (
          <SurfaceCardButton
            label={
              hasCvAny || !isOwner
                ? t("profile.surface.cvButton")
                : t("profile.surface.cvOwnerEmptyButton")
            }
            hint={t("profile.surface.cvHint")}
            icon={<CvIcon />}
            empty={isOwner && !hasCvAny}
            onClick={() => setOpen("cv")}
          />
        )}
      </div>

      <SurfaceModal
        open={open === "statement"}
        title={t("profile.statement.title")}
        onClose={() => setOpen(null)}
      >
        <StatementBody
          statement={trimmedStatement}
          heroImagePath={heroImagePath ?? null}
          isOwner={isOwner}
          ownerEditHref={ownerStatementHref}
        />
      </SurfaceModal>

      <SurfaceModal open={open === "cv"} title={t("profile.cv.title")} onClose={() => setOpen(null)}>
        <CvBody
          sections={cvSections}
          isOwner={isOwner}
          hasAny={hasCvAny}
          ownerEditHref={ownerCvHref}
          cvPdfUrl={cvPdfUrl}
        />
      </SurfaceModal>
    </section>
  );
}

/* --------------------------------- Buttons -------------------------------- */

type SurfaceCardButtonProps = {
  label: string;
  hint: string;
  icon: ReactNode;
  empty: boolean;
  onClick: () => void;
};

function SurfaceCardButton({ label, hint, icon, empty, onClick }: SurfaceCardButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center gap-3 rounded-2xl border bg-white px-4 py-3.5 text-left transition hover:bg-zinc-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 sm:px-5 sm:py-4 ${
        empty ? "border-dashed border-zinc-300" : "border-zinc-200 hover:border-zinc-300"
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          empty ? "bg-zinc-50 text-zinc-500" : "bg-zinc-900 text-white"
        }`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-zinc-900">{label}</span>
        <span className="mt-0.5 block truncate text-xs text-zinc-500">{hint}</span>
      </span>
      <span
        aria-hidden="true"
        className="text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-zinc-700"
      >
        <ChevronRightIcon />
      </span>
    </button>
  );
}

function StatementIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h12" />
      <path d="M3 12h12" />
      <path d="M3 17h8" />
      <path d="M19 5v14" />
    </svg>
  );
}

function CvIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 10h8" />
      <path d="M8 14h5" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

/* ---------------------------------- Modal --------------------------------- */

type SurfaceModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

function SurfaceModal({ open, title, onClose, children }: SurfaceModalProps) {
  const { t } = useT();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const lastActive = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    lastActive.current = typeof document !== "undefined" ? document.activeElement : null;
    const prevOverflow = typeof document !== "undefined" ? document.body.style.overflow : "";
    if (typeof document !== "undefined") {
      document.body.style.overflow = "hidden";
    }
    const raf =
      typeof window !== "undefined"
        ? window.requestAnimationFrame(() => {
            closeRef.current?.focus();
          })
        : 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", onKey, true);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.cancelAnimationFrame(raf);
        window.removeEventListener("keydown", onKey, true);
      }
      if (typeof document !== "undefined") {
        document.body.style.overflow = prevOverflow;
      }
      const el = lastActive.current as HTMLElement | null;
      if (el && typeof el.focus === "function") {
        try {
          el.focus();
        } catch {
          /* best-effort */
        }
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8 sm:items-center sm:py-12"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-2xl rounded-3xl bg-white shadow-xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-zinc-100 px-6 py-4 sm:px-8">
          <h2 id={titleId} className="text-base font-semibold text-zinc-900">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("profile.surface.modalClose")}
            className="-mr-2 inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
          >
            <CloseIcon />
          </button>
        </header>
        <div className="max-h-[calc(100vh-12rem)] overflow-y-auto px-6 py-6 sm:px-8 sm:py-8">
          {children}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Modal bodies ------------------------------ */

type StatementBodyProps = {
  statement: string;
  heroImagePath: string | null;
  isOwner: boolean;
  ownerEditHref: string;
};

function StatementBody({ statement, heroImagePath, isOwner, ownerEditHref }: StatementBodyProps) {
  const { t } = useT();
  const hasStatement = statement.length > 0;

  if (!hasStatement) {
    return (
      <div>
        <p className="text-sm leading-relaxed text-zinc-700">{t("profile.statement.ownerPrompt")}</p>
        {isOwner && (
          <Link
            href={ownerEditHref}
            className="mt-5 inline-flex items-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            {t("profile.statement.ownerCta")}
          </Link>
        )}
      </div>
    );
  }

  return (
    <div>
      {heroImagePath && (
        <div className="relative mb-5 aspect-[16/9] w-full overflow-hidden rounded-2xl bg-zinc-100">
          <Image
            src={resolveHero(heroImagePath)}
            alt={t("profile.statement.heroAlt")}
            fill
            sizes="(max-width: 768px) 100vw, 768px"
            className="object-cover"
          />
        </div>
      )}
      <div className="whitespace-pre-line text-[15px] leading-relaxed text-zinc-800">
        {statement}
      </div>
      {isOwner && (
        <div className="mt-6 border-t border-zinc-100 pt-4">
          <Link
            href={ownerEditHref}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-zinc-300 hover:text-zinc-900"
          >
            {t("profile.statement.ownerCta")}
          </Link>
        </div>
      )}
    </div>
  );
}

type CvSection = {
  key: "education" | "exhibitions" | "awards" | "residencies";
  label: string;
  entries: CvEntry[];
};

type CvBodyProps = {
  sections: CvSection[];
  isOwner: boolean;
  hasAny: boolean;
  ownerEditHref: string;
  cvPdfUrl?: string | null;
};

function CvBody({ sections, isOwner, hasAny, ownerEditHref, cvPdfUrl }: CvBodyProps) {
  const { t } = useT();

  if (!hasAny) {
    return (
      <div>
        <p className="text-sm leading-relaxed text-zinc-700">
          {isOwner ? t("profile.cv.ownerPrompt") : t("profile.cv.empty")}
        </p>
        {isOwner && (
          <Link
            href={ownerEditHref}
            className="mt-5 inline-flex items-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            {t("profile.cv.ownerCta")}
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-7">
      {/* QA 2026-06-26 (#6) — surface the downloadable CV PDF at the
          top of the modal so visitors can grab it without scrolling
          through the structured entries first. */}
      {cvPdfUrl && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50/60 px-4 py-3">
          <span className="text-xs uppercase tracking-wider text-zinc-500">
            {t("cv.pdf.title")}
          </span>
          <a
            href={cvPdfUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-zinc-900 underline-offset-4 hover:underline"
          >
            {t("profile.public.cvPdf")}
          </a>
        </div>
      )}
      {sections
        .filter((s) => s.entries.length > 0)
        .map((s) => (
          <CvSectionBlock key={s.key} kind={s.key} label={s.label} entries={s.entries} />
        ))}
      {isOwner && (
        <div className="border-t border-zinc-100 pt-4">
          <Link
            href={ownerEditHref}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-zinc-300 hover:text-zinc-900"
          >
            {t("profile.cv.ownerCta")}
          </Link>
        </div>
      )}
    </div>
  );
}

function CvSectionBlock({
  kind,
  label,
  entries,
}: {
  kind: CvSection["key"];
  label: string;
  entries: CvEntry[];
}) {
  return (
    <section>
      <h3 className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </h3>
      <ul className="space-y-2.5">
        {entries.map((entry, i) => (
          <CvEntryRow key={i} kind={kind} entry={entry} />
        ))}
      </ul>
    </section>
  );
}

function CvEntryRow({ kind, entry }: { kind: CvSection["key"]; entry: CvEntry }) {
  const { primary, secondary, year } = formatEntry(kind, entry);
  if (!primary && !secondary && !year) return null;
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-zinc-100 pb-2.5 last:border-b-0 last:pb-0">
      <div className="min-w-0">
        {primary && (
          <div className="truncate text-sm font-medium text-zinc-900">{primary}</div>
        )}
        {secondary && (
          <div className="mt-0.5 truncate text-xs text-zinc-600">{secondary}</div>
        )}
      </div>
      {year && <div className="shrink-0 text-xs tabular-nums text-zinc-500">{year}</div>}
    </li>
  );
}

function formatEntry(
  kind: CvSection["key"],
  entry: CvEntry,
): { primary: string | null; secondary: string | null; year: string | null } {
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = entry[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
    return null;
  };
  const year = pick("year", "year_to", "yearTo", "end_year", "endYear", "date", "year_from", "yearFrom");

  if (kind === "education") {
    const school = pick("school", "institution", "name");
    const program = pick("program", "degree", "field", "major");
    const type = pick("type", "level");
    const secondary = [program, type].filter(Boolean).join(" · ") || null;
    return { primary: school, secondary, year };
  }
  if (kind === "exhibitions") {
    const title = pick("title", "name", "show", "exhibition");
    const venue = pick("venue", "gallery", "space", "place", "institution");
    const city = pick("city", "location");
    const secondary = [venue, city].filter(Boolean).join(", ") || null;
    return { primary: title, secondary, year };
  }
  if (kind === "awards") {
    const name = pick("name", "title", "award");
    const org = pick("organization", "issuer", "by", "from");
    return { primary: name, secondary: org, year };
  }
  // residencies
  const name = pick("name", "title", "program", "residency");
  const place = pick("location", "venue", "city", "place");
  return { primary: name, secondary: place, year };
}
