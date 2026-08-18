-- QA 2026-08-17 (14) — 이중언어(KO/EN) RPC patch: People 검색/추천 계열
--
-- 배경
-- ----
-- 감사(13) 에서 client 타입 `PublicProfile` / `PeopleRec` 는 이미
-- `display_name_ko` / `display_name_en` + `bio_ko` / `bio_en` 을 기대
-- 하고 있지만, 아래 세 RPC 는 여전히 legacy `display_name` / `bio` 만
-- 반환했다.
--
--   1) get_people_recs(text, text[], int, text)   — People 탭 3-lane 추천
--   2) search_people(text, text[], int, text)     — 이름/닉 검색
--   3) get_trending_people(int)                   — Trending
--
-- 세 RPC 모두 `setof jsonb` 반환 → signature 변경 없이 `create or replace`
-- 만으로 필드 추가. 원본과 동일하게 SECURITY DEFINER + stable 유지.
-- follow_graph 브랜치의 `mutual_avatars` jsonb 도 profile-level KO/EN
-- 을 함께 담아 클라이언트의 "X, Y +N follow this person" 스택도 로케일-
-- 우선으로 렌더 가능.
--
-- 릴리즈 룰
--   - PL/pgSQL 함수 정의가 3개 → `-- == SECTION N ==` 배너로 분리,
--     letters-only dollar tag (`$a$` / `$b$` / `$c$`). dashboard 로
--     붙여넣을 때는 SECTION 단위로 highlight → Run.

begin;

-- == SECTION 1 == get_people_recs — 3-lane 모두 KO/EN + bio KO/EN 추가
--
-- 원본 (20260601200000 P2) 과 로직 동일. 각 lane 의 jsonb_build_object
-- 에 `display_name_ko` / `display_name_en` / `bio_ko` / `bio_en` 4개
-- key 를 추가한다. follow_graph 의 mutual_avatars 도 마찬가지로 profile-
-- level KO/EN 을 붙여서 스택 렌더가 로케일-우선으로 동작하게 한다.
create or replace function public.get_people_recs(
  p_mode text,
  p_roles text[] default null,
  p_limit int default 15,
  p_cursor text default null
)
returns setof jsonb
language plpgsql
security definer
stable
set search_path = public
as $a$
declare
  v_uid uuid := auth.uid();
  v_roles text[] := coalesce(p_roles, '{}');
  v_limit int := least(greatest(coalesce(p_limit, 15), 1), 50);
  v_cursor_id uuid;
  v_mode text := lower(coalesce(trim(p_mode), 'follow_graph'));
  v_themes text[];
  v_mediums text[];
  v_city text;
  v_active_threshold timestamptz := now() - interval '14 days';
