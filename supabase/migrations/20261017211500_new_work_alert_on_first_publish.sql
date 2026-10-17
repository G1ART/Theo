-- 2026-10-17 — Followers hear about a work when it is first published,
-- as one alert per publish.
--
-- Before: trg_notify_followers_new_work fired AFTER INSERT only. A work
-- saved as a draft and published later (bulk publish, 내 작품 publish)
-- never alerted anyone. Single upload inserts as public under the
-- uploading account and the claim sync moves artist_id to the chosen
-- artist a moment later, so a curator's upload alerted the curator's
-- followers instead of the artist's.
--
-- Now:
--   * artworks.first_published_at is stamped the first time a row is
--     public and never changes after that. private -> public again does
--     not alert. Rows public before this migration are backfilled with
--     created_at, so past works are not announced. On 2026-10-17 none of
--     the 58 drafts had a new_work alert or a like, so none is treated
--     as published before.
--   * The first publish (insert as public, or draft/private/unlisted ->
--     public) adds the work to one unread 'new_work' alert per follower
--     of artist_id: accepted follows, new_work_alerts not off, not the
--     artist, not created_by, not the caller. An unread alert from the
--     same artist opened in the last 10 minutes is reused, so a bulk
--     publish that updates row by row ends as one alert. payload keeps
--     source 'follow', artwork_ids and count; artwork_id is the first
--     work. The pending digest event of that alert carries the same ids
--     and count.
--   * artist_id changing within 10 minutes of the first publish moves
--     the work from the old artist's followers to the new artist's.
--     A work deleted within 10 minutes (upload rollback) leaves the
--     alerts it was added to; an alert left empty is deleted.
--   * Interest alerts (saved_interests) stay on the insert path only.
--
-- notifications.type stays 'new_work'; notifications_type_check is not
-- touched. Alert failures raise a warning and never block the write.
--
-- Several plpgsql functions: in the SQL editor run one section at a
-- time. Dollar tags are letters only.

-- == SECTION 1 == artworks.first_published_at + backfill

set local lock_timeout = '5s';

alter table public.artworks
  add column if not exists first_published_at timestamptz;

comment on column public.artworks.first_published_at is
  'First time the work became public. Set by trg_artworks_stamp_first_published and never cleared. Rows public before 2026-10-17 carry created_at.';

do $backfill$
begin
  alter table public.artworks disable trigger trg_artworks_updated_at;
  update public.artworks
     set first_published_at = created_at
   where visibility = 'public'
     and first_published_at is null;
  alter table public.artworks enable trigger trg_artworks_updated_at;
end;
$backfill$;

-- == SECTION 2 == stamp first_published_at

create or replace function public.artworks_stamp_first_published()
returns trigger
language plpgsql
set search_path = public
as $stamp$
begin
  if tg_op = 'UPDATE' and old.first_published_at is not null then
    new.first_published_at := old.first_published_at;
  elsif new.visibility = 'public' then
    new.first_published_at := now();
  else
    new.first_published_at := null;
  end if;
  return new;
end;
$stamp$;

drop trigger if exists trg_artworks_stamp_first_published on public.artworks;
create trigger trg_artworks_stamp_first_published
  before insert or update of visibility, first_published_at on public.artworks
  for each row
  execute function public.artworks_stamp_first_published();

-- == SECTION 3 == new_work_alert_add

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
      v_ids := jsonb_build_array(p_artwork_id);
      insert into public.notifications (id, user_id, type, actor_id, artwork_id, payload)
      values (
        v_alert,
        v_recipient,
        'new_work',
        p_artist_id,
        p_artwork_id,
        jsonb_build_object('source', 'follow', 'artwork_ids', v_ids, 'count', 1)
      );
    else
      v_ids := (select n.payload->'artwork_ids' from public.notifications n where n.id = v_alert)
               || jsonb_build_array(p_artwork_id);
      update public.notifications
         set payload = payload || jsonb_build_object('artwork_ids', v_ids, 'count', jsonb_array_length(v_ids))
       where id = v_alert;
    end if;

    update public.digest_events
       set payload = payload || jsonb_build_object('artwork_ids', v_ids, 'count', jsonb_array_length(v_ids))
     where user_id = v_recipient
       and event_type = 'new_work'
       and sent_at is null
       and payload->>'notification_id' = v_alert::text;
  end loop;
end;
$add$;

revoke all on function public.new_work_alert_add(uuid, uuid, uuid) from public, anon, authenticated;

