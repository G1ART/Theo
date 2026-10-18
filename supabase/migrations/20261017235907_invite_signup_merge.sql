-- 2026-10-17 — Invited artists: works and credits move to the new account
-- when sign-up is complete, on every invite path.
--
-- Invites are the SendGrid mail (/api/artist-invite-email, link to
-- /onboarding?email=); no account is created before the artist signs up.
-- link_matching_external_artists_for_user stays the single merge, called
-- from auth.users INSERT, auth.users UPDATE OF email / email_confirmed_at,
-- and profiles INSERT OR UPDATE.
--
--   * Section 1: the merge waits for a verified email. Before, the
--     auth.users INSERT of an unconfirmed sign-up already moved the invited
--     works, so an address typed by someone who never opened the inbox
--     held them. The profile row is still created at INSERT as before;
--     claiming runs on confirmation (or at INSERT when the provider has
--     already verified the email, e.g. Google).
--   * Section 2: exhibition participants can get their email after the
--     name. 20260728220000 made the project-scope CURATED insert
--     idempotent; the later overloads (240005, 20260729100000,
--     20260729120000) dropped that, so the second save of a row failed on
--     uq_claims_project_curated_ext and the email was never stored. Also,
--     a name-only invite given an email another open invite already holds
--     now uses that invite instead of failing on uq_external_artists_email_global.
--   * Section 3: the 13- and 14-argument copies are dropped so every call
--     reaches the one definition above. No SQL caller uses them.
--
-- Existing rows are not changed. Two plpgsql functions: in the SQL Editor
-- run one section at a time. Dollar tags are letters only.

-- == SECTION 1 == link_matching_external_artists_for_user — verified email only
create or replace function public.link_matching_external_artists_for_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $link$
declare
  v_email text;
  v_ext_ids uuid[];
  v_work_ids uuid[];
  v_ext_ko text;
  v_ext_en text;
begin
  if p_user_id is null then
    return;
  end if;

  v_email := coalesce(
    nullif(trim((
      select u.email from auth.users u where u.id = p_user_id
    )), ''),
    ''
  );
  if v_email = '' then
    return;
  end if;

  insert into public.profiles (
    id, is_public, roles, profile_completeness, profile_details,
    profile_updated_at, updated_at
  )
  values (
    p_user_id, true, '{}'::text[], 0, '{}'::jsonb, now(), now()
  )
  on conflict (id) do nothing;

  if not exists (
    select 1
      from auth.users u
     where u.id = p_user_id
       and u.email_confirmed_at is not null
  ) then
    return;
  end if;

  update public.external_artists
     set claimed_profile_id = p_user_id,
         status = 'claimed'
   where lower(trim(invite_email)) = lower(v_email)
     and claimed_profile_id is null;

  v_ext_ids := (
    select array_agg(id)
      from public.external_artists
     where claimed_profile_id = p_user_id
  );

  if v_ext_ids is null or array_length(v_ext_ids, 1) is null then
    return;
  end if;

  v_ext_ko := (
    select max(nullif(trim(coalesce(display_name_ko, '')), ''))
      from public.external_artists
     where id = any(v_ext_ids)
       and display_name_ko is not null
  );
  v_ext_en := (
    select max(nullif(trim(coalesce(display_name_en, '')), ''))
      from public.external_artists
     where id = any(v_ext_ids)
       and display_name_en is not null
  );

  update public.profiles
     set display_name_ko = coalesce(display_name_ko, v_ext_ko),
         display_name_en = coalesce(display_name_en, v_ext_en)
   where id = p_user_id
     and (
       (display_name_ko is null and v_ext_ko is not null)
       or (display_name_en is null and v_ext_en is not null)
     );

  v_work_ids := (
    select array_agg(work_id)
      from public.claims
     where external_artist_id = any(v_ext_ids)
       and work_id is not null
  );

  update public.claims
     set artist_profile_id = p_user_id,
         external_artist_id = null
   where external_artist_id = any(v_ext_ids);

  if v_work_ids is not null and array_length(v_work_ids, 1) > 0 then
    update public.artworks
       set artist_id = p_user_id
     where id = any(v_work_ids);

    perform public.ensure_created_claims_for_linked_artist(p_user_id, v_work_ids);
  end if;
