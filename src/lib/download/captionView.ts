import type { Locale } from "@/lib/i18n/locale";
import {
  pickLocalizedArtworkTitle,
  pickLocalizedDisplayName,
  pickLocalizedMedium,
} from "@/lib/i18n/pickLocalized";
import { formatUsername } from "@/lib/identity/format";
import { isRoleKey, roleLabel } from "@/lib/identity/roles";
import { formatSizeForLocale, type SizeUnitPref } from "@/lib/size/format";
import { buildCaption, type CaptionModel } from "./caption";
import type { DownloadArtworkPayload } from "./types";

export function captionForArtwork(
  row: DownloadArtworkPayload,
  locale: Locale,
  t: (key: string) => string,
  sizePref: SizeUnitPref | null,
): CaptionModel {
  const title = pickLocalizedArtworkTitle(
    { title: row.title, title_ko: row.titleKo, title_en: row.titleEn },
    locale,
  );
  const medium = pickLocalizedMedium(
    { medium: row.medium, medium_ko: row.mediumKo, medium_en: row.mediumEn },
    locale,
  );
  const artistName = pickLocalizedDisplayName(
    {
      display_name: row.artistName,
      display_name_ko: row.artistNameKo,
      display_name_en: row.artistNameEn,
    },
    locale,
  );
  return buildCaption({
    title,
    year: row.year != null ? String(row.year) : null,
    medium,
    size: formatSizeForLocale(row.size, locale, row.sizeUnit, sizePref),
    artistName,
    handle: formatUsername({ username: row.username }),
    role: isRoleKey(row.role) ? roleLabel(row.role, t) : null,
  });
}

export function joinStoredText(parts: Array<string | null | undefined>): string | null {
  const lines = parts.map((part) => (part ?? "").trim()).filter((part) => part.length > 0);
  return lines.length > 0 ? lines.join("\n\n") : null;
}
