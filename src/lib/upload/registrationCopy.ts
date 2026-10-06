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
