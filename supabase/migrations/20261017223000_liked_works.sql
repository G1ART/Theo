-- 2026-10-17 — Liked works (profile "좋아요" tab, phase 1).
--
-- 1. artwork_state_events: when availability or the shown-price state
--    changes. No amounts are stored, only the state names.
-- 2. list_my_liked_artworks(): the signed-in user's likes with what may
--    be said about each one. Price and availability come from
--    artwork_viewer_fields (20261017221000), so the rule is the one used
--    by cards and the detail page. Cards themselves are read from
--    artwork_cards on the client.
-- 3. get_like_edges_for_works(ids): the feed's "an artist / curator
--    liked these" edges, so artwork_likes can stop being world-readable
--    (20261017223500_artwork_likes_private.sql, run after deploy).
--
-- Additive only. Apply section by section in the SQL editor.

-- == SECTION 1 == artwork_price_state

create or replace function public.artwork_price_state(
  p_mode text,
  p_public boolean,
  p_has_amount boolean
) returns text
language sql
immutable
as $a$
  select case
    when p_mode = 'fixed' and coalesce(p_public, false) and coalesce(p_has_amount, false) then 'listed'
    when p_mode = 'inquire' then 'inquire'
    else 'private'
  end;
$a$;

-- == SECTION 2 == artwork_state_events

create table if not exists public.artwork_state_events (
  id bigint generated always as identity primary key,
  artwork_id uuid not null references public.artworks(id) on delete cascade,
  kind text not null check (kind in ('availability', 'price')),
  from_state text,
  to_state text,
  created_at timestamptz not null default now()
);

create index if not exists idx_artwork_state_events_artwork_created
  on public.artwork_state_events (artwork_id, created_at desc);

alter table public.artwork_state_events enable row level security;
revoke all on public.artwork_state_events from public, anon, authenticated;

comment on table public.artwork_state_events is
  'Availability / shown-price state changes per artwork. State names only, never amounts. Read through SECURITY DEFINER functions.';

-- == SECTION 3 == log_artwork_state_change trigger

create or replace function public.log_artwork_state_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_from text;
  v_to text;
begin
  if new.ownership_status is distinct from old.ownership_status then
    insert into public.artwork_state_events (artwork_id, kind, from_state, to_state)
    values (new.id, 'availability', old.ownership_status::text, new.ownership_status::text);
  end if;

  v_from := public.artwork_price_state(old.pricing_mode::text, old.is_price_public, old.price_input_amount is not null);
  v_to := public.artwork_price_state(new.pricing_mode::text, new.is_price_public, new.price_input_amount is not null);
  if v_from is distinct from v_to then
    insert into public.artwork_state_events (artwork_id, kind, from_state, to_state)
    values (new.id, 'price', v_from, v_to);
  end if;

  return new;
end;
$a$;

revoke all on function public.log_artwork_state_change() from public, anon, authenticated;

drop trigger if exists trg_artwork_state_events on public.artworks;
create trigger trg_artwork_state_events
  after update of ownership_status, pricing_mode, is_price_public, price_input_amount
  on public.artworks
  for each row execute function public.log_artwork_state_change();

-- == SECTION 4 == list_my_liked_artworks

