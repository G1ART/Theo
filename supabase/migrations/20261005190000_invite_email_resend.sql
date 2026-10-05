-- Invite email delivery is separate from "a row exists".
--
-- Pending delegation invites that were never mailed are returned so the
-- app can send on that same row. A pending invite that already has
-- invite_email_sent_at is returned with email_sent=true and is not
-- inserted again. Active delegations still raise already_active.
-- Revoked, declined, expired, and past expires_at do not block a new row.
--
-- Profile-path invites never called the mail provider, so they are left
-- with invite_email_sent_at null. Email-path invite_created events were
-- written before the provider call; those rows are marked sent so a later
-- retry offers resend instead of a second blind mail.
--
-- Dashboard: run one SECTION at a time. Dollar tags are letters only.

-- == SECTION 1 == delivery columns and historical marks
alter table public.delegations
  add column if not exists invite_email_sent_at timestamptz,
  add column if not exists invite_email_message_id text;

alter table public.external_artists
  add column if not exists invite_email_sent_at timestamptz,
  add column if not exists invite_email_message_id text;

update public.delegations d
   set invite_email_sent_at = coalesce(d.invited_at, d.created_at)
 where d.invite_email_sent_at is null
   and exists (
     select 1
       from public.delegation_activity_events e
      where e.delegation_id = d.id
        and e.event_type = 'invite_created'
        and e.target_type = 'email'
   );

update public.external_artists
   set invite_email_sent_at = created_at
 where invite_email_sent_at is null
   and nullif(trim(invite_email), '') is not null;

