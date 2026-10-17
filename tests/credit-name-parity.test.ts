// 2026-10-17 — 피드 전시 카드의 "기획 Hyunmin Kim"과 "기획 김현민"은
// @henrykimceo 와 @g1art_founder, 서로 다른 계정이었다. 같은 계정이면
// 전시 크레딧, 작품 클레임 줄, 사람 검색 카드가 로케일마다 같은 이름을 내고,
// 그 이름에 필요한 한/영 열을 쿼리와 RPC가 실어 오는지 본다.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  getExhibitionHostCuratorLabel,
  type ExhibitionWithCredits,
} from "../src/lib/exhibitionCredits";
import { formatDisplayName, formatIdentityPair } from "../src/lib/identity/format";
import { messages } from "../src/lib/i18n/messages";
import type { Locale } from "../src/lib/i18n/locale";

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

function translator(locale: Locale): (key: string) => string {
  const table = messages[locale] as Record<string, string>;
  return (key) => table[key] ?? key;
}

const henrykimceo = {
  username: "henrykimceo",
  display_name: "Hyunmin Kim",
  display_name_ko: null,
  display_name_en: "Hyunmin Kim",
};
const founder = {
  username: "g1art_founder",
  display_name: "김현민",
  display_name_ko: "김현민",
  display_name_en: "Henry Kim",
};
const g1artkorea = {
  username: "g1artkorea",
  display_name: "지원닷아트코리아",
  display_name_ko: "지원닷아트코리아",
  display_name_en: null,
};
const theGreen = {
  username: "thegreen_oc",
  display_name: "The GREEN",
  display_name_ko: null,
  display_name_en: "The GREEN",
};

function exhibition(patch: Partial<ExhibitionWithCredits>): ExhibitionWithCredits {
  return {
    id: "ex",
    project_type: "exhibition",
    title: "t",
    title_ko: null,
    title_en: null,
    preface_ko: null,
    preface_en: null,
    start_date: null,
    end_date: null,
    status: "live",
    curator_id: "curator",
    external_curator_id: null,
    host_name: null,
    host_profile_id: null,
    cover_image_paths: null,
    created_at: null,
    ...patch,
  };
}

// 1) 같은 계정이면 전시 크레딧과 다른 화면의 이름 헬퍼가 같은 이름을 낸다.
for (const locale of ["ko", "en"] as const) {
  const t = translator(locale);
  for (const profile of [henrykimceo, founder, g1artkorea, theGreen]) {
    const name = formatDisplayName(profile, t, locale);
    assert.equal(formatIdentityPair(profile, t, locale).primary, name);
    assert.equal(
      getExhibitionHostCuratorLabel(exhibition({ curator: profile }), t, locale),
      t("exhibition.curatedBy").replace("{name}", name),
      `${profile.username} curator credit (${locale})`,
    );
  }
}

// 2) 대표님 스크린샷의 두 카드. 기획 계정이 달라서 이름이 다르다.
const ko = translator("ko");
const en = translator("en");
assert.equal(
  getExhibitionHostCuratorLabel(
    exhibition({
      curator: henrykimceo,
      host_profile_id: "g1artkorea",
      host: g1artkorea,
      host_name: "지원닷아트코리아",
    }),
    ko,
    "ko",
  ),
  "전시 지원닷아트코리아 · 기획 Hyunmin Kim",
);
assert.equal(
  getExhibitionHostCuratorLabel(
    exhibition({
      curator: founder,
      host_profile_id: "thegreen_oc",
      host: theGreen,
      host_name: "The Green Gallery",
    }),
    ko,
    "ko",
  ),
  "전시 The GREEN · 기획 김현민",
);
assert.equal(
  getExhibitionHostCuratorLabel(exhibition({ curator: founder }), en, "en"),
  "Curated by Henry Kim",
);

// 3) 계정에 연결된 주최는 계정 이름, 연결 없는 주최는 적어 둔 글자다.
assert.equal(
  getExhibitionHostCuratorLabel(
    exhibition({ curator_id: "thegreen_oc", curator: theGreen, host_name: "The Green Gallery" }),
    ko,
    "ko",
  ),
  "전시 The Green Gallery · 기획 The GREEN",
);
assert.equal(
  getExhibitionHostCuratorLabel(
    exhibition({
      curator_id: "thegreen_oc",
      curator: theGreen,
      host_profile_id: "thegreen_oc",
      host: theGreen,
      host_name: "The Green Gallery",
    }),
    ko,
    "ko",
  ),
  "전시·기획 The GREEN",
);

