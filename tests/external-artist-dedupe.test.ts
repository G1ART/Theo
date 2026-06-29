// QA 2026-06-30 — 외부(초대 전) 작가 엔티티 정규화(dedupe) 마이그레이션 계약.
//
// 비온보딩 작가를 매 업로드마다 재초대 → 매번 새 external_artists 행이
// 생기던 문제를 (1) 기존 중복 행 병합 백필 + (2) 업로드 RPC 재사용으로
// 해결한다. 이 테스트는 마이그레이션이 그 두 가지를 모두 담고 있고,
// 가입 시 invite_email 매칭/동명이인 가드 같은 안전장치를 유지하는지
// 소스 레벨에서 검증한다(Supabase 클라이언트/환경변수 비의존).

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const migrationsDir = join(root, "supabase", "migrations");

const mig = readdirSync(migrationsDir)
  .filter((n) => n.includes("external_artist_dedupe"))
  .sort()
  .pop();
assert.ok(mig, "expected external_artist_dedupe migration to exist");
const sql = readFileSync(join(migrationsDir, mig!), "utf8");

// 1) 백필: 이름 기준 병합 + 동명이인(이메일) 가드 ------------------------
assert.match(sql, /do \$a\$/, "section 1 must be a DO block");
assert.match(
  sql,
  /group by lower\(trim\(display_name\)\)/,
  "backfill must group duplicates by normalized display_name",
);
assert.match(
  sql,
  /count\(distinct lower\(trim\(invite_email\)\)\)/,
  "backfill must guard on distinct emails (possible homonyms)",
);
assert.match(
  sql,
  /v_email_count >= 2/,
  "backfill must skip merging when >=2 distinct emails",
);
// canonical 선정: 이메일 보유 행 우선
assert.match(
  sql,
  /order by \(nullif\(trim\(invite_email\), ''\) is null\), created_at asc/,
  "canonical row must prefer the one carrying an invite_email",
);
// 온보딩 완료 행은 건드리지 않음
assert.match(
  sql,
  /claimed_profile_id is null/,
  "backfill must leave already-claimed external artists alone",
);
// claim 재지정 + 잔여 행 삭제
assert.match(sql, /update public\.claims\s+set external_artist_id = v_canonical/);
assert.match(sql, /delete from public\.external_artists/);

// 2) 업로드 RPC dedupe ----------------------------------------------------
assert.match(
  sql,
  /create or replace function public\.create_external_artist_and_claim/,
  "must redefine create_external_artist_and_claim",
);
// 이메일이 있으면 이메일 기준 재사용
assert.match(
  sql,
  /lower\(trim\(invite_email\)\) = lower\(v_email\)/,
  "dedupe must reuse by invite_email when present",
);
// 이메일이 없으면 (초대자 + 이름 + 이메일 없음) 기준 재사용
assert.match(
  sql,
  /lower\(trim\(display_name\)\) = lower\(trim\(p_display_name\)\)/,
  "dedupe must reuse by display_name when no email",
);
assert.match(
  sql,
  /invited_by = v_uid/,
  "dedupe lookup must be scoped to the inviter",
);
// writer 가드(위임 업로드)는 유지되어야 함
assert.match(
  sql,
  /is_active_writer_for\(v_subject\)/,
  "delegate writer guard must be preserved",
);

// 3) 그룹핑 헬퍼가 안정 id 우선 ------------------------------------------
const artworksSrc = readFileSync(
  join(root, "src/lib/supabase/artworks.ts"),
  "utf8",
);
assert.match(
  artworksSrc,
  /ext:\$\{externalClaim\.external_artist_id\}/,
  "group key must prefer the stabilized external_artist_id",
);

console.log("external-artist-dedupe.test.ts: ok");
