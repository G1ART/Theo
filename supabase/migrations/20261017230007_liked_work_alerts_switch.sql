-- 2026-10-17 — One switch for liked-work news (exhibited, price listed,
-- sold), on by default. Stored like new_work_alerts on alert_preferences;
-- the triggers leave out anyone who turned it off.
--
-- Apply section by section in the SQL editor.

-- == SECTION 1 == alert_preferences.liked_work_alerts

alter table public.alert_preferences
  add column if not exists liked_work_alerts boolean not null default true;

-- == SECTION 2 == sold / price listed

create or replace function public.notify_likers_on_state_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_type text;
  v_aw public.artworks;
  v_actor uuid := auth.uid();
  v_liker uuid;
  v_fields jsonb;
begin
  if new.kind = 'availability' and new.to_state = 'sold' and new.from_state is distinct from 'sold' then
    v_type := 'liked_work_sold';
  elsif new.kind = 'price' and new.to_state = 'listed' and new.from_state is distinct from 'listed' then
    v_type := 'liked_work_price_listed';
  else
    return new;
  end if;

  v_aw := (select a from public.artworks a where a.id = new.artwork_id);
  if v_aw.id is null or coalesce(v_aw.visibility::text, '') <> 'public' then
    return new;
  end if;
  if v_type = 'liked_work_price_listed' and coalesce(v_aw.ownership_status::text, '') <> 'available' then
    return new;
  end if;

  for v_liker in
    select l.user_id
    from public.artwork_likes l
    where l.artwork_id = v_aw.id
      and l.user_id <> v_aw.artist_id
      and l.user_id is distinct from v_aw.created_by
      and l.user_id is distinct from v_actor
      and not exists (
        select 1 from public.alert_preferences ap
        where ap.user_id = l.user_id and ap.liked_work_alerts = false
      )
      and not exists (
        select 1 from public.notifications n
        where n.user_id = l.user_id
          and n.type = v_type
          and n.artwork_id = v_aw.id
          and n.created_at > now() - interval '1 day'
      )
  loop
    if v_type = 'liked_work_price_listed' then
      v_fields := public.artwork_viewer_fields_as(v_liker, v_aw.id);
      if coalesce(v_fields->>'pricing_mode', '') <> 'fixed'
         or coalesce(v_fields->>'is_price_public', '') <> 'true' then
        continue;
      end if;
    end if;
    insert into public.notifications (user_id, type, actor_id, artwork_id, payload)
    values (v_liker, v_type, v_aw.artist_id, v_aw.id, '{}'::jsonb);
  end loop;

  return new;
end;
$a$;

-- == SECTION 3 == linked to an exhibition

create or replace function public.notify_likers_on_exhibition_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_aw public.artworks;
  v_show public.projects;
  v_phase text;
  v_actor uuid := coalesce(new.added_by_profile_id, auth.uid());
  v_liker uuid;
  v_existing uuid;
begin
  v_aw := (select a from public.artworks a where a.id = new.work_id);
  if v_aw.id is null or coalesce(v_aw.visibility::text, '') <> 'public' then
    return new;
  end if;

  v_show := (select p from public.projects p where p.id = new.exhibition_id and p.project_type = 'exhibition');
  if v_show.id is null then
    return new;
  end if;

  v_phase := case
    when v_show.end_date is not null and v_show.end_date < current_date then 'ended'
    when v_show.start_date is not null and v_show.start_date > current_date then 'upcoming'
    when v_show.start_date is not null and v_show.end_date is not null then 'ongoing'
    when v_show.status = 'live' then 'ongoing'
    when v_show.status = 'planned' and (v_show.start_date is null or v_show.start_date > current_date) then 'upcoming'
    else 'ended'
  end;
  if v_phase not in ('ongoing', 'upcoming') then
    return new;
  end if;
  if not (
    (v_show.host_profile_id is null or public.is_artist_publicly_visible(v_show.host_profile_id))
    and (v_show.curator_id is null or public.is_artist_publicly_visible(v_show.curator_id))
  ) then
    return new;
  end if;

  for v_liker in
    select l.user_id
    from public.artwork_likes l
    where l.artwork_id = v_aw.id
      and l.user_id <> v_aw.artist_id
      and l.user_id is distinct from v_aw.created_by
      and l.user_id is distinct from v_actor
      and not exists (
        select 1 from public.alert_preferences ap
        where ap.user_id = l.user_id and ap.liked_work_alerts = false
      )
  loop
    v_existing := (
      select n.id
      from public.notifications n
      where n.user_id = v_liker
        and n.type = 'liked_work_exhibited'
        and n.read_at is null
        and n.payload->>'exhibition_id' = v_show.id::text
        and n.created_at > now() - interval '6 hours'
      order by n.created_at desc
      limit 1
    );
    if v_existing is not null then
      update public.notifications n
      set payload = n.payload || jsonb_build_object(
        'artwork_ids', coalesce(n.payload->'artwork_ids', '[]'::jsonb) || jsonb_build_array(v_aw.id::text),
        'count', jsonb_array_length(coalesce(n.payload->'artwork_ids', '[]'::jsonb)) + 1
      )
      where n.id = v_existing
        and not (coalesce(n.payload->'artwork_ids', '[]'::jsonb) ? v_aw.id::text);
    elsif not exists (
      select 1
      from public.notifications n
      where n.user_id = v_liker
        and n.type = 'liked_work_exhibited'
        and n.artwork_id = v_aw.id
        and n.payload->>'exhibition_id' = v_show.id::text
    ) then
      insert into public.notifications (user_id, type, actor_id, artwork_id, payload)
      values (
        v_liker,
        'liked_work_exhibited',
        v_actor,
        v_aw.id,
        jsonb_build_object(
          'exhibition_id', v_show.id,
          'exhibition_title', v_show.title,
          'exhibition_title_ko', v_show.title_ko,
          'exhibition_title_en', v_show.title_en,
          'artwork_ids', jsonb_build_array(v_aw.id::text),
          'count', 1
        )
      );
    end if;
  end loop;

  return new;
end;
$a$;
