-- ===========================================================================
-- Sprint 6.1: Relationship Trust, Delegation Scope, Operator Privacy Polish
-- ===========================================================================
--
-- Apply note for the operator
--   This file contains 4 PL/pgSQL function bodies. Per
--   .cursor/rules/release-workflow.mdc paragraph 1-1, do NOT paste the
--   whole file at once into the Supabase SQL Editor. Highlight each
--   "-- == SECTION N ==" block separately and press Run. Each section
--   uses a unique letters-only dollar tag (a/b/c/d) and the header
--   comments deliberately avoid single quotes so the dashboard tokenizer
--   does not lose track of string state.
--
-- What this changes
--
--   1. Acting-as / delegate principal correctness.
--      The Sprint 6 relationship RPCs gated only on auth.uid(), assuming
--      delegated acting-as somehow swaps the session uid. It does not.
--      A delegate writing on behalf of a principal must call the RPC
--      with the principal as p_owner_profile_id; the RPC validates the
--      caller is either the principal themselves OR an active account
--      delegate-writer for that principal. Three RPCs gain an explicit
--      p_owner_profile_id argument with default null (so existing
--      callers that pass nothing still resolve to auth.uid()).
--
--   2. Owner private note surface minimization.
--      get_relationship_desk_for_owner now returns has_private_note +
--      private_note_updated_at instead of private_note_preview. The
--      full note body lives only inside get_relationship_card_for_owner.
--
--   3. Public artwork passport DTO further minimization.
--      get_artwork_passport_for_viewer redacts created_by for non-owner
--      viewers (owners and active delegate-writers still see it). All
--      other Phase 0 redactions (no invite_email, no is_public, no
--      raw row to_jsonb) and Sprint 6 hotfix v3 fixes (real claims
--      columns, enum-to-text cast) are preserved verbatim.
--
--   4. Relationship card room-view boundary.
--      get_relationship_card_for_owner no longer joins shortlist_views
--      and no longer returns last_viewed_at. Each room reference now
--      carries was_shared_or_granted, a quiet boolean derived from
--      access_grants alone (no passive viewer surveillance in v1).
--
-- Backwards compatibility
--   * Existing callers that did not pass p_owner_profile_id continue
--     to work because we keep the parameter optional with default null
--     and resolve to auth.uid() when null.
--   * Telemetry contract is unchanged (note body still never logged).
--   * No client-side access decision is introduced; UI gating still
--     depends on the resolver-returned visibility object.

-- == SECTION 1 == get_relationship_desk_for_owner (principal-aware)

-- Drop the Sprint 6 3-arg overload so PostgREST always resolves to the
-- new principal-aware signature. Without the drop, both functions
-- coexist in pg_proc and a client-shipped 3-arg call would silently
-- run the old non-principal-validating body.
drop function if exists public.get_relationship_desk_for_owner(integer, integer, text);

