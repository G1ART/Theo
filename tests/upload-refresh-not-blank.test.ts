/**
 * Contract: /upload after refresh must show the 3-column chrome even
 * when AuthGate is not ready. Recurrence of the 2026-08-22 white screen
 * was AuthGate wrapping PageHeader + tabs while the desktop Header is
 * hidden on shell routes, plus AuthBootstrap calling router.refresh()
 * on SIGNED_IN (session recovery).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function sliceGate(src: string): string {
  const start = src.indexOf("<AuthGate>");
  const end = src.indexOf("</AuthGate>");
  assert.ok(start >= 0 && end > start, "upload layout must use AuthGate");
  return src.slice(start, end);
}

(async () => {
  const layout = read("src/app/upload/layout.tsx");

  assert.match(layout, /<AppShell>/, "upload layout mounts AppShell");
  assert.ok(
    layout.indexOf("<AppShell>") < layout.indexOf("<AuthGate>"),
    "AppShell must wrap AuthGate so the sidebar paints during auth wait",
  );

  const gated = sliceGate(layout);
  assert.equal(
    gated.includes("PageHeader"),
    false,
    "PageHeader must not wait on AuthGate ready",
  );
  assert.equal(
    gated.includes("LaneChips"),
    false,
    "LaneChips (tabs) must not wait on AuthGate ready",
  );
  assert.match(gated, /\{children\}/, "AuthGate wraps only the form slot");
  assert.match(
    layout.slice(0, layout.indexOf("<AuthGate>")),
    /PageHeader/,
    "title chrome paints before AuthGate",
  );
  assert.match(
    layout.slice(0, layout.indexOf("<AuthGate>")),
    /LaneChips/,
    "tabs paint before AuthGate",
  );

  const bootstrap = read("src/components/AuthBootstrap.tsx");
  const bootstrapCode = bootstrap
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.match(
    bootstrapCode,
    /event === "SIGNED_OUT"/,
    "SIGNED_OUT still redirects",
  );
  assert.equal(
    (bootstrapCode.match(/router\.refresh\(\)/g) ?? []).length,
    1,
    "router.refresh only on SIGNED_OUT — not SIGNED_IN / TOKEN_REFRESHED / USER_UPDATED",
  );
  assert.equal(
    /SIGNED_IN[\s\S]{0,80}router\.refresh\(/.test(bootstrapCode),
    false,
    "SIGNED_IN must not call router.refresh",
  );

  const client = read("src/lib/supabase/client.ts");
  assert.match(
    client,
    /lock:\s*async/,
    "supabase auth.lock must stay a no-op so getSession cannot hang on LockManager",
  );

  const gate = read("src/components/AuthGate.tsx");
  assert.match(gate, /AUTH_WAIT_MS/);
  assert.match(gate, /AUTH_TIMEOUT/);
  assert.match(
    gate,
    /await sessionPromise/,
    "fail-open must keep awaiting the hung getSession for a late redirect",
  );
  assert.equal(
    /min-h-\[50vh\]/.test(gate),
    false,
    "AuthGate spinner must not fill half the viewport (reads as a white page)",
  );

  const header = read("src/components/Header.tsx");
  const hamIdx = header.indexOf("hamburgerButtonRef");
  assert.ok(hamIdx > 0, "Header still has a hamburger");
  const hamWindow = header.slice(Math.max(0, hamIdx - 80), hamIdx);
  assert.equal(
    /\{ready && \(/.test(hamWindow),
    false,
    "hamburger must render while getSession is in flight",
  );

  const trigger = read("src/components/tour/TourTrigger.tsx");
  assert.match(
    trigger,
    /requestAnimationFrame/,
    "tour auto-start waits for paint before requesting overlay",
  );

  const loading = read("src/app/upload/loading.tsx");
  assert.match(loading, /aria-hidden/, "upload loading.tsx is a visible skeleton, not empty");

  console.log("upload-refresh-not-blank.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
