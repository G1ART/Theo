/**
 * Exhibition "Exhibited by / Curated by" label logic.
 * Single source of truth for host/curator display across cards, detail pages, artwork pages.
 */

import type { ExhibitionRow } from "@/lib/supabase/exhibitions";
import type { Locale } from "@/lib/i18n/locale";
import { pickLocalizedDisplayName, pickLocalizedHostName } from "@/lib/i18n/pickLocalized";
import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import type { MessageKey } from "@/lib/i18n/messages";

/** Joined profile subset used for curator/host credits — accepts optional
 *  KO/EN slots so callers that already SELECT the bilingual columns can
 *  render locale-aware credit lines without extra look-ups. */
type CreditProfile = {
  display_name?: string | null;
  display_name_ko?: string | null;
  display_name_en?: string | null;
  username?: string | null;
};

export type ExhibitionWithCredits = ExhibitionRow & {
  curator?: CreditProfile | null;
  host?: CreditProfile | null;
  /**
   * Optional count of works linked via `exhibition_works`. Populated by
   * listMyExhibitions so callers can render "임시 저장 / 예정" badges without
   * an N+1 fetch per row. `null` means "not fetched" (do not conflate with 0).
   */
  works_count?: number | null;
};

function displayName(
  profile: CreditProfile | null | undefined,
  locale: Locale = "ko",
): string {
  if (!profile) return "—";
  // QA 2026-07-28 — prefer the locale-picked bilingual name; fall back to
  // legacy display_name (kept fresh by the 240004 trigger).
  const localized = pickLocalizedDisplayName(profile, locale).trim();
  if (localized) return localized;
  const name = profile.display_name?.trim();
  return name || profile.username || "—";
}

/**
 * Returns the single line label for "Exhibited by / Curated by" for an exhibition.
 * - When curator_id === host_profile_id (both set): "Exhibited & Curated by [Name]"
 * - When only host (no curator display needed for host): "Exhibited by [Host]"
 * - When only curator (no host): "Curated by [Curator]"
 * - When both and different (or host_name only, no host_profile_id): "Exhibited by [Host] · Curated by [Curator]"
 * @param exhibition Row with optional curator/host profile (from join). host_name used when host_profile_id is null.
 * @param t i18n function (key) => string. Keys: exhibition.exhibitedAndCuratedBy, exhibitedBy, curatedBy, creditsSeparator
 * @param locale Optional UI locale for the bilingual name/host picker
 *               (defaults to "ko" for back-compat with existing callers).
 *               QA 2026-07-28 — callers with a live `useT()` locale in
 *               scope should pass it so KO / EN UIs render the author-
 *               owned localized name instead of the legacy fallback.
 */
export function getExhibitionHostCuratorLabel(
  exhibition: ExhibitionWithCredits,
  t: (key: string) => string,
  locale: Locale = "ko"
): string {
  const { curator_id, host_profile_id, host_name } = exhibition;
  const samePerson =
    curator_id != null && host_profile_id != null && curator_id === host_profile_id;
  const curatorLabel = displayName(exhibition.curator ?? null, locale);
  const hasHostProfile = host_profile_id != null && host_profile_id !== "";
  const hostLabelFromProfile = hasHostProfile
    ? displayName(exhibition.host ?? null, locale)
    : null;
  // QA 2026-07-28 — bilingual host_name has priority over the legacy column;
  // pickLocalizedHostName falls through to `host_name` when either KO/EN
  // slot is empty, matching the trigger sync semantics.
  const hostLabelFromName = pickLocalizedHostName(exhibition, locale) || host_name?.trim() || null;
  const hostLabel = hostLabelFromProfile ?? hostLabelFromName ?? null;
  const hasHost = hostLabel != null;

  if (samePerson) {
    const name = curatorLabel !== "—" ? curatorLabel : displayName(exhibition.host ?? null, locale);
    return t("exhibition.exhibitedAndCuratedBy").replace("{name}", name);
  }
  if (hasHost && curator_id) {
    const sep = t("exhibition.creditsSeparator");
    return (
      t("exhibition.exhibitedBy").replace("{name}", hostLabel) +
      sep +
      t("exhibition.curatedBy").replace("{name}", curatorLabel)
    );
  }
  if (hasHost) {
    return t("exhibition.exhibitedBy").replace("{name}", hostLabel);
  }
  return t("exhibition.curatedBy").replace("{name}", curatorLabel);
}

