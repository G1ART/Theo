-- Phase 3 — claims 무결성 제약.
--
-- 2026-07-01 라이브 감사 결과 위반 0건 확인 후 적용:
--   claim_type 분포 = {CREATED,CURATED,EXHIBITED,INVENTORY,OWNS} (모두 유효)
--   artist_profile_id & external_artist_id 동시 not-null = 0
--   CREATED 인데 작가 참조 둘 다 null = 0
--   work당 CREATED 2개 이상 = 0
--
-- 충돌없는 적용: CHECK 는 NOT VALID 로 추가 후 VALIDATE(데이터가 깨끗하므로
-- 즉시 통과). 멀티 페르소나(작가=갤러리 등)와 무관 — 이 제약들은 "한 claim 의
-- 작가 참조는 최대 1개", "CREATED 는 작가 1명", "work 의 창작자 claim 은 1개"
-- 라는 구조 규칙일 뿐 누가 누구인지는 제한하지 않는다.

begin;

-- == SECTION 1 == claim_type 유효값 (provenance/types.ts CLAIM_TYPES 와 동기)
alter table public.claims drop constraint if exists claims_claim_type_valid;
alter table public.claims
  add constraint claims_claim_type_valid
  check (claim_type in (
    'CREATED','OWNS','INVENTORY','EXHIBITED','CURATED','INCLUDES_WORK','HOSTS_PROJECT'
  )) not valid;
alter table public.claims validate constraint claims_claim_type_valid;

-- == SECTION 2 == 작가 참조는 둘 다 동시에 가질 수 없음
alter table public.claims drop constraint if exists claims_artist_ref_not_both;
alter table public.claims
  add constraint claims_artist_ref_not_both
  check (num_nonnulls(artist_profile_id, external_artist_id) <= 1) not valid;
alter table public.claims validate constraint claims_artist_ref_not_both;

-- == SECTION 3 == CREATED 는 작가 참조 정확히 1개(프로필 XOR 외부작가)
alter table public.claims drop constraint if exists claims_created_requires_artist;
alter table public.claims
  add constraint claims_created_requires_artist
  check (
    claim_type <> 'CREATED'
    or num_nonnulls(artist_profile_id, external_artist_id) = 1
  ) not valid;
alter table public.claims validate constraint claims_created_requires_artist;

-- == SECTION 4 == work 당 창작자(CREATED) claim 은 1개
create unique index if not exists uq_claims_one_created_per_work
  on public.claims (work_id)
  where claim_type = 'CREATED' and work_id is not null;

commit;