create or replace function public.get_relationship_desk_for_owner(
  p_owner_profile_id uuid    default null,
  p_limit            integer default 50,
  p_offset           integer default 0,
  p_status           text    default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $a$
declare
  v_uid    uuid := auth.uid();
  v_owner  uuid;
  v_status text := nullif(coalesce(p_status, ''), 'all');
  v_limit  int  := greatest(1, least(coalesce(p_limit,  50), 200));
  v_offset int  := greatest(0, coalesce(p_offset, 0));
  v_result jsonb;
begin
  if v_uid is null then
    return '[]'::jsonb;
  end if;

  v_owner := coalesce(p_owner_profile_id, v_uid);

  if v_owner <> v_uid
     and not public.is_active_account_delegate_writer(v_owner) then
    return '[]'::jsonb;
  end if;

  with raw_events as (
    select ar.requester_profile_id as related_profile_id,
           ar.created_at           as activity_at,
           'access_request'::text  as activity_type,
           coalesce(a.title, '*')  as subject_title,
           ar.status               as evt_status
    from public.access_requests ar
    left join public.artworks a
      on a.id = ar.subject_id and ar.subject_type = 'artwork'
    where ar.owner_profile_id = v_owner

    union all

    select pi.inquirer_id          as related_profile_id,
           pi.created_at           as activity_at,
           'inquiry'::text         as activity_type,
           coalesce(a.title, '*')  as subject_title,
           pi.inquiry_status       as evt_status
    from public.price_inquiries pi
    join public.artworks a on a.id = pi.artwork_id
    where a.artist_id = v_owner

    union all

    select ag.grantee_profile_id   as related_profile_id,
           ag.created_at           as activity_at,
           'grant'::text           as activity_type,
           coalesce(a.title, s.title, '*') as subject_title,
           'active'::text          as evt_status
    from public.access_grants ag
    left join public.artworks a
      on a.id = ag.subject_id and ag.subject_type = 'artwork'
    left join public.shortlists s
      on s.id = ag.subject_id and ag.subject_type = 'room'
    where ag.owner_profile_id = v_owner

    union all

    select f.follower_id           as related_profile_id,
           f.created_at            as activity_at,
           'follow'::text          as activity_type,
           null::text              as subject_title,
           f.status                as evt_status
    from public.follows f
    where f.following_id = v_owner
      and f.status = 'accepted'

    union all

    select rpn.target_profile_id   as related_profile_id,
           rpn.updated_at          as activity_at,
           'note'::text            as activity_type,
           null::text              as subject_title,
           'active'::text          as evt_status
    from public.relationship_private_notes rpn
    where rpn.owner_profile_id = v_owner
  ),
  events as (
    select * from raw_events where related_profile_id is not null
  ),
  filtered as (
    select * from events
    where v_status is null or activity_type = v_status
  ),
  latest as (
    select related_profile_id,
           max(activity_at) as last_activity_at
    from filtered
    group by related_profile_id
  ),
  latest_meta as (
    select distinct on (e.related_profile_id)
      e.related_profile_id,
      e.activity_at,
      e.activity_type,
      e.subject_title
    from filtered e
    join latest l
      on l.related_profile_id = e.related_profile_id
     and l.last_activity_at = e.activity_at
    order by e.related_profile_id, e.activity_at desc, e.activity_type
  ),
  counts as (
    select related_profile_id,
      count(*) filter (where activity_type = 'access_request' and evt_status = 'pending') as pending_access_request_count,
      count(*) filter (where activity_type = 'inquiry' and evt_status <> 'closed')         as open_inquiry_count,
      count(*) filter (where activity_type = 'grant')                                       as active_grant_count
    from events
    group by related_profile_id
  ),
  page as (
    select lm.related_profile_id,
           lm.activity_at,
           lm.activity_type,
           lm.subject_title
    from latest_meta lm
    order by lm.activity_at desc
    limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'profile_id', p.id,
      'display_name', p.display_name,
      'username', p.username,
      'avatar_url', p.avatar_url,
      'role_label', p.main_role,
      'relationship_status', case
        when exists (
          select 1 from public.follows f1
          where f1.follower_id = v_owner and f1.following_id = p.id and f1.status = 'accepted')
         and exists (
          select 1 from public.follows f2
          where f2.follower_id = p.id and f2.following_id = v_owner and f2.status = 'accepted')
          then 'mutual'
        when exists (
          select 1 from public.follows f2
          where f2.follower_id = p.id and f2.following_id = v_owner and f2.status = 'accepted')
          then 'follower'
        when exists (
          select 1 from public.follows f1
          where f1.follower_id = v_owner and f1.following_id = p.id and f1.status = 'accepted')
          then 'following'
        when exists (
          select 1 from public.access_grants g
          where g.owner_profile_id = v_owner and g.grantee_profile_id = p.id
            and (g.expires_at is null or g.expires_at > now()))
          then 'approved'
        else 'none'
      end,
      'last_activity_at', pg.activity_at,
      'last_activity_type', pg.activity_type,
      'last_subject_title', pg.subject_title,
      'pending_access_request_count', coalesce(c.pending_access_request_count, 0),
      'open_inquiry_count',          coalesce(c.open_inquiry_count, 0),
      'active_grant_count',          coalesce(c.active_grant_count, 0),
      'has_private_note', exists (
        select 1 from public.relationship_private_notes rpn
        where rpn.owner_profile_id = v_owner
          and rpn.target_profile_id = p.id
      ),
      'private_note_updated_at', (
        select rpn.updated_at
        from public.relationship_private_notes rpn
        where rpn.owner_profile_id = v_owner
          and rpn.target_profile_id = p.id
        limit 1
      )
    )
    order by pg.activity_at desc
  ), '[]'::jsonb)
  into v_result
  from page pg
  join public.profiles p on p.id = pg.related_profile_id
  left join counts c on c.related_profile_id = pg.related_profile_id;

  return coalesce(v_result, '[]'::jsonb);
end;
$a$;

grant execute on function public.get_relationship_desk_for_owner(uuid, integer, integer, text) to authenticated;

-- == SECTION 2 == get_relationship_card_for_owner (principal-aware + minimized rooms)

