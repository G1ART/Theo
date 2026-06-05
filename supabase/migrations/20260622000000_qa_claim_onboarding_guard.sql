-- QA 2026-06-05 — Provenance claim onboarding guard.
--
-- A confirmed claim attaches a person to a work's public provenance
-- ("collected by", "curated by", "exhibited by"). If the subject's
-- profile is still a placeholder (onboarding not completed → handle is
-- `user_xxxxxxxx`, no display name), the provenance row renders the
-- neutral "설정 중인 프로필" forever and can never reflect the person's
-- finished identity — especially when they later complete a *different*
-- account. We block claim creation until the subject has a real handle.
--
-- Scope: only `create_claim_request` (the "this artwork is mine" OWNS /
-- CURATED / EXHIBITED collector/curator flow). Artist-attribution RPCs
-- (`create_external_artist_and_claim`, `create_claim_for_existing_artist`)
-- attribute to an artist subject, not the acting placeholder account.
--
-- Single PL/pgSQL function → safe to run as one block.

create or replace function public.create_claim_request(
  p_work_id uuid,
  p_claim_type text,
  p_artist_profile_id uuid,
  p_period_status text default null,
  p_subject_profile_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid       uuid := auth.uid();
  v_subject   uuid;
  v_claim_id  uuid;
  v_claim_row jsonb;
  v_subject_username text;
begin
  if v_uid is null then
    raise exception 'auth.uid() is null';
  end if;
  if p_work_id is null then
    raise exception 'work_id required';
  end if;
  if p_claim_type is null or length(trim(p_claim_type)) = 0 then
    raise exception 'claim_type required';
  end if;
  if p_artist_profile_id is null then
    raise exception 'artist_profile_id required';
  end if;
  if p_period_status is not null and p_period_status not in ('past', 'current', 'future') then
    raise exception 'period_status must be past, current, or future';
  end if;

  v_subject := coalesce(p_subject_profile_id, v_uid);
  if v_subject <> v_uid then
    if not public.is_active_account_delegate_writer(v_subject) then
      raise exception 'forbidden: caller is not an active account delegate writer for subject_profile_id';
    end if;
  end if;

  -- Onboarding completeness guard (QA 2026-06-05). Block provenance
  -- claims while the subject is still a placeholder profile.
  v_subject_username := (select pr.username from public.profiles pr where pr.id = v_subject);
  if public.is_placeholder_username(v_subject_username) then
    raise exception 'profile_incomplete: complete onboarding before recording provenance'
      using errcode = 'P0001';
  end if;

  insert into public.claims (
    subject_profile_id, claim_type, work_id,
    artist_profile_id, visibility, status, period_status
  )
  values (
    v_subject, p_claim_type, p_work_id,
    p_artist_profile_id, 'public', 'pending', p_period_status
  )
  returning id into v_claim_id;

  select to_jsonb(c.*) into v_claim_row from public.claims c where c.id = v_claim_id;
  return jsonb_build_object('claim', v_claim_row);
end;
$function$;
