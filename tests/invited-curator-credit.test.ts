// 2026-10-17 — 초대받은 큐레이터(projects.external_curator_id)가 초대 이메일을
// 인증하면 전시의 큐레이터 크레딧은 그 계정이다. 만든 계정(curator_id)은 그대로
// 남아 편집 권한을 유지하고, 인증 전에는 초대 이름이 크레딧이다. 크레딧 헬퍼,
// 피드 워크, 쿼리, 마이그레이션 계약을 본다. 실제 DB 동작은 롤백 시나리오
// supabase/tests/invited_curator_credit.sql 이 본다.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import {
  ExhibitionHostCuratorCredits,
  getExhibitionHostCuratorLabel,
  type ExhibitionWithCredits,
} from "../src/lib/exhibitionCredits";
import { assembleWalk } from "../src/lib/feed/walk/assemble";
import type {
  WalkExhibition,
  WalkPerson,
  WalkPools,
  WalkViewer,
  WalkWork,
} from "../src/lib/feed/walk/types";
import { messages } from "../src/lib/i18n/messages";
import type { Locale } from "../src/lib/i18n/locale";

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

function translator(locale: Locale): (key: string) => string {
  const table = messages[locale] as Record<string, string>;
  return (key) => table[key] ?? key;
}

const creator = {
  username: "probe_gallery",
  display_name: "프로브 갤러리",
  display_name_ko: "프로브 갤러리",
  display_name_en: "Probe Gallery",
};
const invite = { display_name: "박미나", display_name_ko: "박미나", display_name_en: "Mina Park" };
const account = {
  id: "acct-mina",
  username: "mina_curates",
  display_name: "박미나 큐레이터",
  display_name_ko: "박미나 큐레이터",
  display_name_en: "Mina Park Curator",
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
    curator_id: "acct-gallery",
    external_curator_id: "inv-mina",
    host_name: null,
    host_profile_id: null,
    cover_image_paths: null,
    created_at: null,
    curator: creator,
    ...patch,
  };
}

type NameNodeProps = { name: string; username: string | null };

