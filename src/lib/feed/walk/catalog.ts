/** Main feed. Goods and collected works stay off this walk. */
export const MAIN_FEED_WORK_KINDS = ["artwork", "print_edition"] as const;

export const CATALOG_WANT = 24;
export const CATALOG_BATCH = 80;

/**
 * Walk public works in sort order, skipping ids already shown.
 * `open` means a later batch can still hold an unseen work.
 */
export function catalogPageFromBatches<T extends { id: string }>(
  batches: readonly (readonly T[])[],
  used: ReadonlySet<string>,
  want: number,
  batchSize: number
): { rows: T[]; open: boolean } {
  const rows: T[] = [];
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b] ?? [];
    if (batch.length === 0) return { rows, open: false };
    for (let i = 0; i < batch.length; i++) {
      const row = batch[i];
      if (!row?.id || used.has(row.id)) continue;
      rows.push(row);
      if (rows.length >= want) {
        const moreInBatch = batch.slice(i + 1).some((item) => item.id && !used.has(item.id));
        const batchContinues = batch.length >= batchSize;
        return { rows, open: moreInBatch || batchContinues };
      }
    }
    if (batch.length < batchSize) return { rows, open: false };
  }
  const last = batches[batches.length - 1];
  return { rows, open: !!last && last.length >= batchSize };
}
