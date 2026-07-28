-- QA 2026-07-28 Phase E — 관리자용 external_artists 병합 도구
--
-- 목적
-- ----
-- 기존 duplicate rows (배포 이전에 만들어진 no-email 중복, 또는 데이터
-- 불일치로 남은 잔재) 를 하나의 target row 로 흡수하는 관리자 전용 RPC.
--
-- 왜 필요한가
-- ------------
-- Phase A 로 신규 upload 경로의 duplicate 는 방지되지만, 과거에 생긴
-- 중복 은 여전히 존재할 수 있다. 관리자 (또는 향후 self-serve 도구)
-- 로 안전하게 합칠 방법이 필요.
--
-- 접근 모델
-- ---------
-- 별도의 admin role infrastructure 는 아직 정착되지 않았으므로, 아주
-- 작은 `platform_admins` 테이블 (profile_id → 부여 시각) 을 도입한다.
-- 초기값은 비어 있으며, ops 는 SQL editor 에서 명시적으로 자기 자신을
-- 추가해야 한다. 이는 실수로 아무나 병합을 수행하는 것을 막는 최소
-- 방어선.
--
-- 병합 규칙
-- ---------
--   * `p_target_id` 는 unclaimed 여야 함 (claimed 는 auth trigger 나
--     Phase D 로 정리되므로 관리자 개입 대상 아님)
--   * `p_source_ids` 는 unclaimed 여야 하며 target 과 달라야 함
--   * source 의 모든 `claims.external_artist_id` 를 target 으로 재지정
--   * source 의 website / instagram 이 target 에 비어 있으면 backfill
--   * source 의 display_name_ko / display_name_en 도 target 에 비어 있으면 backfill
--   * source row status = 'merged', invite_email = null (전역 unique
--     index slot 회수), display_name 앞에 '[merged→<target>]' 접두어
--     추가 (감사용)
--
-- 안전장치
-- ---------
--   * 병합 후 롤백은 불가능. UI 는 target/source 카드를 미리보기로
--     보여준 뒤 명시적 확인 요구
--   * 대상 개수 <= 20 으로 제한 (트랜잭션 크기)

begin;

-- == SECTION 1 == platform_admins 인프라
create table if not exists public.platform_admins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  note       text
);

comment on table public.platform_admins is
  'Manually managed allowlist of ops-privileged profile ids. Populate via SQL only.';

alter table public.platform_admins enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'platform_admins'
       and policyname = 'platform_admins self read'
  ) then
    create policy "platform_admins self read"
      on public.platform_admins for select
      using (profile_id = auth.uid());
  end if;
end $$;

create or replace function public.is_ops_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $b$
  select exists(
    select 1 from public.platform_admins
     where profile_id = auth.uid()
  );
$b$;

grant execute on function public.is_ops_user() to authenticated;

-- == SECTION 2 == admin_merge_external_artists
create or replace function public.admin_merge_external_artists(
  p_source_ids uuid[],
  p_target_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $c$
declare
  v_uid           uuid := auth.uid();
  v_target        public.external_artists;
  v_src           public.external_artists;
  v_claims_moved  int := 0;
  v_src_count     int := 0;
begin
  if v_uid is null then
    raise exception 'auth.uid() is null';
  end if;
  if not public.is_ops_user() then
    raise exception 'forbidden: caller is not a platform admin';
  end if;
  if p_target_id is null then
    raise exception 'target_id required';
  end if;
  if p_source_ids is null or array_length(p_source_ids, 1) is null then
    raise exception 'at least one source_id required';
  end if;
  if array_length(p_source_ids, 1) > 20 then
    raise exception 'batch too large (max 20 source ids)';
  end if;

  select * into v_target from public.external_artists where id = p_target_id for update;
  if v_target.id is null then
    raise exception 'target external_artist not found';
  end if;
  if v_target.claimed_profile_id is not null then
    raise exception 'target already claimed --- merge into claimed profiles is not supported here';
  end if;

  for v_src in
    select * from public.external_artists
     where id = any(p_source_ids)
       and id <> p_target_id
     for update
  loop
    if v_src.claimed_profile_id is not null then
      raise exception 'source % is already claimed --- refuse to merge', v_src.id;
    end if;

    -- 1) claims 재지정
    with upd as (
      update public.claims
         set external_artist_id = v_target.id
       where external_artist_id = v_src.id
       returning 1
    )
    select v_claims_moved + count(*) into v_claims_moved from upd;

    -- 2) 메타데이터 backfill (target 이 비어있을 때만)
    update public.external_artists t
       set website         = coalesce(nullif(trim(t.website), ''),         nullif(trim(v_src.website), '')),
           instagram       = coalesce(nullif(trim(t.instagram), ''),       nullif(trim(v_src.instagram), '')),
           display_name_ko = coalesce(nullif(trim(t.display_name_ko), ''), nullif(trim(v_src.display_name_ko), '')),
           display_name_en = coalesce(nullif(trim(t.display_name_en), ''), nullif(trim(v_src.display_name_en), ''))
     where t.id = v_target.id;

    -- 3) source soft-delete: unique index slot 해제 + 감사 marker
    update public.external_artists
       set status = 'merged',
           invite_email = null,
           display_name = left(
             '[merged->' || v_target.id::text || '] ' || coalesce(display_name, ''),
             160
           )
     where id = v_src.id;

    v_src_count := v_src_count + 1;
  end loop;

  return jsonb_build_object(
    'target_id', v_target.id,
    'source_count', v_src_count,
    'claims_moved', v_claims_moved
  );
