// Phase 3 (2026-07-01) — claims 무결성 제약 계약.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const migDir = join(root, "supabase", "migrations");
const f = readdirSync(migDir).filter((n) => n.includes("claims_integrity_phase3")).sort().pop();
assert.ok(f, "expected claims_integrity_phase3 migration");
const sql = readFileSync(join(migDir, f!), "utf8");

// claim_type CHECK with the 7 canonical types
assert.match(sql, /claims_claim_type_valid/);
for (const ct of ["CREATED", "OWNS", "INVENTORY", "EXHIBITED", "CURATED", "INCLUDES_WORK", "HOSTS_PROJECT"]) {
  assert.match(sql, new RegExp(`'${ct}'`), `claim_type CHECK must include ${ct}`);
}
// keep CHECK list in sync with provenance/types.ts CLAIM_TYPES
const types = readFileSync(join(root, "src/lib/provenance/types.ts"), "utf8");
for (const ct of ["CREATED", "OWNS", "INVENTORY", "EXHIBITED", "CURATED", "INCLUDES_WORK", "HOSTS_PROJECT"]) {
  assert.match(types, new RegExp(`"${ct}"`), `CLAIM_TYPES must include ${ct}`);
}

// artist ref never both
assert.match(sql, /claims_artist_ref_not_both/);
assert.match(sql, /num_nonnulls\(artist_profile_id, external_artist_id\) <= 1/);

// CREATED requires exactly one artist ref
assert.match(sql, /claims_created_requires_artist/);
assert.match(sql, /claim_type <> 'CREATED'[\s\S]*num_nonnulls\(artist_profile_id, external_artist_id\) = 1/);

// one CREATED per work
assert.match(sql, /uq_claims_one_created_per_work/);
assert.match(sql, /where claim_type = 'CREATED' and work_id is not null/);

// NOT VALID → VALIDATE conflict-safe pattern for the CHECKs
assert.match(sql, /not valid;/);
assert.match(sql, /validate constraint claims_claim_type_valid/);

console.log("claims-integrity-phase3.test.ts: ok");