end;
$link$;

revoke all on function public.link_matching_external_artists_for_user(uuid) from public, anon, authenticated;

-- == SECTION 2 == create_external_artist_and_claim — idempotent participants, email that is already invited
create or replace function public.create_external_artist_and_claim(
  p_display_name text,
  p_invite_email text default null,
  p_work_id uuid default null,
  p_project_id uuid default null,
  p_claim_type text default 'OWNS',
  p_website text default null,
  p_instagram text default null,
  p_visibility text default 'public',
  p_period_status text default null,
  p_subject_profile_id uuid default null,
  p_external_artist_id uuid default null,
  p_display_name_ko text default null,
  p_display_name_en text default null,
  p_notify_on_inquiry_via_email boolean default false,
  p_notify_on_profile_interest_via_email boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $claim$
declare
  v_uid        uuid := auth.uid();
  v_subject    uuid;
  v_ext_id     uuid;
  v_email      text;
  v_ext_row    jsonb;
  v_claim_row  jsonb;
  v_check      uuid;
  v_other      uuid;
  v_name_ko    text := nullif(trim(coalesce(p_display_name_ko, '')), '');
  v_name_en    text := nullif(trim(coalesce(p_display_name_en, '')), '');
  v_notify     boolean := coalesce(p_notify_on_inquiry_via_email, false);
  v_notify_interest boolean := coalesce(p_notify_on_profile_interest_via_email, false);
  v_participant boolean := p_work_id is null and p_project_id is not null and p_claim_type = 'CURATED';
begin
  if v_uid is null then
    raise exception 'auth.uid() is null';
  end if;
  if p_display_name is null or length(trim(p_display_name)) < 2 then
    raise exception 'display_name must be at least 2 characters';
  end if;
  if (p_work_id is null and p_project_id is null)
     or (p_work_id is not null and p_project_id is not null) then
    raise exception 'exactly one of work_id, project_id required';
  end if;
  if p_visibility is null then
    p_visibility := 'public';
  end if;
  if p_period_status is not null
     and p_period_status not in ('past', 'current', 'future') then
    raise exception 'period_status must be past, current, or future';
  end if;

  v_subject := coalesce(p_subject_profile_id, v_uid);
  if v_subject <> v_uid then
    if not public.is_active_writer_for(v_subject) then
      raise exception 'forbidden: caller is not an active account delegate writer for subject_profile_id';
    end if;
  end if;

  v_email := nullif(trim(p_invite_email), '');

  if p_external_artist_id is not null then
    v_check := (
      select ea.id
        from public.external_artists ea
       where ea.id = p_external_artist_id
         and ea.claimed_profile_id is null
         and ea.invited_by in (v_uid, v_subject)
       limit 1
    );
    if v_check is not null then
      v_ext_id := v_check;

      if v_email is not null and nullif(trim((
           select ea.invite_email from public.external_artists ea where ea.id = v_check
         )), '') is null then
        v_other := (
          select ea.id
            from public.external_artists ea
           where ea.claimed_profile_id is null
             and lower(trim(ea.invite_email)) = lower(v_email)
             and ea.id <> v_check
           order by ea.created_at asc
           limit 1
        );
        if v_other is not null then
          v_ext_id := v_other;
          if v_participant then
            delete from public.claims c
             where c.project_id = p_project_id
               and c.work_id is null
               and c.claim_type = 'CURATED'
               and c.external_artist_id = v_check
               and c.subject_profile_id = v_subject
               and exists (
                 select 1
                   from public.claims t
                  where t.project_id = p_project_id
                    and t.work_id is null
                    and t.claim_type = 'CURATED'
                    and t.external_artist_id = v_other
               );
            update public.claims c
               set external_artist_id = v_other
             where c.project_id = p_project_id
               and c.work_id is null
               and c.claim_type = 'CURATED'
               and c.external_artist_id = v_check
               and c.subject_profile_id = v_subject;
          end if;
        end if;
      end if;

      update public.external_artists
         set website      = coalesce(nullif(trim(website), ''), nullif(trim(p_website), '')),
             instagram    = coalesce(nullif(trim(instagram), ''), nullif(trim(p_instagram), '')),
             invite_email = coalesce(nullif(trim(invite_email), ''), v_email),
             display_name_ko = coalesce(display_name_ko, v_name_ko),
             display_name_en = coalesce(display_name_en, v_name_en),
             notify_on_inquiry_via_email = case
               when v_notify and notify_on_inquiry_via_email is not true then true
               else notify_on_inquiry_via_email end,
             notify_email_consented_at = case
               when v_notify and notify_on_inquiry_via_email is not true then now()
               else notify_email_consented_at end,
             notify_on_profile_interest_via_email = case
               when v_notify_interest and notify_on_profile_interest_via_email is not true then true
               else notify_on_profile_interest_via_email end,
             notify_profile_interest_consented_at = case
               when v_notify_interest and notify_on_profile_interest_via_email is not true then now()
               else notify_profile_interest_consented_at end
       where id = v_ext_id;
    end if;
  end if;

  if v_ext_id is null then
    v_ext_id := public.get_or_create_external_artist(
      trim(p_display_name),
      v_email,
      v_name_ko,
      v_name_en,
      v_notify,
      v_notify_interest
    );

    if v_ext_id is not null and (
         nullif(trim(coalesce(p_website, '')), '') is not null
         or nullif(trim(coalesce(p_instagram, '')), '') is not null
       ) then
      update public.external_artists
         set website   = coalesce(nullif(trim(website), ''),   nullif(trim(p_website), '')),
             instagram = coalesce(nullif(trim(instagram), ''), nullif(trim(p_instagram), ''))
       where id = v_ext_id;
    end if;
  end if;

  if v_ext_id is null then
    raise exception 'failed to resolve external_artist for display_name=% email=%',
      p_display_name, coalesce(v_email, '<none>');
  end if;

  if v_participant then
    insert into public.claims (
      subject_profile_id, claim_type, work_id, project_id,
      external_artist_id, visibility, period_status
    )
    values (
      v_subject, p_claim_type, p_work_id, p_project_id,
      v_ext_id, p_visibility, p_period_status
    )
    on conflict (project_id, external_artist_id, claim_type)
      where work_id is null
        and claim_type = 'CURATED'
        and external_artist_id is not null
      do nothing;

    v_claim_row := (
      select to_jsonb(c.*)
        from public.claims c
       where c.project_id = p_project_id
         and c.external_artist_id = v_ext_id
         and c.claim_type = p_claim_type
         and c.work_id is null
       order by c.created_at asc, c.id asc
       limit 1
    );
  else
    insert into public.claims (
      subject_profile_id, claim_type, work_id, project_id,
      external_artist_id, visibility, period_status
    )
    values (
      v_subject, p_claim_type, p_work_id, p_project_id,
      v_ext_id, p_visibility, p_period_status
    );

    v_claim_row := (
      select to_jsonb(c.*)
        from public.claims c
       where c.subject_profile_id = v_subject
         and c.external_artist_id = v_ext_id
       order by c.created_at desc
       limit 1
    );
  end if;

  v_ext_row := (select to_jsonb(e.*) from public.external_artists e where e.id = v_ext_id);

  return jsonb_build_object('external_artist', v_ext_row, 'claim', v_claim_row);
end;
$claim$;

grant execute on function public.create_external_artist_and_claim(
  text, text, uuid, uuid, text, text, text, text, text, uuid, uuid, text, text, boolean, boolean
) to authenticated;

-- == SECTION 3 == drop the 13- and 14-argument copies
drop function if exists public.create_external_artist_and_claim(
  text, text, uuid, uuid, text, text, text, text, text, uuid, uuid, text, text
);
drop function if exists public.create_external_artist_and_claim(
  text, text, uuid, uuid, text, text, text, text, text, uuid, uuid, text, text, boolean
);

notify pgrst, 'reload schema';
