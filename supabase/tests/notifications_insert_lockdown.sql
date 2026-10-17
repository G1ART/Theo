-- Rolled-back check for 20261017214917_notifications_insert_lockdown.
--
-- Uses two throwaway accounts and always ends by raising, so nothing it
-- writes is kept and no real account gets an alert. Each step runs as
-- the authenticated or anon role, so RLS and grants apply as they do for
-- the app. Success ends with "notifications_lockdown: ok"; any other
-- message is the first failed check.

do $t$
declare
  v_tag text := substr(md5(random()::text), 1, 8);
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_work uuid := gen_random_uuid();
  v_board uuid := gen_random_uuid();
  v_inquiry uuid := gen_random_uuid();
  v_alert uuid;
  v_n int;
  v_denied text[] := '{}';
  v_types jsonb;
  v_missing text[];
begin
  insert into auth.users (id, email)
  values (v_a, 'nw-lock-' || v_tag || '-a@example.invalid'),
         (v_b, 'nw-lock-' || v_tag || '-b@example.invalid');
  insert into public.profiles (id, username, display_name)
  values (v_a, 'nw_lock_' || v_tag || '_a', 'NW lock ' || v_tag || ' A'),
         (v_b, 'nw_lock_' || v_tag || '_b', 'NW lock ' || v_tag || ' B')
  on conflict (id) do update
    set username = excluded.username,
        display_name = excluded.display_name;
  insert into public.artworks (id, artist_id, created_by, title, visibility)
  values (v_work, v_b, v_b, 'NW lock work', 'public');

  -- A, signed in
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    insert into public.notifications (user_id, type, actor_id) values (v_b, 'follow', v_a);
    raise exception 'FAIL signed-in user inserted an alert for someone else';
  exception when insufficient_privilege then
    v_denied := v_denied || 'insert'::text;
  end;
  begin
    perform public._record_delegation_notification(v_b, 'follow', v_a, '{}'::jsonb);
    raise exception 'FAIL signed-in user called _record_delegation_notification';
  exception when insufficient_privilege then
    v_denied := v_denied || 'helper'::text;
  end;

  insert into public.follows (follower_id, following_id) values (v_a, v_b);
  insert into public.artwork_likes (artwork_id, user_id) values (v_work, v_a);
  insert into public.connection_messages (sender_id, recipient_id, body) values (v_a, v_b, 'hello');
  insert into public.price_inquiries (id, artwork_id, inquirer_id) values (v_inquiry, v_work, v_a);
  v_n := public.resend_price_inquiry_notification(v_inquiry);
  if v_n < 1 then
    raise exception 'FAIL resend_price_inquiry_notification sent nothing';
  end if;
  insert into public.claims (subject_profile_id, claim_type, work_id, status)
  values (v_a, 'OWNS', v_work, 'pending');
  insert into public.shortlists (id, owner_id, title) values (v_board, v_a, 'NW lock board');
  insert into public.shortlist_items (shortlist_id, artwork_id) values (v_board, v_work);
  perform public.create_delegation_invite_for_profile(v_b, 'account', null, null, 'operations', null);

  -- B, signed in
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_b, 'role', 'authenticated')::text, true);

  insert into public.price_inquiry_messages (inquiry_id, sender_id, body) values (v_inquiry, v_b, 'reply');
  insert into public.artworks (artist_id, created_by, title, visibility)
  values (v_b, v_b, 'NW lock new work', 'public');

  v_alert := (select n.id from public.notifications n where n.user_id = v_b and n.type = 'follow' limit 1);
  if v_alert is null then
    raise exception 'FAIL recipient cannot read their follow alert';
  end if;
  update public.notifications set read_at = now() where id = v_alert;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'FAIL recipient could not mark an alert read';
  end if;
  begin
    update public.notifications set payload = '{"forged": true}'::jsonb where id = v_alert;
    raise exception 'FAIL recipient rewrote an alert payload';
  exception when insufficient_privilege then
    v_denied := v_denied || 'payload'::text;
  end;

  -- signed out
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
  begin
    insert into public.notifications (user_id, type, actor_id) values (v_b, 'follow', v_a);
    raise exception 'FAIL anon inserted an alert';
  exception when insufficient_privilege then
    v_denied := v_denied || 'anon_insert'::text;
  end;
  begin
    perform public._record_delegation_notification(v_b, 'follow', v_a, '{}'::jsonb);
    raise exception 'FAIL anon called _record_delegation_notification';
  exception when insufficient_privilege then
    v_denied := v_denied || 'anon_helper'::text;
  end;

  perform set_config('role', 'postgres', true);

  v_types := (
    select coalesce(jsonb_object_agg(x.k, x.n), '{}'::jsonb)
      from (
        select (case n.user_id when v_a then 'a:' else 'b:' end) || n.type as k, count(*) as n
          from public.notifications n
         where n.user_id in (v_a, v_b)
         group by 1
      ) x
  );
  v_missing := array(
    select e.k
      from unnest(array[
        'b:follow', 'b:like', 'b:connection_message', 'b:price_inquiry',
        'b:claim_request', 'b:board_save', 'b:delegation_invite_received',
        'a:price_inquiry_reply', 'a:new_work'
      ]) as e(k)
     where not (v_types ? e.k)
  );
  if cardinality(v_missing) > 0 then
    raise exception 'FAIL missing alerts % in %', v_missing, v_types;
  end if;
  if (v_types->>'b:price_inquiry')::int < 2 then
    raise exception 'FAIL resend did not add a price_inquiry alert %', v_types;
  end if;
  if v_denied <> array['insert', 'helper', 'payload', 'anon_insert', 'anon_helper'] then
    raise exception 'FAIL denied steps %', v_denied;
  end if;

  raise exception 'notifications_lockdown: ok % denied=%', v_types, v_denied;
end;
$t$;
