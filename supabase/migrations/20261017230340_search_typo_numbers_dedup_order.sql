-- 2026-10-17 — Search follow-up to 20261017230024_search_name_and_typo_live.sql.
--   * search_artwork_ids: a token with no Latin or Hangul letter ("1423",
--     "15-403") is matched only as typed. Trigram similarity treated
--     neighbouring catalogue numbers (1422, 1429) as typos.
--   * search_works_for_dedup: typo hits sort by similarity after the exact
--     hits, so the closest title is not cut off by the limit behind newer
--     but looser ones.
-- Return columns, security definer/invoker, search_path, and grants are
-- unchanged. Two functions: in the SQL Editor run one section at a time.

-- == SECTION 1 == search_artwork_ids — numbers match only as typed
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
          when char_length(x.alt) >= 4 and x.alt ~ '[a-z가-힣]' then greatest(
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

-- == SECTION 2 == search_works_for_dedup — exact titles, then closest typo
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
      greatest(
        word_similarity(v_q, coalesce(a.title, '')),
        word_similarity(v_q, coalesce(a.title_ko, '')),
        word_similarity(v_q, coalesce(a.title_en, ''))
      ) desc nulls last,
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
      greatest(
        word_similarity(v_q, coalesce(a.title, '')),
        word_similarity(v_q, coalesce(a.title_ko, '')),
        word_similarity(v_q, coalesce(a.title_en, ''))
      ) desc nulls last,
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
      greatest(
        word_similarity(v_q, coalesce(a.title, '')),
        word_similarity(v_q, coalesce(a.title_ko, '')),
        word_similarity(v_q, coalesce(a.title_en, ''))
      ) desc nulls last,
      a.created_at desc
    limit v_limit;
  end if;
end;
$dedup$;

revoke all on function public.search_works_for_dedup(uuid, uuid, text, integer) from public;
grant execute on function public.search_works_for_dedup(uuid, uuid, text, integer) to anon, authenticated;
