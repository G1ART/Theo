-- Sprint 5.2 — Access Enforcement & Redaction Hardening.
--
-- This migration tightens the relationship access layer that Sprint 5
-- shipped (see 20260606000000_relationship_access_layer.sql). Sprint 5
-- delivered the *control surface* — owner UI, RPCs, RLS, telemetry —
-- but viewer surfaces still ran a "fetch full row, hide in JSX" pattern
-- and access-request mutations could touch the table directly.
--
-- Hardening steps installed here:
--
--   1. visibility_subject_belongs_to_owner() — single, central
--      subject-ownership validator. Used by the resolver (fail-closed
--      on bad pairs) and by every mutation RPC (raises on bad pairs).
--      Closes audit P1-1.
--
--   2. resolve_visibility_for_viewer() — re-created with the validator
--      bolted in front, so a malicious caller can't probe a subject
--      that doesn't belong to the owner they passed.
--
--   3. upsert_visibility_policy() — re-created with the validator,
--      now covering artwork_field / room / profile_section.
--
--   4. create_access_request() — re-created with the validator AND
--      with an explicit duplicate signal. Return shape moved from
--      `public.access_requests` to `jsonb { request, duplicate }` so
--      the wrapper no longer has to compare timestamps to guess at
--      idempotent inserts (closes P1-3). DROP-then-CREATE is required
--      because Postgres won't let CREATE OR REPLACE change return type.
--
--   5. resolve_access_request() — re-created so that subject ownership
--      is validated again before a grant row is written.
--
--   6. cancel_access_request() — new SECURITY DEFINER RPC. Requester-
--      only, pending-only, status+updated_at only. The previous direct
--      requester UPDATE policy (`access_requests_update_requester_cancel`)
--      is dropped so cancellation is RPC-only (closes P0-3).
--
--   7. get_artwork_passport_for_viewer() — new redacted-read RPC for
--      the public artwork detail page. Server-side resolves price /
--      availability / description visibility and returns raw values
--      ONLY when the viewer can see them. Closes P0-2 for artworks.
--
--   8. get_room_for_viewer_by_token() — new redacted-read RPC for the
--      public room page. When the viewer can't see the room, the items
--      array is empty and never leaves the database. Closes P0-2 for
--      rooms.
--
--   9. resolve_visibility_for_preview() — new owner/delegate-only
--      RPC that walks the same effective-policy ladder as the viewer
--      resolver and then evaluates a fake state. Replaces the
--      preset-only dry-run for the /my/visibility preview-as panel
--      (closes P1-4).
--
-- Apply guidance (release-workflow §1-1): this file contains 9
-- multi-statement PL/pgSQL functions. **Do not** "Run all" in the
-- Supabase Dashboard SQL Editor — copy each `-- == SECTION N == ...`
-- banner block separately and press Run. Dollar tags are letters only.
-- The whole file is idempotent (`drop function if exists ... ;
-- create or replace function ...`) so individual sections can be
-- re-applied safely.

-- == SECTION 1 == visibility_subject_belongs_to_owner

