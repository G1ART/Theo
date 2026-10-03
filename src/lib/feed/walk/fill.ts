/**
 * A reason slot with real copy. Empty and the exhibition placeholder
 * "title" / "Title" are not names, so they must not be concatenated
 * into "People in title." or "Now on view: title."
 */
const PLACEHOLDER_SLOT = /^(title)$/i;

export function isFilledSlot(value: string | null | undefined): boolean {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 && !PLACEHOLDER_SLOT.test(trimmed);
}

/**
 * Replace `{name}` slots. Unknown keys are left in place.
 * A provided slot that is empty or the placeholder "title" blocks the
 * whole sentence so the word "title" is never concatenated.
 */
export function fillTemplate(template: string, params: Record<string, string>): string {
  let blocked = false;
  const filled = template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, key)) return whole;
    const value = params[key];
    if (!isFilledSlot(value)) {
      blocked = true;
      return "";
    }
    return value.trim();
  });
  return blocked ? "" : filled;
}