-- == SECTION 4 == new_work_alert_remove

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
       set payload = payload || jsonb_build_object('artwork_ids', v_ids, 'count', jsonb_array_length(v_ids)),
           artwork_id = v_first
     where id = v_alert.id;

    update public.digest_events
       set payload = payload || jsonb_build_object(
             'artwork_ids', v_ids,
             'count', jsonb_array_length(v_ids),
             'artwork_id', v_first
           )
     where user_id = v_alert.user_id
       and event_type = 'new_work'
       and sent_at is null
       and payload->>'notification_id' = v_alert.id::text;
  end loop;
end;
$remove$;

revoke all on function public.new_work_alert_remove(uuid, uuid) from public, anon, authenticated;

-- == SECTION 5 == insert as public (follow alert + interest alerts)

create or replace function public.notify_followers_new_work()
returns trigger
language plpgsql
security definer
set search_path = public
as $insert$
begin
  begin
    perform public.new_work_alert_add(new.id, new.artist_id, new.created_by);

    -- Interest-based: artist name match
    insert into public.notifications (user_id, type, actor_id, artwork_id, payload)
    select distinct si.user_id, 'new_work', new.artist_id, new.id,
           jsonb_build_object('source', 'interest', 'interest_type', si.interest_type, 'interest_value', si.interest_value)
      from public.saved_interests si
      join public.profiles p on p.id = new.artist_id
     where si.interest_type = 'artist'
       and (p.display_name ilike '%' || si.interest_value || '%'
            or p.username ilike '%' || si.interest_value || '%')
       and si.user_id <> new.artist_id
       and not exists (
         select 1 from public.follows f
          where f.follower_id = si.user_id and f.following_id = new.artist_id
       );

    -- Interest-based: medium match, skipping anyone already alerted for this work
    if new.medium is not null and new.medium <> '' then
      insert into public.notifications (user_id, type, actor_id, artwork_id, payload)
      select distinct si.user_id, 'new_work', new.artist_id, new.id,
             jsonb_build_object('source', 'interest', 'interest_type', 'medium', 'interest_value', si.interest_value)
        from public.saved_interests si
       where si.interest_type = 'medium'
         and new.medium ilike '%' || si.interest_value || '%'
         and si.user_id <> new.artist_id
         and not exists (
           select 1 from public.notifications n
            where n.user_id = si.user_id
              and n.type = 'new_work'
              and (n.artwork_id = new.id
                   or n.payload->'artwork_ids' @> jsonb_build_array(new.id))
         );
    end if;
  exception when others then
    raise warning 'new_work alert skipped for artwork %: %', new.id, sqlerrm;
  end;
  return null;
end;
$insert$;

drop trigger if exists trg_notify_followers_new_work on public.artworks;
create trigger trg_notify_followers_new_work
  after insert on public.artworks
  for each row
  when (new.first_published_at is not null)
  execute function public.notify_followers_new_work();

-- == SECTION 6 == first publish, artist change, delete

create or replace function public.new_work_alert_on_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $change$
begin
  begin
    if tg_op = 'DELETE' then
      perform public.new_work_alert_remove(old.id, old.artist_id);
    elsif old.first_published_at is null then
      perform public.new_work_alert_add(new.id, new.artist_id, new.created_by);
    else
      perform public.new_work_alert_remove(new.id, old.artist_id);
      if new.visibility = 'public' then
        perform public.new_work_alert_add(new.id, new.artist_id, new.created_by);
      end if;
    end if;
  exception when others then
    raise warning 'new_work alert skipped for artwork %: %', old.id, sqlerrm;
  end;
  return null;
end;
$change$;

drop trigger if exists trg_new_work_alert_first_publish on public.artworks;
create trigger trg_new_work_alert_first_publish
  after update of visibility on public.artworks
  for each row
  when (old.first_published_at is null and new.first_published_at is not null)
  execute function public.new_work_alert_on_change();

drop trigger if exists trg_new_work_alert_artist_change on public.artworks;
create trigger trg_new_work_alert_artist_change
  after update of artist_id on public.artworks
  for each row
  when (
    old.first_published_at is not null
    and old.first_published_at > now() - interval '10 minutes'
    and old.artist_id is distinct from new.artist_id
  )
  execute function public.new_work_alert_on_change();

drop trigger if exists trg_new_work_alert_delete on public.artworks;
create trigger trg_new_work_alert_delete
  after delete on public.artworks
  for each row
  when (old.first_published_at > now() - interval '10 minutes')
  execute function public.new_work_alert_on_change();
