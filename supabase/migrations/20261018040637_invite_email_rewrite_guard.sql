-- 2026-10-17 — An invite's email cannot be changed to an address another
-- account has already verified (대표님 결정 block_verified_other), and the
-- profile link says why it refuses (profile_link_mismatch = explain).
--
-- The merge (link_matching_external_artists_for_user) gives an open invite's
-- works to whoever verifies its email. So changing external_artists.invite_email
-- to an address that is already verified, or pointing an existing claim at an
-- invite that carries such an address, handed the works to that account on
-- its next profile save.
--
--   * Section 1: invite_email_verified_by_account(email), internal.
--   * Section 2: external_artists — a changed invite_email may not be an
--     address any account has verified. Unregistered or unconfirmed
--     addresses, typo fixes, case changes and clearing the email still work.
--   * Section 3: claims — an existing claim may not move to an invite whose
--     email differs from its current one and is already verified.
--   * Section 4: link_external_artist_to_profile raises invite_email_mismatch
--     when the target's verified email is not the invite email.
--
-- New invites (uploads, first save of a participant with an email) are not
-- changes and stay as before; when the invited person verifies that address
-- the merge moves the works as in e5ac462. Ops (is_ops_user) are exempt.
-- Both refusals are message tokens the app maps to copy
-- (src/lib/errors/supabase.ts). No row is changed. Run one section at a time
-- in the SQL Editor. Dollar tags are letters only.

-- == SECTION 1 == invite_email_verified_by_account

create or replace function public.invite_email_verified_by_account(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $a$
  select nullif(trim(coalesce(p_email, '')), '') is not null
     and exists (
       select 1
         from auth.users u
        where lower(trim(u.email)) = lower(trim(p_email))
          and u.email_confirmed_at is not null
     );
$a$;

revoke all on function public.invite_email_verified_by_account(text) from public, anon, authenticated;

-- == SECTION 2 == external_artists_guard_invite_email

create or replace function public.external_artists_guard_invite_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_new text;
  v_old text;
begin
  v_new := lower(nullif(trim(coalesce(new.invite_email, '')), ''));
  v_old := lower(nullif(trim(coalesce(old.invite_email, '')), ''));
  if v_new is null or v_new is not distinct from v_old or public.is_ops_user() then
    return new;
  end if;
  if public.invite_email_verified_by_account(v_new) then
    raise exception 'invite_email_verified_by_other_account'
      using errcode = '23514';
  end if;
  return new;
end;
$a$;

revoke all on function public.external_artists_guard_invite_email() from public, anon, authenticated;

drop trigger if exists trg_external_artists_guard_invite_email on public.external_artists;
create trigger trg_external_artists_guard_invite_email
  before update of invite_email on public.external_artists
  for each row execute function public.external_artists_guard_invite_email();

-- == SECTION 3 == claims_guard_invite_repoint

create or replace function public.claims_guard_invite_repoint()
returns trigger
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_new text;
  v_old text;
begin
  if new.external_artist_id is null
     or new.external_artist_id is not distinct from old.external_artist_id
     or public.is_ops_user() then
    return new;
  end if;
  v_new := (
    select lower(nullif(trim(coalesce(ea.invite_email, '')), ''))
      from public.external_artists ea
     where ea.id = new.external_artist_id
  );
  if v_new is null then
    return new;
  end if;
  v_old := (
    select lower(nullif(trim(coalesce(ea.invite_email, '')), ''))
      from public.external_artists ea
     where ea.id = old.external_artist_id
  );
  if v_new is not distinct from v_old then
    return new;
  end if;
  if public.invite_email_verified_by_account(v_new) then
    raise exception 'invite_email_verified_by_other_account'
      using errcode = '23514';
  end if;
  return new;
end;
$a$;

revoke all on function public.claims_guard_invite_repoint() from public, anon, authenticated;

drop trigger if exists trg_claims_guard_invite_repoint on public.claims;
create trigger trg_claims_guard_invite_repoint
  before update of external_artist_id on public.claims
  for each row execute function public.claims_guard_invite_repoint();

-- == SECTION 4 == link_external_artist_to_profile — says why it refuses

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
    raise exception 'invite_email_mismatch'
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
