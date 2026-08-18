-- QA 2026-08-17 (16) — `search_people_with_external` UNION 타입 mismatch 픽스
--
-- `profiles.main_role` 은 USER-DEFINED enum(`main_role`) 이고
-- external CTE 는 `null::text as main_role` 로 텍스트 리터럴을 쓴다.
-- UNION ALL 은 두 브랜치의 열 타입이 완전히 일치해야 하므로
-- 실행 시 `ERROR: UNION types main_role and text cannot be matched`
-- 로 실패했다. profile CTE 쪽에서 `p.main_role::text as main_role` 로
-- 안전 캐스팅해서 jsonb 최종 payload 의 `main_role` 문자열 표현을
-- 그대로 유지한다 (enum→text 는 semantics-preserving cast).
--
-- 다른 로직 (predicate / RLS / grants) 는 변경 없음.

begin;

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
as $a$
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
$a$;

grant execute on function public.search_people_with_external(text, text[], boolean, uuid, int)
  to authenticated;
grant execute on function public.search_people_with_external(text, text[], boolean, uuid, int)
  to anon;

commit;
