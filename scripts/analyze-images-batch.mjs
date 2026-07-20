#!/usr/bin/env node
/**
 * scripts/analyze-images-batch.mjs
 *
 * One-off helper for the 2026-07-20 feed image standardization backfill
 * when SUPABASE_SERVICE_ROLE_KEY is not on the local machine.
 *
 * Reads a batch of storage paths from stdin (one path per line) or from
 * the command line, downloads each via the public bucket URL (the
 * `artworks` bucket is public per docs/03_RUNBOOK.md), runs
 * `sharp().stats()`, and prints one JSON object per line to stdout:
 *
 *   { "storage_path": "…", "b": 1.05, "c": 1.08, "s": 1.0 }
 *   { "storage_path": "…", "neutral": true }
 *   { "storage_path": "…", "error": "download_failed" }
 *
 * The DB write happens *outside* this script (via MCP execute_sql) so
 * the operator never needs the service-role key locally. Once we have
 * the service role in the environment, `scripts/backfill-image-adjust.ts`
 * does the whole round-trip in one command.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... node scripts/analyze-images-batch.mjs < paths.txt
 *   NEXT_PUBLIC_SUPABASE_URL=... node scripts/analyze-images-batch.mjs 'path/a.jpg' 'path/b.png'
 */

import fs from "node:fs";
import sharp from "sharp";

const BUCKET = "artworks";

// Kept in numeric sync with `src/lib/image/analyze.ts` and
// `scripts/backfill-image-adjust.ts`.
const TONE_TARGET_MEAN = 132;
const TONE_TARGET_STDEV = 58;
const AUTO_CAP = 0.15;
const TONE_MIN = 0.7;
const TONE_MAX = 1.3;

function round3(n) {
  return Math.round(n * 1000) / 1000;
}
function clampTone(n) {
  if (!Number.isFinite(n)) return 1;
  return Math.min(TONE_MAX, Math.max(TONE_MIN, n));
}
function suggestTone(meanLuma, stdevLuma) {
  const bRaw = meanLuma > 0.1 ? TONE_TARGET_MEAN / Math.max(30, meanLuma) : 1;
  const cRaw =
    stdevLuma > 0.1 ? TONE_TARGET_STDEV / Math.max(20, stdevLuma) : 1;
  const b = clampTone(Math.min(1 + AUTO_CAP, Math.max(1 - AUTO_CAP, bRaw)));
  const c = clampTone(Math.min(1 + AUTO_CAP, Math.max(1 - AUTO_CAP, cRaw)));
  if (Math.abs(b - 1) < 0.02 && Math.abs(c - 1) < 0.02) return null;
  return { b: round3(b), c: round3(c), s: 1.0 };
}

async function analyzeOne(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`http_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const stats = await sharp(buf, { failOnError: false }).rotate().stats();
  const ch = stats.channels ?? [];
  const rM = ch[0]?.mean ?? 128;
  const gM = ch[1]?.mean ?? rM;
  const bM = ch[2]?.mean ?? rM;
  const rS = ch[0]?.stdev ?? 50;
  const gS = ch[1]?.stdev ?? rS;
  const bS = ch[2]?.stdev ?? rS;
  const meanLuma = 0.299 * rM + 0.587 * gM + 0.114 * bM;
  const stdevLuma = (rS + gS + bS) / 3;
  return suggestTone(meanLuma, stdevLuma);
}

async function main() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!base) {
    console.error("NEXT_PUBLIC_SUPABASE_URL required.");
    process.exit(1);
  }
  let paths = process.argv.slice(2);
  if (paths.length === 0 && !process.stdin.isTTY) {
    const raw = fs.readFileSync(0, "utf8");
    paths = raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (paths.length === 0) {
    console.error(
      "no paths — pass on argv or pipe one-per-line to stdin.",
    );
    process.exit(1);
  }

  // Cap concurrency to keep the network gentle and cpu-bound sharp
  // decoding from starving the box.
  const CONCURRENCY = 4;
  let idx = 0;
  const worker = async () => {
    while (idx < paths.length) {
      const my = idx++;
      const p = paths[my];
      const url = `${base}/storage/v1/object/public/${BUCKET}/${p}`;
      try {
        const tone = await analyzeOne(url);
        if (!tone) {
          process.stdout.write(
            JSON.stringify({ storage_path: p, neutral: true }) + "\n",
          );
        } else {
          process.stdout.write(
            JSON.stringify({ storage_path: p, ...tone }) + "\n",
          );
        }
      } catch (err) {
        process.stdout.write(
          JSON.stringify({
            storage_path: p,
            error: err instanceof Error ? err.message : String(err),
          }) + "\n",
        );
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, paths.length) }, worker),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