-- == SECTION 2 == create_delegation_invite
create or replace function public.create_delegation_invite(
  p_delegate_email text,
  p_scope_type    public.delegation_scope_type,
  p_project_id    uuid                          default null,
  p_permissions   text[]                        default null,
  p_preset        public.delegation_preset_type default null,
  p_note          text                          default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $invite$
declare
  v_uid             uuid := auth.uid();
  v_email           text;
  v_permissions     text[];
  v_id              uuid;
  v_token           uuid;
  v_now             timestamptz := now();
  v_existing_uid    uuid;
  v_project_title   text;
  v_match_uid       uuid;
  v_existing_id     uuid;
begin
  if v_uid is null then
    raise exception 'permission_denied' using errcode = 'P0001';
  end if;
  v_email := nullif(trim(lower(p_delegate_email)), '');
  if v_email is null then
    raise exception 'missing_email' using errcode = 'P0001';
  end if;
  if p_scope_type = 'project' and p_project_id is null then
    raise exception 'invalid_scope' using errcode = 'P0001';
  end if;
  if p_scope_type = 'project' then
    if not exists (
      select 1 from public.projects p
       where p.id = p_project_id
         and (p.curator_id = v_uid or p.host_profile_id = v_uid)
    ) then
      raise exception 'project_not_found' using errcode = 'P0001';
    end if;
  end if;
  if exists (
    select 1 from auth.users u
     where u.id = v_uid and lower(trim(u.email)) = v_email
  ) then
    raise exception 'cannot_invite_self' using errcode = 'P0001';
  end if;
  if p_preset is not null then
    if not public.delegation_preset_is_valid_for_scope(p_preset, p_scope_type) then
      raise exception 'invalid_scope' using errcode = 'P0001';
    end if;
    v_permissions := public.delegation_preset_permissions(p_preset);
  else
    v_permissions := coalesce(p_permissions, array['view','edit_metadata','manage_works']);
  end if;

  v_match_uid := (
    select u.id
      from auth.users u
     where lower(trim(u.email)) = v_email
     limit 1
  );

  if exists (
    select 1 from public.delegations d
     where d.delegator_profile_id = v_uid
       and d.scope_type = p_scope_type
       and (d.project_id is not distinct from p_project_id)
       and d.status = 'active'
       and (
         lower(trim(d.delegate_email)) = v_email
         or (v_match_uid is not null and d.delegate_profile_id = v_match_uid)
       )
  ) then
    raise exception 'already_active' using errcode = 'P0001';
  end if;

  v_existing_id := (
    select d.id
      from public.delegations d
     where d.delegator_profile_id = v_uid
       and d.scope_type = p_scope_type
       and (d.project_id is not distinct from p_project_id)
       and d.status = 'pending'
       and (d.expires_at is null or d.expires_at > v_now)
       and (
         lower(trim(d.delegate_email)) = v_email
         or (v_match_uid is not null and d.delegate_profile_id = v_match_uid)
       )
     order by d.invited_at desc nulls last
     limit 1
  );

  if v_existing_id is not null then
    return jsonb_build_object(
      'id', v_existing_id,
      'invite_token', (select d.invite_token from public.delegations d where d.id = v_existing_id),
      'already_pending', true,
      'email_sent', (
        select d.invite_email_sent_at is not null
          from public.delegations d
         where d.id = v_existing_id
      )
    );
  end if;

  update public.delegations d
     set status = 'expired', updated_at = v_now
   where d.delegator_profile_id = v_uid
     and d.scope_type = p_scope_type
     and (d.project_id is not distinct from p_project_id)
     and d.status = 'pending'
     and d.expires_at is not null
     and d.expires_at <= v_now
     and (
       lower(trim(d.delegate_email)) = v_email
       or (v_match_uid is not null and d.delegate_profile_id = v_match_uid)
     );

  insert into public.delegations (
    delegator_profile_id, delegate_email, scope_type, project_id,
    permissions, preset, note, status,
    invited_at, invited_by, updated_at
  ) values (
    v_uid, v_email, p_scope_type, p_project_id,
    v_permissions, p_preset, nullif(trim(p_note), ''), 'pending',
    v_now, v_uid, v_now
  )
  returning id, invite_token into v_id, v_token;

  perform public.record_delegation_event(
    v_id, 'invite_created', 'email', null,
    null,
    jsonb_build_object('preset', p_preset, 'scope', p_scope_type)
  );

  if p_scope_type = 'project' and p_project_id is not null then
    v_project_title := (select p.title from public.projects p where p.id = p_project_id);
  end if;

  v_existing_uid := v_match_uid;

  if v_existing_uid is not null then
    perform public._record_delegation_notification(
      v_existing_uid,
      'delegation_invite_received',
      v_uid,
      jsonb_build_object(
        'delegation_id', v_id,
        'scope_type',    p_scope_type,
        'project_id',    p_project_id,
        'project_title', v_project_title,
        'preset',        p_preset
      )
    );
  end if;

  return jsonb_build_object(
    'id', v_id,
    'invite_token', v_token,
    'already_pending', false,
    'email_sent', false
  );
end;
$invite$;

drop function if exists public.create_delegation_invite(text, public.delegation_scope_type, uuid, text[]);

-- == SECTION 3 == create_delegation_invite_for_profile
create or replace function public.create_delegation_invite_for_profile(
  p_delegate_profile_id uuid,
  p_scope_type          public.delegation_scope_type,
  p_project_id          uuid                          default null,
  p_permissions         text[]                        default null,
  p_preset              public.delegation_preset_type default null,
  p_note                text                          default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $profile$
declare
  v_uid           uuid := auth.uid();
  v_email         text;
  v_permissions   text[];
  v_id            uuid;
  v_token         uuid;
  v_now           timestamptz := now();
  v_project_title text;
  v_existing_id   uuid;
begin
  if v_uid is null then
    raise exception 'permission_denied' using errcode = 'P0001';
  end if;
  if p_delegate_profile_id is null then
    raise exception 'delegate_not_found' using errcode = 'P0001';
  end if;
  if p_delegate_profile_id = v_uid then
    raise exception 'cannot_invite_self' using errcode = 'P0001';
  end if;
  if p_scope_type = 'project' and p_project_id is null then
    raise exception 'invalid_scope' using errcode = 'P0001';
  end if;
  if p_scope_type = 'project' then
    if not exists (
      select 1 from public.projects p
       where p.id = p_project_id
         and (p.curator_id = v_uid or p.host_profile_id = v_uid)
    ) then
      raise exception 'project_not_found' using errcode = 'P0001';
    end if;
  end if;

  v_email := lower((
    select nullif(trim(u.email), '')
      from auth.users u
     where u.id = p_delegate_profile_id
  ));
  if v_email is null or v_email = '' then
    raise exception 'delegate_not_found' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from auth.users u
     where u.id = v_uid and lower(trim(u.email)) = v_email
  ) then
    raise exception 'cannot_invite_self' using errcode = 'P0001';
  end if;

  if p_preset is not null then
    if not public.delegation_preset_is_valid_for_scope(p_preset, p_scope_type) then
      raise exception 'invalid_scope' using errcode = 'P0001';
    end if;
    v_permissions := public.delegation_preset_permissions(p_preset);
  else
    v_permissions := coalesce(p_permissions, array['view','edit_metadata','manage_works']);
  end if;

  if exists (
    select 1 from public.delegations d
     where d.delegator_profile_id = v_uid
       and d.scope_type = p_scope_type
       and (d.project_id is not distinct from p_project_id)
       and d.status = 'active'
       and (
         d.delegate_profile_id = p_delegate_profile_id
         or lower(trim(d.delegate_email)) = v_email
       )
  ) then
    raise exception 'already_active' using errcode = 'P0001';
  end if;

  v_existing_id := (
    select d.id
      from public.delegations d
     where d.delegator_profile_id = v_uid
       and d.scope_type = p_scope_type
       and (d.project_id is not distinct from p_project_id)
       and d.status = 'pending'
       and (d.expires_at is null or d.expires_at > v_now)
       and (
         d.delegate_profile_id = p_delegate_profile_id
         or lower(trim(d.delegate_email)) = v_email
       )
     order by d.invited_at desc nulls last
     limit 1
  );

  if v_existing_id is not null then
    return jsonb_build_object(
      'id', v_existing_id,
      'invite_token', (select d.invite_token from public.delegations d where d.id = v_existing_id),
      'already_pending', true,
      'email_sent', (
        select d.invite_email_sent_at is not null
          from public.delegations d
         where d.id = v_existing_id
      )
    );
  end if;

  update public.delegations d
     set status = 'expired', updated_at = v_now
   where d.delegator_profile_id = v_uid
     and d.scope_type = p_scope_type
     and (d.project_id is not distinct from p_project_id)
     and d.status = 'pending'
     and d.expires_at is not null
     and d.expires_at <= v_now
     and (
       d.delegate_profile_id = p_delegate_profile_id
       or lower(trim(d.delegate_email)) = v_email
     );

  insert into public.delegations (
    delegator_profile_id, delegate_profile_id, delegate_email,
    scope_type, project_id, permissions, preset, note, status,
    invited_at, invited_by, updated_at
  ) values (
    v_uid, p_delegate_profile_id, v_email,
    p_scope_type, p_project_id, v_permissions, p_preset,
    nullif(trim(p_note), ''), 'pending',
    v_now, v_uid, v_now
  )
  returning id, invite_token into v_id, v_token;

  perform public.record_delegation_event(
    v_id, 'invite_created', 'profile', p_delegate_profile_id,
    null,
    jsonb_build_object('preset', p_preset, 'scope', p_scope_type)
  );

  if p_scope_type = 'project' and p_project_id is not null then
    v_project_title := (select p.title from public.projects p where p.id = p_project_id);
  end if;

  perform public._record_delegation_notification(
    p_delegate_profile_id,
    'delegation_invite_received',
    v_uid,
    jsonb_build_object(
      'delegation_id', v_id,
      'scope_type',    p_scope_type,
      'project_id',    p_project_id,
      'project_title', v_project_title,
      'preset',        p_preset
    )
  );

  return jsonb_build_object(
    'id', v_id,
    'invite_token', v_token,
    'already_pending', false,
    'email_sent', false
  );
end;
$profile$;

-- == SECTION 4 == record a successful delegation mail
create or replace function public.record_delegation_invite_email(
  p_delegation_id uuid,
  p_message_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $record$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_message text := nullif(trim(p_message_id), '');
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'permission_denied');
  end if;
  if p_delegation_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  v_id := (
    select d.id
      from public.delegations d
     where d.id = p_delegation_id
       and d.delegator_profile_id = v_uid
       and d.status = 'pending'
       and (d.expires_at is null or d.expires_at > now())
  );
  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  update public.delegations
     set invite_email_sent_at = now(),
         invite_email_message_id = v_message,
         updated_at = now()
   where id = v_id;

  perform public.record_delegation_event(
    v_id,
    'invite_email_sent',
    'email',
    null,
    null,
    case
      when v_message is null then '{}'::jsonb
      else jsonb_build_object('message_id', v_message)
    end
  );

  return jsonb_build_object('ok', true);
end;
$record$;

revoke all on function public.record_delegation_invite_email(uuid, text) from public;
grant execute on function public.record_delegation_invite_email(uuid, text) to authenticated;

-- == SECTION 5 == external-artist onboarding delivery
create or replace function public.external_artist_invite_email_state(
  p_email text
)
returns text
language plpgsql
security definer
stable
set search_path = public
as $state$
declare
  v_email text := nullif(lower(trim(p_email)), '');
begin
  if v_email is null or auth.uid() is null then
    return 'none';
  end if;
  if exists (
    select 1
      from public.external_artists ea
     where ea.claimed_profile_id is not null
       and lower(trim(ea.invite_email)) = v_email
  ) then
    return 'claimed';
  end if;
  if exists (
    select 1
      from public.external_artists ea
     where ea.claimed_profile_id is null
       and lower(trim(ea.invite_email)) = v_email
       and ea.invite_email_sent_at is not null
  ) then
    return 'sent';
  end if;
  if exists (
    select 1
      from public.external_artists ea
     where ea.claimed_profile_id is null
       and lower(trim(ea.invite_email)) = v_email
  ) then
    return 'unsent';
  end if;
  return 'none';
end;
$state$;

revoke all on function public.external_artist_invite_email_state(text) from public;
grant execute on function public.external_artist_invite_email_state(text) to authenticated;

create or replace function public.prepare_external_artist_invite_email(
  p_external_artist_id uuid,
  p_resend boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $prepare$
declare
  v_uid uuid := auth.uid();
  v_row public.external_artists%rowtype;
  v_found boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'permission_denied');
  end if;
  if p_external_artist_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  v_found := exists (
    select 1 from public.external_artists ea where ea.id = p_external_artist_id
  );
  if not v_found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select ea.* into v_row
    from public.external_artists ea
   where ea.id = p_external_artist_id;
  if v_row.invited_by is distinct from v_uid
     and not public.is_active_writer_for(v_row.invited_by) then
    return jsonb_build_object('ok', false, 'code', 'permission_denied');
  end if;
  if v_row.claimed_profile_id is not null then
    return jsonb_build_object('ok', false, 'code', 'already_onboarded');
  end if;
  if nullif(trim(v_row.invite_email), '') is null then
    return jsonb_build_object('ok', false, 'code', 'missing_email');
  end if;
  if v_row.invite_email_sent_at is not null and coalesce(p_resend, false) = false then
    return jsonb_build_object('ok', true, 'dispatch', false, 'already_sent', true);
  end if;

  return jsonb_build_object(
    'ok', true,
    'dispatch', true,
    'already_sent', false,
    'to_email', v_row.invite_email,
    'artist_name', v_row.display_name
  );
end;
$prepare$;

revoke all on function public.prepare_external_artist_invite_email(uuid, boolean) from public;
grant execute on function public.prepare_external_artist_invite_email(uuid, boolean) to authenticated;

create or replace function public.record_external_artist_invite_email(
  p_email text,
  p_message_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $markext$
declare
  v_email text := nullif(lower(trim(p_email)), '');
  v_message text := nullif(trim(p_message_id), '');
  v_count int := 0;
begin
  if v_email is null then
    return jsonb_build_object('ok', false, 'code', 'missing_email');
  end if;

  update public.external_artists ea
     set invite_email_sent_at = now(),
         invite_email_message_id = v_message
   where ea.claimed_profile_id is null
     and lower(trim(ea.invite_email)) = v_email;
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'updated', v_count);
end;
$markext$;

revoke all on function public.record_external_artist_invite_email(text, text) from public;
grant execute on function public.record_external_artist_invite_email(text, text) to service_role;
