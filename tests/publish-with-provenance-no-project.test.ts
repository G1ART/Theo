// QA 2026-06-26 (#8) — static guard: ensure publishArtworksWithProvenance
// (bulk publish path) NEVER passes both `workId` and `projectId` to the
// claim RPC. The DB enforces `exactly one of work_id, project_id required`
// — passing both made every CURATED bulk publish silently fail and
// surface as an opaque "Publish failed" toast. This test pins the fix.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const SRC = read("src/lib/supabase/artworks.ts");

// 1. The exported options type must no longer expose `projectId`.
{
  const typeBlockMatch = SRC.match(
    /export type PublishWithProvenanceOptions = \{[\s\S]*?\};/
  );
  assert.ok(typeBlockMatch, "PublishWithProvenanceOptions type must exist");
  const block = typeBlockMatch[0];
  assert.equal(
    /\bprojectId\??\s*:/.test(block),
    false,
    "PublishWithProvenanceOptions must NOT declare projectId (QA #8)"
  );
}

// 2. The function body must not pass `projectId:` to any claim RPC.
{
  const fnMatch = SRC.match(
    /export async function publishArtworksWithProvenance[\s\S]*?\n\}\s*\n/
  );
  assert.ok(fnMatch, "publishArtworksWithProvenance function must exist");
  const body = fnMatch[0];
  assert.equal(
    /projectId\s*:/.test(body),
    false,
    "publishArtworksWithProvenance must not forward projectId to claim RPC (QA #8)"
  );
}

// 3. New result shape: per-work results array.
{
  assert.ok(
    /export type PublishWithProvenanceResult\s*=\s*\{/.test(SRC),
    "PublishWithProvenanceResult must be exported for partial-success handling"
  );
  assert.ok(
    /results\s*:\s*Array</.test(SRC),
    "Result must include a per-work `results` array (QA #8 partial-success UX)"
  );
}

// 4. The single-upload page must mirror the same fix.
{
  const SINGLE = read("src/app/upload/page.tsx");
  // Grab the existing-artist claim call site.
  const claimCall = SINGLE.match(
    /createClaimForExistingArtist\(\{[\s\S]*?\}\);/
  );
  assert.ok(
    claimCall,
    "Single-upload page must call createClaimForExistingArtist"
  );
  assert.equal(
    /projectId\s*:/.test(claimCall![0]),
    false,
    "Single-upload claim must not forward projectId (QA #8)"
  );
}

console.log("publish-with-provenance-no-project.test.ts: ok");
