#!/usr/bin/env node
// Onboarding Smoothness Follow-up — static smoke invariants.
//
// These tests keep the onboarding front door from silently regressing
// to the old monolithic signup. They run as part of CI/`npm test` and
// fail the PR if any of the post-overhaul guarantees slip.
//
// Invariants checked:
//   1. `/onboarding` is account-creation-only (no username/display_name/
//      role/is_public inputs, no profile save, no username availability
//      check).
//   2. `/onboarding/identity` is the only caller of
//      `checkUsernameAvailability` and the only surface that reads the
//      `check_username_availability` RPC.
//   3. Every `routeByAuthState` call that happens *after* the caller
//      has confirmed a live session passes `sessionPresent: true`. This
//      is the guardrail against the RPC-loop login regression.
//   4. The `Header` "My Profile" link sends placeholder identities to
//      `/onboarding/identity`.
//   5. `/invites/delegation` preserves `next` on its signup link so
//      invite flows round-trip through identity-finish cleanly.
//   6. Front-door IA (Finalization patch):
//        a. `/` sends anonymous visitors to the PUBLIC feed
//           (DEFAULT_DESTINATION), NOT to `/login`. As of 2026-08-07 the
//           cold front door is feed-first: browsing is the landing
//           experience and auth is surfaced by deeper gated actions.
//        b. `/login` is login-first: no email-link form is rendered
//           unconditionally, and no user-facing string contains the
//           old "매직" / "magic link" terminology.
//        c. `/login` offers a visible, single-click path back to
//           `/onboarding` so returning non-members are not stranded.
//
// Usage: `node tests/onboarding-smoke.mjs`

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function read(path) {
  return readFileSync(path, "utf8");
}

const failures = [];
function fail(msg) {
  failures.push(msg);
}

