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

function mediumParts(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * What the upload form is showing.
 *
 * `primaryText` is the open medium box for the current language.
 * `altText` is the other language box.
 * `chips` are terms already added with + for the current language.
 * Typing in either box is enough. The current language does not have to
 * become a chip first, and the other language must not replace it.
 */
export function mediumFieldsFromBoxes(input: {
  locale: "ko" | "en";
  primaryText: string;
  altText: string;
  chips?: string[];
}): { mediumKo: string; mediumEn: string } {
  const parts = (input.chips ?? []).flatMap((chip) => mediumParts(chip));
  const pending = input.primaryText.trim();
  if (pending && !parts.some((part) => part.toLowerCase() === pending.toLowerCase())) {
    parts.push(pending);
  }
  const joined = parts.join(", ");
  const alt = input.altText.trim();
  if (input.locale === "ko") return { mediumKo: joined, mediumEn: alt };
  return { mediumKo: alt, mediumEn: joined };
}

/** @deprecated Use mediumFieldsFromBoxes. Kept so chip drafts still merge. */
export function withPendingLocaleMedium(input: {
  locale: "ko" | "en";
  mediumKo: string;
  mediumEn: string;
  pending?: string | null;
}): { mediumKo: string; mediumEn: string } {
  const localeKey = input.locale === "ko" ? "ko" : "en";
  return mediumFieldsFromBoxes({
    locale: localeKey,
    primaryText: input.pending ?? "",
    altText: localeKey === "ko" ? input.mediumEn : input.mediumKo,
    chips: mediumParts(localeKey === "ko" ? input.mediumKo : input.mediumEn),
  });
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
