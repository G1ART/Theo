-- QA 2026-07-28 — 전시 참여자 CURATED claim 중복 봉쇄 + backfill
--
-- 배경
-- ----
-- `/my/exhibitions/[id]/add` 페이지의 "다음: 작품 선택" 버튼은 외부 작가
-- 각 행마다 `create_external_artist_and_claim(work_id=null,
-- project_id=<exhibition>)` 를 호출해 project-scope CURATED claim 을
-- INSERT 했다. `externalRows` 는 React 로컬 state 만 있어 upload 왕복 후
-- 컴포넌트가 remount 되면 초기화 → 사용자는 같은 명단을 다시 입력 →
-- "다음" 을 다시 눌러 새 claim 이 또 INSERT. `external_artists` 는 Phase A
-- 의 전역 이메일 dedupe 로 안전했지만, `claims` 에는 unique 제약이 없어
-- 같은 (project × external_artist × CURATED) claim 이 계속 쌓였다.
--
-- 실측 (2026-07-28 프로덕션 스냅숏):
--   - project-only CURATED claim 그룹 19 개 중 9 개(47%) 중복.
--   - 잉여 row 55 개, 워스트 케이스 28× (김수철, 단일 전시).
--   - work-scoped CURATED claim 은 duplicate 0 (upload 경로는 정상).
--
-- 이번 마이그레이션
-- ------------------
--   SECTION 1 — 기존 duplicate 를 canonical 1행(earliest created_at)으로
--               병합하고 나머지는 delete. 그룹 축: (project_id,
--               external_artist_id) 및 (project_id, artist_profile_id).
--               `notifications.claim_id` 는 `on delete set null` 이라
--               cascade 위험 없음.
--   SECTION 2 — partial unique index 2개 추가 (external / profile 각각).
--               앞으로 동일 조합의 두 번째 INSERT 는 no-op.
--   SECTION 3 — `create_external_artist_and_claim` (v5) 및
--               `create_claim_for_existing_artist` (v3) 을 idempotent 하게
--               재작성. project-scope path 는 `on conflict do nothing`,
--               work-scope path 는 기존 동작 유지. 반환 claim row 는 항상
--               canonical (기존/신규 무관) 을 SELECT.
--
-- 스타일 규칙 (release-workflow.mdc)
--   - dollar tag 는 letters-only (`$backfill$`, `$a$`, `$b$`).
--   - `-- == SECTION N ==` 배너로 함수 단위 분리 (dashboard 에서 하나씩
--     highlight → Run 안전).
--   - SECURITY DEFINER + `set search_path = public` 유지.
--   - 시그니처는 그대로 (arg count 동일) → 오버로드 방지.

begin;

-- == SECTION 1 == 기존 duplicate project-scope CURATED claim 병합.
--
-- 그룹 축이 두 개인데(external_artist_id vs artist_profile_id) 이 두 필드는
-- `claims_artist_ref_not_both` 로 상호 배타적이므로 각각 독립 처리해도
-- 서로 간섭하지 않는다. canonical 은 그룹 내 `created_at` 가장 이른 행,
-- 동률이면 `id` 순 (`order by created_at asc, id asc`).
--
-- 삭제 대상은 순수히 "명단 선언" 성격의 project-only CURATED 뿐.
-- work-scope CURATED / 기타 claim_type 은 건드리지 않는다.

do $backfill$
declare
  v_before_ext_dupes  int;
  v_before_prof_dupes int;
  v_deleted_ext       int := 0;
  v_deleted_prof      int := 0;
  v_batch             int;
  g record;
  v_canonical uuid;