begin
  if p_cursor is not null and length(trim(p_cursor)) > 0 then
    begin
      v_cursor_id := convert_from(decode(p_cursor, 'base64'), 'UTF8')::uuid;
    exception when others then
      v_cursor_id := null;
    end;
  else
    v_cursor_id := null;
  end if;

  -- Non-logged-in fallback.
  if v_uid is null then
    return query
    select jsonb_build_object(
      'id', p.id, 'username', p.username,
      'display_name', p.display_name,
      'display_name_ko', p.display_name_ko,
      'display_name_en', p.display_name_en,
      'avatar_url', p.avatar_url,
      'bio', p.bio, 'bio_ko', p.bio_ko, 'bio_en', p.bio_en,
      'main_role', p.main_role, 'roles', p.roles, 'is_public', p.is_public,
      'reason_tags', '{}'::jsonb,
      'reason_detail', '{}'::jsonb,
      'mutual_follow_sources', 0,
      'liked_artists_count', 0,
      'mutual_avatars', '[]'::jsonb,
      'signal_count', 0,
      'top_signal', 'fallback',
      'is_recently_active', (p.last_active_at is not null and p.last_active_at > v_active_threshold)
    )
    from profiles p
    where p.is_public = true
      and public.is_presentable_profile(p.display_name, p.username)
      and (array_length(v_roles, 1) is null or array_length(v_roles, 1) = 0
           or (p.main_role::text = any(v_roles)) or (coalesce(p.roles, '{}'::text[]) && v_roles))
      and (v_cursor_id is null or p.id < v_cursor_id)
    order by p.id desc
    limit v_limit;
    return;
  end if;

  select coalesce(p.themes, '{}'::text[]),
         coalesce(p.mediums, '{}'::text[]),
         coalesce(nullif(trim(p.location), ''), null)
    into v_themes, v_mediums, v_city
    from profiles p where p.id = v_uid;
  v_themes := coalesce(v_themes, '{}'::text[]);
  v_mediums := coalesce(v_mediums, '{}'::text[]);

  -- follow_graph
  if v_mode = 'follow_graph' then
    return query
    with two_hop as (
      select f2.following_id as candidate_id,
        count(distinct f2.follower_id)::int as mutual_sources,
        (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'id', sp.id,
                   'username', sp.username,
                   'display_name', sp.display_name,
                   'display_name_ko', sp.display_name_ko,
                   'display_name_en', sp.display_name_en,
                   'avatar_url', sp.avatar_url
                 ) order by sp.id), '[]'::jsonb)
          from (
            select distinct sp_inner.id, sp_inner.username,
                   sp_inner.display_name,
                   sp_inner.display_name_ko,
                   sp_inner.display_name_en,
                   sp_inner.avatar_url
            from follows f2x
            join profiles sp_inner on sp_inner.id = f2x.follower_id
            where f2x.follower_id in (
                    select following_id from follows
                    where follower_id = v_uid and status = 'accepted'
                  )
              and f2x.following_id = f2.following_id
              and f2x.status = 'accepted'
              and public.is_presentable_profile(sp_inner.display_name, sp_inner.username)
            order by sp_inner.id
            limit 3
          ) sp
        ) as mutual_avatars
      from follows f1
      join follows f2 on f2.follower_id = f1.following_id
      where f1.follower_id = v_uid
        and f1.status = 'accepted'
        and f2.status = 'accepted'
        and f2.following_id != v_uid
        and f2.following_id not in (
          select following_id from follows
          where follower_id = v_uid and status = 'accepted'
        )
        and f2.following_id not in (
          select target_id from public.people_dismissals
          where user_id = v_uid and (expires_at is null or expires_at > now())
        )
      group by f2.following_id
    )
    select jsonb_build_object(
      'id', p.id, 'username', p.username,
      'display_name', p.display_name,
      'display_name_ko', p.display_name_ko,
      'display_name_en', p.display_name_en,
      'avatar_url', p.avatar_url,
      'bio', p.bio, 'bio_ko', p.bio_ko, 'bio_en', p.bio_en,
      'main_role', p.main_role, 'roles', p.roles, 'is_public', p.is_public,
      'reason_tags', '["follow_graph"]'::jsonb,
      'reason_detail', jsonb_build_object('mutual_follow_sources', th.mutual_sources),
      'mutual_follow_sources', th.mutual_sources,
      'liked_artists_count', 0,
      'mutual_avatars', th.mutual_avatars,
      'signal_count', th.mutual_sources,
      'top_signal', 'follow_graph',
      'is_recently_active', (p.last_active_at is not null and p.last_active_at > v_active_threshold)
    )
    from two_hop th
    join profiles p on p.id = th.candidate_id
    where p.is_public = true
      and public.is_presentable_profile(p.display_name, p.username)
      and (array_length(v_roles, 1) is null or array_length(v_roles, 1) = 0
           or (p.main_role::text = any(v_roles)) or (coalesce(p.roles, '{}'::text[]) && v_roles))
      and (v_cursor_id is null or p.id < v_cursor_id)
    order by th.mutual_sources desc, p.id desc
    limit v_limit;
    return;
  end if;

  -- likes_based
  if v_mode = 'likes_based' then
    return query
    with liked_artists as (
      select a.artist_id, count(*)::int as cnt
      from artwork_likes al
      join artworks a on a.id = al.artwork_id and a.visibility = 'public'
      where al.user_id = v_uid
      group by a.artist_id
    ),
    primary_rows as (
      select p.id, p.username, p.display_name,
        p.display_name_ko, p.display_name_en,
        p.avatar_url, p.bio, p.bio_ko, p.bio_en,
        p.main_role, p.roles, p.is_public, p.last_active_at, c.liked_cnt
      from (
        select la.artist_id as candidate_id, la.cnt as liked_cnt
        from liked_artists la
        where la.artist_id != v_uid
          and la.artist_id not in (
            select following_id from follows
            where follower_id = v_uid and status = 'accepted'
          )
          and la.artist_id not in (
            select target_id from public.people_dismissals
            where user_id = v_uid and (expires_at is null or expires_at > now())
          )
      ) c
      join profiles p on p.id = c.candidate_id
      where p.is_public = true
        and public.is_presentable_profile(p.display_name, p.username)
        and (array_length(v_roles, 1) is null or array_length(v_roles, 1) = 0
             or (p.main_role::text = any(v_roles)) or (coalesce(p.roles, '{}'::text[]) && v_roles))
        and (v_cursor_id is null or p.id < v_cursor_id)
      order by c.liked_cnt desc, p.id desc
      limit v_limit
    ),
    primary_count as (select count(*)::int as n from primary_rows),
    fallback_rows as (
      select p.id, p.username, p.display_name,
        p.display_name_ko, p.display_name_en,
        p.avatar_url, p.bio, p.bio_ko, p.bio_en,
        p.main_role, p.roles, p.is_public, p.last_active_at, 0::int as liked_cnt
      from profiles p
      where p.is_public = true and p.id != v_uid
        and public.is_presentable_profile(p.display_name, p.username)
        and (array_length(v_roles, 1) is null or array_length(v_roles, 1) = 0
             or (p.main_role::text = any(v_roles)) or (coalesce(p.roles, '{}'::text[]) && v_roles))
        and not exists (
          select 1 from follows f
          where f.follower_id = v_uid and f.following_id = p.id
            and f.status = 'accepted'
        )
        and p.id not in (
          select target_id from public.people_dismissals
          where user_id = v_uid and (expires_at is null or expires_at > now())
        )
        and (v_cursor_id is null or p.id < v_cursor_id)
        and (select n from primary_count) = 0
      order by p.id desc
      limit v_limit
    )
    select jsonb_build_object(
      'id', r.id, 'username', r.username,
      'display_name', r.display_name,
      'display_name_ko', r.display_name_ko,
      'display_name_en', r.display_name_en,
      'avatar_url', r.avatar_url,
      'bio', r.bio, 'bio_ko', r.bio_ko, 'bio_en', r.bio_en,
      'main_role', r.main_role, 'roles', r.roles, 'is_public', r.is_public,
      'reason_tags', case when r.liked_cnt > 0 then '["likes_based"]'::jsonb else '["fallback"]'::jsonb end,
      'reason_detail', case when r.liked_cnt > 0 then jsonb_build_object('liked_artists_count', r.liked_cnt) else '{}'::jsonb end,
      'mutual_follow_sources', 0,
      'liked_artists_count', r.liked_cnt,
      'mutual_avatars', '[]'::jsonb,
      'signal_count', r.liked_cnt,
      'top_signal', case when r.liked_cnt > 0 then 'likes_based' else 'fallback' end,
      'is_recently_active', (r.last_active_at is not null and r.last_active_at > v_active_threshold)
    )
    from (
      select * from primary_rows
      union all
      select * from fallback_rows
    ) r
    order by r.liked_cnt desc, r.id desc
    limit v_limit;
    return;
  end if;

  -- expand
  if v_mode = 'expand' then
    return query
    with liked_seed as (
      select distinct a.artist_id
      from artwork_likes al
      join artworks a on a.id = al.artwork_id
      where al.user_id = v_uid
      limit 20
    ),
    expand_pool as (
      select p.id, p.username, p.display_name,
        p.display_name_ko, p.display_name_en,
        p.avatar_url, p.bio, p.bio_ko, p.bio_en,
        p.main_role, p.roles, p.is_public, p.last_active_at,
        coalesce(p.themes, '{}'::text[]) as cand_themes,
        coalesce(p.mediums, '{}'::text[]) as cand_mediums,
        nullif(trim(p.location), '') as cand_city
      from profiles p
      where p.is_public = true and p.id != v_uid
        and public.is_presentable_profile(p.display_name, p.username)
        and p.id not in (
          select following_id from follows
          where follower_id = v_uid and status = 'accepted'
        )
        and p.id not in (
          select target_id from public.people_dismissals
          where user_id = v_uid and (expires_at is null or expires_at > now())
        )
        and (array_length(v_roles, 1) is null or array_length(v_roles, 1) = 0
             or (p.main_role::text = any(v_roles)) or (coalesce(p.roles, '{}'::text[]) && v_roles))
        and (v_cursor_id is null or p.id < v_cursor_id)
        and (
          (p.id not in (select artist_id from liked_seed) and exists (select 1 from liked_seed limit 1))
          or not exists (select 1 from liked_seed limit 1)
        )
    ),
    scored as (
      select ep.*,
        coalesce(array_length(array(select unnest(ep.cand_themes) intersect select unnest(v_themes)), 1), 0) as shared_themes_count,
        coalesce(array_length(array(select unnest(ep.cand_mediums) intersect select unnest(v_mediums)), 1), 0) as shared_mediums_count,
        case
          when v_city is not null and ep.cand_city is not null
               and lower(v_city) = lower(ep.cand_city) then 1
          else 0
        end as same_city
      from expand_pool ep
    ),
    ranked as (
      select s.*,
        (s.shared_themes_count * 3 + s.shared_mediums_count * 2 + s.same_city) as score
      from scored s
      order by score desc, s.id desc
      limit v_limit
    )
    select jsonb_build_object(
      'id', r.id, 'username', r.username,
      'display_name', r.display_name,
      'display_name_ko', r.display_name_ko,
      'display_name_en', r.display_name_en,
      'avatar_url', r.avatar_url,
      'bio', r.bio, 'bio_ko', r.bio_ko, 'bio_en', r.bio_en,
      'main_role', r.main_role, 'roles', r.roles, 'is_public', r.is_public,
      'reason_tags', case
        when r.shared_themes_count > 0 then
          case
            when r.shared_mediums_count > 0 then '["expand","similar_keywords","shared_medium"]'::jsonb
            else '["expand","similar_keywords"]'::jsonb
          end
        when r.shared_mediums_count > 0 then '["expand","shared_medium"]'::jsonb
        when r.same_city = 1 then '["expand","same_city"]'::jsonb
        else '["expand"]'::jsonb
      end,
      'reason_detail', jsonb_build_object(
        'note', 'adjacent discovery',
        'shared_themes_count', r.shared_themes_count,
        'shared_mediums_count', r.shared_mediums_count,
        'medium', case when r.shared_mediums_count > 0
                       then (select unnest(r.cand_mediums) intersect select unnest(v_mediums) limit 1)
                       else null end,
        'city', case when r.same_city = 1 then r.cand_city else null end
      ),
      'mutual_follow_sources', 0,
      'liked_artists_count', 0,
      'mutual_avatars', '[]'::jsonb,
      'signal_count', greatest(r.shared_themes_count, r.shared_mediums_count, r.same_city),
      'top_signal', case
        when r.shared_themes_count > 0 then 'shared_themes'
        when r.shared_mediums_count > 0 then 'shared_medium'
        when r.same_city = 1 then 'same_city'
        else 'expand'
      end,
      'is_recently_active', (r.last_active_at is not null and r.last_active_at > v_active_threshold)
    )
    from ranked r;
    return;
  end if;

  -- fallback: latest public.
  return query
  select jsonb_build_object(
    'id', p.id, 'username', p.username,
    'display_name', p.display_name,
    'display_name_ko', p.display_name_ko,
    'display_name_en', p.display_name_en,
    'avatar_url', p.avatar_url,
    'bio', p.bio, 'bio_ko', p.bio_ko, 'bio_en', p.bio_en,
    'main_role', p.main_role, 'roles', p.roles, 'is_public', p.is_public,
    'reason_tags', '["fallback"]'::jsonb,
    'reason_detail', '{}'::jsonb,
    'mutual_follow_sources', 0,
    'liked_artists_count', 0,
    'mutual_avatars', '[]'::jsonb,
    'signal_count', 0,
    'top_signal', 'fallback',
    'is_recently_active', (p.last_active_at is not null and p.last_active_at > v_active_threshold)
  )
  from profiles p
  where p.is_public = true and p.id != v_uid
    and public.is_presentable_profile(p.display_name, p.username)
    and (array_length(v_roles, 1) is null or array_length(v_roles, 1) = 0
         or (p.main_role::text = any(v_roles)) or (coalesce(p.roles, '{}'::text[]) && v_roles))
    and not exists (
      select 1 from follows f
      where f.follower_id = v_uid and f.following_id = p.id
        and f.status = 'accepted'
    )
    and p.id not in (
      select target_id from public.people_dismissals
      where user_id = v_uid and (expires_at is null or expires_at > now())
    )
    and (v_cursor_id is null or p.id < v_cursor_id)
  order by p.id desc
  limit v_limit;
