-- 초대 메일이 간 비온보딩 작가 → 그 이메일로 온보딩이 끝나면 작품·크레딧 병합.
--
-- 배경
-- ----
-- 자동 링크는 원래 `auth.users` AFTER INSERT 한 곳뿐이었다.
-- 전시/단일/벌크 초대는 `signInWithOtp` 로 auth 행을 *먼저* 만든다.
-- 그 INSERT 가 트리거보다 앞서거나, 온보딩이 나중에 confirm +
-- `upsert_my_profile` 만 타면 병합이 영구히 비었다.
-- (2026-09-10 heimyunghyun: auth 행 2026-07-25, 프로필 오늘, EA 미클레임)
--
-- 가계정을 안 만들면 예전에 위임 초대 FK ("Database error saving new user")
-- 같은 구멍이 났다. OTP 사전 생성은 유지한다. 고스트/진계정 구분은
-- 병합 조건이 아니다. SSOT 는 이메일 매칭 한 함수다.
--
-- CREATED 헬퍼는 `claims_created_requires_artist` 때문에
-- artist_profile_id 가 필요하다. 예전 헬퍼는 subject 만 채워 큐레이터
-- 업로드(CREATED 없음) 병합이 실패했다.
--
-- 적용: Dashboard SQL Editor 에서 섹션 단위로 highlight → Run.
-- 한꺼번에 paste 하지 않는다. dollar tag 는 letters only.
--
--   SECTION 1 — ensure_created_claims_for_linked_artist 에 artist_profile_id
--   SECTION 2 — link_matching_external_artists_for_user(uuid)
--   SECTION 3 — auth.users INSERT 트리거를 같은 함수 호출로 축소
--   SECTION 4 — auth.users UPDATE (email / email_confirmed_at)
--   SECTION 5 — profiles INSERT OR UPDATE (온보딩 저장 포함)
--   SECTION 6 — 이미 온보딩된 미클레임 이메일 백필
--
-- authenticated 에 grant 하지 않는다. 트리거·백필 전용.