drop function if exists public.get_relationship_card_for_owner(uuid);

create or replace function public.get_relationship_card_for_owner(
  p_owner_profile_id  uuid default null,
  p_target_profile_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $b$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_target uuid := p_target_profile_id;
  v_profile jsonb;
  v_relationship_status text;
  v_requests jsonb;
  v_grants jsonb;
  v_inquiries jsonb;
  v_rooms jsonb;
  v_note jsonb;
begin
  if v_uid is null then
    return null;
  end if;
  v_owner := coalesce(p_owner_profile_id, v_uid);
  if v_owner <> v_uid
     and not public.is_active_account_delegate_writer(v_owner) then
    return null;
  end if;
  if v_target is null or v_target = v_owner then
    return null;
  end if;

  select jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'avatar_url', p.avatar_url,
    'bio', p.bio,
    'main_role', p.main_role,
    'roles', p.roles
  ) into v_profile
  from public.profiles p
  where p.id = v_target;

  if v_profile is null then
    return null;
  end if;

  v_relationship_status := case
    when exists (
      select 1 from public.follows f1
      where f1.follower_id = v_owner and f1.following_id = v_target and f1.status = 'accepted')
     and exists (
      select 1 from public.follows f2
      where f2.follower_id = v_target and f2.following_id = v_owner and f2.status = 'accepted')
      then 'mutual'
    when exists (
      select 1 from public.follows f2
      where f2.follower_id = v_target and f2.following_id = v_owner and f2.status = 'accepted')
      then 'follower'
    when exists (
      select 1 from public.follows f1
      where f1.follower_id = v_owner and f1.following_id = v_target and f1.status = 'accepted')
      then 'following'
    when exists (
      select 1 from public.access_grants g
      where g.owner_profile_id = v_owner and g.grantee_profile_id = v_target
        and (g.expires_at is null or g.expires_at > now()))
      then 'approved'
    else 'none'
  end;

  v_requests := (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', ar.id,
        'subject_type', ar.subject_type,
        'subject_id', ar.subject_id,
        'field_key', ar.field_key,
        'request_type', ar.request_type,
        'status', ar.status,
        'created_at', ar.created_at,
        'updated_at', ar.updated_at,
        'subject_title', a.title
      ) order by ar.created_at desc
    ), '[]'::jsonb)
    from (
      select * from public.access_requests
      where owner_profile_id = v_owner
        and requester_profile_id = v_target
      order by created_at desc
      limit 20
    ) ar
    left join public.artworks a
      on a.id = ar.subject_id and ar.subject_type = 'artwork'
  );

  v_grants := (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', ag.id,
        'subject_type', ag.subject_type,
        'subject_id', ag.subject_id,
        'field_key', ag.field_key,
        'grant_type', ag.grant_type,
        'expires_at', ag.expires_at,
        'created_at', ag.created_at,
        'subject_title', coalesce(a.title, s.title)
      ) order by ag.created_at desc
    ), '[]'::jsonb)
    from (
      select * from public.access_grants
      where owner_profile_id = v_owner
        and grantee_profile_id = v_target
      order by created_at desc
      limit 20
    ) ag
    left join public.artworks a
      on a.id = ag.subject_id and ag.subject_type = 'artwork'
    left join public.shortlists s
      on s.id = ag.subject_id and ag.subject_type = 'room'
  );

  v_inquiries := (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', pi.id,
        'artwork_id', pi.artwork_id,
        'inquiry_status', pi.inquiry_status,
        'created_at', pi.created_at,
        'last_message_at', pi.last_message_at,
        'subject_title', a.title
      ) order by coalesce(pi.last_message_at, pi.created_at) desc
    ), '[]'::jsonb)
    from public.price_inquiries pi
    join public.artworks a
      on a.id = pi.artwork_id and a.artist_id = v_owner
    where pi.inquirer_id = v_target
    limit 20
  );

  -- Sprint 6.1 boundary: rooms section is restricted to the owner side
  -- of the relationship. We list the owner shortlists that have an
  -- access_grant to v_target, and surface whether the grant is still
  -- active. We do NOT join shortlist_views and we do NOT return any
  -- last_viewed_at signal. Passive viewer surveillance is out of scope
  -- for v1; an explicit per-target view-feed is a future product call
  -- with its own copy and consent surface.
  v_rooms := (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'room_id', s.id,
        'title', s.title,
        'has_active_grant', exists (
          select 1 from public.access_grants ag
          where ag.owner_profile_id = v_owner
            and ag.grantee_profile_id = v_target
            and ag.subject_type = 'room'
            and ag.subject_id = s.id
            and (ag.expires_at is null or ag.expires_at > now())
        ),
        'was_shared_or_granted', true
      ) order by s.updated_at desc
    ), '[]'::jsonb)
    from public.shortlists s
    where s.owner_id = v_owner
      and exists (
        select 1 from public.access_grants ag
        where ag.owner_profile_id = v_owner
          and ag.grantee_profile_id = v_target
          and ag.subject_type = 'room'
          and ag.subject_id = s.id
      )
    limit 20
  );

  v_note := (
    select jsonb_build_object(
      'id', rpn.id,
      'note', rpn.note,
      'updated_at', rpn.updated_at
    )
    from public.relationship_private_notes rpn
    where rpn.owner_profile_id = v_owner
      and rpn.target_profile_id = v_target
    limit 1
  );

  return jsonb_build_object(
    'profile', v_profile,
    'relationship_status', v_relationship_status,
    'requests', v_requests,
    'grants', v_grants,
    'inquiries', v_inquiries,
    'rooms', v_rooms,
    'private_note', v_note
  );