create or replace function public.visibility_subject_belongs_to_owner(
  p_owner uuid,
  p_subject_type text,
  p_subject_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $a$
begin
  if p_owner is null or p_subject_type is null then
    return false;
  end if;

  -- Owner-wide defaults (no specific subject) are always allowed.
  if p_subject_id is null then
    return true;
  end if;

  if p_subject_type in ('artwork', 'artwork_field') then
    return exists (
      select 1 from public.artworks a
      where a.id = p_subject_id and a.artist_id = p_owner
    );
  end if;

  if p_subject_type = 'room' then
    return exists (
      select 1 from public.shortlists s
      where s.id = p_subject_id and s.owner_id = p_owner
    );
  end if;

  if p_subject_type = 'profile_section' then
    -- profile_section subjects are owner-scoped: subject_id, when set,
    -- must equal the owner's own profile id (or be null, handled above).
    return p_subject_id = p_owner;
  end if;

  if p_subject_type = 'exhibition' then
    -- Exhibition ownership model is ambiguous (curator vs host vs
    -- delegated). Until a clean rule is in place, fail closed for
    -- exhibition subjects with a non-null subject_id. UI surfaces
    -- never wire exhibitions into Sprint 5 v1, so this is a deferred
    -- gap, not a regression.
    return false;
  end if;

  return false;
end;
$a$;

grant execute on function public.visibility_subject_belongs_to_owner(uuid, text, uuid) to authenticated;
grant execute on function public.visibility_subject_belongs_to_owner(uuid, text, uuid) to anon;

-- == SECTION 2 == resolve_visibility_for_viewer (re-create with validator)

create or replace function public.resolve_visibility_for_viewer(
  p_owner uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_field_key text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $a$
declare
  v_audience text;
  v_request_mode text;
  v_preset text;
  v_can boolean;
  v_reason text := 'fallback_open';
begin
  if p_owner is null or p_subject_type is null then
    return jsonb_build_object(
      'can_view', false,
      'required_audience', 'owner_only',
      'request_mode', null,
      'reason', 'invalid_input'
    );
  end if;

  -- Sprint 5.2 — fail-closed when caller passes an owner/subject pair
  -- that does not actually belong together. Without this, a probe
  -- could spoof a different owner's policy by combining their owner
  -- id with someone else's artwork id.
  if not public.visibility_subject_belongs_to_owner(p_owner, p_subject_type, p_subject_id) then
    return jsonb_build_object(
      'can_view', false,
      'required_audience', 'owner_only',
      'request_mode', null,
      'reason', 'subject_owner_mismatch'
    );
  end if;

  select audience, request_mode
    into v_audience, v_request_mode
  from public.visibility_policies
  where owner_profile_id = p_owner
    and subject_type = p_subject_type
    and (
      (subject_id is not null and subject_id = p_subject_id and field_key = p_field_key)
      or (subject_id is not null and subject_id = p_subject_id and field_key = '*')
      or (subject_id is null and field_key = p_field_key)
      or (subject_id is null and field_key = '*')
    )
  order by
    case when subject_id is not null and field_key = p_field_key then 0
         when subject_id is not null and field_key = '*' then 1
         when subject_id is null and field_key = p_field_key then 2
         else 3
    end
  limit 1;

  if v_audience is null then
    select preset_key into v_preset
    from public.visibility_owner_settings
    where owner_profile_id = p_owner;

    v_preset := coalesce(v_preset, 'open_studio');

    v_audience := case v_preset
      when 'open_studio' then case
        when p_field_key in ('price', 'availability') then 'mutuals'
        when p_field_key = 'studio_note' then 'owner_only'
        else 'public'
      end
      when 'follower_aware' then case
        when p_field_key in ('price', 'availability') then 'mutuals'
        when p_field_key in ('description', 'studio_note') then 'followers'
        else 'public'
      end
      when 'mutual_first' then case
        when p_field_key in ('price', 'availability') then 'mutuals'
        when p_field_key in ('description', 'studio_note') then 'mutuals'
        when p_field_key = '*' then 'public'
        else 'followers'
      end
      when 'private_studio' then case
        when p_field_key in ('price', 'availability', 'description', 'studio_note') then 'approved'
        when p_field_key = '*' then 'signed_in'
        else 'approved'
      end
      else 'public'
    end;

    v_reason := 'preset_fallback:' || v_preset;
  else
    v_reason := 'policy_match';
  end if;

  v_can := public.can_view_by_relationship(
    p_owner, p_subject_type, p_subject_id, p_field_key, v_audience
  );

  return jsonb_build_object(
    'can_view', v_can,
    'required_audience', v_audience,
    'request_mode', v_request_mode,
    'reason', case when v_can then v_reason else v_reason || ':blocked' end
  );
end;
$a$;

grant execute on function public.resolve_visibility_for_viewer(uuid, text, uuid, text) to authenticated;
grant execute on function public.resolve_visibility_for_viewer(uuid, text, uuid, text) to anon;

-- == SECTION 3 == upsert_visibility_policy (re-create with validator)

create or replace function public.upsert_visibility_policy(
  p_owner uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_field_key text,
  p_audience text,
  p_request_mode text,
  p_source_preset text
) returns public.visibility_policies
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_uid uuid := auth.uid();
  v_row public.visibility_policies;
  v_field text := coalesce(p_field_key, '*');
  v_request_mode text := nullif(p_request_mode, '');
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  if p_owner is null then
    raise exception 'owner_profile_id required';
  end if;

  if v_uid <> p_owner
     and not public.is_active_account_delegate_writer(p_owner) then
    raise exception 'not authorized to manage visibility for this owner';
  end if;

  if v_request_mode is not null
     and v_request_mode not in ('inquiry', 'access_request', 'none') then
    raise exception 'invalid request_mode: %', v_request_mode;
  end if;

  -- Sprint 5.2 — central validator covers artwork, artwork_field, room,
  -- profile_section. exhibition with a non-null subject_id fails closed
  -- (deferred, see helper).
  if not public.visibility_subject_belongs_to_owner(p_owner, p_subject_type, p_subject_id) then
    raise exception 'subject does not belong to owner';
  end if;

  if p_subject_id is null then
    insert into public.visibility_policies as vp (
      owner_profile_id, subject_type, subject_id, field_key, audience, request_mode, source_preset
    ) values (
      p_owner, p_subject_type, null, v_field, p_audience, v_request_mode, p_source_preset
    )
    on conflict (owner_profile_id, subject_type, field_key)
      where subject_id is null
    do update set
      audience = excluded.audience,
      request_mode = excluded.request_mode,
      source_preset = excluded.source_preset,
      updated_at = now()
    returning * into v_row;
  else
    insert into public.visibility_policies as vp (
      owner_profile_id, subject_type, subject_id, field_key, audience, request_mode, source_preset
    ) values (
      p_owner, p_subject_type, p_subject_id, v_field, p_audience, v_request_mode, p_source_preset
    )
    on conflict (owner_profile_id, subject_type, subject_id, field_key)
      where subject_id is not null
    do update set
      audience = excluded.audience,
      request_mode = excluded.request_mode,
      source_preset = excluded.source_preset,
      updated_at = now()
    returning * into v_row;
  end if;

  return v_row;
end;
$a$;

grant execute on function public.upsert_visibility_policy(uuid, text, uuid, text, text, text, text) to authenticated;

-- == SECTION 4 == create_access_request (drop+recreate, return jsonb with duplicate signal)

drop function if exists public.create_access_request(uuid, text, uuid, text, text, text, text, jsonb);

create function public.create_access_request(
  p_owner uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_field_key text,
  p_request_type text,
  p_message text,
  p_source_surface text,
  p_source_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_uid uuid := auth.uid();
  v_row public.access_requests;
  v_field text := coalesce(p_field_key, '*');
  v_msg text := nullif(left(coalesce(p_message, ''), 1000), '');
  v_payload jsonb;
  v_source text := nullif(p_source_surface, '');
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if p_owner is null then
    raise exception 'owner_profile_id required';
  end if;
  if v_uid = p_owner then
    raise exception 'cannot request access from yourself';
  end if;
  if p_request_type is null
     or p_request_type not in (
       'price_inquiry', 'availability_request', 'room_access',
       'vip_preview', 'studio_note_access', 'general_access'
     ) then
    raise exception 'invalid request_type: %', p_request_type;
  end if;
  if v_source is not null
     and v_source not in ('feed', 'room', 'artwork', 'exhibition', 'profile', 'direct') then
    raise exception 'invalid source_surface: %', v_source;
  end if;

  -- Sprint 5.2 — validate subject belongs to owner before doing anything.
  if not public.visibility_subject_belongs_to_owner(p_owner, p_subject_type, p_subject_id) then
    raise exception 'subject does not belong to owner';
  end if;

  -- Sanitize source_payload server-side as belt-and-suspenders. Top-level
  -- scalar keys only; drop nested objects/arrays; strip token-shaped keys.
  v_payload := null;
  if p_source_payload is not null and jsonb_typeof(p_source_payload) = 'object' then
    select jsonb_object_agg(k, v)
      into v_payload
    from jsonb_each(p_source_payload) as e(k, v)
    where lower(k) !~ '(token|password|secret|apikey|authorization|cookie|magic|bearer)'
      and jsonb_typeof(v) in ('string', 'number', 'boolean');

    if v_payload is not null and length(v_payload::text) > 2048 then
      v_payload := null;
    end if;
  end if;

  -- Idempotent insert: if a pending row exists for the same key, return
  -- it with duplicate=true so the client never silently double-creates.
  if p_subject_id is null then
    select * into v_row
    from public.access_requests
    where requester_profile_id = v_uid
      and owner_profile_id = p_owner
      and subject_type = p_subject_type
      and subject_id is null
      and field_key = v_field
      and request_type = p_request_type
      and status = 'pending';
  else
    select * into v_row
    from public.access_requests
    where requester_profile_id = v_uid
      and owner_profile_id = p_owner
      and subject_type = p_subject_type
      and subject_id = p_subject_id
      and field_key = v_field
      and request_type = p_request_type
      and status = 'pending';
  end if;

  if v_row.id is not null then
    return jsonb_build_object(
      'request', to_jsonb(v_row),
      'duplicate', true
    );
  end if;

  insert into public.access_requests (
    requester_profile_id, owner_profile_id, subject_type, subject_id,
    field_key, request_type, message, source_surface, source_payload
  ) values (
    v_uid, p_owner, p_subject_type, p_subject_id,
    v_field, p_request_type, v_msg, v_source, v_payload
  )
  returning * into v_row;

  return jsonb_build_object(
    'request', to_jsonb(v_row),
    'duplicate', false
  );
end;
$a$;

grant execute on function public.create_access_request(uuid, text, uuid, text, text, text, text, jsonb) to authenticated;

-- == SECTION 5 == resolve_access_request (re-create with validator before grant)

create or replace function public.resolve_access_request(
  p_request_id uuid,
  p_action text
) returns public.access_requests
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_uid uuid := auth.uid();
  v_req public.access_requests;
  v_new_status text;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if p_action is null or p_action not in ('approve', 'decline') then
    raise exception 'invalid action: %', p_action;
  end if;

  select * into v_req from public.access_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'access request not found';
  end if;

  if v_uid <> v_req.owner_profile_id
     and not public.is_active_account_delegate_writer(v_req.owner_profile_id) then
    raise exception 'not authorized to resolve this access request';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'access request is not pending (status=%)', v_req.status;
  end if;

  -- Sprint 5.2 — validate subject still belongs to owner before any
  -- side-effecting grant. Approving a stale request whose subject was
  -- transferred out from under the owner should not silently leak access.
  if p_action = 'approve'
     and not public.visibility_subject_belongs_to_owner(
       v_req.owner_profile_id, v_req.subject_type, v_req.subject_id
     ) then
    raise exception 'subject does not belong to owner';
  end if;

  v_new_status := case p_action when 'approve' then 'approved' else 'declined' end;

  update public.access_requests
     set status = v_new_status,
         resolved_by = v_uid,
         resolved_at = now(),
         updated_at = now()
   where id = p_request_id
   returning * into v_req;

  if p_action = 'approve' then
    if v_req.subject_id is null then
      insert into public.access_grants (
        owner_profile_id, grantee_profile_id, subject_type, subject_id,
        field_key, grant_type, source_request_id, created_by
      ) values (
        v_req.owner_profile_id, v_req.requester_profile_id, v_req.subject_type, null,
        v_req.field_key, 'request_approved', v_req.id, v_uid
      )
      on conflict (owner_profile_id, grantee_profile_id, subject_type, field_key)
        where subject_id is null
      do nothing;
    else
      insert into public.access_grants (
        owner_profile_id, grantee_profile_id, subject_type, subject_id,
        field_key, grant_type, source_request_id, created_by
      ) values (
        v_req.owner_profile_id, v_req.requester_profile_id, v_req.subject_type, v_req.subject_id,
        v_req.field_key, 'request_approved', v_req.id, v_uid
      )
      on conflict (owner_profile_id, grantee_profile_id, subject_type, subject_id, field_key)
        where subject_id is not null
      do nothing;
    end if;
  end if;

  return v_req;
end;
$a$;

grant execute on function public.resolve_access_request(uuid, text) to authenticated;

-- == SECTION 6 == cancel_access_request RPC + drop direct requester UPDATE policy

create or replace function public.cancel_access_request(
  p_request_id uuid
) returns public.access_requests
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_uid uuid := auth.uid();
  v_req public.access_requests;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select * into v_req from public.access_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'access request not found';
  end if;

  if v_req.requester_profile_id <> v_uid then
    raise exception 'only the requester can cancel this access request';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'access request is not pending (status=%)', v_req.status;
  end if;

  update public.access_requests
     set status = 'cancelled',
         updated_at = now()
   where id = p_request_id
   returning * into v_req;

  return v_req;
end;
$a$;

grant execute on function public.cancel_access_request(uuid) to authenticated;

-- Sprint 5.2 — drop the direct requester UPDATE policy. Cancellation is
-- now RPC-only via cancel_access_request(), so the requester cannot
-- touch the row through PostgREST and accidentally (or maliciously)
-- modify columns beyond status. The owner/delegate-writer UPDATE policy
-- (`access_requests_update_owner`) stays in place because the existing
-- /my/access-requests inbox uses resolve_access_request() (which already
-- re-validates) — but the table policy provides defense in depth.
drop policy if exists access_requests_update_requester_cancel on public.access_requests;

-- == SECTION 7 == get_artwork_passport_for_viewer (redacted artwork RPC)

create or replace function public.get_artwork_passport_for_viewer(
  p_artwork_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $a$
declare
  v_uid uuid := auth.uid();
  v_aw record;
  v_owner uuid;
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

  v_owner := v_aw.artist_id;

  -- Authorization gate (mirrors the existing public-artwork RLS lane):
  -- non-public artworks must come from owner / delegate-writer only.
  -- Anything else returns null and the UI shows a calm not-found.
  if coalesce(v_aw.visibility, '') <> 'public' then
    if v_uid is null
       or (v_uid <> v_owner
           and not public.is_active_account_delegate_writer(v_owner)) then
      return null;
    end if;
  end if;

  v_price := public.resolve_visibility_for_viewer(v_owner, 'artwork', v_aw.id, 'price');
  v_avail := public.resolve_visibility_for_viewer(v_owner, 'artwork', v_aw.id, 'availability');
  v_desc  := public.resolve_visibility_for_viewer(v_owner, 'artwork', v_aw.id, 'description');
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
    'created_by', v_aw.created_by,
    'artist_id', v_aw.artist_id,
    'artist_sort_order', v_aw.artist_sort_order,
    'created_at', v_aw.created_at,
    'provenance_visible', v_aw.provenance_visible,
    -- Redacted-when-gated. Returning null (not the raw value) is the
    -- entire point of this RPC — the browser must never see a value
    -- it isn't allowed to surface.
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
      select to_jsonb(p)
      from (
        select id, username, display_name, avatar_url, bio, main_role, roles, is_public
        from public.profiles
        where id = v_owner
      ) p
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
              select to_jsonb(sp)
              from (
                select username, display_name
                from public.profiles
                where id = c.subject_profile_id
              ) sp
            ),
            'external_artists', (
              select to_jsonb(ea)
              from (
                select display_name, invite_email
                from public.external_artists
                where id = c.external_artist_id
              ) ea
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
      'price', v_price,
      'availability', v_avail,
      'description', v_desc
    ),
    -- Pre-redaction "value exists" signal per first-class field. Lets
    -- the UI tell apart "artist hides this from you" (gate) from "no
    -- value set on this work" (render nothing). Booleans only — no raw
    -- values leak through this channel.
    'presence', jsonb_build_object(
      'price', (
        v_aw.pricing_mode is not null
        or v_aw.price_usd is not null
        or v_aw.price_input_amount is not null
      ),
      'availability', (v_aw.ownership_status is not null),
      'description', (
        v_aw.story is not null
        and length(btrim(v_aw.story)) > 0
      )
    ),
    'relationship', v_relationship
  );
end;
$a$;

grant execute on function public.get_artwork_passport_for_viewer(uuid) to authenticated;
grant execute on function public.get_artwork_passport_for_viewer(uuid) to anon;

-- == SECTION 8 == get_room_for_viewer_by_token (redacted room RPC)

create or replace function public.get_room_for_viewer_by_token(
  p_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_uid uuid := auth.uid();
  v_token uuid;
  v_room record;
  v_owner uuid;
  v_resolution jsonb;
  v_relationship jsonb;
  v_can boolean;
  v_meta jsonb;
  v_items jsonb;
begin
  if p_token is null or length(p_token) = 0 then
    return null;
  end if;

  begin
    v_token := p_token::uuid;
  exception when others then
    -- Malformed token — surface as not-found so we never echo the raw
    -- input back to the caller.
    return null;
  end;

  select s.id, s.title, s.description, s.owner_id,
         p.username as owner_username,
         p.display_name as owner_display_name
  into v_room
  from public.shortlists s
  join public.profiles p on p.id = s.owner_id
  where s.share_token = v_token
    and s.room_active = true
    and (s.expires_at is null or s.expires_at > now());

  if v_room.id is null then
    return null;
  end if;

  v_owner := v_room.owner_id;
  v_resolution := public.resolve_visibility_for_viewer(v_owner, 'room', v_room.id, '*');
  v_relationship := public.get_viewer_relationship_context(v_owner);
  v_can := coalesce((v_resolution->>'can_view')::boolean, false);

  v_meta := jsonb_build_object(
    'id', v_room.id,
    'title', v_room.title,
    -- Title is safe to surface even when gated (matches existing room
    -- card behavior). Description is also surfaced because it's already
    -- exposed as the room's published lead — the gated bit is the items.
    'description', v_room.description,
    'owner_id', v_room.owner_id,
    'owner_username', v_room.owner_username,
    'owner_display_name', v_room.owner_display_name
  );

  if v_can then
    -- Mirror the legacy get_shortlist_items_by_token side-effect so the
    -- new path keeps activity attribution. Best-effort: never throw on
    -- a failed view-log insert (would block legitimate viewers).
    begin
      insert into public.shortlist_views (shortlist_id, viewer_id, action)
      values (v_room.id, v_uid, 'viewed');
    exception when others then
      -- swallow; view logging is non-essential.
      null;
    end;

    v_items := (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'item_id', si.id,
            'artwork_id', si.artwork_id,
            'exhibition_id', si.exhibition_id,
            'note', si.note,
            'position', si."position",
            'artwork_title', a.title,
            'artwork_image_path', (
              select ai.storage_path
              from public.artwork_images ai
              where ai.artwork_id = a.id
              order by ai."position" limit 1
            ),
            'artwork_artist_name', prof.display_name,
            'exhibition_title', proj.title
          )
          order by si."position", si.created_at
        ),
        '[]'::jsonb
      )
      from public.shortlist_items si
      left join public.artworks a on a.id = si.artwork_id and a.visibility = 'public'
      left join public.profiles prof on prof.id = a.artist_id
      left join public.projects proj on proj.id = si.exhibition_id
      where si.shortlist_id = v_room.id
    );
  else
    -- Gated path: items array is empty and the row contents NEVER leave
    -- the database. The viewer surface gets only the meta block + the
    -- visibility resolution it needs to render a hospitable gate.
    v_items := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'room', v_meta,
    'items', v_items,
    'visibility', v_resolution,
    'relationship', v_relationship,
    'can_view', v_can
  );
