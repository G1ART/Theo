-- 2026-08-13 — admin_merge_external_artists: absorb overlapping claims
--
-- The original merge blindly re-pointed every source claim onto the
-- target. That UPDATE trips
--   uq_claims_project_curated_ext (project_id, external_artist_id, claim_type)
--     where work_id is null and claim_type = 'CURATED'
-- when source and target already have a project-scope CURATED claim on
-- the same exhibition. Same class of collision for
--   uq_claims_one_created_per_work (work_id)
--     where claim_type = 'CREATED' and work_id is not null.
--
-- Before the re-point UPDATE, drop the source claim and keep the
-- target's. Dropped rows are counted as claims_dropped in the jsonb
-- return. Signature is unchanged.
--
-- Dashboard: single function. Paste the whole file and Run once.
-- Letters-only dollar tag ($merge$). Idempotent (create or replace).

create or replace function public.admin_merge_external_artists(
  p_source_ids uuid[],
  p_target_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $merge$
declare
  v_uid             uuid := auth.uid();
  v_target          public.external_artists;
  v_src             public.external_artists;
  v_claims_moved    int := 0;
  v_claims_dropped  int := 0;
  v_src_count       int := 0;
begin
  if v_uid is null then
    raise exception 'auth.uid() is null';
  end if;
  if not public.is_ops_user() then
    raise exception 'forbidden: caller is not a platform admin';
  end if;
  if p_target_id is null then
    raise exception 'target_id required';
  end if;
  if p_source_ids is null or array_length(p_source_ids, 1) is null then
    raise exception 'at least one source_id required';
  end if;
  if array_length(p_source_ids, 1) > 20 then
    raise exception 'batch too large (max 20 source ids)';
  end if;

  select * into v_target from public.external_artists where id = p_target_id for update;
  if v_target.id is null then
    raise exception 'target external_artist not found';
  end if;
  if v_target.claimed_profile_id is not null then
    raise exception 'target already claimed --- merge into claimed profiles is not supported here';
  end if;

  for v_src in
    select * from public.external_artists
     where id = any(p_source_ids)
       and id <> p_target_id
     for update
  loop
    if v_src.claimed_profile_id is not null then
      raise exception 'source % is already claimed --- refuse to merge', v_src.id;
    end if;

    -- Drop source CURATED project-scope claims that would collide with
    -- uq_claims_project_curated_ext after the re-point UPDATE.
    v_claims_dropped := v_claims_dropped + (
      with dropped as (
        delete from public.claims src
         where src.external_artist_id = v_src.id
           and src.work_id is null
           and src.claim_type = 'CURATED'
           and exists (
             select 1
               from public.claims tgt
              where tgt.external_artist_id = v_target.id
                and tgt.work_id is null
                and tgt.claim_type = 'CURATED'
                and tgt.project_id = src.project_id
           )
         returning 1
      )
      select count(*)::int from dropped
    );

    -- Drop source CREATED claims that would collide with
    -- uq_claims_one_created_per_work after the re-point UPDATE.
    v_claims_dropped := v_claims_dropped + (
      with dropped as (
        delete from public.claims src
         where src.external_artist_id = v_src.id
           and src.claim_type = 'CREATED'
           and src.work_id is not null
           and exists (
             select 1
               from public.claims tgt
              where tgt.external_artist_id = v_target.id
                and tgt.claim_type = 'CREATED'
                and tgt.work_id = src.work_id
           )
         returning 1
      )
      select count(*)::int from dropped
    );

    -- Re-point remaining source claims onto the target.
    v_claims_moved := v_claims_moved + (
      with upd as (
        update public.claims
           set external_artist_id = v_target.id
         where external_artist_id = v_src.id
         returning 1
      )
      select count(*)::int from upd
    );

    -- Metadata backfill (only when target is empty).
    update public.external_artists t
       set website         = coalesce(nullif(trim(t.website), ''),         nullif(trim(v_src.website), '')),
           instagram       = coalesce(nullif(trim(t.instagram), ''),       nullif(trim(v_src.instagram), '')),
           display_name_ko = coalesce(nullif(trim(t.display_name_ko), ''), nullif(trim(v_src.display_name_ko), '')),
           display_name_en = coalesce(nullif(trim(t.display_name_en), ''), nullif(trim(v_src.display_name_en), ''))
     where t.id = v_target.id;

    -- Source soft-delete: free the unique index slot + audit marker.
    update public.external_artists
       set status = 'merged',
           invite_email = null,
           display_name = left(
             '[merged->' || v_target.id::text || '] ' || coalesce(display_name, ''),
             160
           )
     where id = v_src.id;

    v_src_count := v_src_count + 1;
  end loop;

  return jsonb_build_object(
    'target_id', v_target.id,
    'source_count', v_src_count,
    'claims_moved', v_claims_moved,
    'claims_dropped', v_claims_dropped
  );
end;
$merge$;

grant execute on function public.admin_merge_external_artists(uuid[], uuid) to authenticated;
