-- Feed thumbnails on a group exhibition.
-- The gallery may store up to six work ids on the exhibition.
-- The read below returns a bounded candidate set for one feed page:
-- up to six public artwork or print images for each of the first
-- twelve artists, plus any saved picks. The app divides the six slots.
--
-- Safe to re-run. Highlight each section and Run it on its own.
-- Dollar tags are letters only.

-- == SECTION 1 == projects.feed_thumb_work_ids
-- Highlight this section and Run by itself.

alter table public.projects
  add column if not exists feed_thumb_work_ids uuid[];

comment on column public.projects.feed_thumb_work_ids is
  'Gallery-chosen feed card thumbnails, in display order. At most six works already in the exhibition. Null means the feed divides the slots across artists.';

alter table public.projects
  drop constraint if exists projects_feed_thumb_work_ids_len;

alter table public.projects
  add constraint projects_feed_thumb_work_ids_len
  check (
    feed_thumb_work_ids is null
    or cardinality(feed_thumb_work_ids) between 1 and 6
  );

-- == SECTION 2 == exhibition_feed_thumb_sources
-- Highlight this section and Run by itself.

create or replace function public.exhibition_feed_thumb_sources(p_exhibition_ids uuid[])
returns table (
  exhibition_id uuid,
  work_id uuid,
  artist_key text,
  image_path text,
  sort_order int,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $thumb$
  with ids as (
    select u.exhibition_id
    from unnest(coalesce(p_exhibition_ids, array[]::uuid[])) with ordinality as u(exhibition_id, n)
    where u.n <= 14
    group by u.exhibition_id
  ),
  eligible as (
    select
      ew.exhibition_id,
      ew.work_id,
      ew.sort_order,
      ew.created_at,
      coalesce(
        case
          when credit.external_artist_id is not null
          then 'ext:' || credit.external_artist_id::text
        end,
        case
          when a.artist_id is not null
           and (a.created_by is null or a.artist_id is distinct from a.created_by)
          then a.artist_id::text
        end,
        credit.artist_profile_id::text,
        a.artist_id::text,
        a.id::text
      ) as artist_key,
      img.storage_path as image_path
    from public.exhibition_works ew
    join ids on ids.exhibition_id = ew.exhibition_id
    join public.artworks a on a.id = ew.work_id
    join lateral (
      select ai.storage_path
      from public.artwork_images ai
      where ai.artwork_id = a.id
        and ai.storage_path is not null
        and btrim(ai.storage_path) <> ''
      order by coalesce(ai.sort_order, 0), ai.created_at
      limit 1
    ) img on true
    left join lateral (
      select
        (
          select c.external_artist_id
          from public.claims c
          where c.work_id = a.id
            and c.external_artist_id is not null
          order by c.created_at
          limit 1
        ) as external_artist_id,
        (
          select c.artist_profile_id
          from public.claims c
          where c.work_id = a.id
            and c.artist_profile_id is not null
            and (c.status is null or c.status = 'confirmed')
            and (a.created_by is null or c.artist_profile_id is distinct from a.created_by)
          order by c.created_at
          limit 1
        ) as artist_profile_id
    ) credit on true
    where a.visibility = 'public'
      and a.work_kind::text in ('artwork', 'print_edition')
  ),
  artist_rank as (
    select
      exhibition_id,
      artist_key,
      row_number() over (
        partition by exhibition_id
        order by min(sort_order) nulls last, min(created_at), artist_key
      ) as artist_ord
    from eligible
    group by exhibition_id, artist_key
  ),
  ranked as (
    select
      e.exhibition_id,
      e.work_id,
      e.artist_key,
      e.image_path,
      e.sort_order,
      e.created_at,
      r.artist_ord,
      row_number() over (
        partition by e.exhibition_id, e.artist_key
        order by e.sort_order nulls last, e.created_at, e.work_id
      ) as work_ord
    from eligible e
    join artist_rank r
      on r.exhibition_id = e.exhibition_id
     and r.artist_key = e.artist_key
  )
  select
    ranked.exhibition_id,
    ranked.work_id,
    ranked.artist_key,
    ranked.image_path,
    ranked.sort_order,
    ranked.created_at
  from ranked
  where (
      ranked.artist_ord <= 12
      and ranked.work_ord <= 6
    )
    or exists (
      select 1
      from public.projects p
      where p.id = ranked.exhibition_id
        and p.feed_thumb_work_ids is not null
        and ranked.work_id = any(p.feed_thumb_work_ids)
    )
  order by ranked.exhibition_id, ranked.sort_order nulls last, ranked.created_at, ranked.work_id
$thumb$;

comment on function public.exhibition_feed_thumb_sources(uuid[]) is
  'Bounded public artwork and print images for feed exhibition cards. At most six works for each of the first twelve artists, plus any gallery-chosen feed thumbnails.';

grant execute on function public.exhibition_feed_thumb_sources(uuid[]) to anon, authenticated;