// --- Invariant 1: /onboarding is account-creation-only ----------------
{
  const path = join(repoRoot, "src/app/onboarding/page.tsx");
  const body = read(path);
  const forbiddenTokens = [
    // Identity fields that should NOT live on the signup route.
    /\bsetUsername\s*\(/,
    /\bsetDisplayName\s*\(/,
    /\bsetMainRole\s*\(/,
    /\bsetRoles\s*\(/,
    /\bsetIsPublic\s*\(/,
    /\bcheckUsernameExists\s*\(/,
    /\bcheckUsernameAvailability\s*\(/,
    /saveProfileUnified/,
    /updateMyProfileBase/,
    // Legacy i18n keys that belonged to the monolithic signup form.
    /onboarding\.labelUsername/,
    /onboarding\.labelDisplayName/,
    /onboarding\.labelMainRole/,
    /onboarding\.labelRoles/,
    /onboarding\.privacyTitle/,
    /onboarding\.previewLabel/,
  ];
  for (const re of forbiddenTokens) {
    if (re.test(body)) {
      fail(
        `[signup-lightness] /onboarding must not include identity logic: pattern ${re} still present (${relative(repoRoot, path)})`,
      );
    }
  }
}

// --- Invariant 2: username availability lives only on identity-finish --
{
  const srcRoot = join(repoRoot, "src");
  const files = walk(srcRoot).filter((p) => p.endsWith(".ts") || p.endsWith(".tsx"));
  const consumerRe = /checkUsernameAvailability\s*\(/;
  const rpcRe = /check_username_availability/;
  // Files that are allowed to reference availability checks:
  //   - the identity-finish page
  //   - the reusable <UsernameField /> that implements the UX
  //   - the thin wrapper that calls the RPC
  //   - this smoke file's own string (not scanned because it lives
  //     under `tests/`, not `src/`)
  const allowed = new Set([
    "src/app/onboarding/identity/page.tsx",
    "src/components/onboarding/UsernameField.tsx",
    "src/lib/identity/suggestions.ts",
    "src/lib/supabase/profiles.ts",
  ]);
  for (const full of files) {
    const rel = relative(repoRoot, full).split("\\").join("/");
    const body = read(full);
    if (consumerRe.test(body) || rpcRe.test(body)) {
      if (!allowed.has(rel)) {
        fail(
          `[identity-singleton] availability check must live only in identity-finish flow (unexpected: ${rel})`,
        );
      }
    }
  }
}

// --- Invariant 3: sessionPresent invariant on routeByAuthState ---------
//
// Any file that has already established `session` (via `getSession()`
// or the Supabase auth callback) must pass `sessionPresent: true` when
// it subsequently calls `routeByAuthState`. The one authorized
// exception is `src/lib/identity/routing.ts` itself, which is the
// declaration site.
{
  const entryFiles = [
    "src/app/page.tsx",
    "src/app/login/page.tsx",
    "src/app/auth/callback/page.tsx",
    "src/app/onboarding/page.tsx",
    "src/app/onboarding/identity/page.tsx",
  ];
  for (const rel of entryFiles) {
    const full = join(repoRoot, rel);
    const body = read(full);
    // Grab every `routeByAuthState(...)` call including its argument
    // list up to the matching closing paren (approximate but good
    // enough for our single-line call sites).
    const calls = body.match(/routeByAuthState\s*\([^)]*\)/g) || [];
    if (calls.length === 0) {
      fail(`[route-entry] ${rel} should route through routeByAuthState`);
      continue;
    }
    for (const call of calls) {
      if (!/sessionPresent\s*:\s*true/.test(call)) {
        fail(
          `[session-present] ${rel}: routeByAuthState call is missing \`sessionPresent: true\` — this causes the post-login RPC loop (match: ${call.slice(0, 120)})`,
        );
      }
    }
  }
}

// --- Invariant 4: Header "My Profile" rescues placeholder users --------
{
  const path = join(repoRoot, "src/components/Header.tsx");
  const body = read(path);
  // The conditional must explicitly route placeholder users into the
  // identity-finish surface. We don't care about the exact expression
  // shape, only that both the placeholder check and the destination
  // path are present near each other.
  if (!/isPlaceholderUsername\(/.test(body)) {
    fail(`[header-rescue] Header.tsx must call isPlaceholderUsername()`);
  }
  if (!/\/onboarding\/identity/.test(body)) {
    fail(`[header-rescue] Header.tsx must link placeholder users to /onboarding/identity`);
  }
}

// --- Invariant 5: delegation invite preserves `next` --------------------
{
  const path = join(repoRoot, "src/app/invites/delegation/page.tsx");
  const body = read(path);
  if (!/\/onboarding\?next=/.test(body)) {
    fail(
      `[invite-smoothness] delegation invite signup link must include ?next= so invite flows round-trip through identity-finish`,
    );
  }
}

// --- Invariant 6a: `/` sends anonymous visitors to the public feed ------
{
  const path = join(repoRoot, "src/app/page.tsx");
  const body = read(path);
  // Feed-first cold front door (2026-08-07): the no-session branch must
  // redirect to the PUBLIC feed (DEFAULT_DESTINATION). If anyone flips
  // this to `/login` OR back to the old `/onboarding` wall, the
  // browse-first front door has regressed.
  if (
    !/DEFAULT_DESTINATION/.test(body) ||
    !/router\.replace\(\s*DEFAULT_DESTINATION\s*\)/.test(body)
  ) {
    fail(
      `[front-door] src/app/page.tsx must redirect anonymous visitors to the public feed via DEFAULT_DESTINATION (feed-first entry)`,
    );
  }
  if (/router\.replace\(\s*LOGIN_PATH\s*\)/.test(body)) {
    fail(
      `[front-door] src/app/page.tsx must not redirect anonymous visitors to LOGIN_PATH — use DEFAULT_DESTINATION (public feed)`,
    );
  }
  if (/router\.replace\(\s*ONBOARDING_PATH\s*\)/.test(body)) {
    fail(
      `[front-door] src/app/page.tsx must not wall anonymous visitors behind ONBOARDING_PATH — the feed is the public landing`,
    );
  }
}

// --- Invariant 6b: /login is login-first, no magic-link terminology -----
{
  const path = join(repoRoot, "src/app/login/page.tsx");
  const body = read(path);
  // No user-facing "magic link" terminology anywhere on /login. The
  // passwordless option must use neutral copy.
  const userFacingMagic = /t\(\s*["']login\.(magicLinkPlaceholder|sendMagicLink)["']\s*\)/;
  if (userFacingMagic.test(body)) {
    fail(
      `[front-door] /login must not render legacy magic-link i18n keys (login.magicLinkPlaceholder / login.sendMagicLink)`,
    );
  }
  // The passwordless path must live behind a disclosure flag so cold
  // traffic doesn't see it with the same weight as password sign-in.
  // The explicit state name is `passwordlessOpen`; we also accept any
  // conditional render guarded by such a flag.
  if (!/passwordlessOpen/.test(body)) {
    fail(
      `[front-door] /login must gate the passwordless form behind a \`passwordlessOpen\` disclosure state`,
    );
  }
  if (!/\/onboarding/.test(body)) {
    fail(
      `[front-door] /login must expose a clear link back to /onboarding for new members`,
    );
  }
}

// --- Invariant 6c: Korean "매직" terminology is gone from user copy -----
{
  const msgPath = join(repoRoot, "src/lib/i18n/messages.ts");
  const body = read(msgPath);
  // The only permitted mention of "magic" is in developer comments.
  // Values inside quoted i18n strings must not contain the term.
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Quick reject: only inspect obvious i18n value lines (they have
    // a quoted key and a quoted value). We flag any such line that
    // still contains "매직" or "magic link" in its value.
    const kv = line.match(/^\s*"([^"]+)"\s*:\s*"([^"]*)"/);
    if (!kv) continue;
    const value = kv[2];
    if (/매직/.test(value) || /magic\s*link/i.test(value)) {
      fail(
        `[copy-cleanup] i18n value still contains magic-link terminology at messages.ts:${i + 1}: ${kv[1]} = "${value}"`,
      );
    }
  }
}

if (failures.length) {
  console.error("Onboarding smoothness regressions:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("Onboarding smoke: all invariants hold.");