// 4) 크레딧과 클레임 줄의 프로필 조인은 한/영 이름을 함께 가져온다.
const exhibitionsSrc = read("src/lib/supabase/exhibitions.ts");
assert.match(
  exhibitionsSrc,
  /curator:profiles!curator_id\(display_name, display_name_ko, display_name_en, username\)/,
);
assert.match(
  exhibitionsSrc,
  /host:profiles!host_profile_id\(display_name, display_name_ko, display_name_en, username\)/,
);
for (const rel of ["src/lib/supabase/artworks.ts", "src/lib/provenance/rpc.ts"]) {
  const embeds = read(rel).match(/profiles!subject_profile_id\([^)]*\)/g) ?? [];
  assert.ok(embeds.length > 0, `${rel} embeds the claimant profile`);
  for (const embed of embeds) {
    assert.match(embed, /display_name_ko/, `${rel}: ${embed}`);
    assert.match(embed, /display_name_en/, `${rel}: ${embed}`);
  }
}
// 가격 문의의 문의자(받은 문의함, 작품 상세의 문의 목록)도 같다.
{
  const rel = "src/lib/supabase/priceInquiries.ts";
  const embeds = read(rel).match(/profiles!inquirer_id\([^)]*\)/g) ?? [];
  assert.ok(embeds.length >= 2, `${rel} embeds the inquirer profile in every inquiry select`);
  for (const embed of embeds) {
    assert.match(embed, /display_name_ko/, `${rel}: ${embed}`);
    assert.match(embed, /display_name_en/, `${rel}: ${embed}`);
  }
}

// 5) 이름을 그리는 화면은 모두 지금 로케일을 넘긴다.
function callArgs(src: string, fn: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\b${fn}\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
      i++;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

const surfaces = [
  "src/components/explore/ExploreExhibitionCard.tsx",
  "src/components/feed/ExhibitionMemoryStrip.tsx",
  "src/app/e/[id]/page.tsx",
  "src/components/UserProfileContent.tsx",
  "src/components/studio/StudioPortfolioPanel.tsx",
  "src/app/artwork/[id]/page.tsx",
  "src/components/ArtworkCard.tsx",
  "src/components/ArtworkProvenanceBlock.tsx",
  "src/app/search/SearchClient.tsx",
  "src/app/people/PeopleResultCard.tsx",
  "src/components/shell/rail/MyConnectionRail.tsx",
  "src/app/my/claims/page.tsx",
  "src/app/my/inquiries/page.tsx",
];
for (const rel of surfaces) {
  const src = read(rel);
  let seen = 0;
  for (const fn of ["getExhibitionHostCuratorLabel", "formatDisplayName", "formatIdentityPair"]) {
    for (const args of callArgs(src, fn)) {
      seen++;
      assert.match(args, /\blocale\b/, `${rel}: ${fn}(${args}) must pass locale`);
    }
  }
  for (const tag of src.match(/<ExhibitionHostCuratorCredits[^>]*>/g) ?? []) {
    seen++;
    assert.match(tag, /locale=/, `${rel}: ${tag} must pass locale`);
  }
  assert.ok(seen > 0, `${rel} renders a name through the shared helpers`);
}

// 6) 사람 검색·추천 RPC의 최신 정의는 한/영 이름 키를 돌려준다.
const migrationsDir = join(root, "supabase", "migrations");
const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => /^\d{14}_.*\.sql$/.test(name))
  .sort();

function latestDefinition(fn: string): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  const re = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${fn}\\s*\\(`, "gi");
  for (const file of migrationFiles) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    for (const m of sql.matchAll(re)) {
      const rest = sql.slice(m.index);
      const tag = /\bas\s+(\$[a-z]*\$)/i.exec(rest)?.[1];
      assert.ok(tag, `${file}: ${fn} has a dollar-quoted body`);
      const open = rest.indexOf(tag);
      found = { file, body: rest.slice(0, rest.indexOf(tag, open + tag.length)) };
    }
  }
  assert.ok(found, `${fn} is defined in a timestamped migration`);
  return found;
}

for (const fn of [
  "search_people",
  "search_artists_by_artwork",
  "search_people_with_external",
  "get_people_recs",
  "get_trending_people",
]) {
  const { file, body } = latestDefinition(fn);
  assert.match(body, /'display_name_ko'/, `${file}: ${fn} returns display_name_ko`);
  assert.match(body, /'display_name_en'/, `${file}: ${fn} returns display_name_en`);
}

console.log("credit-name-parity.test.ts: ok");
