-- 2026-10-17 — New-work alerts stop calling a gallery the artist, and a
-- newly published work goes to the front of manual orders.
--
-- Wording. A gallery, curator or collector that lists the work of an
-- artist without an account keeps artist_id on its own profile, so its
-- followers read "○○ 작가가 새 작품 …" with the gallery as the artist.
-- Each new_work alert now records the works listed for an external
-- artist (payload.listed_ids) and, when every work in it is by one
-- external artist, that artist (payload.external_artist). The app then
-- reads "○○에 △△ 작가의 새 작품 …", or "○○에 새 작품 …" when there is
-- no single known name. The pending digest event carries the same
-- fields. Single upload files the external claim right after the insert,
-- so a claim on a work first published in the last 10 minutes refreshes
-- the alerts that hold it. Existing new_work alerts about such works get
-- the fields once; nothing new is sent.
--
-- Order (대표님 2026-10-17: new works go first in a manual order and the
-- owner can move them later). At first publish, when artist_id changes
-- within 10 minutes of it, and when a claim lands within 10 minutes of it:
--   * profile_artwork_orders of the artist and of every profile with a
--     public claim on the work, when that profile already keeps rows. The
--     artist's older order on artworks.artist_sort_order counts as a
--     manual order too. The work takes min(sort_order) - 1. Profiles
--     without a manual order keep the default sort.
--   * custom tabs (profile_details.studio_portfolio.custom_tabs[]
--     .artwork_ids) of those profiles and of the uploader: the work moves
--     to the front of each tab that holds it. file_artworks_into_existing_tab
--     puts works first published in the last 10 minutes at the front
--     instead of the end.
-- Works published before this migration are not moved.
--
-- Several plpgsql functions: in the SQL editor run one section at a
-- time. Dollar tags are letters only.

-- == SECTION 1 == put a work first in the manual orders that show it