create or replace function public.list_my_liked_artworks(p_limit integer default 300)
returns table(
  artwork_id uuid,
  liked_at timestamptz,
  exhibition jsonb,
  changes jsonb,
  mine jsonb,
  artist_more_available integer
)
language plpgsql
stable
security definer
set search_path = public
as $a$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_limit int := least(greatest(coalesce(p_limit, 300), 1), 500);
begin
  if v_uid is null then
    return;
  end if;

  return query
  with liked as materialized (
    select l.artwork_id as aid, l.created_at as liked_ts
    from public.artwork_likes l
    where l.user_id = v_uid
    order by l.created_at desc
    limit v_limit
  ),
  judged as materialized (
    select lk.aid, lk.liked_ts, a.artist_id, public.artwork_viewer_fields(lk.aid) as vf
    from liked lk
    join public.artworks a on a.id = lk.aid
  ),
  seen as materialized (
    select j.aid, j.liked_ts, j.artist_id, j.vf
    from judged j
    where j.vf is not null
  ),
  links as materialized (
    select
      ew.work_id as aid,
      ew.created_at as linked_ts,
      p.id as exhibition_id,
      p.title,
      p.title_ko,
      p.title_en,
      p.start_date,
      p.end_date,
      case
        when p.end_date is not null and p.end_date < current_date then 'ended'
        when p.start_date is not null and p.start_date > current_date then 'upcoming'
        when p.start_date is not null and p.end_date is not null then 'ongoing'
        when p.status = 'live' then 'ongoing'
        when p.status = 'planned' and (p.start_date is null or p.start_date > current_date) then 'upcoming'
        else 'ended'
      end as phase
    from public.exhibition_works ew
    join public.projects p on p.id = ew.exhibition_id and p.project_type = 'exhibition'
    where ew.work_id in (select s.aid from seen s)
      and (p.host_profile_id is null or p.host_profile_id = v_uid or public.is_artist_publicly_visible(p.host_profile_id))
      and (p.curator_id is null or p.curator_id = v_uid or public.is_artist_publicly_visible(p.curator_id))
  ),
  current_show as materialized (
    select distinct on (k.aid)
      k.aid,
      jsonb_build_object(
        'id', k.exhibition_id,
        'title', k.title,
        'title_ko', k.title_ko,
        'title_en', k.title_en,
        'start_date', k.start_date,
        'end_date', k.end_date,
        'phase', k.phase
      ) as show
    from links k
    where k.phase in ('ongoing', 'upcoming')
    order by k.aid, case k.phase when 'ongoing' then 0 else 1 end, k.start_date nulls last
  ),
  show_changes as (
    select distinct on (k.aid)
      k.aid,
      jsonb_build_object(
        'kind', 'exhibition',
        'at', k.linked_ts,
        'exhibition_id', k.exhibition_id,
        'title', k.title,
        'title_ko', k.title_ko,
        'title_en', k.title_en
      ) as change
    from links k
    join seen s on s.aid = k.aid
    where k.linked_ts > s.liked_ts
      and k.phase in ('ongoing', 'upcoming')
    order by k.aid, k.linked_ts desc
  ),
  state_changes as (
    select distinct on (e.artwork_id, e.kind)
      e.artwork_id as aid,
      e.kind,
      e.to_state,
      e.created_at as at_ts,
      s.vf
    from public.artwork_state_events e
    join seen s on s.aid = e.artwork_id
    where e.created_at > s.liked_ts
    order by e.artwork_id, e.kind, e.created_at desc
  ),
  visible_state_changes as (
    select
      sc.aid,
      jsonb_build_object(
        'kind',
        case
          when sc.kind = 'availability' and sc.to_state = 'sold' then 'sold'
          when sc.kind = 'availability' and sc.to_state = 'available' then 'available_again'
          when sc.kind = 'availability' then 'off_market'
          else 'price_listed'
        end,
        'at', sc.at_ts
      ) as change
    from state_changes sc
    where (
        sc.kind = 'availability'
        and sc.to_state is not null
        and (sc.vf->>'ownership_status') = sc.to_state
      )
      or (
        sc.kind = 'price'
        and sc.to_state = 'listed'
        and (sc.vf->>'pricing_mode') = 'fixed'
        and (sc.vf->>'is_price_public') = 'true'
      )
  ),
  all_changes as (
    select x.aid, jsonb_agg(x.change order by (x.change->>'at') desc) as list
    from (
      select sc.aid, sc.change from show_changes sc
      union all
      select vc.aid, vc.change from visible_state_changes vc
    ) x
    group by x.aid
  ),
  inquiries as (
    select
      pi.artwork_id as aid,
      bool_or(
        pi.artist_reply is not null
        or pi.replied_at is not null
        or pi.inquiry_status = 'replied'
      ) as replied
    from public.price_inquiries pi
    where pi.inquirer_id = v_uid
      and pi.artwork_id in (select s.aid from seen s)
    group by pi.artwork_id
  ),
  boarded as (
    select distinct si.artwork_id as aid
    from public.shortlist_items si
    join public.shortlists sl on sl.id = si.shortlist_id
    where sl.owner_id = v_uid
      and si.artwork_id in (select s.aid from seen s)
  ),
  needs_more as (
    select distinct s.artist_id
    from seen s
    where (s.vf->>'ownership_status') in ('sold', 'not_for_sale', 'owned')
  ),
  more_available as (
    select
      n.artist_id,
      (
        select count(*)::int
        from (
          select 1
          from public.artworks a2
          where a2.artist_id = n.artist_id
            and a2.visibility = 'public'
            and a2.work_kind in ('artwork', 'print_edition')
            and a2.ownership_status = 'available'
            and (public.artwork_viewer_fields(a2.id)->>'ownership_status') = 'available'
          limit 50
        ) c
      ) as cnt
    from needs_more n
  )
  select
    j.aid,
    j.liked_ts,
    case when j.vf is null then null else (select cs.show from current_show cs where cs.aid = j.aid) end,
    case when j.vf is null then '[]'::jsonb
         else coalesce((select ac.list from all_changes ac where ac.aid = j.aid), '[]'::jsonb) end,
    case when j.vf is null then null else jsonb_build_object(
      'inquiry', case
        when not exists (select 1 from inquiries iq where iq.aid = j.aid) then null
        when (select iq.replied from inquiries iq where iq.aid = j.aid) then 'replied'
        else 'open'
      end,
      'in_board', exists (select 1 from boarded b where b.aid = j.aid)
    ) end,
    case when j.vf is null then 0
         else coalesce((select ma.cnt from more_available ma where ma.artist_id = j.artist_id), 0) end
  from judged j
  order by j.liked_ts desc;
end;
$a$;

revoke all on function public.list_my_liked_artworks(integer) from public, anon;
grant execute on function public.list_my_liked_artworks(integer) to authenticated;

-- == SECTION 5 == get_like_edges_for_works

create or replace function public.get_like_edges_for_works(p_artwork_ids uuid[])
returns table(user_id uuid, artwork_id uuid)
language sql
stable
security definer
set search_path = public
as $a$
  select l.user_id, l.artwork_id
  from public.artwork_likes l
  join public.artworks a on a.id = l.artwork_id and a.visibility = 'public'
  join public.profiles p on p.id = l.user_id
  where l.artwork_id = any((coalesce(p_artwork_ids, '{}'::uuid[]))[1:36])
    and coalesce(p.is_public, true)
    and case
      when p.main_role::text in ('artist', 'curator') then true
      when p.main_role::text in ('gallerist', 'collector') then false
      when 'curator' = any(coalesce(p.roles, '{}'::text[])) then true
      when 'gallerist' = any(coalesce(p.roles, '{}'::text[])) then false
      when 'artist' = any(coalesce(p.roles, '{}'::text[])) then true
      else false
    end
  order by l.created_at desc
  limit 80;
$a$;

revoke all on function public.get_like_edges_for_works(uuid[]) from public, anon;
grant execute on function public.get_like_edges_for_works(uuid[]) to authenticated;

notify pgrst, 'reload schema';
