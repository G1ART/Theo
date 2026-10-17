-- 2026-10-17 — Search: one-character typos (pg_trgm), an artist name typed
-- with a work word ("현혜명 벚꽃"), and the KO/EN name and title slots.
-- Replaces 20261007160000_search_artist_name_and_typo.sql, which was never
-- applied and must not be run.
--
-- Built on the live definitions (pg_get_functiondef) read right before
-- applying, not on the 10/07 bodies:
--   * search_works_for_dedup keeps returns table(id, title, title_ko,
--     title_en, created_at) from 20261017221000: no whole artwork rows, no
--     locked price or availability columns. Grants stay anon and
--     authenticated, not public.
--   * search_artists_by_artwork keeps the KO/EN name keys from
--     20261017224000.
--   * Existing functions stay security definer with search_path = public.
--     The new search_artwork_ids is security invoker, so artworks RLS still
--     hides drafts the caller cannot read, and it returns ids only.
-- Exact text stays ahead of typo hits on every surface: people by tier,
-- works and artists by an exact-first sort key.
--
-- pg_trgm 1.6 is already installed in schema public; section 1 only adds
-- the missing trigram indexes. To run again in the SQL Editor, highlight
-- one section at a time and Run. Dollar tags are letters only.

-- == SECTION 1 == trigram indexes for titles and KO/EN names
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

-- == SECTION 2 == search_artwork_ids — works the caller may read
-- p_groups is an array of OR-groups: the token as typed first, then related
-- words and other-script spellings. Every group must hit.
-- p_mode: public | attachable | library.
-- A hit is the text as typed (title, medium, story, artist or uploader name
-- or handle, an exhibition title the viewer may know), or for the token as
-- typed only, trigram word similarity >= 0.5 on titles, names, handles and
-- exhibition titles (four or more characters; two or three Hangul
-- syllables check the artist name and title).
-- Order: every typed token appears as typed, then every token appears as
-- typed or through a related word, then typo hits by similarity. Newest
-- first inside each.
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
      case
        when jsonb_typeof(p_groups) = 'array' then least(jsonb_array_length(p_groups), 4)
        else 0
      end as groups
  ),
  alts as (
    select g.i as grp, t.ord, lower(left(btrim(t.alt), 80)) as alt
    from params pr
    cross join generate_series(0, pr.groups - 1) as g(i)
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(p_groups -> g.i) = 'array' then p_groups -> g.i else '[]'::jsonb end
    ) with ordinality as t(alt, ord)
    where btrim(t.alt) <> ''
  ),
  scoped as (
    select
      a.id,
      a.created_at,
      lower(concat_ws(
        ' ',
        a.title, a.title_ko, a.title_en,
        a.medium, a.medium_ko, a.medium_en,
        left(coalesce(a.story, ''), 500),
        left(coalesce(a.story_ko, ''), 500),
        left(coalesce(a.story_en, ''), 500),
        artist.username, artist.display_name, artist.display_name_ko, artist.display_name_en,
        uploader.username, uploader.display_name, uploader.display_name_ko, uploader.display_name_en,
        ex.titles
      )) as blob,
      coalesce(a.title, '') as title,
      coalesce(a.title_ko, '') as title_ko,
      coalesce(a.title_en, '') as title_en,
      coalesce(artist.username, '') as artist_username,
      coalesce(artist.display_name, '') as artist_name,
      coalesce(artist.display_name_ko, '') as artist_ko,
      coalesce(artist.display_name_en, '') as artist_en,
      coalesce(uploader.username, '') as uploader_username,
      coalesce(uploader.display_name, '') as uploader_name,
      coalesce(uploader.display_name_ko, '') as uploader_ko,
      coalesce(uploader.display_name_en, '') as uploader_en,
      coalesce(ex.titles, '') as exhibitions
    from public.artworks a
    cross join params pr
    left join public.profiles artist on artist.id = a.artist_id
    left join public.profiles uploader on uploader.id = a.created_by
    left join lateral (
      select string_agg(concat_ws(' ', proj.title, proj.title_ko, proj.title_en), ' ') as titles
      from public.exhibition_works ew
      join public.projects proj on proj.id = ew.exhibition_id
      where ew.work_id = a.id
        and (
          proj.status in ('live', 'ended')
          or proj.curator_id = auth.uid()
          or proj.host_profile_id = auth.uid()
        )
    ) ex on true
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
  ),
  best as (
    select
      s.id,
      s.created_at,
      x.grp,
      max(
        case
          when strpos(s.blob, x.alt) > 0 then case when x.ord = 1 then 3 else 2 end
          when x.ord > 1 then 0
          when char_length(x.alt) >= 4 then greatest(
            word_similarity(x.alt, s.title),
            word_similarity(x.alt, s.title_ko),
            word_similarity(x.alt, s.title_en),
            word_similarity(x.alt, s.artist_username),
            word_similarity(x.alt, s.artist_name),
            word_similarity(x.alt, s.artist_ko),
            word_similarity(x.alt, s.artist_en),
            word_similarity(x.alt, s.uploader_username),
            word_similarity(x.alt, s.uploader_name),
            word_similarity(x.alt, s.uploader_ko),
            word_similarity(x.alt, s.uploader_en),
            word_similarity(x.alt, s.exhibitions)
          )
          when x.alt ~ '[가-힣]' and char_length(x.alt) between 2 and 3 then greatest(
            word_similarity(x.alt, s.artist_name),
            word_similarity(x.alt, s.artist_ko),
            word_similarity(x.alt, s.title),
            word_similarity(x.alt, s.title_ko)
          )
          else 0
        end
      ) as score
    from scoped s
    cross join alts x
    group by s.id, s.created_at, x.grp
  )
  select b.id
  from best b
  cross join params pr
  group by b.id, b.created_at, pr.groups
  having count(*) filter (where b.score >= 0.5) = pr.groups
  order by min(b.score) desc, b.created_at desc nulls last, b.id desc
  limit (select lim from params);