create or replace function public.custom_tabs_put_first(p_tabs jsonb, p_artwork_id text)
returns jsonb
language sql
immutable
set search_path = public
as $tabs$
  select coalesce(
    jsonb_agg(
      case
        when jsonb_typeof(t.tab->'artwork_ids') = 'array'
         and t.tab->'artwork_ids' @> jsonb_build_array(p_artwork_id)
          then jsonb_set(
                 t.tab,
                 '{artwork_ids}',
                 jsonb_build_array(p_artwork_id) || ((t.tab->'artwork_ids') - p_artwork_id)
               )
        else t.tab
      end
      order by t.ord
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(p_tabs) with ordinality as t(tab, ord)
$tabs$;

revoke all on function public.custom_tabs_put_first(jsonb, text) from public, anon, authenticated;

create or replace function public.artwork_put_first(p_artwork_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $first$
declare
  v_artist uuid;
  v_uploader uuid;
  v_profiles uuid[];
  v_id text := p_artwork_id::text;
begin
  v_artist := (
    select a.artist_id
      from public.artworks a
     where a.id = p_artwork_id
       and a.visibility = 'public'
  );
  if v_artist is null then
    return;
  end if;
  v_uploader := (select a.created_by from public.artworks a where a.id = p_artwork_id);

  v_profiles := array(
    select v_artist
    union
    select c.subject_profile_id
      from public.claims c
     where c.work_id = p_artwork_id
       and c.visibility = 'public'
  );

  insert into public.profile_artwork_orders (profile_id, artwork_id, sort_order, updated_at)
  select p.id,
         p_artwork_id,
         coalesce((select min(o.sort_order) from public.profile_artwork_orders o where o.profile_id = p.id), 0) - 1,
         now()
    from unnest(v_profiles) as p(id)
   where exists (select 1 from public.profile_artwork_orders o where o.profile_id = p.id)
      or (
        p.id = v_artist
        and exists (
          select 1
            from public.artworks a
           where a.artist_id = v_artist
             and a.artist_sort_order is not null
             and a.id <> p_artwork_id
        )
      )
  on conflict (profile_id, artwork_id) do nothing;

  update public.profiles pr
     set profile_details = jsonb_set(
           pr.profile_details,
           '{studio_portfolio,custom_tabs}',
           public.custom_tabs_put_first(pr.profile_details #> '{studio_portfolio,custom_tabs}', v_id)
         )
   where pr.id = any(v_profiles || v_uploader)
     and jsonb_typeof(pr.profile_details #> '{studio_portfolio,custom_tabs}') = 'array'
     and exists (
       select 1
         from jsonb_array_elements(pr.profile_details #> '{studio_portfolio,custom_tabs}') as t(tab)
        where t.tab->'artwork_ids' @> jsonb_build_array(v_id)
     );
end;
$first$;

revoke all on function public.artwork_put_first(uuid) from public, anon, authenticated;

-- == SECTION 2 == run it at first publish and on an early artist change

create or replace function public.artwork_order_on_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $order$
begin
  begin
    perform public.artwork_put_first(new.id);
  exception when others then
    raise warning 'artwork order skipped for %: %', new.id, sqlerrm;
  end;
  return null;
end;
$order$;

drop trigger if exists trg_artwork_order_insert on public.artworks;
create trigger trg_artwork_order_insert
  after insert on public.artworks
  for each row
  when (new.first_published_at is not null)
  execute function public.artwork_order_on_publish();

drop trigger if exists trg_artwork_order_update on public.artworks;
create trigger trg_artwork_order_update
  after update of visibility, artist_id on public.artworks
  for each row
  when (
    (old.first_published_at is null and new.first_published_at is not null)
    or (
      new.first_published_at > now() - interval '10 minutes'
      and old.artist_id is distinct from new.artist_id
    )
  )
  execute function public.artwork_order_on_publish();

-- == SECTION 3 == filing into a tab right after publish puts the work first

create or replace function public.file_artworks_into_existing_tab(
  p_profile_id uuid,
  p_tab_id uuid,
  p_artwork_ids uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $file$
declare
  v_uid uuid := auth.uid();
  v_details jsonb;
  v_tabs jsonb;
  v_next jsonb := '[]'::jsonb;
  v_tab jsonb;
  v_found boolean := false;
  v_kind text := 'artwork';
  v_ids jsonb;
  v_aid uuid;
  v_cap integer := 300;
  v_front jsonb;
  v_back jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_profile_id is null then
    raise exception 'missing_tab';
  end if;
  if p_artwork_ids is null or cardinality(p_artwork_ids) = 0 then
    return;
  end if;

  if p_profile_id is distinct from v_uid
     and not public.is_active_account_delegate_writer(p_profile_id) then
    if exists (
      select 1
      from unnest(p_artwork_ids) as aid(id)
      where not exists (
        select 1
        from public.artworks a
        where a.id = aid.id
          and (a.created_by = v_uid or a.artist_id = v_uid)
      )
    ) then
      raise exception 'not_allowed';
    end if;
  end if;

  v_details := (
    select p.profile_details
      from public.profiles p
     where p.id = p_profile_id
       for update
  );

  if v_details is null then
    raise exception 'profile_missing';
  end if;

  v_tabs := v_details #> '{studio_portfolio,custom_tabs}';
  if jsonb_typeof(v_tabs) is distinct from 'array' then
    raise exception 'tab_missing';
  end if;

  for v_tab in
    select value from jsonb_array_elements(v_tabs)
  loop
    v_ids := coalesce(v_tab->'artwork_ids', '[]'::jsonb);
    if jsonb_typeof(v_ids) is distinct from 'array' then
      v_ids := '[]'::jsonb;
    end if;
    v_ids := (
      select coalesce(jsonb_agg(to_jsonb(e.x) order by e.ord), '[]'::jsonb)
      from jsonb_array_elements_text(v_ids) with ordinality as e(x, ord)
      where not exists (
        select 1
        from unnest(p_artwork_ids) as u(id)
        where u.id::text = e.x
      )
    );
    if p_tab_id is not null and (v_tab->>'id') = p_tab_id::text then
      v_found := true;
      v_kind := coalesce(v_tab->>'kind', 'artwork');
      v_front := '[]'::jsonb;
      v_back := '[]'::jsonb;
      for v_aid in
        select u.id from unnest(p_artwork_ids) with ordinality as u(id, ord) order by u.ord
      loop
        if jsonb_array_length(v_ids) + jsonb_array_length(v_front) + jsonb_array_length(v_back) >= v_cap then
          exit;
        end if;
        if exists (
          select 1
            from public.artworks a
           where a.id = v_aid
             and a.first_published_at > now() - interval '10 minutes'
        ) then
          v_front := v_front || to_jsonb(v_aid::text);
        else
          v_back := v_back || to_jsonb(v_aid::text);
        end if;
      end loop;
      v_ids := v_front || v_ids || v_back;
    end if;
    v_tab := jsonb_set(v_tab, '{artwork_ids}', coalesce(v_ids, '[]'::jsonb), true);
    v_next := v_next || jsonb_build_array(v_tab);
  end loop;

  if p_tab_id is not null and not v_found then
    raise exception 'tab_missing';
  end if;

  v_details := jsonb_set(v_details, '{studio_portfolio,custom_tabs}', v_next, true);

  update public.profiles
  set profile_details = v_details,
      updated_at = now()
  where id = p_profile_id;

  if p_tab_id is null then
    update public.artworks
    set work_kind = 'artwork'
    where id = any (p_artwork_ids);
  elsif v_kind is distinct from 'collected' then
    update public.artworks
    set work_kind = v_kind::public.profile_content_kind
    where id = any (p_artwork_ids);
  end if;
end;
$file$;

-- == SECTION 4 == new_work_alert_sync: count, listed works, external artist

create or replace function public.new_work_alert_sync(p_alert_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $sync$
declare
  v_user uuid;
  v_first uuid;
  v_ids jsonb;
  v_works uuid[];
  v_listed jsonb;
  v_artist_id uuid;
  v_artist jsonb;
  v_fields jsonb;
begin
  v_ids := (select n.payload->'artwork_ids' from public.notifications n where n.id = p_alert_id);
  if jsonb_typeof(v_ids) is distinct from 'array' then
    return;
  end if;
  v_user := (select n.user_id from public.notifications n where n.id = p_alert_id);
  v_first := (select n.artwork_id from public.notifications n where n.id = p_alert_id);

  v_works := array(
    select case
             when e.x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then e.x::uuid
           end
      from jsonb_array_elements_text(v_ids) with ordinality as e(x, ord)
     order by e.ord
  );

  v_listed := (
    select coalesce(jsonb_agg(to_jsonb(w.id::text) order by w.ord), '[]'::jsonb)
      from unnest(v_works) with ordinality as w(id, ord)
     where w.id is not null
       and exists (
         select 1
           from public.claims c
          where c.work_id = w.id
            and c.external_artist_id is not null
       )
  );

  v_artist := null;
  if jsonb_array_length(v_listed) > 0
     and jsonb_array_length(v_listed) = jsonb_array_length(v_ids) then
    v_artist_id := (
      select case
               when count(distinct c.external_artist_id) = 1 then (array_agg(c.external_artist_id))[1]
             end
        from public.claims c
       where c.work_id = any(v_works)
         and c.external_artist_id is not null
    );
    v_artist := (
      select jsonb_build_object(
               'id', ea.id,
               'display_name', ea.display_name,
               'display_name_ko', ea.display_name_ko,
               'display_name_en', ea.display_name_en
             )
        from public.external_artists ea
       where ea.id = v_artist_id
    );
  end if;

  v_fields := jsonb_build_object(
    'count', jsonb_array_length(v_ids),
    'listed_ids', v_listed,
    'external_artist', coalesce(v_artist, 'null'::jsonb)
  );

  update public.notifications
     set payload = payload || v_fields
   where id = p_alert_id;

  update public.digest_events
     set payload = payload || v_fields || jsonb_build_object('artwork_ids', v_ids, 'artwork_id', v_first)
   where user_id = v_user
     and event_type = 'new_work'
     and sent_at is null
     and payload->>'notification_id' = p_alert_id::text;
end;
$sync$;

revoke all on function public.new_work_alert_sync(uuid) from public, anon, authenticated;

-- == SECTION 5 == new_work_alert_add (same recipients and bundling, then sync)

create or replace function public.new_work_alert_add(
  p_artwork_id uuid,
  p_artist_id uuid,
  p_uploader_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $add$
declare
  v_recipient uuid;
  v_alert uuid;
  v_ids jsonb;
begin
  if p_artwork_id is null or p_artist_id is null then
    return;
  end if;

  -- Publishes of the same artist in parallel transactions wait here, so
  -- they find one open alert instead of each opening their own.
  perform pg_advisory_xact_lock(hashtextextended('new_work_alert:' || p_artist_id::text, 0));

  for v_recipient in
    select f.follower_id
      from public.follows f
      left join public.alert_preferences ap on ap.user_id = f.follower_id
     where f.following_id = p_artist_id
       and f.status = 'accepted'
       and f.follower_id <> p_artist_id
       and f.follower_id is distinct from p_uploader_id
       and f.follower_id is distinct from auth.uid()
       and coalesce(ap.new_work_alerts, true)
  loop
    if exists (
      select 1
        from public.notifications n
       where n.user_id = v_recipient
         and n.type = 'new_work'
         and (n.artwork_id = p_artwork_id
              or n.payload->'artwork_ids' @> jsonb_build_array(p_artwork_id))
    ) then
      continue;
    end if;

    v_alert := (
      select n.id
        from public.notifications n
       where n.user_id = v_recipient
         and n.type = 'new_work'
         and n.actor_id = p_artist_id
         and n.read_at is null
         and n.created_at > now() - interval '10 minutes'
         and n.payload->>'source' = 'follow'
         and jsonb_typeof(n.payload->'artwork_ids') = 'array'
       order by n.created_at desc
       limit 1
    );

    if v_alert is null then
      v_alert := gen_random_uuid();
      insert into public.notifications (id, user_id, type, actor_id, artwork_id, payload)
      values (
        v_alert,
        v_recipient,
        'new_work',
        p_artist_id,
        p_artwork_id,
        jsonb_build_object('source', 'follow', 'artwork_ids', jsonb_build_array(p_artwork_id))
      );
    else
      v_ids := (select n.payload->'artwork_ids' from public.notifications n where n.id = v_alert)
               || jsonb_build_array(p_artwork_id);
      update public.notifications
         set payload = payload || jsonb_build_object('artwork_ids', v_ids)
       where id = v_alert;
    end if;

    perform public.new_work_alert_sync(v_alert);
  end loop;
end;
$add$;

revoke all on function public.new_work_alert_add(uuid, uuid, uuid) from public, anon, authenticated;

-- == SECTION 6 == new_work_alert_remove (same removal, then sync)

create or replace function public.new_work_alert_remove(
  p_artwork_id uuid,
  p_artist_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $remove$
declare
  v_alert record;
  v_ids jsonb;
  v_first uuid;
begin
  if p_artwork_id is null or p_artist_id is null then
    return;
  end if;

  for v_alert in
    select n.id, n.user_id, n.artwork_id, n.payload
      from public.notifications n
      join public.follows f
        on f.follower_id = n.user_id
       and f.following_id = p_artist_id
     where n.type = 'new_work'
       and n.actor_id = p_artist_id
       and n.payload->>'source' = 'follow'
       and (n.artwork_id = p_artwork_id
            or n.payload->'artwork_ids' @> jsonb_build_array(p_artwork_id))
  loop
    v_ids := case
      when jsonb_typeof(v_alert.payload->'artwork_ids') = 'array'
        then (v_alert.payload->'artwork_ids') - p_artwork_id::text
      else '[]'::jsonb
    end;

    if jsonb_array_length(v_ids) = 0 then
      delete from public.digest_events
       where user_id = v_alert.user_id
         and event_type = 'new_work'
         and sent_at is null
         and payload->>'notification_id' = v_alert.id::text;
      delete from public.notifications where id = v_alert.id;
      continue;
    end if;

    v_first := v_alert.artwork_id;
    if v_first is null or v_first = p_artwork_id then
      v_first := null;
      if (v_ids->>0) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_first := (select a.id from public.artworks a where a.id = (v_ids->>0)::uuid);
      end if;
    end if;

    update public.notifications
       set payload = payload || jsonb_build_object('artwork_ids', v_ids),
           artwork_id = v_first
     where id = v_alert.id;

    perform public.new_work_alert_sync(v_alert.id);
  end loop;
end;
$remove$;

revoke all on function public.new_work_alert_remove(uuid, uuid) from public, anon, authenticated;

-- == SECTION 7 == a claim on a just-published work refreshes order and alerts

create or replace function public.claims_on_recent_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $claim$
declare
  v_artist uuid;
  v_alert uuid;
begin
  begin
    v_artist := (
      select a.artist_id
        from public.artworks a
       where a.id = new.work_id
         and a.visibility = 'public'
         and a.first_published_at > now() - interval '10 minutes'
    );
    if v_artist is not null then
      perform public.artwork_put_first(new.work_id);
      for v_alert in
        select n.id
          from public.notifications n
          join public.follows f
            on f.follower_id = n.user_id
           and f.following_id = v_artist
         where n.type = 'new_work'
           and n.actor_id = v_artist
           and n.payload->>'source' = 'follow'
           and n.payload->'artwork_ids' @> jsonb_build_array(new.work_id)
      loop
        perform public.new_work_alert_sync(v_alert);
      end loop;
    end if;
  exception when others then
    raise warning 'recent publish refresh skipped for claim %: %', new.id, sqlerrm;
  end;
  return null;
end;
$claim$;

drop trigger if exists trg_claims_recent_publish on public.claims;
create trigger trg_claims_recent_publish
  after insert or update of work_id, subject_profile_id, external_artist_id, artist_profile_id, visibility
  on public.claims
  for each row
  when (new.work_id is not null)
  execute function public.claims_on_recent_publish();

-- == SECTION 8 == existing alerts get the listed-work fields once

select public.new_work_alert_sync(n.id)
  from public.notifications n
 where n.type = 'new_work'
   and jsonb_typeof(n.payload->'artwork_ids') = 'array';

update public.notifications n
   set payload = coalesce(n.payload, '{}'::jsonb) || jsonb_build_object(
         'listed_ids', jsonb_build_array(n.artwork_id::text),
         'external_artist', coalesce((
           select jsonb_build_object(
                    'id', ea.id,
                    'display_name', ea.display_name,
                    'display_name_ko', ea.display_name_ko,
                    'display_name_en', ea.display_name_en
                  )
             from public.external_artists ea
            where ea.id = (
              select case
                       when count(distinct c.external_artist_id) = 1 then (array_agg(c.external_artist_id))[1]
                     end
                from public.claims c
               where c.work_id = n.artwork_id
                 and c.external_artist_id is not null
            )
         ), 'null'::jsonb)
       )
 where n.type = 'new_work'
   and n.payload->>'source' = 'follow'
   and jsonb_typeof(n.payload->'artwork_ids') is distinct from 'array'
   and n.artwork_id is not null
   and exists (
     select 1
       from public.claims c
      where c.work_id = n.artwork_id
        and c.external_artist_id is not null
   );

update public.digest_events d
   set payload = d.payload || jsonb_build_object(
         'listed_ids', n.payload->'listed_ids',
         'external_artist', n.payload->'external_artist'
       )
  from public.notifications n
 where d.event_type = 'new_work'
   and d.sent_at is null
   and d.user_id = n.user_id
   and d.payload->>'notification_id' = n.id::text
   and n.type = 'new_work'
   and jsonb_typeof(n.payload->'artwork_ids') is distinct from 'array'
   and n.payload->'listed_ids' is not null;
