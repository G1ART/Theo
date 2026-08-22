/**
 * Contract: "그래도 계속" / "계속 진행" must hide the quality-gate
 * banner so crop / 작품 영역 stays the focus. Block used to keep
 * rendering whenever severity === "block", even after override.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ArtworkQualityGateResult } from "../src/lib/ai/types";
import { shouldShowQualityGateBanner } from "../src/lib/image/enhancement/qualityGateBannerVisibility";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function blockResult(
  extra: Partial<ArtworkQualityGateResult> = {},
): ArtworkQualityGateResult {
  return {
    usable: false,
    severity: "block",
    issues: ["low_resolution", "occlusion"],
    reshootAdviceKo: "",
    reshootAdviceEn: "",
    scores: { sharpness: 0.2, glare: 0, exposure: 0.5, framing: 0.5 },
    ...extra,
  };
}

function warnResult(): ArtworkQualityGateResult {
  return { ...blockResult(), usable: true, severity: "warn" };
}

(async () => {
  const shown = {
    pathChoice: "ai" as const,
    result: blockResult(),
    dismissed: false,
    override: false,
  };
  assert.equal(
    shouldShowQualityGateBanner(shown),
    true,
    "block banner shows before the artist continues",
  );
  assert.equal(
    shouldShowQualityGateBanner({ ...shown, dismissed: true }),
    false,
    "그래도 계속 (dismissed) hides the banner",
  );
  assert.equal(
    shouldShowQualityGateBanner({ ...shown, override: true }),
    false,
    "block override hides the banner",
  );
  assert.equal(
    shouldShowQualityGateBanner({
      ...shown,
      result: warnResult(),
      dismissed: true,
    }),
    false,
    "계속 진행 hides a warn banner",
  );
  assert.equal(
    shouldShowQualityGateBanner({
      ...shown,
      result: blockResult({ degraded: true, reason: "error" }),
    }),
    false,
    "degraded / fail-open is silent",
  );
  assert.equal(
    shouldShowQualityGateBanner({ ...shown, pathChoice: "original" }),
    false,
    "original-margin path has no gate banner",
  );

  const editor = read("src/components/upload/ImageStandardizeEditor.tsx");
  assert.match(
    editor,
    /shouldShowQualityGateBanner/,
    "editor must use the shared visibility helper",
  );
  assert.match(editor, /fileIdentityKey/);
  assert.match(editor, /rememberQualityGateAck/);
  assert.match(
    editor,
    /onUseAnyway=\{\(\) => \{[\s\S]*setQualityGateOverride\(true\);[\s\S]*setQualityGateDismissed\(true\);/,
    "그래도 계속 must record override AND dismiss the banner",
  );
  assert.equal(
    /qualityGate\.severity === "block" \|\|/.test(editor),
    false,
    "block must not render the banner unconditionally",
  );

  console.log("quality-gate-banner-dismiss.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
