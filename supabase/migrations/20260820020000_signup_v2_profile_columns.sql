-- Signup v2 (2026-08-20) — profile column foundation.
--
-- Adds three columns used by the new signup wizard:
--
--   * full_name             — single "이름" 슬롯 (First/Last 분리 없음).
--                              artist mononym / KO 이름 관행 커버 + 향후
--                              결제 elevation 시 legal_first/last_name 별도.
--   * tos_accepted_at       — 계정 생성 시 ToS/Privacy 동의 timestamp.
--                              현재는 passive consent 이므로 UI 는 안 뜨고,
--                              wizard 가 완주할 때 upsert_my_profile 가 자동
--                              으로 now() 스탬프.
--   * profile_completed_at  — Signup v2 Step 3 (프로필 카드) 저장 시점을
--                              기록. NULL 이면 기존 59명처럼 "프로필 완성"
--                              배너 노출 대상 (SSOT).
--
-- age_band 컬럼은 이미 2026-02-14 profile_v0_fields.sql 에서 추가되어
-- 있으므로 이번 마이그레이션에서 다시 만들지 않는다. IF NOT EXISTS 가드가
-- 붙어 있어 재실행 안전 (idempotent).
--
-- RLS: profiles 테이블의 기존 owner-scoped UPDATE 정책
-- (profiles_update_rls.sql) 과 SELECT is_public OR owner 정책
-- (profiles_required_columns_triggers_rls.sql) 이 컬럼 추가 시 자동으로
-- 새 컬럼을 커버하므로 별도 policy 신설/수정 없음.

alter table public.profiles
  add column if not exists full_name             text,
  add column if not exists tos_accepted_at       timestamptz,
  add column if not exists profile_completed_at  timestamptz;

comment on column public.profiles.full_name is
  'Signup v2 (2026-08-20): 유저의 전체 이름 단일 컬럼. Legal name 분리는 향후 결제 elevation 시 별도 컬럼으로.';

comment on column public.profiles.tos_accepted_at is
  'Signup v2 (2026-08-20): 최초 계정 생성 시 ToS/Privacy 동의 timestamp. Passive consent.';

comment on column public.profiles.profile_completed_at is
  'Signup v2 (2026-08-20): 신 사인업 필드 (full_name, age_band 등) 채워진 시점. NULL 이면 기존 프로필처럼 "완성하기" 배너 노출 대상.';