end;
$b$;

grant execute on function public.get_relationship_card_for_owner(uuid, uuid) to authenticated;

-- == SECTION 3 == upsert_relationship_private_note (principal-aware)

drop function if exists public.upsert_relationship_private_note(uuid, text);

create or replace function public.upsert_relationship_private_note(
  p_owner_profile_id  uuid default null,
  p_target_profile_id uuid default null,
  p_note              text default null
) returns public.relationship_private_notes
language plpgsql
security definer
set search_path = public
as $c$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_row public.relationship_private_notes;
  v_clean text;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if p_target_profile_id is null then
    raise exception 'target profile required';
  end if;

  v_owner := coalesce(p_owner_profile_id, v_uid);
  if v_owner <> v_uid
     and not public.is_active_account_delegate_writer(v_owner) then
    raise exception 'not authorized to act for this owner';
  end if;

  if v_owner = p_target_profile_id then
    raise exception 'cannot write a relationship note about yourself';
  end if;

  v_clean := coalesce(p_note, '');
  if length(v_clean) > 4000 then
    v_clean := substring(v_clean from 1 for 4000);
  end if;

  insert into public.relationship_private_notes (
    owner_profile_id, target_profile_id, note, created_by, updated_by
  ) values (
    v_owner, p_target_profile_id, v_clean, v_uid, v_uid
  )
  on conflict (owner_profile_id, target_profile_id)
  do update set
    note = excluded.note,
    updated_by = v_uid,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$c$;

grant execute on function public.upsert_relationship_private_note(uuid, uuid, text) to authenticated;

-- == SECTION 4 == get_artwork_passport_for_viewer (created_by redaction)

-- Carries forward the Sprint 6 hotfix v3 body byte-for-byte, with a
-- single change: created_by is now redacted unless the caller is the
-- owner OR an active account delegate-writer for the owner. Anonymous
-- viewers and unrelated logged-in viewers receive null. All other
-- redactions (no invite_email, no is_public, no whole-row to_jsonb)
-- are preserved. The enum-to-text cast in the visibility gate is
-- preserved.