begin
  v_before_ext_dupes := (
    select coalesce(sum(n - 1), 0) from (
      select count(*) as n
        from public.claims
       where claim_type = 'CURATED'
         and work_id is null
         and project_id is not null
         and external_artist_id is not null
       group by project_id, external_artist_id
      having count(*) > 1
    ) t
  );

  v_before_prof_dupes := (
    select coalesce(sum(n - 1), 0) from (
      select count(*) as n
        from public.claims
       where claim_type = 'CURATED'
         and work_id is null
         and project_id is not null
         and artist_profile_id is not null
       group by project_id, artist_profile_id
      having count(*) > 1
    ) t
  );

  raise notice 'exhibition_participant_dedupe: pre-backfill leaked rows (ext=%, prof=%)',
    v_before_ext_dupes, v_before_prof_dupes;

  -- 외부 작가 축 병합
  for g in
    select project_id, external_artist_id
      from public.claims
     where claim_type = 'CURATED'
       and work_id is null
       and project_id is not null
       and external_artist_id is not null
     group by project_id, external_artist_id
    having count(*) > 1
  loop
    v_canonical := (
      select id from public.claims
       where claim_type = 'CURATED'
         and work_id is null
         and project_id = g.project_id
         and external_artist_id = g.external_artist_id
       order by created_at asc, id asc
       limit 1
    );

    delete from public.claims
     where claim_type = 'CURATED'
       and work_id is null
       and project_id = g.project_id
       and external_artist_id = g.external_artist_id
       and id <> v_canonical;

    get diagnostics v_batch = row_count;
    v_deleted_ext := v_deleted_ext + v_batch;
  end loop;

  -- 프로필 축 병합
  for g in
    select project_id, artist_profile_id
      from public.claims
     where claim_type = 'CURATED'
       and work_id is null
       and project_id is not null
       and artist_profile_id is not null
     group by project_id, artist_profile_id
    having count(*) > 1
  loop
    v_canonical := (
      select id from public.claims
       where claim_type = 'CURATED'
         and work_id is null
         and project_id = g.project_id
         and artist_profile_id = g.artist_profile_id
       order by created_at asc, id asc
       limit 1
    );

    delete from public.claims
     where claim_type = 'CURATED'
       and work_id is null
       and project_id = g.project_id
       and artist_profile_id = g.artist_profile_id
       and id <> v_canonical;

    get diagnostics v_batch = row_count;
    v_deleted_prof := v_deleted_prof + v_batch;
  end loop;

  raise notice 'exhibition_participant_dedupe: deleted (ext=%, prof=%)',
    v_deleted_ext, v_deleted_prof;
end;
$backfill$;


-- == SECTION 2 == partial unique indexes.
--
-- 인덱스 predicate 는 SECTION 3 의 `on conflict ... where ...` 와 문자
-- 그대로 일치해야 Postgres inference 가 성립한다. 두 인덱스는 상호 배타적
-- 그룹 축을 다루므로 함께 존재해도 문제 없음.

create unique index if not exists uq_claims_project_curated_ext
  on public.claims (project_id, external_artist_id, claim_type)
  where work_id is null
    and claim_type = 'CURATED'
    and external_artist_id is not null;

create unique index if not exists uq_claims_project_curated_prof
  on public.claims (project_id, artist_profile_id, claim_type)
  where work_id is null
    and claim_type = 'CURATED'
    and artist_profile_id is not null;


-- == SECTION 3 == create_external_artist_and_claim v5 (idempotent).
--
-- 변경점 (vs. 20260728000000 v4):
--   * project-scope path (p_work_id is null) 는 `on conflict do nothing`
--     로 두 번째 INSERT 를 흡수. 반환할 canonical claim 은 하위 SELECT 가
--     담당 (기존/신규 무관 동일 코드 경로).
--   * work-scope path (p_work_id is not null) 는 기존 동작 유지.
--
-- 시그니처 그대로 (11 args). SECURITY DEFINER + set search_path = public.

