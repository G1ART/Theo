"use client";

/**
 * Sprint C.M / 2026-08-03 — Profile inline Statement + CV cards.
 *
 * The 2026-08-03 wireframe (image "Profile") pulls Statement and CV
 * *into* the page — they used to live inside a modal (see
 * `ProfileSurfaceCards`). Both cards now render as in-page collapsible
 * regions:
 *
 *   • Collapsed → show the card header + a truncated preview (roughly
 *     the first 3-4 lines of the statement, or the counts of each CV
 *     bucket).
 *   • Expanded → full statement / full structured CV entries + CV PDF
 *     download link (when available).
 *
 * Persona gating still happens in the parent (UserProfileContent) — the
 * artist-only rule for both surfaces is unchanged. Owner empty-state
 * CTAs point back to `/settings#statement` and `/settings#cv`, matching
 * the modal-era behavior so bookmarked deep links keep working.
 */

import { useState, type ReactNode } from "react";
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
  cvPdfPath?: string | null | undefined;
  isOwner: boolean;
  ownerStatementHref?: string;
  ownerCvHref?: string;
};

function resolveHero(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return getArtworkImageUrl(path, "medium");
}

export function ProfileInlineCards({
  statement,
  heroImagePath,
  education,
  exhibitionsCv,
  awards,
  residencies,
  cvPdfPath,
  isOwner,
  ownerStatementHref = "/settings#statement",
  ownerCvHref = "/settings#cv",
}: Props) {
  const { t } = useT();

  const trimmedStatement = (statement ?? "").trim();
  const hasStatement = trimmedStatement.length > 0;

  const cvSections: CvSectionData[] = [
    {
      key: "education",
      label: t("profile.cv.education"),
      entries: education ?? [],
    },
    {
      key: "exhibitions",
      label: t("profile.cv.exhibitions"),
      entries: exhibitionsCv ?? [],
    },
    { key: "awards", label: t("profile.cv.awards"), entries: awards ?? [] },
    {
      key: "residencies",
      label: t("profile.cv.residencies"),
      entries: residencies ?? [],
    },
  ];
  const hasStructuredCv = cvSections.some((s) => s.entries.length > 0);
  const cvPdfUrl = getProfileCvPdfUrl(cvPdfPath ?? null);
  const hasCvAny = hasStructuredCv || !!cvPdfUrl;

  // Visitor view with both empty → render nothing (parity with the
  // modal-era ProfileSurfaceCards).
  if (!isOwner && !hasStatement && !hasCvAny) return null;

  return (
    <section className="mb-6 space-y-3">
      <ExpandCard
        title={t("profile.section.statement")}
        empty={!hasStatement}
        placeholder={t("profile.section.statementEmpty")}
        preview={<StatementPreview text={trimmedStatement} />}
      >
        <StatementBody
          statement={trimmedStatement}
          heroImagePath={heroImagePath ?? null}
          isOwner={isOwner}
          ownerEditHref={ownerStatementHref}
        />
      </ExpandCard>

      <ExpandCard
        title={t("profile.section.cv")}
        empty={!hasCvAny}
        placeholder={t("profile.section.cvEmpty")}
        preview={<CvPreview sections={cvSections} pdf={!!cvPdfUrl} />}
      >
        <CvBody
          sections={cvSections}
          isOwner={isOwner}
          hasAny={hasCvAny}
          ownerEditHref={ownerCvHref}
          cvPdfUrl={cvPdfUrl}
        />
      </ExpandCard>
    </section>
  );
}

/* --------------------------- Expandable shell ---------------------------- */

