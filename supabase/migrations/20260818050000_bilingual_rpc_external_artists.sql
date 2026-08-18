-- QA 2026-08-17 (14) — 이중언어(KO/EN) RPC patch: 외부 작가(External Artists) 계열
--
-- 배경
-- ----
-- 감사(13) 에서 client 타입은 `MyExternalArtist.display_name_ko/en`,
-- `SearchPeopleWithExternalResult.display_name_ko/en`,
-- `OrphanExternalArtistCandidate.display_name_ko/en` 등 KO/EN 슬롯을
-- 이미 기대하고 있지만 RPC 세 개가 여전히 legacy `display_name` 만
-- 반환했다. 이 패치로:
--
--   1) list_my_external_artists(uuid)  → returns table(...): 새 컬럼 2개
--      (display_name_ko / display_name_en) 를 signature 에 추가해야
--      해서 반드시 **drop + recreate** (pg_depend 상 dependent 없음
--      확인함 — MCP 로 pg_depend 조회 시 빈 결과).
--
--   2) search_people_with_external(...): jsonb 반환이므로 additive.
--      profile 브랜치 → profiles.display_name_ko/en / bio_ko/en 노출.
--      external 브랜치 → external_artists.display_name_ko/en 노출.
--      (bio 는 external_artists 에 없음.)
--
--   3) search_orphan_external_artists_for_me(text): jsonb 반환이므로
--      additive. 원본은 이미 external 의 KO/EN 을 노출했지만 초대자
--      (inviter) profile 은 legacy display_name 만 있었다. 아래 재정의로
--      inviter_display_name_ko / inviter_display_name_en 두 키만 추가.
--
-- 보안 posture 유지
--   - `list_my_external_artists` : SECURITY DEFINER, authenticated only
--   - `search_people_with_external` : SECURITY DEFINER, stable,
--     authenticated + anon (원본과 동일)
--   - `search_orphan_external_artists_for_me` : SECURITY DEFINER,
--     stable, authenticated only
--   - external_artists 테이블의 컬럼-level allowlist 는 이미 KO/EN 을
--     포함 (20260729080000_bilingual_external_artists_grant_and_btrim_fix.sql).
--
-- 릴리즈 룰
--   - PL/pgSQL 함수 정의가 3개 → `-- == SECTION N ==` 배너로 분리,
--     letters-only dollar tag (`$a$` / `$b$` / `$c$`).
--   - dashboard 로 붙여넣을 때는 SECTION 단위로 highlight → Run.

begin;

-- == SECTION 1 == list_my_external_artists — 반환 signature 확장 (drop + recreate)
--
-- 반환 컬럼 diff:
--   OLD: (id uuid, display_name text, invite_email text, has_email boolean,
--         work_count bigint, created_at timestamptz)
--   NEW: (id uuid, display_name text, display_name_ko text,
--         display_name_en text, invite_email text, has_email boolean,
--         work_count bigint, created_at timestamptz)
--
-- pg_depend 조회로 dependent 없음 확인. `drop function ... cascade` 대신
-- `drop function ...` 로 안전하게 drop (dependent 발견 시 실패해 재검토
-- 하기 위함).
drop function if exists public.list_my_external_artists(uuid);

