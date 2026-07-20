/**
 * scripts/backfill-image-adjust.ts
 *
 * One-shot backfill for `artwork_images.display_adjust` on rows that
 * do NOT yet have a value (feed image standardization, 2026-07-20).
 *
 * What it does
 * ------------
 * - Walks `artwork_images` in batches, ordered by `created_at` desc.
 * - For each row without `display_adjust`, downloads the original from
 *   the `artworks` bucket, runs `sharp().stats()` to get per-channel
 *   mean/stdev, converts to luminance mean/stdev, and computes a
 *   gentle `b / c` correction toward the same "Theo standard" targets
 *   the client analyzer uses. Values clamped to ±15%.
 * - Writes ONLY tone (`b / c / s`) to `display_adjust`. **Crop is
 *   intentionally NOT backfilled** — the auto-crop assumption
 *   (uniform-background bands = safe to trim) is only safe when a
 *   human confirms in the upload editor. Silent server-side crop
 *   violates §0.6 (preview-first) and §8 (never fabricate).
 *
 * Reversibility
 * -------------
 * The write is non-destructive: the original storage file is never
 * touched. Owners can reset an image to "render original" from the
 * artwork edit page. To wipe the entire backfill:
 *   update artwork_images set display_adjust = null;
 *
 * How to run
 * ----------
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/backfill-image-adjust.ts [--limit=200] [--dry]
 *
 * Requires SERVICE_ROLE (bypass RLS + upsert on artwork_images). Do
 * not run with the anon key.
 */

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const BUCKET = "artworks";

// Duplicated tiny numeric contract with `src/lib/image/analyze.ts` so
// the script does not pull the React/DOM code path. Keep the two in
// sync when you tune targets.
const TONE_TARGET_MEAN = 132;
const TONE_TARGET_STDEV = 58;
const AUTO_CAP = 0.15;
const TONE_MIN = 0.7;
const TONE_MAX = 1.3;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function clampTone(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(TONE_MAX, Math.max(TONE_MIN, n));
}

function suggestTone(
  meanLuma: number,
  stdevLuma: number,
): { b: number; c: number; s: number } | null {
  const bRaw =
    meanLuma > 0.1 ? TONE_TARGET_MEAN / Math.max(30, meanLuma) : 1;
  const cRaw =
    stdevLuma > 0.1 ? TONE_TARGET_STDEV / Math.max(20, stdevLuma) : 1;
  const b = clampTone(Math.min(1 + AUTO_CAP, Math.max(1 - AUTO_CAP, bRaw)));
  const c = clampTone(Math.min(1 + AUTO_CAP, Math.max(1 - AUTO_CAP, cRaw)));
  // Skip near-neutral rows so we don't spam the DB with no-op JSON.
  if (Math.abs(b - 1) < 0.02 && Math.abs(c - 1) < 0.02) return null;
  return { b: round3(b), c: round3(c), s: 1.0 };
}

type Row = { id: string; artwork_id: string; storage_path: string };

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 500;
  const dry = args.includes("--dry");

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required (do NOT use the anon key).",
    );
    process.exit(1);
  }
  const supa = createClient(url, key, { auth: { persistSession: false } });

  console.log(
    `[backfill-image-adjust] starting  limit=${limit}  dry=${dry ? "yes" : "no"}`,
  );

  const { data: rows, error } = await supa
    .from("artwork_images")
    .select("id, artwork_id, storage_path")
    .is("display_adjust", null)
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) {
    console.error("select failed:", error);
    process.exit(1);
  }
  const toProcess = (rows ?? []) as Row[];
  console.log(`[backfill-image-adjust] fetched ${toProcess.length} rows`);

  let updated = 0;
  let skippedNeutral = 0;
  let failed = 0;

  for (const row of toProcess) {
    try {
      const { data: blob, error: dlErr } = await supa.storage
        .from(BUCKET)
        .download(row.storage_path);
      if (dlErr || !blob) {
        failed += 1;
        console.warn(`  ! download failed  ${row.storage_path}`, dlErr);
        continue;
      }
      const buf = Buffer.from(await blob.arrayBuffer());
      // `sharp().stats()` returns per-channel mean/stdev on the
      // 0–255 range. We collapse to luminance via Rec.601 weights.
      const stats = await sharp(buf, { failOnError: false })
        .rotate()
        .stats();
      const ch = stats.channels ?? [];
      // Fall back to identity if channel layout is unexpected
      // (single-channel PNG, etc.).
      const rM = ch[0]?.mean ?? 128;
      const gM = ch[1]?.mean ?? rM;
      const bM = ch[2]?.mean ?? rM;
      const rS = ch[0]?.stdev ?? 50;
      const gS = ch[1]?.stdev ?? rS;
      const bS = ch[2]?.stdev ?? rS;
      const meanLuma = 0.299 * rM + 0.587 * gM + 0.114 * bM;
      const stdevLuma = (rS + gS + bS) / 3;

      const tone = suggestTone(meanLuma, stdevLuma);
      if (!tone) {
        skippedNeutral += 1;
        continue;
      }

      if (!dry) {
        const { error: upErr } = await supa
          .from("artwork_images")
          .update({ display_adjust: { v: 1, ...tone } })
          .eq("id", row.id);
        if (upErr) {
          failed += 1;
          console.warn(`  ! update failed  id=${row.id}`, upErr);
          continue;
        }
      }
      updated += 1;
      if (updated % 25 === 0) {
        console.log(`  … ${updated} updated`);
      }
    } catch (err) {
      failed += 1;
      console.warn(`  ! error  ${row.storage_path}`, err);
    }
  }

  console.log(
    `[backfill-image-adjust] done  updated=${updated}  neutral=${skippedNeutral}  failed=${failed}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
