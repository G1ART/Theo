import { pickLegacyForSave } from "@/lib/i18n/pickLocalized";

function clean(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export type RegistrationBilingualInput = {
  titleKo: string;
  titleEn: string;
  mediumKo: string;
  mediumEn: string;
  storyKo: string;
  storyEn: string;
  title?: string;
  medium?: string;
  story?: string;
};

/**
 * First registration writes both languages when the artist filled them.
 * The other language is never cleared just because the UI locale shows one.
 * Legacy columns stay KO-first so older readers still have a title.
 */
/**
 * The medium box on first registration is a chip search. Text left in
 * that box is the current language and must be stored with the other
 * language, not dropped because the artist did not press +.
 */
export function withPendingLocaleMedium(input: {
  locale: "ko" | "en";
  mediumKo: string;
  mediumEn: string;
  pending?: string | null;
}): { mediumKo: string; mediumEn: string } {
  const mediumKo = input.mediumKo ?? "";
  const mediumEn = input.mediumEn ?? "";
  const pending = input.pending?.trim() ?? "";
  if (!pending) return { mediumKo, mediumEn };
  const primary = input.locale === "ko" ? mediumKo : mediumEn;
  const parts = primary
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.some((part) => part.toLowerCase() === pending.toLowerCase())) {
    parts.push(pending);
  }
  const joined = parts.join(", ");
  if (input.locale === "ko") return { mediumKo: joined, mediumEn };
  return { mediumKo, mediumEn: joined };
}

export function registrationBilingualFields(input: RegistrationBilingualInput) {
  const titleKo = clean(input.titleKo);
  const titleEn = clean(input.titleEn);
  const mediumKo = clean(input.mediumKo);
  const mediumEn = clean(input.mediumEn);
  const storyKo = clean(input.storyKo);
  const storyEn = clean(input.storyEn);
  const storyLegacy = pickLegacyForSave(storyKo, storyEn) ?? (clean(input.story) || null);
  return {
    title: pickLegacyForSave(titleKo, titleEn) ?? clean(input.title),
    title_ko: titleKo || null,
    title_en: titleEn || null,
    medium: pickLegacyForSave(mediumKo, mediumEn) ?? clean(input.medium),
    medium_ko: mediumKo || null,
    medium_en: mediumEn || null,
    story: storyLegacy,
    story_ko: storyKo || null,
    story_en: storyEn || null,
  };
}