create or replace function public.list_my_external_artists(
  p_inviter uuid default null
)
returns table (
  id uuid,
  display_name text,
  display_name_ko text,
  display_name_en text,
  invite_email text,
  has_email boolean,
  work_count bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_uid     uuid := auth.uid();
  v_inviter uuid;
begin
  if v_uid is null then
    raise exception 'auth.uid() is null';
  end if;
  v_inviter := coalesce(p_inviter, v_uid);
  if v_inviter <> v_uid and not public.is_active_writer_for(v_inviter) then
    raise exception 'forbidden';
  end if;

  return query
    select ea.id,
           ea.display_name,
           ea.display_name_ko,
           ea.display_name_en,
           ea.invite_email,
           (nullif(trim(ea.invite_email), '') is not null) as has_email,
           (select count(*) from public.claims c
             where c.external_artist_id = ea.id and c.work_id is not null) as work_count,
           ea.created_at
      from public.external_artists ea
     where ea.invited_by = v_inviter
       and ea.claimed_profile_id is null
     order by ea.created_at desc;
end;
$a$;

grant execute on function public.list_my_external_artists(uuid) to authenticated;

-- == SECTION 2 == search_people_with_external — profile+external 브랜치에 KO/EN 추가
--
-- 원본 (20260727000000) 과 로직 동일. profile CTE 는 `p.display_name_ko`
-- / `p.display_name_en` / `p.bio_ko` / `p.bio_en` 을 추가로 select 하고,
-- external CTE 는 `ea.display_name_ko` / `ea.display_name_en` 을 추가로
-- select 한다. jsonb_build_object 최종 payload 에 slot 만 얹어서 반환.
-- (external 은 bio 가 없어 profile 만 bio_ko/en 노출.)
create or replace function public.search_people_with_external(
  p_q text,
  p_roles text[] default '{}',
  p_include_external boolean default false,
  p_inviter_id uuid default null,
  p_limit int default 15
)
returns setof jsonb
language plpgsql
security definer
stable
set search_path = public
as $b$
declare
  v_uid      uuid := auth.uid();
  v_q        text := coalesce(trim(p_q), '');
  v_q_lower  text;
  v_pattern  text;
  v_prefix   text;
  v_roles    text[] := coalesce(p_roles, '{}');
  v_limit    int := least(greatest(coalesce(p_limit, 15), 1), 30);
  v_inviter  uuid;
begin
  if v_q = '' then
    return;
  end if;

  v_q_lower := lower(v_q);
  v_pattern := '%' || v_q || '%';
  v_prefix  := v_q || '%';

  if p_include_external and v_uid is not null then
    v_inviter := coalesce(p_inviter_id, v_uid);
    if v_inviter <> v_uid then
      if not public.is_active_writer_for(v_inviter) then
        v_inviter := v_uid;
      end if;
    end if;
  else
    v_inviter := null;
  end if;

  return query
  with profile_hits as (
    select
      'profile'::text as kind,
      p.id,
      p.display_name,
      p.display_name_ko,
      p.display_name_en,
      p.username,
      p.avatar_url,
      p.main_role::text as main_role,
      p.roles,
      p.bio,
      p.bio_ko,
      p.bio_en,
      0::int as works_count,
      '{}'::text[] as latest_cover_paths,
      null::timestamptz as invited_at,
      case
        when lower(coalesce(p.username, '')) = v_q_lower then 0
        when lower(coalesce(p.display_name, '')) = v_q_lower then 1
        when lower(coalesce(p.username, '')) like lower(v_prefix)
          or lower(coalesce(p.display_name, '')) like lower(v_prefix) then 2
        when p.username ilike v_pattern or p.display_name ilike v_pattern then 3
        else 4
      end as tier,
      greatest(
        similarity(coalesce(p.username, ''), v_q),
        similarity(coalesce(p.display_name, ''), v_q)
      ) as sim
    from profiles p
    where (
        p.username ilike v_pattern or p.display_name ilike v_pattern
        or similarity(coalesce(p.username, ''), v_q) > 0.2
        or similarity(coalesce(p.display_name, ''), v_q) > 0.2
      )
      and (array_length(v_roles, 1) is null or array_length(v_roles, 1) = 0
           or (p.main_role::text = any(v_roles))
           or (coalesce(p.roles, '{}'::text[]) && v_roles))
  ),
  external_hits as (
    select
      'external'::text as kind,
      ea.id,
      ea.display_name,
      ea.display_name_ko,
      ea.display_name_en,
      null::text as username,
      null::text as avatar_url,
      null::text as main_role,
      null::text[] as roles,
      null::text as bio,
      null::text as bio_ko,
      null::text as bio_en,
      (
        select count(distinct c.work_id)
          from public.claims c
         where c.external_artist_id = ea.id
           and c.work_id is not null
      )::int as works_count,
      (
        select coalesce(array_agg(cover_path order by rn), '{}'::text[])
          from (
            select ai.storage_path as cover_path,
                   row_number() over (
                     partition by a.id
                     order by (case when ai.view_type = 'wall_mounted' then 0 else 1 end),
                              coalesce(ai.sort_order, 999),
                              ai.created_at asc
                   ) as ri,
                   row_number() over (
                     order by a.created_at desc, a.id desc
                   ) as rn
              from public.claims c
              join public.artworks a on a.id = c.work_id
              join public.artwork_images ai on ai.artwork_id = a.id
             where c.external_artist_id = ea.id
               and c.work_id is not null
               and a.visibility = 'public'
          ) t
         where t.ri = 1
           and t.rn <= 3
      ) as latest_cover_paths,
      ea.created_at as invited_at,
      case
        when lower(coalesce(ea.display_name, '')) = v_q_lower then 0
        when lower(coalesce(ea.display_name, '')) like lower(v_prefix) then 2
        when ea.display_name ilike v_pattern then 3
        else 4
      end as tier,
      similarity(coalesce(ea.display_name, ''), v_q) as sim
    from public.external_artists ea
    where v_inviter is not null
      and ea.claimed_profile_id is null
      and ea.invited_by = v_inviter
      and (
        ea.display_name ilike v_pattern
        or similarity(coalesce(ea.display_name, ''), v_q) > 0.2
      )
  ),
  combined as (
    select * from profile_hits
    union all
    select * from external_hits
  )
  select jsonb_build_object(
    'kind', c.kind,
    'id', c.id,
    'display_name', c.display_name,
    'display_name_ko', c.display_name_ko,
    'display_name_en', c.display_name_en,
    'username', c.username,
    'avatar_url', c.avatar_url,
    'main_role', c.main_role,
    'roles', c.roles,
    'bio', c.bio,
    'bio_ko', c.bio_ko,
    'bio_en', c.bio_en,
    'works_count', c.works_count,
    'latest_cover_paths', c.latest_cover_paths,
    'invited_at', c.invited_at
  )
  from combined c
  order by c.tier asc, c.sim desc nulls last, c.kind desc
  limit v_limit;
end;
$b$;

grant execute on function public.search_people_with_external(text, text[], boolean, uuid, int)
  to authenticated;
grant execute on function public.search_people_with_external(text, text[], boolean, uuid, int)
  to anon;

-- == SECTION 3 == search_orphan_external_artists_for_me — inviter KO/EN 추가
--
-- 원본 (20260729105000) 과 로직 동일. 최종 select 의 profiles join alias
-- (p) 에서 display_name_ko / display_name_en 도 함께 select 해서
-- inviter_display_name_ko / inviter_display_name_en 두 키를 payload 에
-- 추가한다. match_confidence 힌트도 그대로 유지.
create or replace function public.search_orphan_external_artists_for_me(
  p_q text default null
)
returns setof jsonb
language plpgsql
security definer
stable
set search_path = public
as $c$
declare
  v_uid       uuid := auth.uid();
  v_my_name   text;
  v_q         text;
  v_q_lower   text;
  v_pattern   text;
begin
  if v_uid is null then
    return;
  end if;

  select btrim(display_name) into v_my_name
    from public.profiles
   where id = v_uid;

  v_q := coalesce(nullif(btrim(p_q), ''), v_my_name);
  if v_q is null or length(v_q) < 2 then
    return;
  end if;
  v_q_lower := lower(v_q);
  v_pattern := '%' || v_q || '%';

  return query
  with hits as (
    select
      ea.id,
      ea.display_name,
      ea.display_name_ko,
      ea.display_name_en,
      ea.invited_by,
      ea.created_at,
      (select count(distinct c.work_id)
         from public.claims c
        where c.external_artist_id = ea.id
          and c.work_id is not null)::int as works_count,
      (
        select coalesce(array_agg(cover_path order by rn), '{}'::text[])
          from (
            select ai.storage_path as cover_path,
                   row_number() over (
                     partition by a.id
                     order by (case when ai.view_type = 'wall_mounted' then 0 else 1 end),
                              coalesce(ai.sort_order, 999),
                              ai.created_at asc
                   ) as ri,
                   row_number() over (
                     order by a.created_at desc, a.id desc
                   ) as rn
              from public.claims c
              join public.artworks a on a.id = c.work_id
              join public.artwork_images ai on ai.artwork_id = a.id
             where c.external_artist_id = ea.id
               and c.work_id is not null
               and a.visibility = 'public'
          ) t
         where t.ri = 1
           and t.rn <= 3
      ) as latest_cover_paths,
      case
        when lower(btrim(coalesce(ea.display_name, ''))) = v_q_lower then 0
        when lower(btrim(coalesce(ea.display_name_ko, ''))) = v_q_lower then 0
        when lower(btrim(coalesce(ea.display_name_en, ''))) = v_q_lower then 0
        when ea.display_name ilike v_pattern
          or ea.display_name_ko ilike v_pattern
          or ea.display_name_en ilike v_pattern then 1
        else 2
      end as tier
    from public.external_artists ea
    where ea.claimed_profile_id is null
      and nullif(btrim(ea.invite_email), '') is null
      and (
        ea.display_name ilike v_pattern
        or ea.display_name_ko ilike v_pattern
        or ea.display_name_en ilike v_pattern
      )
  )
  select jsonb_build_object(
    'id', h.id,
    'display_name', h.display_name,
    'display_name_ko', h.display_name_ko,
    'display_name_en', h.display_name_en,
    'invited_by', h.invited_by,
    'inviter_display_name', p.display_name,
    'inviter_display_name_ko', p.display_name_ko,
    'inviter_display_name_en', p.display_name_en,
    'inviter_username', p.username,
    'invited_at', h.created_at,
    'works_count', h.works_count,
    'latest_cover_paths', h.latest_cover_paths,
    'match_confidence', case when h.tier = 0 then 'exact' else 'fuzzy' end
  )
  from hits h
  left join public.profiles p on p.id = h.invited_by
  order by h.tier asc, h.created_at desc
  limit 20;
end;
$c$;

grant execute on function public.search_orphan_external_artists_for_me(text) to authenticated;

commit;
