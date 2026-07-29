-- QA 2026-07-29 (Part B) — orphan-invites 자동 스캔 배너 강화 지원.
--
-- `/my` 대시보드 배너가 매치 신뢰도(exact vs fuzzy)를 구분해 문구/CTA 를
-- 다르게 보여줄 수 있도록 `search_orphan_external_artists_for_me` 반환
-- jsonb 에 `match_confidence` 키를 추가한다. 함수는 `setof jsonb` 를
-- 반환하므로(스키마-리스) 이 확장은 SQL 함수 시그니처(인자) 를 바꾸지
-- 않는 순수 additive 변경이다. 겸사겸사 이름 비교를 `btrim` 으로
-- 통일해 앞뒤 공백 차이로 인한 오탐/누락을 줄인다.

begin;

-- == SECTION 1 == search_orphan_external_artists_for_me: match_confidence + btrim
create or replace function public.search_orphan_external_artists_for_me(
  p_q text default null
)
returns setof jsonb
language plpgsql
security definer
stable
set search_path = public
as $orphansearch$
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

  -- caller 검색어가 있으면 그것으로, 없으면 본인 display_name 으로 매칭.
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
      -- 이 external row 에 매달린 claims 중 실제 work 가 연결된 것의 수
      (select count(distinct c.work_id)
         from public.claims c
        where c.external_artist_id = ea.id
          and c.work_id is not null)::int as works_count,
      -- 최근 3개 primary cover (privacy 안전 — public visibility 만)
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
      -- 이메일이 있는 행은 auth trigger 의 관할 이므로 제외
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
    'inviter_username', p.username,
    'invited_at', h.created_at,
    'works_count', h.works_count,
    'latest_cover_paths', h.latest_cover_paths,
    -- QA 2026-07-29 (Part B) — 대시보드 자동 스캔 배너가 exact 매치일 때만
    -- "1-click 확정" CTA 를, fuzzy 일 때는 목록 페이지로 안내하는 CTA 를
    -- 고를 수 있도록 힌트를 함께 내려준다.
    'match_confidence', case when h.tier = 0 then 'exact' else 'fuzzy' end
  )
  from hits h
  left join public.profiles p on p.id = h.invited_by
  order by h.tier asc, h.created_at desc
  limit 20;
end;
$orphansearch$;

grant execute on function public.search_orphan_external_artists_for_me(text) to authenticated;

commit;
