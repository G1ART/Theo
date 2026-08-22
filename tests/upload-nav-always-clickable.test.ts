/**
 * Contract: during 이미지 보정, left PRIMARY/SECONDARY tabs and upload
 * sub-tabs stay clickable. Crop can work while Links look dead — that
 * is a hung App Router or a covering layer, not a body pointer-events lock.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  hrefPathname,
  isUploadAppPath,
  shouldHardLeaveUpload,
} from "../src/lib/shell/leaveUploadNav";
import { fileIdentityKey } from "../src/lib/image/enhancement/qualityGateBannerVisibility";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

(async () => {
  assert.equal(isUploadAppPath("/upload"), true);
  assert.equal(isUploadAppPath("/upload/bulk"), true);
  assert.equal(isUploadAppPath("/upload/exhibition"), true);
  assert.equal(isUploadAppPath("/feed"), false);
  assert.equal(isUploadAppPath("/my/messages"), false);
  assert.equal(hrefPathname("/feed?tab=all&sort=latest"), "/feed");

  const prevWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {} as unknown;
  try {
    assert.equal(
      shouldHardLeaveUpload("/upload", "/feed?tab=all&sort=latest"),
      true,
      "Explore from upload must hard-leave",
    );
    assert.equal(
      shouldHardLeaveUpload("/upload", "/upload/bulk"),
      false,
      "upload sub-tabs stay client-side",
    );
    assert.equal(
      shouldHardLeaveUpload("/feed", "/my/messages"),
      false,
      "hard-leave only applies on /upload*",
    );
  } finally {
    if (prevWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = prevWindow;
    }
  }

  const a = { name: "a.jpg", size: 12, lastModified: 1 } as File;
  const b = { name: "a.jpg", size: 12, lastModified: 1 } as File;
  const c = { name: "b.jpg", size: 12, lastModified: 1 } as File;
  assert.equal(fileIdentityKey(a), fileIdentityKey(b));
  assert.notEqual(fileIdentityKey(a), fileIdentityKey(c));

  const overlay = read("src/components/tour/TourOverlay.tsx");
  assert.equal(/<svg/.test(overlay), false, "tour must not use a full-viewport SVG");
  assert.equal(
    /absolute inset-0 h-full w-full/.test(overlay),
    false,
    "tour must not mount a full-viewport layer",
  );
  assert.match(overlay, /0 0 0 9999px rgba\(24,24,27,0\.55\)/);
  assert.match(
    overlay,
    /className="pointer-events-auto fixed z-\[1200\] w-\[min\(340px,92vw\)\]/,
    "only the popover should capture clicks",
  );

  const shell = read("src/components/shell/AppShell.tsx");
  assert.match(shell, /relative z-30/);
  assert.match(shell, /pointer-events-auto/);
  assert.match(shell, /overflow-x-clip/);

  const css = read("src/app/globals.css");
  assert.match(css, /@media \(max-width: 1023px\)/);
  assert.match(css, /html\.theo-nav-blocked body \*/);

  const sidebar = read("src/components/shell/AppSidebar.tsx");
  assert.match(sidebar, /ShellNavLink/);

  const editor = read("src/components/upload/ImageStandardizeEditor.tsx");
  assert.match(editor, /fileIdentityKey/);
  assert.match(editor, /rememberQualityGateAck/);
  assert.match(editor, /setEnhanceWizardActive/);

  const provider = read("src/components/tour/TourProvider.tsx");
  assert.match(provider, /isEnhanceWizardActive/);
  assert.match(provider, /ENHANCE_WIZARD_EVENT/);

  console.log("upload-nav-always-clickable.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