end;
$a$;

grant execute on function public.get_people_recs(text, text[], int, text) to authenticated;
grant execute on function public.get_people_recs(text, text[], int, text) to anon;

-- == SECTION 2 == search_people — display_name_ko/en + bio_ko/en 추가
create or replace function public.search_people(
  p_q text,
  p_roles text[] default '{}',
  p_limit int default 15,
  p_cursor text default null
)
returns setof jsonb
language plpgsql
security definer
stable
set search_path = public
as $b$
declare
  v_q text := coalesce(trim(p_q), '');
  v_q_lower text;
  v_pattern text;
  v_prefix_pattern text;
  v_roles text[] := coalesce(p_roles, '{}');
  v_cursor_id uuid := nullif(p_cursor, '')::uuid;
begin
  if v_q = '' then
    return;
  end if;
  v_q_lower := lower(v_q);
  v_pattern := '%' || v_q || '%';
  v_prefix_pattern := v_q || '%';

  return query
  with scored as (
    select p.id, p.username, p.display_name,
           p.display_name_ko, p.display_name_en,
           p.avatar_url, p.bio, p.bio_ko, p.bio_en,
           p.main_role, p.roles, p.is_public,
           case
             when lower(coalesce(p.username, '')) = v_q_lower then 0
             when lower(coalesce(p.display_name, '')) = v_q_lower then 1
             when lower(coalesce(p.username, '')) like lower(v_prefix_pattern)
               or lower(coalesce(p.display_name, '')) like lower(v_prefix_pattern) then 2
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
      and (v_cursor_id is null or p.id < v_cursor_id)
  )
  select jsonb_build_object(
    'id', s.id, 'username', s.username,
    'display_name', s.display_name,
    'display_name_ko', s.display_name_ko,
    'display_name_en', s.display_name_en,
    'avatar_url', s.avatar_url,
    'bio', s.bio, 'bio_ko', s.bio_ko, 'bio_en', s.bio_en,
    'main_role', s.main_role, 'roles', s.roles, 'is_public', s.is_public,
    'reason', 'search',
    'match_rank', case when s.tier <= 1 then 0 else 1 end,
    'match_tier', s.tier,
    'match_similarity', s.sim
  )
  from scored s
  order by s.tier asc, s.sim desc nulls last, s.id desc
  limit greatest(coalesce(p_limit, 15), 1);
