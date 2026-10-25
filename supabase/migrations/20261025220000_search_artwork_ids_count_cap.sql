-- 2026-10-25 — Let one public search count a single artist's works.
-- The matcher is unchanged. Only the hard cap moves from 80 to 400 so
-- a name like 현혜명 can report the real total and page by tens.
-- One function. Dollar tag is letters only.

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
      least(greatest(coalesce(p_limit, 30), 1), 400) as lim,
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

