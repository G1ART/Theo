-- Rolled-back check for 20261017211500_new_work_alert_on_first_publish.
--
-- Creates throwaway users, follows and artworks and always ends by
-- raising, so nothing it writes is kept and no real account gets an
-- alert. Run the whole file as one query (SQL editor, psql, MCP).
-- Success ends with "new_work_alert: ok"; any other message is the
-- first failed check.
--
-- Each user's line lists alerts as actor:count:read and pending digest
-- events as digest:count.

create or replace function pg_temp.nw_alert_summary(p_users jsonb, p_artist uuid, p_curator uuid)
returns jsonb
language sql
as $s$
  select coalesce(jsonb_object_agg(l.key, (
    select coalesce(jsonb_agg(q.x order by q.x), '[]'::jsonb)
      from (
        select (case n.actor_id when p_artist then 'artist' when p_curator then 'curator' else 'other' end)
               || ':' || coalesce(n.payload->>'count', '?')
               || ':' || case when n.read_at is null then 'unread' else 'read' end as x
          from public.notifications n
         where n.user_id = (l.value #>> '{}')::uuid
           and n.type = 'new_work'
        union all
        select 'digest:' || coalesce(d.payload->>'count', '?')
          from public.digest_events d
         where d.user_id = (l.value #>> '{}')::uuid
           and d.event_type = 'new_work'
           and d.sent_at is null
      ) q
  )), '{}'::jsonb)
  from jsonb_each(p_users) l
$s$;

do $t$
declare
  v_tag text := substr(md5(random()::text), 1, 8);
  v_artist uuid := gen_random_uuid();
  v_curator uuid := gen_random_uuid();
  v_delegate uuid := gen_random_uuid();
  v_f1 uuid := gen_random_uuid();
  v_f2 uuid := gen_random_uuid();
  v_f3 uuid := gen_random_uuid();
  v_f4 uuid := gen_random_uuid();
  v_users jsonb;
  v_drafts uuid[];
  v_w uuid := gen_random_uuid();
  v_w2 uuid := gen_random_uuid();
  v_n jsonb;
  v_stamp timestamptz;
begin
  v_users := jsonb_build_object(
    'f1', v_f1, 'f2', v_f2, 'f3', v_f3, 'f4', v_f4,
    'delegate', v_delegate, 'curator', v_curator, 'artist', v_artist
  );

  insert into auth.users (id, email)
  select x.u, 'nw-alert-' || v_tag || '-' || x.i || '@example.invalid'
    from unnest(array[v_artist, v_curator, v_delegate, v_f1, v_f2, v_f3, v_f4]) with ordinality as x(u, i);
  insert into public.profiles (id, username, display_name)
  select x.u, 'nw_alert_' || v_tag || '_' || x.i, 'NW alert ' || v_tag || ' ' || x.i
    from unnest(array[v_artist, v_curator, v_delegate, v_f1, v_f2, v_f3, v_f4]) with ordinality as x(u, i)
  on conflict (id) do update
    set username = excluded.username,
        display_name = excluded.display_name;

  -- f2 turned new-work alerts off, f4 is a pending request, the
  -- delegate follows the artist and uploads for them.
  insert into public.follows (follower_id, following_id, status) values
    (v_f1, v_artist, 'accepted'),
    (v_f2, v_artist, 'accepted'),
    (v_f3, v_artist, 'accepted'),
    (v_f3, v_curator, 'accepted'),
    (v_f4, v_artist, 'pending'),
    (v_delegate, v_artist, 'accepted');
  insert into public.alert_preferences (user_id, new_work_alerts) values (v_f2, false);

  perform set_config('request.jwt.claim.sub', v_delegate::text, true);
  insert into public.artworks (artist_id, created_by, title, visibility)
  select v_artist, v_delegate, 'NW alert draft ' || lpad(g::text, 2, '0'), 'draft'
    from generate_series(1, 7) g;
  v_drafts := array(
    select a.id from public.artworks a
     where a.artist_id = v_artist and a.title like 'NW alert draft %'
     order by a.title
  );

  if (select count(*) from public.notifications where user_id = any(array[v_f1, v_f2, v_f3, v_f4]) and type = 'new_work') <> 0 then
    raise exception 'FAIL drafts alerted';
  end if;

  -- 1. Bulk publish in one statement: one alert with three works.
  update public.artworks set visibility = 'public' where id = any(v_drafts[1:3]);
  v_n := pg_temp.nw_alert_summary(v_users, v_artist, v_curator);
  if v_n <> '{"f1": ["artist:3:unread", "digest:3"], "f2": [], "f3": ["artist:3:unread", "digest:3"], "f4": [], "delegate": [], "curator": [], "artist": []}'::jsonb then
    raise exception 'FAIL 1 bulk statement %', v_n;
  end if;

  -- 2. Bulk publish row by row: the open alert grows to five.
  update public.artworks set visibility = 'public' where id = v_drafts[4];
  update public.artworks set visibility = 'public' where id = v_drafts[5];
  v_n := pg_temp.nw_alert_summary(v_users, v_artist, v_curator);
  if v_n->'f1' <> '["artist:5:unread", "digest:5"]'::jsonb
     or v_n->'f3' <> '["artist:5:unread", "digest:5"]'::jsonb then
    raise exception 'FAIL 2 row by row %', v_n;
  end if;

  -- 3. A read alert is not reopened: the next work starts a new one.
  update public.notifications set read_at = now() where user_id = v_f1 and type = 'new_work';
  update public.artworks set visibility = 'public' where id = v_drafts[6];
  v_n := pg_temp.nw_alert_summary(v_users, v_artist, v_curator);
  if v_n->'f1' <> '["artist:1:unread", "artist:5:read", "digest:1", "digest:5"]'::jsonb
     or v_n->'f3' <> '["artist:6:unread", "digest:6"]'::jsonb then
    raise exception 'FAIL 3 read alert %', v_n;
  end if;

  -- 4. Private -> public again, a no-op public update and a direct
  --    write to first_published_at change nothing.
  v_stamp := (select first_published_at from public.artworks where id = v_drafts[1]);
  update public.artworks set visibility = 'private' where id = v_drafts[1];
  update public.artworks set visibility = 'public' where id = v_drafts[1];
  update public.artworks set visibility = 'public' where id = v_drafts[2];
  update public.artworks set first_published_at = null where id = v_drafts[1];
  if (select first_published_at from public.artworks where id = v_drafts[1]) is distinct from v_stamp then
    raise exception 'FAIL 4 first_published_at moved';
  end if;
  if pg_temp.nw_alert_summary(v_users, v_artist, v_curator) <> v_n then
    raise exception 'FAIL 4 republish alerted %', pg_temp.nw_alert_summary(v_users, v_artist, v_curator);
  end if;

  -- 5. An alert older than 10 minutes is closed.
  update public.notifications set created_at = now() - interval '11 minutes'
   where user_id = v_f3 and type = 'new_work';
  update public.artworks set visibility = 'public' where id = v_drafts[7];
  v_n := pg_temp.nw_alert_summary(v_users, v_artist, v_curator);
  if v_n->'f1' <> '["artist:2:unread", "artist:5:read", "digest:2", "digest:5"]'::jsonb
     or v_n->'f3' <> '["artist:1:unread", "artist:6:unread", "digest:1", "digest:6"]'::jsonb then
    raise exception 'FAIL 5 window %', v_n;
  end if;

  -- 6. Single upload by a curator: inserted public under the curator,
  --    then the claim moves artist_id to the artist.
  perform set_config('request.jwt.claim.sub', v_curator::text, true);
  insert into public.artworks (id, artist_id, created_by, title, visibility)
  values (v_w, v_curator, v_curator, 'NW alert single', 'public');
  v_n := pg_temp.nw_alert_summary(v_users, v_artist, v_curator);
  if v_n->'f3' <> '["artist:1:unread", "artist:6:unread", "curator:1:unread", "digest:1", "digest:1", "digest:6"]'::jsonb then
    raise exception 'FAIL 6 insert under curator %', v_n;
  end if;
  update public.artworks set artist_id = v_artist where id = v_w;
  v_n := pg_temp.nw_alert_summary(v_users, v_artist, v_curator);
  if v_n <> jsonb_build_object(
       'f1', '["artist:3:unread", "artist:5:read", "digest:3", "digest:5"]'::jsonb,
       'f2', '[]'::jsonb,
       'f3', '["artist:2:unread", "artist:6:unread", "digest:2", "digest:6"]'::jsonb,
       'f4', '[]'::jsonb,
       'delegate', '["artist:1:unread", "digest:1"]'::jsonb,
       'curator', '[]'::jsonb,
       'artist', '[]'::jsonb
     ) then
    raise exception 'FAIL 6 artist change %', v_n;
  end if;

  -- 7. The artist's own single upload joins the open alerts.
  perform set_config('request.jwt.claim.sub', v_artist::text, true);
  insert into public.artworks (id, artist_id, created_by, title, visibility)
  values (v_w2, v_artist, v_artist, 'NW alert own', 'public');
  v_n := pg_temp.nw_alert_summary(v_users, v_artist, v_curator);
  if v_n->'f1' <> '["artist:4:unread", "artist:5:read", "digest:4", "digest:5"]'::jsonb
     or v_n->'f3' <> '["artist:3:unread", "artist:6:unread", "digest:3", "digest:6"]'::jsonb
     or v_n->'delegate' <> '["artist:2:unread", "digest:2"]'::jsonb
     or v_n->'artist' <> '[]'::jsonb then
    raise exception 'FAIL 7 own upload %', v_n;
  end if;

  -- 8. Deleting the first work of an alert hands artwork_id to the next.
  delete from public.artworks where id = v_w;
  v_n := pg_temp.nw_alert_summary(v_users, v_artist, v_curator);
  if v_n->'f1' <> '["artist:3:unread", "artist:5:read", "digest:3", "digest:5"]'::jsonb
     or v_n->'f3' <> '["artist:2:unread", "artist:6:unread", "digest:2", "digest:6"]'::jsonb
     or v_n->'delegate' <> '["artist:1:unread", "digest:1"]'::jsonb then
    raise exception 'FAIL 8 delete first work %', v_n;
  end if;
  if (select artwork_id from public.notifications where user_id = v_delegate and type = 'new_work') is distinct from v_w2 then
    raise exception 'FAIL 8 artwork_id not moved to the next work';
  end if;

  -- 9. Deleting the last work removes the alert and its digest event.
  delete from public.artworks where id = v_w2;
  v_n := pg_temp.nw_alert_summary(v_users, v_artist, v_curator);
  if v_n <> jsonb_build_object(
       'f1', '["artist:2:unread", "artist:5:read", "digest:2", "digest:5"]'::jsonb,
       'f2', '[]'::jsonb,
       'f3', '["artist:1:unread", "artist:6:unread", "digest:1", "digest:6"]'::jsonb,
       'f4', '[]'::jsonb,
       'delegate', '[]'::jsonb,
       'curator', '[]'::jsonb,
       'artist', '[]'::jsonb
     ) then
    raise exception 'FAIL 9 delete last work %', v_n;
  end if;

  -- 10. Announcing a work twice is a no-op, and past works stay quiet.
  perform public.new_work_alert_add(v_drafts[1], v_artist, v_delegate);
  if pg_temp.nw_alert_summary(v_users, v_artist, v_curator) <> v_n then
    raise exception 'FAIL 10 duplicate alert %', pg_temp.nw_alert_summary(v_users, v_artist, v_curator);
  end if;
  if exists (select 1 from public.artworks where visibility = 'public' and first_published_at is null) then
    raise exception 'FAIL 10 public work without first_published_at';
  end if;

  raise exception 'new_work_alert: ok %', v_n;
end;
$t$;