function ExpandCard({
  title,
  preview,
  empty,
  placeholder,
  children,
}: {
  title: string;
  preview: ReactNode;
  empty: boolean;
  placeholder: string;
  children: ReactNode;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
      >
        <span className="text-sm font-semibold text-zinc-900">{title}</span>
        <span className="flex items-center gap-2 text-xs text-zinc-500">
          <span>
            {open
              ? t("profile.section.collapse")
              : t("profile.section.expand")}
          </span>
          <Chevron open={open} />
        </span>
      </button>

      {!open && (
        <div className="border-t border-zinc-100 px-5 py-4 text-sm text-zinc-600">
          {empty ? (
            <p className="text-zinc-400">{placeholder}</p>
          ) : (
            preview
          )}
        </div>
      )}

      {open && (
        <div className="border-t border-zinc-100 px-5 py-5">{children}</div>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

/* ----------------------------- Preview blocks ---------------------------- */

function StatementPreview({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p className="line-clamp-3 whitespace-pre-line leading-relaxed text-zinc-700">
      {text}
    </p>
  );
}

function CvPreview({
  sections,
  pdf,
}: {
  sections: CvSectionData[];
  pdf: boolean;
}) {
  const filled = sections.filter((s) => s.entries.length > 0);
  const total = filled.reduce((sum, s) => sum + s.entries.length, 0);
  if (filled.length === 0 && !pdf) {
    return null;
  }
  return (
    <p className="text-zinc-600">
      {filled.map((s, i) => (
        <span key={s.key}>
          {s.label} <span className="tabular-nums text-zinc-500">{s.entries.length}</span>
          {i < filled.length - 1 && (
            <span aria-hidden className="mx-1.5 text-zinc-300">
              ·
            </span>
          )}
        </span>
      ))}
      {pdf && filled.length > 0 && (
        <span aria-hidden className="mx-1.5 text-zinc-300">
          ·
        </span>
      )}
      {pdf && <span className="uppercase tracking-wide text-zinc-500">PDF</span>}
      {total === 0 && !pdf && null}
    </p>
  );
}

/* ------------------------------ Card bodies ------------------------------ */

function StatementBody({
  statement,
  heroImagePath,
  isOwner,
  ownerEditHref,
}: {
  statement: string;
  heroImagePath: string | null;
  isOwner: boolean;
  ownerEditHref: string;
}) {
  const { t } = useT();
  if (!statement) {
    return (
      <div>
        <p className="text-sm leading-relaxed text-zinc-700">
          {t("profile.statement.ownerPrompt")}
        </p>
        {isOwner && (
          <Link
            href={ownerEditHref}
            className="mt-4 inline-flex items-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
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
        <div className="relative mb-4 aspect-[16/9] w-full overflow-hidden rounded-xl bg-zinc-100">
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
        <div className="mt-5 border-t border-zinc-100 pt-3">
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

type CvSectionData = {
  key: "education" | "exhibitions" | "awards" | "residencies";
  label: string;
  entries: CvEntry[];
};

function CvBody({
  sections,
  isOwner,
  hasAny,
  ownerEditHref,
  cvPdfUrl,
}: {
  sections: CvSectionData[];
  isOwner: boolean;
  hasAny: boolean;
  ownerEditHref: string;
  cvPdfUrl?: string | null;
}) {
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
            className="mt-4 inline-flex items-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            {t("profile.cv.ownerCta")}
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {cvPdfUrl && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50/60 px-4 py-3">
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
        <div className="border-t border-zinc-100 pt-3">
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
  kind: CvSectionData["key"];
  label: string;
  entries: CvEntry[];
}) {
  return (
    <section>
      <h3 className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </h3>
      <ul className="space-y-2">
        {entries.map((entry, i) => (
          <CvEntryRow key={i} kind={kind} entry={entry} />
        ))}
      </ul>
    </section>
  );
}

function CvEntryRow({
  kind,
  entry,
}: {
  kind: CvSectionData["key"];
  entry: CvEntry;
}) {
  const { primary, secondary, year } = formatEntry(kind, entry);
  if (!primary && !secondary && !year) return null;
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-zinc-100 pb-2 last:border-b-0 last:pb-0">
      <div className="min-w-0">
        {primary && (
          <div className="truncate text-sm font-medium text-zinc-900">
            {primary}
          </div>
        )}
        {secondary && (
          <div className="mt-0.5 truncate text-xs text-zinc-600">
            {secondary}
          </div>
        )}
      </div>
      {year && (
        <div className="shrink-0 text-xs tabular-nums text-zinc-500">
          {year}
        </div>
      )}
    </li>
  );
}

function formatEntry(
  kind: CvSectionData["key"],
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
  const year = pick(
    "year",
    "year_to",
    "yearTo",
    "end_year",
    "endYear",
    "date",
    "year_from",
    "yearFrom",
  );
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
  const name = pick("name", "title", "program", "residency");
  const place = pick("location", "venue", "city", "place");
  return { primary: name, secondary: place, year };
}
