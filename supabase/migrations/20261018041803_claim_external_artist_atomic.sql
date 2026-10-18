-- 2026-10-17 — Changing a work's invite email on the edit screen leaves no
-- empty invite behind when the address is refused.
--
-- The edit screen used two requests: get_or_create_external_artist (which may
-- insert a new invite), then a direct claims update. When the update was
-- refused by trg_claims_guard_invite_repoint (20261018040637: the address is
-- already verified by another account), the invite from the first request
-- stayed, empty, in the inviter's list.
--
--   * Section 1: prepare_claim_external_artist checks the caller may edit the
--     claim and applies the same refusal rule before any invite is created,
--     then calls get_or_create_external_artist.
--   * Section 2: set_claim_external_artist runs that and the claim update in
--     one call, as the caller (claims RLS unchanged). If the update is refused
--     (for example the address got verified meanwhile) or touches no row, the
--     whole call rolls back, including an invite it just created.
--
-- Existing invites, invites with works and name-only invites are not touched.
-- No row is changed. Run one section at a time in the SQL Editor. Dollar tags
-- are letters only.

-- == SECTION 1 == prepare_claim_external_artist

create or replace function public.prepare_claim_external_artist(
  p_claim_id uuid,
  p_display_name text,
  p_invite_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_uid uuid := auth.uid();
  v_subject uuid;
  v_current uuid;
  v_new text;
  v_old text;
begin
  if v_uid is null then
    raise exception 'auth.uid() is null';
  end if;

  v_subject := (select c.subject_profile_id from public.claims c where c.id = p_claim_id);
  v_current := (select c.external_artist_id from public.claims c where c.id = p_claim_id);
  if v_subject is null or (v_subject <> v_uid and not public.is_active_writer_for(v_subject)) then
    raise exception 'claim not found';
  end if;

  v_new := lower(nullif(trim(coalesce(p_invite_email, '')), ''));
  if v_new is not null and not public.is_ops_user() then
    v_old := (
      select lower(nullif(trim(coalesce(ea.invite_email, '')), ''))
        from public.external_artists ea
       where ea.id = v_current
    );
    if v_new is distinct from v_old and public.invite_email_verified_by_account(v_new) then
      raise exception 'invite_email_verified_by_other_account'
        using errcode = '23514';
    end if;
  end if;

  return public.get_or_create_external_artist(
    p_display_name, p_invite_email, null::text, null::text, false, false
  );
end;
$a$;

revoke all on function public.prepare_claim_external_artist(uuid, text, text) from public, anon;
grant execute on function public.prepare_claim_external_artist(uuid, text, text) to authenticated;

-- == SECTION 2 == set_claim_external_artist

create or replace function public.set_claim_external_artist(
  p_claim_id uuid,
  p_display_name text,
  p_invite_email text default null,
  p_claim_type text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $a$
declare
  v_ext uuid;
  v_rows int;
begin
  v_ext := public.prepare_claim_external_artist(p_claim_id, p_display_name, p_invite_email);

  update public.claims
     set claim_type = coalesce(p_claim_type, claim_type),
         artist_profile_id = null,
         external_artist_id = v_ext
   where id = p_claim_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'claim not found';
  end if;

  return v_ext;
end;
$a$;

revoke all on function public.set_claim_external_artist(uuid, text, text, text) from public, anon;
grant execute on function public.set_claim_external_artist(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
