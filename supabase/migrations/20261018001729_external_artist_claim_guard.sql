-- 2026-10-17 — Only the verified-email merge may say which account took an
-- invite (external_artists.claimed_profile_id).
--
-- external_artists_all_own lets the inviter write every column of their own
-- invite rows, and any signed-in user can insert invite rows. Setting
-- claimed_profile_id to someone else's id made the next merge for that
-- account move the invite's works, credits and CREATED claims onto their
-- profile. link_external_artist_to_profile did the same through an RPC:
-- the inviter picked any profile and the works moved at once.
--
-- Legitimate writers all run as the function owner and are unchanged:
-- link_matching_external_artists_for_user (verified email, from the
-- sign-up, confirmation and profile triggers), claim_orphan_external_artist_as_self
-- (the caller's own account, name match, invites without an email) and
-- admin_merge_external_artists (ops, never sets the column).
--
--   * Section 1: anon loses every write privilege on the table (no anon
--     write policy exists). authenticated keeps row writes under the same
--     RLS policy, column by column, without claimed_profile_id.
--   * Section 2: a trigger refuses the column from anon / authenticated even
--     if a later grant opens the table again.
--   * Section 3: link_external_artist_to_profile links only an account
--     whose verified email is the invite email (the merge rule).
--
-- No row is changed. Two plpgsql functions: run one section at a time in
-- the SQL Editor. Dollar tags are letters only.

-- == SECTION 1 == privileges on external_artists

revoke insert, update, delete, truncate, references, trigger on public.external_artists from anon;
revoke insert, update, truncate, references, trigger on public.external_artists from authenticated;

grant insert (
  id, display_name, website, instagram, invite_email, invited_by, created_at, status, updated_at,
  display_name_ko, display_name_en,
  notify_on_inquiry_via_email, notify_email_consented_at,
  notify_on_profile_interest_via_email, notify_profile_interest_consented_at,
  invite_email_sent_at, invite_email_message_id
) on public.external_artists to authenticated;

grant update (
  id, display_name, website, instagram, invite_email, invited_by, created_at, status, updated_at,
  display_name_ko, display_name_en,
  notify_on_inquiry_via_email, notify_email_consented_at,
  notify_on_profile_interest_via_email, notify_profile_interest_consented_at,
  invite_email_sent_at, invite_email_message_id
) on public.external_artists to authenticated;

-- == SECTION 2 == external_artists_guard_claimed_profile

create or replace function public.external_artists_guard_claimed_profile()
returns trigger
language plpgsql
set search_path = public
as $a$
begin
  if current_user in ('anon', 'authenticated')
     and (
       (tg_op = 'INSERT' and new.claimed_profile_id is not null)
       or (tg_op = 'UPDATE' and new.claimed_profile_id is distinct from old.claimed_profile_id)
     ) then
    raise exception 'external_artists.claimed_profile_id is set only by the verified-email merge'
      using errcode = '42501';
  end if;
  return new;
end;
$a$;

revoke all on function public.external_artists_guard_claimed_profile() from public, anon, authenticated;

drop trigger if exists trg_external_artists_guard_claimed_profile on public.external_artists;
create trigger trg_external_artists_guard_claimed_profile
  before insert or update of claimed_profile_id on public.external_artists
  for each row execute function public.external_artists_guard_claimed_profile();

-- == SECTION 3 == link_external_artist_to_profile — verified invite email only

create or replace function public.link_external_artist_to_profile(p_external_artist_id uuid, p_target_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_uid       uuid := auth.uid();
  v_inviter   uuid;
  v_claimed   uuid;
  v_email     text;
  v_work_ids  uuid[];
  v_claims    int;
begin
  if v_uid is null then
    raise exception 'auth.uid() is null';
  end if;

  v_inviter := (select ea.invited_by from public.external_artists ea where ea.id = p_external_artist_id);
  v_claimed := (select ea.claimed_profile_id from public.external_artists ea where ea.id = p_external_artist_id);
  v_email   := (select nullif(trim(ea.invite_email), '') from public.external_artists ea where ea.id = p_external_artist_id);
  if v_inviter is null then
    raise exception 'external_artist not found';
  end if;
  if v_uid <> v_inviter and not public.is_active_writer_for(v_inviter) then
    raise exception 'forbidden: only the inviter or their account delegate may link this artist';
  end if;
  if v_claimed is not null then
    raise exception 'external_artist is already linked to a profile';
  end if;

  perform 1 from public.profiles where id = p_target_profile_id;
  if not found then
    raise exception 'target profile not found';
  end if;

  if v_email is null or not exists (
    select 1
      from auth.users u
     where u.id = p_target_profile_id
       and u.email_confirmed_at is not null
       and lower(trim(u.email)) = lower(v_email)
  ) then
    raise exception 'forbidden: the target account has not verified the invite email'
      using errcode = '42501';
  end if;

  update public.external_artists
     set claimed_profile_id = p_target_profile_id, status = 'claimed'
   where id = p_external_artist_id;

  v_work_ids := (
    select array_agg(work_id)
      from public.claims
     where external_artist_id = p_external_artist_id and work_id is not null
  );

  update public.claims
     set artist_profile_id = p_target_profile_id, external_artist_id = null
   where external_artist_id = p_external_artist_id;
  get diagnostics v_claims = row_count;

  if v_work_ids is not null and array_length(v_work_ids, 1) > 0 then
    update public.artworks
       set artist_id = p_target_profile_id
     where id = any(v_work_ids);

    perform public.ensure_created_claims_for_linked_artist(p_target_profile_id, v_work_ids);
  end if;

  return jsonb_build_object(
    'external_artist_id', p_external_artist_id,
    'target_profile_id', p_target_profile_id,
    'claims_migrated', v_claims,
    'works_moved', coalesce(array_length(v_work_ids, 1), 0)
  );
end;
$a$;

revoke all on function public.link_external_artist_to_profile(uuid, uuid) from public, anon;
grant execute on function public.link_external_artist_to_profile(uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