$search$;

grant execute on function public.search_artwork_ids(jsonb, text, uuid, int)
  to anon, authenticated;

-- == SECTION 3 == search_people — KO/EN names, @handle, light typo
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
          and char_length(v_q) between 2 and 3
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

-- == SECTION 4 == search_artists_by_artwork — KO/EN title, medium, story and a light title typo
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
  with matched as (
    select a.artist_id, m.exact
    from artworks a
    cross join lateral (
      select coalesce(
        a.title ilike v_pattern
        or a.title_ko ilike v_pattern
        or a.title_en ilike v_pattern
        or a.medium ilike v_pattern
        or a.medium_ko ilike v_pattern
        or a.medium_en ilike v_pattern
        or a.story ilike v_pattern
        or a.story_ko ilike v_pattern
        or a.story_en ilike v_pattern,
        false
      ) as exact
    ) m
    where a.artist_id is not null
      and a.visibility = 'public'
      and (
        m.exact
        or (
          char_length(v_q) >= 4 and (
            word_similarity(v_q, coalesce(a.title, '')) >= 0.5
            or word_similarity(v_q, coalesce(a.title_ko, '')) >= 0.5
            or word_similarity(v_q, coalesce(a.title_en, '')) >= 0.5
          )
        )
      )
  ),
  hits as (
    select matched.artist_id, bool_or(matched.exact) as exact
    from matched
    group by matched.artist_id
  )
  select jsonb_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name,
    'display_name_ko', p.display_name_ko, 'display_name_en', p.display_name_en,
    'avatar_url', p.avatar_url, 'bio', p.bio, 'main_role', p.main_role,
    'roles', p.roles, 'is_public', p.is_public, 'reason', 'artwork',
    'match_rank', 2
  )
  from profiles p
  join hits h on h.artist_id = p.id
  where (array_length(v_roles, 1) is null or array_length(v_roles, 1) = 0
         or (p.main_role::text = any(v_roles))
         or (coalesce(p.roles, '{}'::text[]) && v_roles))
  order by h.exact desc, p.id desc
  limit greatest(coalesce(p_limit, 20), 1);
end;
$artists$;

grant execute on function public.search_artists_by_artwork(text, text[], int)
  to anon, authenticated;

-- == SECTION 5 == search_people_with_external — KO/EN names, @handle, light typo
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

-- == SECTION 6 == search_works_for_dedup — KO/EN title and a light typo, titles only
-- Same return columns and grants as 20261017221000 section 8. Exact title
-- hits sort ahead of typo hits.
create or replace function public.search_works_for_dedup(
  p_artist_profile_id uuid default null,
  p_external_artist_id uuid default null,
  p_q text default null,
  p_limit integer default 20
) returns table(id uuid, title text, title_ko text, title_en text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $dedup$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  if p_artist_profile_id is not null then
    return query
    select a.id, a.title, a.title_ko, a.title_en, a.created_at
    from public.artworks a
    where a.visibility = 'public'
      and a.artist_id = p_artist_profile_id
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
    order by coalesce(
        a.title ilike '%' || v_q || '%'
        or a.title_ko ilike '%' || v_q || '%'
        or a.title_en ilike '%' || v_q || '%',
        false
      ) desc,
      a.created_at desc
    limit v_limit;
  elsif p_external_artist_id is not null then
    return query
    select a.id, a.title, a.title_ko, a.title_en, a.created_at
    from public.artworks a
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
    order by coalesce(
        a.title ilike '%' || v_q || '%'
        or a.title_ko ilike '%' || v_q || '%'
        or a.title_en ilike '%' || v_q || '%',
        false
      ) desc,
      a.created_at desc
    limit v_limit;
  else
    return query
    select a.id, a.title, a.title_ko, a.title_en, a.created_at
    from public.artworks a
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
    order by coalesce(
        a.title ilike '%' || v_q || '%'
        or a.title_ko ilike '%' || v_q || '%'
        or a.title_en ilike '%' || v_q || '%',
        false
      ) desc,
      a.created_at desc
    limit v_limit;
  end if;
end;
$dedup$;

revoke all on function public.search_works_for_dedup(uuid, uuid, text, integer) from public;
grant execute on function public.search_works_for_dedup(uuid, uuid, text, integer) to anon, authenticated;