end;
$a$;

grant execute on function public.get_room_for_viewer_by_token(text) to authenticated;
grant execute on function public.get_room_for_viewer_by_token(text) to anon;

-- == SECTION 9 == resolve_visibility_for_preview (owner/delegate-only effective preview)

create or replace function public.resolve_visibility_for_preview(
  p_owner uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_field_key text,
  p_fake_state jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $a$
declare
  v_uid uuid := auth.uid();
  v_audience text;
  v_request_mode text;
  v_preset text;
  v_can boolean;
  v_reason text := 'fallback_open';
  v_signed_in boolean := coalesce((p_fake_state->>'signed_in')::boolean, true);
  v_follows boolean := coalesce((p_fake_state->>'viewer_follows_target')::boolean, false);
  v_followed boolean := coalesce((p_fake_state->>'target_follows_viewer')::boolean, false);
  v_grant boolean := coalesce((p_fake_state->>'has_grant')::boolean, false);
  v_delegate boolean := coalesce((p_fake_state->>'is_delegate')::boolean, false);
begin
  -- Caller authority: owner or delegate-writer of owner only. Refusing
  -- with a raise (vs returning a fail-closed jsonb) is intentional —
  -- this is an owner-only preview tool, never a viewer surface.
  if v_uid is null
     or (v_uid <> p_owner and not public.is_active_account_delegate_writer(p_owner)) then
    raise exception 'not authorized to preview visibility for this owner';
  end if;

  if p_owner is null or p_subject_type is null then
    return jsonb_build_object(
      'can_view', false,
      'required_audience', 'owner_only',
      'request_mode', null,
      'reason', 'invalid_input'
    );
  end if;

  if not public.visibility_subject_belongs_to_owner(p_owner, p_subject_type, p_subject_id) then
    return jsonb_build_object(
      'can_view', false,
      'required_audience', 'owner_only',
      'request_mode', null,
      'reason', 'subject_owner_mismatch'
    );
  end if;

  -- Effective policy ladder — kept identical to resolve_visibility_for_viewer.
  select audience, request_mode
    into v_audience, v_request_mode
  from public.visibility_policies
  where owner_profile_id = p_owner
    and subject_type = p_subject_type
    and (
      (subject_id is not null and subject_id = p_subject_id and field_key = p_field_key)
      or (subject_id is not null and subject_id = p_subject_id and field_key = '*')
      or (subject_id is null and field_key = p_field_key)
      or (subject_id is null and field_key = '*')
    )
  order by
    case when subject_id is not null and field_key = p_field_key then 0
         when subject_id is not null and field_key = '*' then 1
         when subject_id is null and field_key = p_field_key then 2
         else 3
    end
  limit 1;

  if v_audience is null then
    select preset_key into v_preset
    from public.visibility_owner_settings
    where owner_profile_id = p_owner;
    v_preset := coalesce(v_preset, 'open_studio');
    v_audience := case v_preset
      when 'open_studio' then case
        when p_field_key in ('price', 'availability') then 'mutuals'
        when p_field_key = 'studio_note' then 'owner_only'
        else 'public'
      end
      when 'follower_aware' then case
        when p_field_key in ('price', 'availability') then 'mutuals'
        when p_field_key in ('description', 'studio_note') then 'followers'
        else 'public'
      end
      when 'mutual_first' then case
        when p_field_key in ('price', 'availability') then 'mutuals'
        when p_field_key in ('description', 'studio_note') then 'mutuals'
        when p_field_key = '*' then 'public'
        else 'followers'
      end
      when 'private_studio' then case
        when p_field_key in ('price', 'availability', 'description', 'studio_note') then 'approved'
        when p_field_key = '*' then 'signed_in'
        else 'approved'
      end
      else 'public'
    end;
    v_reason := 'preset_fallback:' || v_preset;
  else
    v_reason := 'policy_match';
  end if;

  -- Evaluate audience against fake_state, NOT against auth.uid(). This
  -- is what makes "preview-as" honest: the caller is the owner, but
  -- the answer reflects how a *fake* viewer would be judged.
  if v_audience = 'public' then
    v_can := true;
  elsif v_audience = 'signed_in' then
    v_can := v_signed_in;
  elsif v_audience = 'followers' then
    v_can := v_follows;
  elsif v_audience = 'following' then
    v_can := v_followed;
  elsif v_audience = 'mutuals' then
    v_can := v_follows and v_followed;
  elsif v_audience = 'approved' then
    v_can := v_grant;
  elsif v_audience = 'delegates' then
    v_can := v_delegate;
  elsif v_audience = 'owner_only' then
    v_can := false;
  else
    v_can := false;
  end if;

  return jsonb_build_object(
    'can_view', v_can,
    'required_audience', v_audience,
    'request_mode', v_request_mode,
    'reason', case when v_can then v_reason else v_reason || ':blocked' end
  );
end;
$a$;

grant execute on function public.resolve_visibility_for_preview(uuid, text, uuid, text, jsonb) to authenticated;