end;
$c$;

grant execute on function public.admin_merge_external_artists(uuid[], uuid) to authenticated;

-- == SECTION 3 == 감사용 조회 (관리자만)
create or replace function public.admin_search_external_artist_duplicates()
returns setof jsonb
language plpgsql
security definer
stable
set search_path = public
as $d$
begin
  if auth.uid() is null then
    return;
  end if;
  if not public.is_ops_user() then
    raise exception 'forbidden: caller is not a platform admin';
  end if;

  return query
  with groups as (
    -- 이메일 없는 no-email 중복 (역사적 이슈)
    select
      'noemail-name'::text as bucket,
      lower(trim(display_name)) as key,
      array_agg(id order by created_at asc) as ids,
      count(*) as n
    from public.external_artists
    where claimed_profile_id is null
      and nullif(trim(invite_email), '') is null
      and nullif(trim(display_name), '') is not null
    group by lower(trim(display_name))
    having count(*) > 1
    union all
    -- 이메일 있는 것과 없는 것이 이름이 같은 경우 (병합 후보)
    select
      'mixed-email-noemail'::text as bucket,
      lower(trim(display_name)) as key,
      array_agg(id order by created_at asc) as ids,
      count(*) as n
    from public.external_artists
    where claimed_profile_id is null
      and nullif(trim(display_name), '') is not null
    group by lower(trim(display_name))
    having
      count(*) filter (where nullif(trim(invite_email), '') is null) > 0
      and count(*) filter (where nullif(trim(invite_email), '') is not null) > 0
  )
  select jsonb_build_object(
    'bucket', g.bucket,
    'key', g.key,
    'ids', g.ids,
    'n', g.n
  )
  from groups g
  order by g.n desc, g.key asc
  limit 100;
end;
$d$;

grant execute on function public.admin_search_external_artist_duplicates() to authenticated;

-- == SECTION 4 == admin_fetch_external_artist_batch — id 목록으로 상세 조회
create or replace function public.admin_fetch_external_artist_batch(p_ids uuid[])
returns setof jsonb
language plpgsql
security definer
stable
set search_path = public
as $e$
begin
  if auth.uid() is null then return; end if;
  if not public.is_ops_user() then
    raise exception 'forbidden: caller is not a platform admin';
  end if;
  return query
  select jsonb_build_object(
    'id', ea.id,
    'display_name', ea.display_name,
    'display_name_ko', ea.display_name_ko,
    'display_name_en', ea.display_name_en,
    'invite_email', ea.invite_email,
    'invited_by', ea.invited_by,
    'website', ea.website,
    'instagram', ea.instagram,
    'claimed_profile_id', ea.claimed_profile_id,
    'status', ea.status,
    'created_at', ea.created_at
  )
  from public.external_artists ea
  where ea.id = any(p_ids)
  order by ea.created_at asc;
end;
$e$;

grant execute on function public.admin_fetch_external_artist_batch(uuid[]) to authenticated;

commit;
