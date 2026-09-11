// 보정 미리보기는 「이 이미지 사용」 전에 부모(Publish payload)로
// 커밋되어야 한다. 미리보기만 보고 올리면 원본 폰 사진이 게시되던
// 구멍 (2026-09-10 작업실).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const editor = readFileSync(
  join(root, "src/components/upload/ImageStandardizeEditor.tsx"),
  "utf8",
);
const upload = readFileSync(join(root, "src/app/upload/page.tsx"), "utf8");
const storage = readFileSync(join(root, "src/lib/supabase/storage.ts"), "utf8");

assert.match(editor, /const pushDraftToParent = useCallback/);
assert.match(
  editor,
  /enhancePreviewUrlRef\.current = null;\s*fn\(draft\)/,
  "parent must take blob URL ownership so hiding the editor cannot drop the draft",
);
assert.match(
  editor,
  /if \(draft\) onEnhanceRef\.current\?\.\(draft\)/,
  "unmount must flush the latest preview so collapsing the panel cannot ship the original",
);
assert.match(
  editor,
  /pushDraftToParent\(shown\)/,
  "AI preview success must commit the shown draft without waiting for lightApply",
);
assert.match(editor, /pushDraftToParent\(attachedBase\)/);
assert.match(editor, /pushDraftToParent\(draft\)/);

assert.match(
  upload,
  /preparedDisplayFile: pending\.enhancement\?\.displayFile \?\? null/,
);
assert.match(
  storage,
  /if \(opts\?\.preparedDisplayFile\)/,
  "storage must prefer the enhanced display file when present",
);

console.log("enhance-preview-commits-to-parent.test.ts: ok");
