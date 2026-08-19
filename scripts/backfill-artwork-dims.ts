/**
 * scripts/backfill-artwork-dims.ts
 *
 * Populate `artworks.width_cm/height_cm/depth_cm` from the free-form
 * `size` column for rows that still have `width_cm IS NULL`. This is
 * the on-call tool for legacy imports that landed without structured
 * dimensions (the 2026-08-19 backfill migration cleared the first
 * 348 rows; this script covers anything new).
 *
 * What it does
 * ------------
 * - Fetches every artwork with `width_cm IS NULL AND size IS NOT NULL`
 *   (paged for safety, 1000/row batches).
 * - Runs `parseSizeToDimensionsCm(size, size_unit)` — the same
 *   utility SpaceEditor + backfill migration use.
 * - For every parseable row, UPDATE:
 *     set width_cm = coalesce(width_cm, $1),
 *         height_cm = coalesce(height_cm, $2),
 *         depth_cm = coalesce(depth_cm, $3)
 *   `dims_confirmed_at` is deliberately left NULL — auto-parsed
 *   dimensions are not the same as owner-confirmed ones. The inspector
 *   still surfaces a "확인 필요" affordance for those rows.
 *
 * Idempotency
 * -----------
 * The `where width_cm is null` filter + coalesce'd UPDATE make this
 * safe to re-run.
 *
 * How to run
 * ----------
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/backfill-artwork-dims.ts [--dry] [--limit=1000]
 *
 * Requires the service-role key (RLS bypass). Never run with the anon
 * key — it will silently no-op every UPDATE.
 */

import { createClient } from "@supabase/supabase-js";
import { parseSizeToDimensionsCm } from "../src/lib/size/format";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

type Row = {
  id: string;
  size: string | null;
  size_unit: "cm" | "in" | null;
};

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 2000;

  const supabase = createClient(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const pageSize = 500;
  let offset = 0;
  let processed = 0;
  let filled = 0;
  let unparseable = 0;
  const unparseableSamples: Row[] = [];

  while (processed < limit) {
    const remaining = Math.min(pageSize, limit - processed);
    const { data, error } = await supabase
      .from("artworks")
      .select("id, size, size_unit")
      .is("width_cm", null)
      .not("size", "is", null)
      .order("id")
      .range(offset, offset + remaining - 1);
    if (error) {
      console.error("fetch error:", error);
      process.exit(1);
    }
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) break;

    for (const row of rows) {
      processed += 1;
      const dims = parseSizeToDimensionsCm(row.size, row.size_unit ?? null);
      if (!dims) {
        unparseable += 1;
        if (unparseableSamples.length < 25) unparseableSamples.push(row);
        continue;
      }
      if (dry) {
        console.log(
          `[dry] ${row.id} size="${row.size}" size_unit=${row.size_unit} → w=${dims.widthCm.toFixed(2)} h=${dims.heightCm.toFixed(2)}${dims.depthCm != null ? ` d=${dims.depthCm.toFixed(2)}` : ""}`
        );
        filled += 1;
        continue;
      }
      const { error: updErr } = await supabase
        .from("artworks")
        .update({
          width_cm: dims.widthCm,
          height_cm: dims.heightCm,
          depth_cm: dims.depthCm ?? null,
        })
        .eq("id", row.id)
        .is("width_cm", null);
      if (updErr) {
        console.error(`update ${row.id}:`, updErr.message);
        continue;
      }
      filled += 1;
    }

    offset += rows.length;
    if (rows.length < remaining) break;
  }

  console.log(`processed=${processed} filled=${filled} unparseable=${unparseable}`);
  if (unparseableSamples.length > 0) {
    console.log("unparseable samples:");
    for (const r of unparseableSamples) {
      console.log(`  ${r.id}\t"${r.size}"\tunit=${r.size_unit}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
