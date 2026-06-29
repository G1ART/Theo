// QA 2026-06-30 — 전시 페이지(/e/[id])의 "← 피드" 백 링크가 진입 경로와
// 무관하게 항상 피드로 가던 문제. artwork 의 setArtworkBack/getArtworkBack
// 패턴을 미러링해, 전시로 진입하는 표면(피드 스트립/프로필 목록/룸/숏리스트)이
// 자기 경로를 stamp 하고 전시 페이지가 그걸 읽어 되돌아가도록 한다.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

// 1) 헬퍼 존재 -----------------------------------------------------------
const lib = read("src/lib/exhibitionBack.ts");
assert.match(lib, /export function setExhibitionBack/);
assert.match(lib, /export function getExhibitionBack/);
// 진입 경로별 라벨 매핑(피드/프로필/내스튜디오/보드)
assert.match(lib, /labelKey: "nav\.feed"/);
assert.match(lib, /labelKey: "nav\.profile"/);
assert.match(lib, /labelKey: "nav\.myProfile"/);

// 2) 전시 페이지가 컨텍스트 기반 백 링크 사용 ---------------------------
const page = read("src/app/e/[id]/page.tsx");
assert.match(page, /getExhibitionBack\(\)/, "exhibition page must read entry context");
assert.match(page, /href=\{back\.path\}/, "back link must use resolved path");
// 하드코딩된 피드 백 링크가 남아있으면 안 됨
assert.doesNotMatch(
  page,
  /<Link href="\/feed" className="text-sm text-zinc-600/,
  "exhibition page must not keep the hardcoded /feed back link",
);

// 3) 전시로 진입하는 표면들이 자기 경로를 stamp ------------------------
for (const rel of [
  "src/components/feed/ExhibitionMemoryStrip.tsx",
  "src/components/UserProfileContent.tsx",
  "src/app/room/[token]/page.tsx",
  "src/app/my/shortlists/[id]/page.tsx",
]) {
  const src = read(rel);
  assert.match(
    src,
    /setExhibitionBack\(/,
    `${rel} must stamp the entry path via setExhibitionBack`,
  );
}

console.log("exhibition-back-context.test.ts: ok");
