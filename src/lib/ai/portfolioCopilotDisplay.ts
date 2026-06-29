/**
 * Client-side cleanup for portfolio copilot model output (defense in depth;
 * prompts also forbid leaking opaque ids into prose).
 */

const UUID_SEGMENT = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const UUID_RE = new RegExp(`\\b${UUID_SEGMENT}\\b`, "g");
const PAREN_ID_RE = /\(\s*[Ii]d\s*:\s*[0-9a-fA-F-]{36}\s*\)/g;
const INLINE_ID_RE = /\b[Ii]d\s*:\s*[0-9a-fA-F-]{36}\b/g;

export function stripOpaqueIdsFromCopilotText(text: string): string {
  let s = text.replace(PAREN_ID_RE, "").replace(INLINE_ID_RE, "").replace(UUID_RE, "");
  s = s.replace(/\(\s*\)/g, "");
  s = s.replace(/\s+,/g, ",").replace(/,\s*,/g, ",");
  s = s.replace(/\s{2,}/g, " ").replace(/\s+\./g, ".").replace(/\(\s+/g, "(").trim();
  return s;
}

/**
 * Prefer localized CTA labels for known Theo deep links; otherwise use
 * a cleaned model label.
 */
export function resolvePortfolioActionLabel(
  href: string,
  modelLabel: string | undefined,
  t: (key: string) => string,
): string {
  if (/\/artwork\/[^/?#]+\/edit(?:$|[?#])/.test(href)) return t("ai.portfolio.action.editArtwork");
  if (href.includes("mode=reorder")) return t("ai.portfolio.action.reorderOnProfile");
  if (/\/my\/exhibitions\//.test(href)) return t("ai.portfolio.action.openStudioExhibitions");
  if (/\/my\/library/.test(href)) return t("ai.portfolio.action.openWorkshop");
  const cleaned = modelLabel ? stripOpaqueIdsFromCopilotText(modelLabel).trim() : "";
  if (cleaned) return cleaned;
  return t("ai.action.apply");
}
