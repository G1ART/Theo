/**
 * Contract: an in-app tour must never trap global nav (sidebar tabs).
 *
 * The 이미지 보정 / upload path is the reported case: TourOverlay used
 * a full-viewport `pointer-events-auto` spotlight (and a dim fallback
 * when the step target unmounted) which ate clicks meant for 둘러보기 /
 * 메시지. This file locks the fix.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathnameInTourScope } from "../src/lib/tours/tourUtils";
import { TOURS, TOUR_IDS } from "../src/lib/tours/tourRegistry";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

(async () => {
  // ── pathnameInTourScope ───────────────────────────────────────────
  assert.equal(pathnameInTourScope("/upload", ["/upload/*"]), true);
  assert.equal(pathnameInTourScope("/upload/bulk", ["/upload/*"]), true);
  assert.equal(pathnameInTourScope("/upload/exhibition", ["/upload/*"]), true);
  assert.equal(pathnameInTourScope("/feed", ["/upload/*"]), false);
  assert.equal(pathnameInTourScope("/my/messages", ["/upload/*"]), false);

  assert.equal(pathnameInTourScope("/my", ["/my"]), true);
  assert.equal(pathnameInTourScope("/my/network", ["/my"]), false);
  assert.equal(pathnameInTourScope("/my/messages", ["/my"]), false);

  assert.equal(pathnameInTourScope("/u/alice", ["/u/*"]), true);
  assert.equal(
    pathnameInTourScope("/my/exhibitions/new", [
      "/my/exhibitions/new",
      "/upload/exhibition",
    ]),
    true,
  );
  assert.equal(pathnameInTourScope("", ["/upload/*"]), false);

  // Upload tour must stay on /upload* and drop everywhere else.
  const uploadScope = TOURS[TOUR_IDS.upload].routeScope;
  assert.ok(
    pathnameInTourScope("/upload", uploadScope),
    "upload tour stays on /upload",
  );
  assert.ok(
    pathnameInTourScope("/upload/bulk", uploadScope),
    "upload tour stays on bulk",
  );
  assert.equal(
    pathnameInTourScope("/feed", uploadScope),
    false,
    "upload tour must not follow the user to Explore",
  );

  for (const tour of Object.values(TOURS)) {
    assert.ok(
      Array.isArray(tour.routeScope) && tour.routeScope.length > 0,
      `${tour.id} must declare a non-empty routeScope`,
    );
  }

  // ── TourOverlay: visual-only dim, not a modal, no null-target trap ─
  const overlay = read("src/components/tour/TourOverlay.tsx");
  assert.equal(
    /pointer-events-auto absolute inset-0/.test(overlay),
    false,
    "Spotlight must not use a full-screen pointer-events-auto layer",
  );
  assert.match(
    overlay,
    /className="pointer-events-none absolute inset-0 h-full w-full"/,
    "SVG spotlight must be pointer-events-none",
  );
  assert.match(
    overlay,
    /if \(!rect\) return null/,
    "missing target must not render a full-screen dim",
  );
  assert.equal(
    /aria-modal="true"/.test(overlay),
    false,
    "tour overlay must not be aria-modal",
  );
  assert.equal(
    /role="dialog"/.test(overlay),
    false,
    "tour overlay must not use a blocking dialog role",
  );
  assert.match(overlay, /role="region"/);
  assert.match(
    overlay,
    /className="pointer-events-auto absolute w-\[min\(340px,92vw\)\]/,
    "only the popover should capture clicks",
  );

  // ── TourProvider: leave-page skip + missing-target skip ───────────
  const provider = read("src/components/tour/TourProvider.tsx");
  assert.match(provider, /usePathname/);
  assert.match(provider, /pathnameInTourScope/);
  assert.match(provider, /MISSING_TARGET_MS/);
  assert.match(provider, /advanceOrSkipMissing/);
  assert.match(
    provider,
    /activeTour && currentStep && targetRect \?/,
    "TourOverlay mounts only when targetRect is measured",
  );

  // ── ImageStandardizeEditor: no full-viewport click trap ───────────
  const editor = read("src/components/upload/ImageStandardizeEditor.tsx");
  assert.equal(
    /fixed inset-0/.test(editor),
    false,
    "enhance editor must not mount a full-viewport overlay",
  );

  console.log("tour-nav-not-trapped.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