end;
$b$;

grant execute on function public.search_people(text, text[], int, text) to authenticated;
grant execute on function public.search_people(text, text[], int, text) to anon;

-- == SECTION 3 == get_trending_people — display_name_ko/en + bio_ko/en 추가
create or replace function public.get_trending_people(
  p_limit int default 8
)
returns setof jsonb
language plpgsql
security definer
stable
set search_path = public
as $c$
declare
  v_uid uuid := auth.uid();
  v_limit int := least(greatest(coalesce(p_limit, 8), 1), 24);
  v_since timestamptz := now() - interval '7 days';
begin
  return query
  with new_followers as (
    select f.following_id as candidate_id,
           count(*)::int as recent_followers
    from public.follows f
    where f.status = 'accepted'
      and f.created_at >= v_since
      and f.following_id != coalesce(v_uid, '00000000-0000-0000-0000-000000000000'::uuid)
    group by f.following_id
  )
  select jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'display_name_ko', p.display_name_ko,
    'display_name_en', p.display_name_en,
    'avatar_url', p.avatar_url,
    'bio', p.bio, 'bio_ko', p.bio_ko, 'bio_en', p.bio_en,
    'main_role', p.main_role,
    'roles', p.roles,
    'is_public', p.is_public,
    'reason_tags', '["trending"]'::jsonb,
    'reason_detail', jsonb_build_object('recent_followers', nf.recent_followers),
    'mutual_follow_sources', 0,
    'liked_artists_count', 0,
    'mutual_avatars', '[]'::jsonb,
    'signal_count', nf.recent_followers,
    'top_signal', 'trending',
    'is_recently_active', (p.last_active_at is not null and p.last_active_at > now() - interval '14 days')
  )
  from new_followers nf
  join public.profiles p on p.id = nf.candidate_id
  where p.is_public = true
    and public.is_presentable_profile(p.display_name, p.username)
    and (
      v_uid is null
      or p.id not in (
        select following_id from public.follows
        where follower_id = v_uid and status = 'accepted'
      )
    )
    and (
      v_uid is null
      or p.id not in (
        select target_id from public.people_dismissals
        where user_id = v_uid
          and (expires_at is null or expires_at > now())
      )
    )
  order by nf.recent_followers desc, p.id desc
  limit v_limit;
end;
$c$;

grant execute on function public.get_trending_people(int) to authenticated;
grant execute on function public.get_trending_people(int) to anon;

commit;