-- ===========================================================================
-- == SECTION 1 == CREATED 헬퍼 — artist_profile_id 필수
-- ===========================================================================
create or replace function public.ensure_created_claims_for_linked_artist(
  p_subject_profile_id uuid,
  p_work_ids uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $ensurefix$
begin
  if p_subject_profile_id is null
     or p_work_ids is null
     or array_length(p_work_ids, 1) is null then
    return;
  end if;

  insert into public.claims (
    subject_profile_id, claim_type, work_id, status, visibility, period_status,
    artist_profile_id
  )
  select
    p_subject_profile_id,
    'CREATED',
    a.id,
    'confirmed',
    'public',
    null,
    p_subject_profile_id
  from public.artworks a
  where a.id = any(p_work_ids)
    and not exists (
      select 1 from public.claims c
      where c.work_id = a.id and c.claim_type = 'CREATED'
    );
end;
$ensurefix$;

revoke all on function public.ensure_created_claims_for_linked_artist(uuid, uuid[])
  from public, authenticated, anon;


-- ===========================================================================
-- == SECTION 2 == link_matching_external_artists_for_user
-- ===========================================================================
create or replace function public.link_matching_external_artists_for_user(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $linkfn$
declare
  v_email text;
  v_ext_ids uuid[];
  v_work_ids uuid[];
  v_ext_ko text;
  v_ext_en text;
begin
  if p_user_id is null then
    return;
  end if;

  v_email := coalesce(
    nullif(trim((
      select u.email from auth.users u where u.id = p_user_id
    )), ''),
    ''
  );
  if v_email = '' then
    return;
  end if;

  insert into public.profiles (
    id, is_public, roles, profile_completeness, profile_details,
    profile_updated_at, updated_at
  )
  values (
    p_user_id, true, '{}'::text[], 0, '{}'::jsonb, now(), now()
  )
  on conflict (id) do nothing;

  update public.external_artists
     set claimed_profile_id = p_user_id,
         status = 'claimed'
   where lower(trim(invite_email)) = lower(v_email)
     and claimed_profile_id is null;

  v_ext_ids := (
    select array_agg(id)
      from public.external_artists
     where claimed_profile_id = p_user_id
  );

  if v_ext_ids is null or array_length(v_ext_ids, 1) is null then
    return;
  end if;

  v_ext_ko := (
    select max(nullif(trim(coalesce(display_name_ko, '')), ''))
      from public.external_artists
     where id = any(v_ext_ids)
       and display_name_ko is not null
  );
  v_ext_en := (
    select max(nullif(trim(coalesce(display_name_en, '')), ''))
      from public.external_artists
     where id = any(v_ext_ids)
       and display_name_en is not null
  );

  update public.profiles
     set display_name_ko = coalesce(display_name_ko, v_ext_ko),
         display_name_en = coalesce(display_name_en, v_ext_en)
   where id = p_user_id
     and (
       (display_name_ko is null and v_ext_ko is not null)
       or (display_name_en is null and v_ext_en is not null)
     );

  v_work_ids := (
    select array_agg(work_id)
      from public.claims
     where external_artist_id = any(v_ext_ids)
       and work_id is not null
  );

  update public.claims
     set artist_profile_id = p_user_id,
         external_artist_id = null
   where external_artist_id = any(v_ext_ids);

  if v_work_ids is not null and array_length(v_work_ids, 1) > 0 then
    update public.artworks
       set artist_id = p_user_id
     where id = any(v_work_ids);

    perform public.ensure_created_claims_for_linked_artist(p_user_id, v_work_ids);
  end if;
end;
$linkfn$;

revoke all on function public.link_matching_external_artists_for_user(uuid)
  from public, authenticated, anon;


-- ===========================================================================
-- == SECTION 3 == auth.users INSERT — 같은 함수. OTP 사전 생성은 유지.
-- ===========================================================================
create or replace function public.handle_auth_user_created_link_external_artist()
returns trigger
language plpgsql
security definer
set search_path = public
as $authins$
begin
  perform public.link_matching_external_artists_for_user(new.id);
  return new;
end;
$authins$;

drop trigger if exists on_auth_user_created_link_external_artist on auth.users;
create trigger on_auth_user_created_link_external_artist
  after insert on auth.users
  for each row execute function public.handle_auth_user_created_link_external_artist();


-- ===========================================================================
-- == SECTION 4 == auth.users UPDATE — confirm / 이메일 확정 때도 병합
-- ===========================================================================
create or replace function public.handle_auth_user_updated_link_external_artist()
returns trigger
language plpgsql
security definer
set search_path = public
as $authupd$
begin
  perform public.link_matching_external_artists_for_user(new.id);
  return new;
end;
$authupd$;

drop trigger if exists on_auth_user_updated_link_external_artist on auth.users;
create trigger on_auth_user_updated_link_external_artist
  after update of email, email_confirmed_at on auth.users
  for each row
  when (
    new.email is not null
    and trim(new.email) <> ''
    and (
      old.email is distinct from new.email
      or old.email_confirmed_at is distinct from new.email_confirmed_at
    )
  )
  execute function public.handle_auth_user_updated_link_external_artist();


-- ===========================================================================
-- == SECTION 5 == profiles INSERT OR UPDATE — 정체성 저장이 병합 SSOT
-- ===========================================================================
create or replace function public.handle_profile_link_external_artists()
returns trigger
language plpgsql
security definer
set search_path = public
as $proflnk$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  perform public.link_matching_external_artists_for_user(new.id);
  return new;
end;
$proflnk$;

drop trigger if exists on_profile_link_external_artists on public.profiles;
create trigger on_profile_link_external_artists
  after insert or update on public.profiles
  for each row execute function public.handle_profile_link_external_artists();


-- ===========================================================================
-- == SECTION 6 == 이미 온보딩된 미클레임 초대 이메일 백필
-- ===========================================================================
do $backfill$
declare
  r record;
begin
  for r in
    select distinct u.id as user_id
      from auth.users u
      join public.external_artists ea
        on lower(trim(ea.invite_email)) = lower(trim(u.email))
     where ea.claimed_profile_id is null
       and nullif(trim(u.email), '') is not null
  loop
    begin
      perform public.link_matching_external_artists_for_user(r.user_id);
    exception when others then
      raise warning 'link_matching_external_artists_for_user %: %', r.user_id, sqlerrm;
    end;
  end loop;
end;
$backfill$;