create or replace function public.create_external_artist_and_claim(
  p_display_name       text,
  p_invite_email       text default null,
  p_work_id            uuid default null,
  p_project_id         uuid default null,
  p_claim_type         text default 'OWNS',
  p_website            text default null,
  p_instagram          text default null,
  p_visibility         text default 'public',
  p_period_status      text default null,
  p_subject_profile_id uuid default null,
  p_external_artist_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_uid        uuid := auth.uid();
  v_subject    uuid;
  v_ext_id     uuid;
  v_email      text;
  v_ext_row    jsonb;
  v_claim_row  jsonb;
  v_check      uuid;
begin
  if v_uid is null then
    raise exception 'auth.uid() is null';
  end if;
  if p_display_name is null or length(trim(p_display_name)) < 2 then
    raise exception 'display_name must be at least 2 characters';
  end if;
  if (p_work_id is null and p_project_id is null)
     or (p_work_id is not null and p_project_id is not null) then
    raise exception 'exactly one of work_id, project_id required';
  end if;
  if p_visibility is null then
    p_visibility := 'public';
  end if;
  if p_period_status is not null
     and p_period_status not in ('past', 'current', 'future') then
    raise exception 'period_status must be past, current, or future';
  end if;

  v_subject := coalesce(p_subject_profile_id, v_uid);
  if v_subject <> v_uid then
    if not public.is_active_writer_for(v_subject) then
      raise exception 'forbidden: caller is not an active account delegate writer for subject_profile_id';
    end if;
  end if;

  v_email := nullif(trim(p_invite_email), '');

  -- Phase 3-4: 명시적 external_artist_id 우선.
  if p_external_artist_id is not null then
    v_check := (
      select ea.id
        from public.external_artists ea
       where ea.id = p_external_artist_id
         and ea.claimed_profile_id is null
         and ea.invited_by in (v_uid, v_subject)
       limit 1
    );
    if v_check is not null then
      v_ext_id := v_check;
      update public.external_artists
         set website      = coalesce(nullif(trim(website), ''), nullif(trim(p_website), '')),
             instagram    = coalesce(nullif(trim(instagram), ''), nullif(trim(p_instagram), '')),
             invite_email = coalesce(nullif(trim(invite_email), ''), v_email)
       where id = v_ext_id;
    end if;
  end if;

  -- v4 fallback: 전역 dedupe helper 로 이메일/이름 매칭 재사용.
  if v_ext_id is null then
    v_ext_id := public.get_or_create_external_artist(
      trim(p_display_name),
      v_email
    );

    if v_ext_id is not null and (
         nullif(trim(coalesce(p_website, '')), '') is not null
         or nullif(trim(coalesce(p_instagram, '')), '') is not null
       ) then
      update public.external_artists
         set website   = coalesce(nullif(trim(website), ''),   nullif(trim(p_website), '')),
             instagram = coalesce(nullif(trim(instagram), ''), nullif(trim(p_instagram), ''))
       where id = v_ext_id;
    end if;
  end if;

  if v_ext_id is null then
    raise exception 'failed to resolve external_artist for display_name=% email=%',
      p_display_name, coalesce(v_email, '<none>');
  end if;

  -- v5: project-scope 는 unique index 를 통해 idempotent, work-scope 는
  -- 기존 동작 유지. `on conflict ... where ...` 의 predicate 는 SECTION 2
  -- 의 index predicate 와 정확히 일치해야 한다.
  if p_work_id is null and p_project_id is not null and p_claim_type = 'CURATED' then
    insert into public.claims (
      subject_profile_id, claim_type, work_id, project_id,
      external_artist_id, visibility, period_status
    )
    values (
      v_subject, p_claim_type, p_work_id, p_project_id,
      v_ext_id, p_visibility, p_period_status
    )
    on conflict (project_id, external_artist_id, claim_type)
      where work_id is null
        and claim_type = 'CURATED'
        and external_artist_id is not null
      do nothing;
  else
    insert into public.claims (
      subject_profile_id, claim_type, work_id, project_id,
      external_artist_id, visibility, period_status
    )
    values (
      v_subject, p_claim_type, p_work_id, p_project_id,
      v_ext_id, p_visibility, p_period_status
    );
  end if;

  v_ext_row := (select to_jsonb(e.*) from public.external_artists e where e.id = v_ext_id);

  -- canonical claim 조회: work-scope 는 방금 INSERT 된 최신 row,
  -- project-scope 는 dedupe 후 유일한 canonical row.
  if p_work_id is null then
    v_claim_row := (
      select to_jsonb(c.*) from public.claims c
       where c.project_id = p_project_id
         and c.external_artist_id = v_ext_id
         and c.claim_type = p_claim_type
         and c.work_id is null
       order by c.created_at asc, c.id asc
       limit 1
    );
  else
    v_claim_row := (
      select to_jsonb(c.*) from public.claims c
       where c.work_id = p_work_id
         and c.external_artist_id = v_ext_id
         and c.claim_type = p_claim_type
       order by c.created_at desc
       limit 1
    );
  end if;

  return jsonb_build_object('external_artist', v_ext_row, 'claim', v_claim_row);
end;
$a$;

grant execute on function public.create_external_artist_and_claim(text, text, uuid, uuid, text, text, text, text, text, uuid, uuid)
  to authenticated;


-- == SECTION 4 == create_claim_for_existing_artist v3 (idempotent).
--
-- 시그니처 그대로 (7 args). project-scope CURATED 는 unique index 로
-- idempotent, 그 외는 기존 동작.

create or replace function public.create_claim_for_existing_artist(
  p_artist_profile_id  uuid,
  p_claim_type         text,
  p_work_id            uuid default null,
  p_project_id         uuid default null,
  p_visibility         text default 'public',
  p_period_status      text default null,
  p_subject_profile_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $b$
declare
  v_uid       uuid := auth.uid();
  v_subject   uuid;
  v_claim_row jsonb;
begin
  if v_uid is null then
    raise exception 'auth.uid() is null';
  end if;
  if p_artist_profile_id is null then
    raise exception 'artist_profile_id required';
  end if;
  if (p_work_id is null and p_project_id is null)
     or (p_work_id is not null and p_project_id is not null) then
    raise exception 'exactly one of work_id, project_id required';
  end if;
  if p_visibility is null then
    p_visibility := 'public';
  end if;
  if p_period_status is not null
     and p_period_status not in ('past', 'current', 'future') then
    raise exception 'period_status must be past, current, or future';
  end if;

  v_subject := coalesce(p_subject_profile_id, v_uid);
  if v_subject <> v_uid then
    if not public.is_active_writer_for(v_subject) then
      raise exception 'forbidden: caller is not an active account delegate writer for subject_profile_id';
    end if;
  end if;

  if p_work_id is null and p_project_id is not null and p_claim_type = 'CURATED' then
    insert into public.claims (
      subject_profile_id, claim_type, work_id, project_id,
      artist_profile_id, visibility, period_status
    )
    values (
      v_subject, p_claim_type, p_work_id, p_project_id,
      p_artist_profile_id, p_visibility, p_period_status
    )
    on conflict (project_id, artist_profile_id, claim_type)
      where work_id is null
        and claim_type = 'CURATED'
        and artist_profile_id is not null
      do nothing;

    v_claim_row := (
      select to_jsonb(c.*) from public.claims c
       where c.project_id = p_project_id
         and c.artist_profile_id = p_artist_profile_id
         and c.claim_type = 'CURATED'
         and c.work_id is null
       order by c.created_at asc, c.id asc
       limit 1
    );
  else
    insert into public.claims (
      subject_profile_id, claim_type, work_id, project_id,
      artist_profile_id, visibility, period_status
    )
    values (
      v_subject, p_claim_type, p_work_id, p_project_id,
      p_artist_profile_id, p_visibility, p_period_status
    );

    v_claim_row := (
      select to_jsonb(c.*) from public.claims c
       where c.subject_profile_id = v_subject
         and c.artist_profile_id = p_artist_profile_id
         and (
           (p_work_id is not null and c.work_id = p_work_id)
           or (p_work_id is null and c.project_id = p_project_id and c.work_id is null)
         )
         and c.claim_type = p_claim_type
       order by c.created_at desc
       limit 1
    );
  end if;

  return jsonb_build_object('claim', v_claim_row);
end;
$b$;

grant execute on function public.create_claim_for_existing_artist(uuid, text, uuid, uuid, text, text, uuid)
  to authenticated;

commit;
