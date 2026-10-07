-- Search: artist name, bilingual titles, and one-character typos.
-- pg_trgm is already enabled in production. This file creates it if missing,
-- adds trigram indexes, and replaces the search functions.
--
-- Run in the Supabase SQL Editor one section at a time (highlight → Run).
-- Do not paste the whole file at once. Dollar quotes are letters only.

-- == SECTION 1 == extension and trigram indexes
create extension if not exists pg_trgm;

create index if not exists idx_artworks_title_trgm
  on public.artworks using gin (title gin_trgm_ops);
create index if not exists idx_artworks_title_ko_trgm
  on public.artworks using gin (title_ko gin_trgm_ops);
create index if not exists idx_artworks_title_en_trgm
  on public.artworks using gin (title_en gin_trgm_ops);
create index if not exists idx_profiles_display_name_ko_trgm
  on public.profiles using gin (display_name_ko gin_trgm_ops);
create index if not exists idx_profiles_display_name_en_trgm
  on public.profiles using gin (display_name_en gin_trgm_ops);

-- == SECTION 2 == artwork_alt_hits
-- One alternate (a token or a related word) against a work, its artist,
-- the uploader, and exhibition titles the viewer is allowed to know.
create or replace function public.artwork_alt_hits(
  p_title text,
  p_title_ko text,
  p_title_en text,
  p_medium text,
  p_medium_ko text,
  p_medium_en text,
  p_story text,
  p_story_ko text,
  p_story_en text,
  p_artist_username text,
  p_artist_name text,
  p_artist_ko text,
  p_artist_en text,
  p_uploader_username text,
  p_uploader_name text,
  p_uploader_ko text,
  p_uploader_en text,
  p_artwork_id uuid,
  p_alt text
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $hit$
  select
    p_alt is not null
    and length(btrim(p_alt)) > 0
    and (
      concat_ws(
        ' ',
        p_title, p_title_ko, p_title_en,
        p_medium, p_medium_ko, p_medium_en,
        left(coalesce(p_story, ''), 500),
        left(coalesce(p_story_ko, ''), 500),
        left(coalesce(p_story_en, ''), 500),
        p_artist_username, p_artist_name, p_artist_ko, p_artist_en,
        p_uploader_username, p_uploader_name, p_uploader_ko, p_uploader_en
      ) ilike '%' || replace(replace(btrim(p_alt), '%', ''), '_', '') || '%'
      or (
        char_length(btrim(p_alt)) >= 4
        and (
          word_similarity(btrim(p_alt), coalesce(p_title, '')) >= 0.5
          or word_similarity(btrim(p_alt), coalesce(p_title_ko, '')) >= 0.5
          or word_similarity(btrim(p_alt), coalesce(p_title_en, '')) >= 0.5
          or word_similarity(btrim(p_alt), coalesce(p_artist_name, '')) >= 0.5
          or word_similarity(btrim(p_alt), coalesce(p_artist_ko, '')) >= 0.5
          or word_similarity(btrim(p_alt), coalesce(p_artist_en, '')) >= 0.5
          or word_similarity(btrim(p_alt), coalesce(p_artist_username, '')) >= 0.5
          or word_similarity(btrim(p_alt), coalesce(p_uploader_name, '')) >= 0.5
          or word_similarity(btrim(p_alt), coalesce(p_uploader_en, '')) >= 0.5
          or word_similarity(btrim(p_alt), coalesce(p_uploader_username, '')) >= 0.5
        )
      )
      or (
        btrim(p_alt) ~ '[가-힣]'
        and char_length(btrim(p_alt)) >= 2
        and char_length(btrim(p_alt)) < 4
        and (
          word_similarity(btrim(p_alt), coalesce(p_artist_name, '')) >= 0.5
          or word_similarity(btrim(p_alt), coalesce(p_artist_ko, '')) >= 0.5
          or word_similarity(btrim(p_alt), coalesce(p_title, '')) >= 0.5
          or word_similarity(btrim(p_alt), coalesce(p_title_ko, '')) >= 0.5
        )
      )
      or exists (
        select 1
        from public.exhibition_works ew
        join public.projects proj on proj.id = ew.exhibition_id
        where ew.work_id = p_artwork_id
          and (
            proj.status in ('live', 'ended')
            or proj.curator_id = auth.uid()
            or proj.host_profile_id = auth.uid()
          )
          and (
            concat_ws(' ', proj.title, proj.title_ko, proj.title_en)
              ilike '%' || replace(replace(btrim(p_alt), '%', ''), '_', '') || '%'
            or (
              char_length(btrim(p_alt)) >= 4
              and (
                word_similarity(btrim(p_alt), coalesce(proj.title, '')) >= 0.5
                or word_similarity(btrim(p_alt), coalesce(proj.title_ko, '')) >= 0.5
                or word_similarity(btrim(p_alt), coalesce(proj.title_en, '')) >= 0.5
              )
            )
          )
      )
    );
$hit$;

grant execute on function public.artwork_alt_hits(
  text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, uuid, text
) to anon, authenticated;

-- == SECTION 3 == search_artwork_ids
-- p_groups is an array of OR-groups. Every group must hit.
-- p_mode: public | attachable | library.
-- security invoker so artwork RLS still hides drafts the caller cannot see.
create or replace function public.search_artwork_ids(
  p_groups jsonb,
  p_mode text default 'public',
  p_owner uuid default null,
  p_limit int default 30
)
returns table(id uuid)
language sql
stable
security invoker
set search_path = public
as $search$
  with params as (
    select
      least(greatest(coalesce(p_limit, 30), 1), 80) as lim,
      coalesce(p_owner, auth.uid()) as owner_id,
      lower(coalesce(nullif(btrim(p_mode), ''), 'public')) as mode,
      least(coalesce(jsonb_array_length(p_groups), 0), 4) as groups
  )
  select a.id
  from public.artworks a
  left join public.profiles artist on artist.id = a.artist_id
  left join public.profiles uploader on uploader.id = a.created_by
  cross join params pr
  where pr.groups >= 1
    and (
      (pr.mode = 'public' and a.visibility = 'public')
      or (
        pr.mode = 'attachable'
        and (
          a.visibility = 'public'
          or (pr.owner_id is not null and a.artist_id = pr.owner_id)
          or (pr.owner_id is not null and a.created_by = pr.owner_id)
        )
      )
      or (
        pr.mode = 'library'
        and pr.owner_id is not null
        and (
          a.artist_id = pr.owner_id
          or a.created_by = pr.owner_id
          or exists (
            select 1
            from public.claims c
            where c.work_id = a.id
              and c.subject_profile_id = pr.owner_id
              and (c.status is null or c.status = 'confirmed')
          )
        )
      )
    )
    and (
      select count(*)::int
      from generate_series(0, pr.groups - 1) as g(i)
      where jsonb_typeof(p_groups -> g.i) = 'array'
        and exists (
          select 1
          from jsonb_array_elements_text(p_groups -> g.i) as t(alt)
          where public.artwork_alt_hits(
            a.title, a.title_ko, a.title_en,
            a.medium, a.medium_ko, a.medium_en,
            a.story, a.story_ko, a.story_en,
            artist.username, artist.display_name, artist.display_name_ko, artist.display_name_en,
            uploader.username, uploader.display_name, uploader.display_name_ko, uploader.display_name_en,
            a.id,
            left(btrim(t.alt), 80)
          )
        )
    ) = pr.groups
  order by a.created_at desc nulls last
  limit (select lim from params);
$search$;

grant execute on function public.search_artwork_ids(jsonb, text, uuid, int)
  to anon, authenticated;

-- == SECTION 4 == search_people — Korean and English names, handle, light typo
create or replace function public.search_people(
  p_q text,
  p_roles text[] default '{}',
  p_limit int default 15,
  p_cursor text default null
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public
as $people$
declare
  v_q text := regexp_replace(coalesce(trim(p_q), ''), '^@+', '');
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
             when lower(coalesce(p.display_name, '')) = v_q_lower
               or lower(coalesce(p.display_name_ko, '')) = v_q_lower
               or lower(coalesce(p.display_name_en, '')) = v_q_lower then 1
             when lower(coalesce(p.username, '')) like lower(v_prefix_pattern)
               or lower(coalesce(p.display_name, '')) like lower(v_prefix_pattern)
               or lower(coalesce(p.display_name_ko, '')) like lower(v_prefix_pattern)
               or lower(coalesce(p.display_name_en, '')) like lower(v_prefix_pattern) then 2
             when p.username ilike v_pattern
               or p.display_name ilike v_pattern
               or p.display_name_ko ilike v_pattern
               or p.display_name_en ilike v_pattern then 3
             else 4
           end as tier,
           greatest(
             similarity(coalesce(p.username, ''), v_q),
             similarity(coalesce(p.display_name, ''), v_q),
             similarity(coalesce(p.display_name_ko, ''), v_q),
             similarity(coalesce(p.display_name_en, ''), v_q),
             case when char_length(v_q) >= 4 then word_similarity(v_q, coalesce(p.username, '')) else 0 end,
             case when char_length(v_q) >= 4 then word_similarity(v_q, coalesce(p.display_name, '')) else 0 end,
             case when char_length(v_q) >= 4 then word_similarity(v_q, coalesce(p.display_name_ko, '')) else 0 end,
             case when char_length(v_q) >= 4 then word_similarity(v_q, coalesce(p.display_name_en, '')) else 0 end
           ) as sim
    from profiles p
    where (
        p.username ilike v_pattern
        or p.display_name ilike v_pattern
        or p.display_name_ko ilike v_pattern
        or p.display_name_en ilike v_pattern
        or similarity(coalesce(p.username, ''), v_q) > 0.2
        or similarity(coalesce(p.display_name, ''), v_q) > 0.2
        or similarity(coalesce(p.display_name_ko, ''), v_q) > 0.2
        or similarity(coalesce(p.display_name_en, ''), v_q) > 0.2
        or (
          char_length(v_q) >= 4 and (
            word_similarity(v_q, coalesce(p.username, '')) >= 0.5
            or word_similarity(v_q, coalesce(p.display_name, '')) >= 0.5
            or word_similarity(v_q, coalesce(p.display_name_ko, '')) >= 0.5
            or word_similarity(v_q, coalesce(p.display_name_en, '')) >= 0.5
          )
        )
        or (
          v_q ~ '[가-힣]'
          and char_length(v_q) >= 2
          and char_length(v_q) < 4
          and (
            word_similarity(v_q, coalesce(p.display_name, '')) >= 0.5
            or word_similarity(v_q, coalesce(p.display_name_ko, '')) >= 0.5
          )
        )
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
$people$;

grant execute on function public.search_people(text, text[], int, text)
  to anon, authenticated;

-- == SECTION 5 == search_artists_by_artwork — bilingual fields and a light typo
create or replace function public.search_artists_by_artwork(
  p_q text,
  p_roles text[] default '{}',
  p_limit int default 20
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public
as $artists$
declare
  v_q text := regexp_replace(coalesce(trim(p_q), ''), '^@+', '');
  v_pattern text;
  v_roles text[] := coalesce(p_roles, '{}');
begin
  if v_q = '' then
    return;
  end if;
  v_pattern := '%' || v_q || '%';

  return query
  select jsonb_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name,
    'display_name_ko', p.display_name_ko, 'display_name_en', p.display_name_en,
    'avatar_url', p.avatar_url, 'bio', p.bio, 'main_role', p.main_role,
    'roles', p.roles, 'is_public', p.is_public, 'reason', 'artwork',
    'match_rank', 2
  )
  from profiles p
  where p.id in (
      select distinct a.artist_id
      from artworks a
      where a.artist_id is not null
        and a.visibility = 'public'
        and (
          a.title ilike v_pattern
          or a.title_ko ilike v_pattern
          or a.title_en ilike v_pattern
          or a.medium ilike v_pattern
          or a.medium_ko ilike v_pattern
          or a.medium_en ilike v_pattern
          or a.story ilike v_pattern
          or a.story_ko ilike v_pattern
          or a.story_en ilike v_pattern
          or (
            char_length(v_q) >= 4 and (
              word_similarity(v_q, coalesce(a.title, '')) >= 0.5
              or word_similarity(v_q, coalesce(a.title_ko, '')) >= 0.5
              or word_similarity(v_q, coalesce(a.title_en, '')) >= 0.5
            )
          )
        )
    )
    and (array_length(v_roles, 1) is null or array_length(v_roles, 1) = 0
         or (p.main_role::text = any(v_roles))
         or (coalesce(p.roles, '{}'::text[]) && v_roles))
  order by p.id desc
  limit greatest(coalesce(p_limit, 20), 1);
end;
$artists$;

grant execute on function public.search_artists_by_artwork(text, text[], int)
  to anon, authenticated;

-- == SECTION 6 == search_people_with_external — Korean and English names
create or replace function public.search_people_with_external(
  p_q text,
  p_roles text[] default '{}',
  p_include_external boolean default false,
  p_inviter_id uuid default null,
  p_limit int default 15
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public
as $external$
declare
  v_uid      uuid := auth.uid();
  v_q        text := regexp_replace(coalesce(trim(p_q), ''), '^@+', '');
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
        when lower(coalesce(p.display_name, '')) = v_q_lower
          or lower(coalesce(p.display_name_ko, '')) = v_q_lower
          or lower(coalesce(p.display_name_en, '')) = v_q_lower then 1
        when lower(coalesce(p.username, '')) like lower(v_prefix)
          or lower(coalesce(p.display_name, '')) like lower(v_prefix)
          or lower(coalesce(p.display_name_ko, '')) like lower(v_prefix)
          or lower(coalesce(p.display_name_en, '')) like lower(v_prefix) then 2
        when p.username ilike v_pattern
          or p.display_name ilike v_pattern
          or p.display_name_ko ilike v_pattern
          or p.display_name_en ilike v_pattern then 3
        else 4
      end as tier,
      greatest(
        similarity(coalesce(p.username, ''), v_q),
        similarity(coalesce(p.display_name, ''), v_q),
        similarity(coalesce(p.display_name_ko, ''), v_q),
        similarity(coalesce(p.display_name_en, ''), v_q)
      ) as sim
    from profiles p
    where (
        p.username ilike v_pattern
        or p.display_name ilike v_pattern
        or p.display_name_ko ilike v_pattern
        or p.display_name_en ilike v_pattern
        or similarity(coalesce(p.username, ''), v_q) > 0.2
        or similarity(coalesce(p.display_name, ''), v_q) > 0.2
        or similarity(coalesce(p.display_name_ko, ''), v_q) > 0.2
        or similarity(coalesce(p.display_name_en, ''), v_q) > 0.2
        or (
          char_length(v_q) >= 4 and (
            word_similarity(v_q, coalesce(p.display_name_en, '')) >= 0.5
            or word_similarity(v_q, coalesce(p.display_name_ko, '')) >= 0.5
            or word_similarity(v_q, coalesce(p.username, '')) >= 0.5
          )
        )
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
        when lower(coalesce(ea.display_name, '')) = v_q_lower
          or lower(coalesce(ea.display_name_ko, '')) = v_q_lower
          or lower(coalesce(ea.display_name_en, '')) = v_q_lower then 0
        when lower(coalesce(ea.display_name, '')) like lower(v_prefix)
          or lower(coalesce(ea.display_name_ko, '')) like lower(v_prefix)
          or lower(coalesce(ea.display_name_en, '')) like lower(v_prefix) then 2
        when ea.display_name ilike v_pattern
          or ea.display_name_ko ilike v_pattern
          or ea.display_name_en ilike v_pattern then 3
        else 4
      end as tier,
      greatest(
        similarity(coalesce(ea.display_name, ''), v_q),
        similarity(coalesce(ea.display_name_ko, ''), v_q),
        similarity(coalesce(ea.display_name_en, ''), v_q)
      ) as sim
    from public.external_artists ea
    where v_inviter is not null
      and ea.claimed_profile_id is null
      and ea.invited_by = v_inviter
      and (
        ea.display_name ilike v_pattern
        or ea.display_name_ko ilike v_pattern
        or ea.display_name_en ilike v_pattern
        or similarity(coalesce(ea.display_name, ''), v_q) > 0.2
        or similarity(coalesce(ea.display_name_ko, ''), v_q) > 0.2
        or similarity(coalesce(ea.display_name_en, ''), v_q) > 0.2
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
$external$;

grant execute on function public.search_people_with_external(text, text[], boolean, uuid, int)
  to anon, authenticated;

-- == SECTION 7 == search_works_for_dedup — same artist, bilingual title, light typo
-- Still public works only, still scoped to the chosen artist. Drafts stay hidden.
create or replace function public.search_works_for_dedup(
  p_artist_profile_id uuid default null,
  p_external_artist_id uuid default null,
  p_q text default null,
  p_limit int default 20
)
returns setof public.artworks
language plpgsql
stable
security definer
set search_path = public
as $dedup$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  if p_artist_profile_id is not null then
    return query
    select a.* from public.artworks a
    where a.visibility = 'public' and a.artist_id = p_artist_profile_id
      and (
        v_q is null
        or a.title ilike '%' || v_q || '%'
        or a.title_ko ilike '%' || v_q || '%'
        or a.title_en ilike '%' || v_q || '%'
        or (
          char_length(v_q) >= 4 and (
            word_similarity(v_q, coalesce(a.title, '')) >= 0.5
            or word_similarity(v_q, coalesce(a.title_ko, '')) >= 0.5
            or word_similarity(v_q, coalesce(a.title_en, '')) >= 0.5
          )
        )
      )
    order by a.created_at desc limit v_limit;
  elsif p_external_artist_id is not null then
    return query
    select a.* from public.artworks a
    join public.claims c on c.work_id = a.id and c.external_artist_id = p_external_artist_id
    where a.visibility = 'public'
      and (
        v_q is null
        or a.title ilike '%' || v_q || '%'
        or a.title_ko ilike '%' || v_q || '%'
        or a.title_en ilike '%' || v_q || '%'
        or (
          char_length(v_q) >= 4 and (
            word_similarity(v_q, coalesce(a.title, '')) >= 0.5
            or word_similarity(v_q, coalesce(a.title_ko, '')) >= 0.5
            or word_similarity(v_q, coalesce(a.title_en, '')) >= 0.5
          )
        )
      )
    order by a.created_at desc limit v_limit;
  else
    return query
    select a.* from public.artworks a
    where a.visibility = 'public'
      and (
        v_q is null
        or a.title ilike '%' || v_q || '%'
        or a.title_ko ilike '%' || v_q || '%'
        or a.title_en ilike '%' || v_q || '%'
        or (
          char_length(v_q) >= 4 and (
            word_similarity(v_q, coalesce(a.title, '')) >= 0.5
            or word_similarity(v_q, coalesce(a.title_ko, '')) >= 0.5
            or word_similarity(v_q, coalesce(a.title_en, '')) >= 0.5
          )
        )
      )
    order by a.created_at desc limit v_limit;
  end if;
end;
$dedup$;

grant execute on function public.search_works_for_dedup(uuid, uuid, text, int)
  to authenticated;
