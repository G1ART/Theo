/** Select every draft in the list. If they are all selected already, clear. */
export function nextBulkSelection(
  draftIds: readonly string[],
  selected: ReadonlySet<string>,
): Set<string> {
  if (draftIds.length > 0 && draftIds.every((id) => selected.has(id))) {
    return new Set();
  }
  return new Set(draftIds);
}