create or replace function public.get_artwork_passport_for_viewer(
  p_artwork_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $d$
declare
  v_uid uuid := auth.uid();
  v_aw record;
  v_owner uuid;
  v_vis_text text;
  v_is_owner_or_delegate boolean;
  v_price jsonb;
  v_avail jsonb;
  v_desc jsonb;
  v_relationship jsonb;
  v_can_price boolean;
  v_can_avail boolean;
  v_can_desc boolean;
  v_artwork jsonb;
begin
  if p_artwork_id is null then
    return null;
  end if;

  select
    a.id, a.title, a.year, a.medium, a.size, a.size_unit, a.story,
    a.visibility, a.created_by, a.pricing_mode, a.is_price_public,
    a.price_usd, a.price_input_amount, a.price_input_currency,
    a.fx_rate_to_usd, a.fx_date, a.ownership_status, a.artist_id,
    a.artist_sort_order, a.created_at, a.provenance_visible
  into v_aw
  from public.artworks a
  where a.id = p_artwork_id;

  if v_aw.id is null then
    return null;
  end if;

  v_owner    := v_aw.artist_id;
  v_vis_text := coalesce(v_aw.visibility::text, '');

  v_is_owner_or_delegate :=
    v_uid is not null
    and (v_uid = v_owner
         or public.is_active_account_delegate_writer(v_owner));

  if v_vis_text <> 'public' then
    if not v_is_owner_or_delegate then
      return null;
    end if;
  end if;

  v_price        := public.resolve_visibility_for_viewer(v_owner, 'artwork', v_aw.id, 'price');
  v_avail        := public.resolve_visibility_for_viewer(v_owner, 'artwork', v_aw.id, 'availability');
  v_desc         := public.resolve_visibility_for_viewer(v_owner, 'artwork', v_aw.id, 'description');
  v_relationship := public.get_viewer_relationship_context(v_owner);

  v_can_price := coalesce((v_price->>'can_view')::boolean, false);
  v_can_avail := coalesce((v_avail->>'can_view')::boolean, false);
  v_can_desc  := coalesce((v_desc ->>'can_view')::boolean, false);

  v_artwork := jsonb_build_object(
    'id', v_aw.id,
    'title', v_aw.title,
    'year', v_aw.year,
    'medium', v_aw.medium,
    'size', v_aw.size,
    'size_unit', v_aw.size_unit,
    'visibility', v_aw.visibility,
    'created_by', case when v_is_owner_or_delegate then v_aw.created_by else null end,
    'artist_id', v_aw.artist_id,
    'artist_sort_order', v_aw.artist_sort_order,
    'created_at', v_aw.created_at,
    'provenance_visible', v_aw.provenance_visible,
    'ownership_status',     case when v_can_avail then v_aw.ownership_status     else null end,
    'pricing_mode',         case when v_can_price then v_aw.pricing_mode         else null end,
    'is_price_public',      case when v_can_price then v_aw.is_price_public      else null end,
    'price_usd',            case when v_can_price then v_aw.price_usd            else null end,
    'price_input_amount',   case when v_can_price then v_aw.price_input_amount   else null end,
    'price_input_currency', case when v_can_price then v_aw.price_input_currency else null end,
    'fx_rate_to_usd',       case when v_can_price then v_aw.fx_rate_to_usd       else null end,
    'fx_date',              case when v_can_price then v_aw.fx_date              else null end,
    'story',                case when v_can_desc  then v_aw.story                else null end,
    'artwork_images', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('storage_path', ai.storage_path, 'sort_order', ai.sort_order)
          order by ai.sort_order nulls last
        ),
        '[]'::jsonb
      )
      from public.artwork_images ai
      where ai.artwork_id = v_aw.id
    ),
    'profiles', (
      select jsonb_build_object(
        'id', p.id,
        'username', p.username,
        'display_name', p.display_name,
        'avatar_url', p.avatar_url,
        'bio', p.bio,
        'main_role', p.main_role,
        'roles', p.roles
      )
      from public.profiles p
      where p.id = v_owner
    ),
    'artwork_likes', (
      select jsonb_build_array(jsonb_build_object('count', count(*)))
      from public.artwork_likes al
      where al.artwork_id = v_aw.id
    ),
    'claims', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'claim_type', c.claim_type,
            'subject_profile_id', c.subject_profile_id,
            'artist_profile_id', c.artist_profile_id,
            'external_artist_id', c.external_artist_id,
            'created_at', c.created_at,
            'status', c.status,
            'period_status', c.period_status,
            'start_date', c.start_date,
            'end_date', c.end_date,
            'profiles', (
              select jsonb_build_object(
                'username', sp.username,
                'display_name', sp.display_name
              )
              from public.profiles sp
              where sp.id = c.subject_profile_id
            ),
            'external_artists', (
              select jsonb_build_object(
                'display_name', ea.display_name
              )
              from public.external_artists ea
              where ea.id = c.external_artist_id
            )
          )
          order by c.created_at desc
        ),
        '[]'::jsonb
      )
      from public.claims c
      where c.work_id = v_aw.id
    )
  );

  return jsonb_build_object(
    'artwork', v_artwork,
    'visibility', jsonb_build_object(
      'price',        v_price,
      'availability', v_avail,
      'description',  v_desc
    ),
    'presence', jsonb_build_object(
      'price', (
        v_aw.pricing_mode is not null
        or v_aw.price_usd is not null
        or v_aw.price_input_amount is not null
      ),
      'availability', (v_aw.ownership_status is not null),
      'description', (
        v_aw.story is not null and length(btrim(v_aw.story)) > 0
      )
    ),
    'relationship', v_relationship,
    'viewer_id',    v_uid
  );
end;
$d$;

grant execute on function public.get_artwork_passport_for_viewer(uuid) to authenticated;
grant execute on function public.get_artwork_passport_for_viewer(uuid) to anon;