/**
 * QA 2026-07-29 — clickable "Exhibited by / Curated by" credit line.
 *
 * Same branching logic as `getExhibitionHostCuratorLabel` above (kept as
 * the single source of truth for the *plain-text* variant — memory strip,
 * feed cards, SEO snippets, etc.), but each entity's name renders as a
 * `<Link href="/u/{username}">` when the entity has a public username
 * (i.e. is onboarded), and a plain `<span>` otherwise (host_name-only
 * credits, or a profile with no linkable username).
 */
function NameNode({
  name,
  username,
}: {
  name: string;
  username: string | null;
}): ReactElement {
  if (username) {
    return (
      <Link href={`/u/${username}`} className="font-medium text-zinc-900 hover:underline">
        {name}
      </Link>
    );
  }
  return <span className="font-medium text-zinc-900">{name}</span>;
}

/** Splits a `t()` template containing exactly one `{name}` placeholder and
 *  swaps it for a React node (the linked/plain name), preserving the
 *  surrounding localized copy verbatim. */
function renderNameTemplate(template: string, node: ReactNode): ReactNode {
  const idx = template.indexOf("{name}");
  if (idx === -1) return template;
  const before = template.slice(0, idx);
  const after = template.slice(idx + "{name}".length);
  return (
    <>
      {before}
      {node}
      {after}
    </>
  );
}

export function ExhibitionHostCuratorCredits({
  exhibition,
  t,
  locale = "ko",
  className,
}: {
  exhibition: ExhibitionWithCredits;
  t: (key: MessageKey) => string;
  locale?: Locale;
  className?: string;
}): ReactElement {
  const { curator_id, host_profile_id, host_name } = exhibition;
  const samePerson =
    curator_id != null && host_profile_id != null && curator_id === host_profile_id;
  const curatorLabel = displayName(exhibition.curator ?? null, locale);
  const curatorUsername = exhibition.curator?.username?.trim() || null;
  const hasHostProfile = host_profile_id != null && host_profile_id !== "";
  const hostLabelFromProfile = hasHostProfile
    ? displayName(exhibition.host ?? null, locale)
    : null;
  const hostUsername = hasHostProfile ? exhibition.host?.username?.trim() || null : null;
  const hostLabelFromName = pickLocalizedHostName(exhibition, locale) || host_name?.trim() || null;
  const hostLabel = hostLabelFromProfile ?? hostLabelFromName ?? null;
  const hasHost = hostLabel != null;

  if (samePerson) {
    const name = curatorLabel !== "—" ? curatorLabel : displayName(exhibition.host ?? null, locale);
    const username = curatorUsername ?? hostUsername ?? null;
    return (
      <span className={className}>
        {renderNameTemplate(t("exhibition.exhibitedAndCuratedBy"), (
          <NameNode name={name} username={username} />
        ))}
      </span>
    );
  }
  if (hasHost && curator_id) {
    const sep = t("exhibition.creditsSeparator");
    return (
      <span className={className}>
        {renderNameTemplate(t("exhibition.exhibitedBy"), (
          <NameNode name={hostLabel as string} username={hostUsername} />
        ))}
        {sep}
        {renderNameTemplate(t("exhibition.curatedBy"), (
          <NameNode name={curatorLabel} username={curatorUsername} />
        ))}
      </span>
    );
  }
  if (hasHost) {
    return (
      <span className={className}>
        {renderNameTemplate(t("exhibition.exhibitedBy"), (
          <NameNode name={hostLabel as string} username={hostUsername} />
        ))}
      </span>
    );
  }
  return (
    <span className={className}>
      {renderNameTemplate(t("exhibition.curatedBy"), (
        <NameNode name={curatorLabel} username={curatorUsername} />
      ))}
    </span>
  );
}
