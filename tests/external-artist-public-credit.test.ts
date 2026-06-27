// QA 2026-06-27 — external artist public credit + invite_email PII guard.
//
// Bug: invited (pre-onboarding) external artists' display_name was only
// readable by the inviting account, so every other viewer saw the
// uploader's account name in the artist slot. Fix exposes display_name
// publicly (for rows referenced by a public confirmed claim) while
// keeping invite_email private.
//
// These assertions are SQL- and source-contract shaped so they run
// without a live DB / env.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const migrationsDir = join(root, "supabase", "migrations");

// 1) Migration must add a PUBLIC select policy on external_artists
//    scoped to rows referenced by a public+confirmed claim.
const mig = readdirSync(migrationsDir)
  .filter((n) => n.includes("external_artist_public_credit"))
  .sort()
  .pop();
assert.ok(mig, "expected external_artist_public_credit migration");
const sql = readFileSync(join(migrationsDir, mig!), "utf8");
assert.match(sql, /create policy external_artists_select_public/);
assert.match(sql, /to public/);
assert.match(sql, /c\.visibility = 'public'/);
assert.match(sql, /c\.status is null or c\.status = 'confirmed'/);

// 2) invite_email must be protected by REVOKING table SELECT then
//    GRANTing column SELECT WITHOUT invite_email (column-level revoke
//    alone is a no-op when a table grant exists).
assert.match(sql, /revoke select on public\.external_artists from anon/);
assert.match(sql, /revoke select on public\.external_artists from authenticated/);
assert.match(sql, /grant select \([\s\S]*?display_name[\s\S]*?\) on public\.external_artists to anon/);
assert.doesNotMatch(
  sql,
  /grant select \([\s\S]*?invite_email[\s\S]*?\) on public\.external_artists/,
  "invite_email must NOT be re-granted",
);

// 3) Owner-only RPC must check invited_by = auth.uid().
assert.match(sql, /create or replace function public\.get_external_artist_invite_email/);
assert.match(sql, /ea\.invited_by = auth\.uid\(\)/);
assert.match(sql, /security definer/);

// 4) Public artwork embeds must NOT request invite_email anymore.
const artworksSrc = readFileSync(join(root, "src", "lib", "supabase", "artworks.ts"), "utf8");
assert.doesNotMatch(
  artworksSrc,
  /external_artists\(display_name,\s*invite_email\)/,
  "public artwork embeds must drop invite_email",
);
assert.match(artworksSrc, /external_artists\(display_name\)/);

// 5) Editor must read invite_email via the owner-only RPC, not the embed.
const editSrc = readFileSync(
  join(root, "src", "app", "artwork", "[id]", "edit", "page.tsx"),
  "utf8",
);
assert.match(editSrc, /getExternalArtistInviteEmail/);
assert.doesNotMatch(editSrc, /external_artists\.invite_email/);

console.log("external-artist-public-credit.test.ts: ok");