function nameNodes(node: ReactNode, out: NameNodeProps[] = []): NameNodeProps[] {
  if (Array.isArray(node)) {
    for (const child of node) nameNodes(child, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as ReactElement<{ children?: ReactNode } & Partial<NameNodeProps>>;
  if (typeof el.type === "function" && el.type.name === "NameNode") {
    out.push({ name: el.props.name ?? "", username: el.props.username ?? null });
    return out;
  }
  return nameNodes(el.props.children, out);
}

function linked(ex: ExhibitionWithCredits, locale: Locale): NameNodeProps[] {
  return nameNodes(ExhibitionHostCuratorCredits({ exhibition: ex, t: translator(locale), locale }));
}

const pending = exhibition({ external_curator: invite });
const verified = exhibition({ external_curator: { ...invite, claimed_profile: account } });

// 1) 인증 전: 초대 이름이 크레딧, 만든 계정 이름이나 링크는 나오지 않는다.
for (const [locale, name] of [["ko", "박미나"], ["en", "Mina Park"]] as const) {
  const t = translator(locale);
  assert.equal(getExhibitionHostCuratorLabel(pending, t, locale), t("exhibition.curatedBy").replace("{name}", name));
  assert.deepEqual(linked(pending, locale), [{ name, username: null }]);
}

// 2) 인증 후: 그 계정 이름(로케일 규칙)과 프로필 링크.
for (const [locale, name] of [["ko", "박미나 큐레이터"], ["en", "Mina Park Curator"]] as const) {
  const t = translator(locale);
  assert.equal(getExhibitionHostCuratorLabel(verified, t, locale), t("exhibition.curatedBy").replace("{name}", name));
  assert.deepEqual(linked(verified, locale), [{ name, username: "mina_curates" }]);
}

// 3) 만든 계정이 주최: 주최는 만든 계정, 기획은 초대 이름 → 인증 후 그 계정.
{
  const t = translator("ko");
  const sep = t("exhibition.creditsSeparator");
  const hosted = { host_profile_id: "acct-gallery", host: creator };
  for (const [ex, name, username] of [
    [exhibition({ ...hosted, external_curator: invite }), "박미나", null],
    [exhibition({ ...hosted, external_curator: { ...invite, claimed_profile: account } }), "박미나 큐레이터", "mina_curates"],
  ] as const) {
    assert.equal(
      getExhibitionHostCuratorLabel(ex, t, "ko"),
      t("exhibition.exhibitedBy").replace("{name}", "프로브 갤러리") + sep + t("exhibition.curatedBy").replace("{name}", name)
    );
    assert.deepEqual(linked(ex, "ko"), [
      { name: "프로브 갤러리", username: "probe_gallery" },
      { name, username },
    ]);
  }
}

// 4) 인증한 큐레이터 계정이 주최이기도 하면 "주최·기획" 한 줄.
{
  const t = translator("en");
  const ex = exhibition({
    host_profile_id: account.id,
    host: account,
    external_curator: { ...invite, claimed_profile: account },
  });
  assert.equal(
    getExhibitionHostCuratorLabel(ex, t, "en"),
    t("exhibition.exhibitedAndCuratedBy").replace("{name}", "Mina Park Curator")
  );
  assert.deepEqual(linked(ex, "en"), [{ name: "Mina Park Curator", username: "mina_curates" }]);
}

// 5) 이름만 있는 주최 + 인증한 큐레이터.
{
  const t = translator("ko");
  const ex = exhibition({ host_name: "프로브 홀", external_curator: { ...invite, claimed_profile: account } });
  assert.equal(
    getExhibitionHostCuratorLabel(ex, t, "ko"),
    t("exhibition.exhibitedBy").replace("{name}", "프로브 홀") +
      t("exhibition.creditsSeparator") +
      t("exhibition.curatedBy").replace("{name}", "박미나 큐레이터")
  );
}

// 6) 초대 큐레이터가 없는 전시는 그대로: curator_id 프로필, 같은 계정 주최면 한 줄.
{
  const t = translator("ko");
  const plain = exhibition({ external_curator_id: null, external_curator: null });
  assert.equal(getExhibitionHostCuratorLabel(plain, t, "ko"), t("exhibition.curatedBy").replace("{name}", "프로브 갤러리"));
  assert.deepEqual(linked(plain, "ko"), [{ name: "프로브 갤러리", username: "probe_gallery" }]);
  const same = exhibition({
    external_curator_id: null,
    external_curator: null,
    host_profile_id: "acct-gallery",
    host: creator,
  });
  assert.equal(
    getExhibitionHostCuratorLabel(same, t, "ko"),
    t("exhibition.exhibitedAndCuratedBy").replace("{name}", "프로브 갤러리")
  );
}

// 7) 피드 워크: 인증한 계정은 curatorId 로, 인증 전 초대는 curatorName 으로 크레딧.
{
  const person = (id: string, name: string, role: WalkPerson["role"] = "artist"): WalkPerson => ({
    id,
    name,
    username: id.toLowerCase(),
    avatarUrl: null,
    oneLine: null,
    school: null,
    city: null,
    role,
    mediums: [],
    mutualNames: null,
    viewerFollows: false,
  });
  const work = (id: string, artistId: string): WalkWork => ({
    id,
    artistId,
    title: id,
    year: "2024",
    medium: "mixed",
    imagePath: null,
    exhibitionIds: [],
    size: null,
    sizeUnit: null,
  });
  const show = (patch: Partial<WalkExhibition> & Pick<WalkExhibition, "id" | "title" | "curatorId">): WalkExhibition => ({
    startDate: "2024-03-01",
    endDate: "2024-04-01",
    hostProfileId: "Gal",
    hostName: null,
    coverPath: null,
    participantIds: ["Gal"],
    workIds: [],
    city: null,
    ...patch,
  });
  const pools = (exhibitions: WalkExhibition[]): WalkPools => ({
    people: [
      person("Gal", "Probe Gallery", "gallery"),
      person("Mina", "Mina Park Curator", "curator"),
      person("A", "Ada"),
      person("B", "Bea"),
      person("C", "Cara"),
    ],
    works: [work("W1", "A"), work("W2", "B"), work("W3", "C"), work("W4", "A"), work("W5", "B"), work("W6", "C")],
    exhibitions,
    engagements: [],
    follows: [],
  });
  const anon: WalkViewer = {
    id: null,
    school: null,
    city: null,
    medium: null,
    role: null,
    exhibitionIds: [],
    artworkIds: [],
    followingIds: [],
    savedArtworkIds: [],
    inquiredArtworkIds: [],
    likedArtworkIds: [],
  };
  const curatorOnCard = (one: WalkExhibition) => {
    const page = assembleWalk({ lane: "public", viewer: anon, pools: pools([one]), cursor: null });
    const card = page.modules.find((mod) => mod.type === "exhibition_card");
    assert.ok(card && card.type === "exhibition_card", one.id);
    const curator = card.exhibition.curator;
    return curator ? { id: curator.id, name: curator.name } : null;
  };
  assert.deepEqual(
    curatorOnCard(show({ id: "E1", title: "Verified Hall", curatorId: "Mina", participantIds: ["Gal", "Mina"] })),
    { id: "Mina", name: "Mina Park Curator" }
  );
  assert.deepEqual(
    curatorOnCard(show({ id: "E2", title: "Pending Hall", curatorId: "Gal", curatorName: "Mina Park" })),
    { id: null, name: "Mina Park" }
  );
}

// 8) 쿼리: 전시 크레딧은 초대 → 인증한 계정을 함께 싣고, 프로필 목록은 그 계정이
//    가져간 초대의 전시를 포함한다. 피드 워크도 같은 칸을 읽는다.
{
  const src = read("src/lib/supabase/exhibitions.ts");
  assert.match(
    src,
    /external_curator:external_artists!external_curator_id\(display_name, display_name_ko, display_name_en, claimed_profile:profiles!claimed_profile_id\(id, display_name, display_name_ko, display_name_en, username\)\)/
  );
  assert.match(src, /from\("external_artists"\)\.select\("id"\)\.eq\("claimed_profile_id", profileId\)/);
  assert.match(src, /\.in\("external_curator_id", inviteIds\)/);
  const walk = read("src/lib/feed/walk/loadPools.ts");
  assert.match(
    walk,
    /external_curator:external_artists!external_curator_id\(claimed_profile_id, display_name, display_name_ko, display_name_en\)/
  );
}

// 9) 마이그레이션: 방문자 읽기 정책 + 큐레이터 칸 잠금, 데이터는 바꾸지 않고
//    병합 함수(작가 초대와 같은 시점·인증 조건)는 다시 정의하지 않는다.
{
  const dir = "supabase/migrations";
  const file = readdirSync(join(root, dir)).find((name) => name.endsWith("_invited_curator_credit.sql"));
  assert.ok(file, "invited_curator_credit migration missing");
  assert.match(file, /^\d{14}_invited_curator_credit\.sql$/);
  const sql = read(`${dir}/${file}`);
  const code = sql.replace(/--.*$/gm, "");
  assert.match(sql, /^-- == SECTION 1 ==/m);
  assert.match(sql, /^-- == SECTION 2 ==/m);
  for (const tag of code.match(/\$[A-Za-z0-9_]*\$/g) ?? []) assert.match(tag, /^\$[a-z]+\$$/);
  assert.match(
    code,
    /create policy external_artists_select_invited_curator\s+on public\.external_artists\s+for select\s+to public\s+using \(\s*exists \(\s*select 1\s+from public\.projects p\s+where p\.external_curator_id = external_artists\.id/
  );
  assert.match(
    code,
    /function public\.external_artist_invite_is_taken\(p_external_artist_id uuid\)[\s\S]*?security definer[\s\S]*?claimed_profile_id is not null/
  );
  assert.match(code, /current_user in \('anon', 'authenticated'\)/);
  assert.match(code, /new\.external_curator_id is distinct from old\.external_curator_id/);
  assert.match(code, /public\.external_artist_invite_is_taken\(new\.external_curator_id\)/);
  assert.match(code, /errcode = '42501'/);
  assert.match(code, /before insert or update of external_curator_id on public\.projects/);
  assert.doesNotMatch(code, /\b(update|delete from|insert into)\s+public\./i);
  assert.doesNotMatch(code, /link_matching_external_artists_for_user/);
  assert.doesNotMatch(code, /\bselect\b[^;]*\binto\s+v_/i);

  const scenario = read("supabase/tests/invited_curator_credit.sql");
  assert.match(scenario, /raise exception 'invited_curator_credit: ok'/);
  assert.match(scenario, /@example\.invalid/);
  assert.match(scenario, /FAIL unverified curator took the invite/);
  assert.match(scenario, /FAIL gallery pointed P2 at a taken invite/);
}

console.log("invited-curator-credit: ok");
