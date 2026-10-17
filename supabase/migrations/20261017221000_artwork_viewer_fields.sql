-- 2026-10-17 — One server rule for artwork price and availability.
--
-- Rule (decided 2026-10-17):
--   * 'sold' is visible to everyone.
--   * Price and every other availability value (available, owned,
--     not_for_sale) follow the owner's visibility policy. Default preset
--     = mutual follows.
--   * Anyone who may edit the artwork (artist, uploader, claim holder,
--     account delegate with manage_artworks, project works delegate)
--     sees the stored values. This mirrors the UPDATE policies on
--     public.artworks, so nobody reads more than they can already write.
--
-- Surfaces:
--   * resolve_visibility_for_viewer / _for_preview carry the sold rule.
--   * get_artwork_passport_for_viewer (detail) adds the editor rule.
--   * artwork_viewer_fields(id) returns the judged price/availability
--     fields for cards, feed, search, profile, library and edit.
--   * public.artwork_cards = artworks without the stored price/status
--     columns + viewer_fields. Security invoker, so artworks RLS applies.
--   * artwork_viewer_fields_for(ids) = batch form for client refresh.
--   * search_works_for_dedup returns titles only (was whole rows).
--
-- Additive only. The column lock (revoking direct SELECT on the stored
-- columns) is 20261017221500_artwork_price_column_lock.sql and runs
-- after the app that reads artwork_cards is live.
--
-- Apply section by section in the SQL editor.

-- == SECTION 1 == sold availability is public

create or replace function public.artwork_availability_is_public(
  p_subject_type text,
  p_subject_id uuid,
  p_field_key text
) returns boolean
language sql
stable
security definer
set search_path = public
as $a$
  select coalesce(p_subject_type, '') = 'artwork'
     and coalesce(p_field_key, '') = 'availability'
     and p_subject_id is not null
     and exists (
       select 1 from public.artworks a
       where a.id = p_subject_id
         and a.ownership_status = 'sold'
     );
$a$;

revoke all on function public.artwork_availability_is_public(text, uuid, text) from public, anon, authenticated;

-- == SECTION 2 == resolve_visibility_for_viewer (sold rule)

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
  v_policy public.visibility_policies;
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

  if not public.visibility_subject_belongs_to_owner(p_owner, p_subject_type, p_subject_id) then
    return jsonb_build_object(
      'can_view', false,
      'required_audience', 'owner_only',
      'request_mode', null,
      'reason', 'subject_owner_mismatch'
    );
  end if;

  if public.artwork_availability_is_public(p_subject_type, p_subject_id, p_field_key) then
    return jsonb_build_object(
      'can_view', true,
      'required_audience', 'public',
      'request_mode', null,
      'reason', 'sold_public'
    );
  end if;

  v_policy := (
    select vp
    from public.visibility_policies vp
    where vp.owner_profile_id = p_owner
      and vp.subject_type = p_subject_type
      and (
        (vp.subject_id is not null and vp.subject_id = p_subject_id and vp.field_key = p_field_key)
        or (vp.subject_id is not null and vp.subject_id = p_subject_id and vp.field_key = '*')
        or (vp.subject_id is null and vp.field_key = p_field_key)
        or (vp.subject_id is null and vp.field_key = '*')
      )
    order by
      case when vp.subject_id is not null and vp.field_key = p_field_key then 0
           when vp.subject_id is not null and vp.field_key = '*' then 1
           when vp.subject_id is null and vp.field_key = p_field_key then 2
           else 3
      end
    limit 1
  );
  v_audience := v_policy.audience;
  v_request_mode := v_policy.request_mode;

  if v_audience is null then
    v_preset := coalesce(
      (select s.preset_key from public.visibility_owner_settings s where s.owner_profile_id = p_owner),
      'open_studio'
    );

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

-- == SECTION 3 == resolve_visibility_for_preview (sold rule)

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
  v_policy public.visibility_policies;
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

  if public.artwork_availability_is_public(p_subject_type, p_subject_id, p_field_key) then
    return jsonb_build_object(
      'can_view', true,
      'required_audience', 'public',
      'request_mode', null,
      'reason', 'sold_public'
    );
  end if;

  v_policy := (
    select vp
    from public.visibility_policies vp
    where vp.owner_profile_id = p_owner
      and vp.subject_type = p_subject_type
      and (
        (vp.subject_id is not null and vp.subject_id = p_subject_id and vp.field_key = p_field_key)
        or (vp.subject_id is not null and vp.subject_id = p_subject_id and vp.field_key = '*')
        or (vp.subject_id is null and vp.field_key = p_field_key)
        or (vp.subject_id is null and vp.field_key = '*')
      )
    order by
      case when vp.subject_id is not null and vp.field_key = p_field_key then 0
           when vp.subject_id is not null and vp.field_key = '*' then 1
           when vp.subject_id is null and vp.field_key = p_field_key then 2
           else 3
      end
    limit 1
  );
  v_audience := v_policy.audience;
  v_request_mode := v_policy.request_mode;

  if v_audience is null then
    v_preset := coalesce(
      (select s.preset_key from public.visibility_owner_settings s where s.owner_profile_id = p_owner),
      'open_studio'
    );
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

-- == SECTION 4 == artwork_viewer_is_editor (mirrors the UPDATE policies)

create or replace function public.artwork_viewer_is_editor(
  p_artwork_id uuid,
  p_artist_id uuid,
  p_created_by uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $a$
  select auth.uid() is not null
     and (
       auth.uid() = p_artist_id
       or auth.uid() = p_created_by
       or exists (
         select 1 from public.claims c
         where c.work_id = p_artwork_id
           and c.subject_profile_id = auth.uid()
       )
       or public.has_active_account_delegate_perm(p_artist_id, 'manage_artworks')
       or public.is_active_project_delegate_works_writer(p_artist_id)
     );
$a$;

revoke all on function public.artwork_viewer_is_editor(uuid, uuid, uuid) from public, anon, authenticated;

-- == SECTION 5 == artwork_viewer_fields

create or replace function public.artwork_viewer_fields(p_artwork_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
cost 100
as $a$
declare
  v_aw public.artworks;
  v_editor boolean;
  v_price jsonb;
  v_avail jsonb;
  v_can_price boolean;
  v_can_avail boolean;
begin
  if p_artwork_id is null then
    return null;
  end if;

  v_aw := (select a from public.artworks a where a.id = p_artwork_id);
  if v_aw.id is null then
    return null;
  end if;

  v_editor := public.artwork_viewer_is_editor(v_aw.id, v_aw.artist_id, v_aw.created_by);

  if coalesce(v_aw.visibility::text, '') <> 'public' and not v_editor then
    return null;
  end if;

  if v_editor then
    v_can_price := true;
    v_can_avail := true;
  else
    v_price := public.resolve_visibility_for_viewer(v_aw.artist_id, 'artwork', v_aw.id, 'price');
    v_avail := public.resolve_visibility_for_viewer(v_aw.artist_id, 'artwork', v_aw.id, 'availability');
    v_can_price := coalesce((v_price->>'can_view')::boolean, false);
    v_can_avail := coalesce((v_avail->>'can_view')::boolean, false);
  end if;

  return jsonb_build_object(
    'ownership_status',     case when v_can_avail then v_aw.ownership_status::text else null end,
    'pricing_mode',         case when v_can_price then v_aw.pricing_mode::text else null end,
    'is_price_public',      case when v_can_price then v_aw.is_price_public else null end,
    'price_usd',            case when v_can_price then v_aw.price_usd else null end,
    'price_input_amount',   case when v_can_price then v_aw.price_input_amount else null end,
    'price_input_currency', case when v_can_price then v_aw.price_input_currency else null end,
    'fx_rate_to_usd',       case when v_can_price then v_aw.fx_rate_to_usd else null end,
    'fx_date',              case when v_can_price then v_aw.fx_date else null end,
    'price_gate', case when v_can_price then null else jsonb_build_object(
      'required_audience', coalesce(v_price->>'required_audience', 'owner_only'),
      'request_mode', v_price->'request_mode'
    ) end,
    'availability_gate', case when v_can_avail then null else jsonb_build_object(
      'required_audience', coalesce(v_avail->>'required_audience', 'owner_only'),
      'request_mode', v_avail->'request_mode'
    ) end
  );
end;
$a$;

revoke all on function public.artwork_viewer_fields(uuid) from public;
grant execute on function public.artwork_viewer_fields(uuid) to anon, authenticated;

-- == SECTION 6 == artwork_cards view

create or replace view public.artwork_cards
with (security_invoker = true)
as
select
  a.id,
  a.artist_id,
  a.title,
  a.title_ko,
  a.title_en,
  a.year,
  a.medium,
  a.medium_ko,
  a.medium_en,
  a.size,
  a.size_unit,
  a.work_form,
  a.width_cm,
  a.height_cm,
  a.depth_cm,
  a.dims_confirmed_at,
  a.story,
  a.story_ko,
  a.story_en,
  a.visibility,
  a.work_kind,
  a.created_by,
  a.artist_sort_order,
  a.artist_sort_updated_at,
  a.created_at,
  a.updated_at,
  a.provenance_visible,
  a.website_import_provenance,
  a.likes_count,
  public.artwork_viewer_fields(a.id) as viewer_fields
from public.artworks a;

revoke all on public.artwork_cards from public, anon, authenticated;
grant select on public.artwork_cards to anon, authenticated;

comment on view public.artwork_cards is
  'artworks without stored price/availability columns; viewer_fields carries the values the current viewer may see.';

-- == SECTION 7 == artwork_viewer_fields_for (batch)

create or replace function public.artwork_viewer_fields_for(p_ids uuid[])
returns table(id uuid, viewer_fields jsonb)
language plpgsql
stable
security definer
set search_path = public
as $a$
#variable_conflict use_column
begin
  return query
  with ids as materialized (
    select distinct x as artwork_id
    from unnest(coalesce(p_ids, '{}'::uuid[])) as x
    limit 1000
  ),
  judged as materialized (
    select ids.artwork_id, public.artwork_viewer_fields(ids.artwork_id) as fields
    from ids
  )
  select judged.artwork_id, judged.fields
  from judged
  where judged.fields is not null;
end;
$a$;

revoke all on function public.artwork_viewer_fields_for(uuid[]) from public;
grant execute on function public.artwork_viewer_fields_for(uuid[]) to anon, authenticated;

-- == SECTION 8 == search_works_for_dedup returns titles only

drop function if exists public.search_works_for_dedup(uuid, uuid, text, integer);

create function public.search_works_for_dedup(
  p_artist_profile_id uuid default null,
  p_external_artist_id uuid default null,
  p_q text default null,
  p_limit integer default 20
) returns table(id uuid, title text, title_ko text, title_en text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $a$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  if p_artist_profile_id is not null then
    return query
    select a.id, a.title, a.title_ko, a.title_en, a.created_at
    from public.artworks a
    where a.visibility = 'public'
      and a.artist_id = p_artist_profile_id
      and (v_q is null or a.title ilike '%' || v_q || '%')
    order by a.created_at desc
    limit v_limit;
  elsif p_external_artist_id is not null then
    return query
    select a.id, a.title, a.title_ko, a.title_en, a.created_at
    from public.artworks a
    join public.claims c on c.work_id = a.id and c.external_artist_id = p_external_artist_id
    where a.visibility = 'public'
      and (v_q is null or a.title ilike '%' || v_q || '%')
    order by a.created_at desc
    limit v_limit;
  else
    return query
    select a.id, a.title, a.title_ko, a.title_en, a.created_at
    from public.artworks a
    where a.visibility = 'public'
      and (v_q is null or a.title ilike '%' || v_q || '%')
    order by a.created_at desc
    limit v_limit;
  end if;
end;
$a$;

revoke all on function public.search_works_for_dedup(uuid, uuid, text, integer) from public;
grant execute on function public.search_works_for_dedup(uuid, uuid, text, integer) to anon, authenticated;

-- == SECTION 9 == get_artwork_passport_for_viewer (editor rule; sold rule via resolver)

create or replace function public.get_artwork_passport_for_viewer(p_artwork_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $a$
declare
  v_uid uuid := auth.uid();
  v_aw public.artworks;
  v_owner uuid;
  v_vis_text text;
  v_is_owner_or_delegate boolean;
  v_is_editor boolean;
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

  v_aw := (select a from public.artworks a where a.id = p_artwork_id);

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

  v_is_editor := public.artwork_viewer_is_editor(v_aw.id, v_aw.artist_id, v_aw.created_by);

  v_price        := public.resolve_visibility_for_viewer(v_owner, 'artwork', v_aw.id, 'price');
  v_avail        := public.resolve_visibility_for_viewer(v_owner, 'artwork', v_aw.id, 'availability');
  v_desc         := public.resolve_visibility_for_viewer(v_owner, 'artwork', v_aw.id, 'description');
  v_relationship := public.get_viewer_relationship_context(v_owner);

  if v_is_editor then
    v_price := jsonb_build_object(
      'can_view', true,
      'required_audience', coalesce(v_price->>'required_audience', 'public'),
      'request_mode', v_price->'request_mode',
      'reason', 'editor'
    );
    v_avail := jsonb_build_object(
      'can_view', true,
      'required_audience', coalesce(v_avail->>'required_audience', 'public'),
      'request_mode', v_avail->'request_mode',
      'reason', 'editor'
    );
    v_desc := jsonb_build_object(
      'can_view', true,
      'required_audience', coalesce(v_desc->>'required_audience', 'public'),
      'request_mode', v_desc->'request_mode',
      'reason', 'editor'
    );
  end if;

  v_can_price := coalesce((v_price->>'can_view')::boolean, false);
  v_can_avail := coalesce((v_avail->>'can_view')::boolean, false);
  v_can_desc  := coalesce((v_desc ->>'can_view')::boolean, false);

  v_artwork := jsonb_build_object(
    'id', v_aw.id,
    'title', v_aw.title,
    'title_ko', v_aw.title_ko,
    'title_en', v_aw.title_en,
    'year', v_aw.year,
    'medium', v_aw.medium,
    'medium_ko', v_aw.medium_ko,
    'medium_en', v_aw.medium_en,
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
    'story_ko',             case when v_can_desc  then v_aw.story_ko             else null end,
    'story_en',             case when v_can_desc  then v_aw.story_en             else null end,
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
        'display_name_ko', p.display_name_ko,
        'display_name_en', p.display_name_en,
        'avatar_url', p.avatar_url,
        'bio',
          case
            when v_is_owner_or_delegate then p.bio
            when coalesce(p.is_public, true) then p.bio
            else null
          end,
        'bio_ko',
          case
            when v_is_owner_or_delegate then p.bio_ko
            when coalesce(p.is_public, true) then p.bio_ko
            else null
          end,
        'bio_en',
          case
            when v_is_owner_or_delegate then p.bio_en
            when coalesce(p.is_public, true) then p.bio_en
            else null
          end,
        'main_role',
          case
            when v_is_owner_or_delegate then p.main_role
            when coalesce(p.is_public, true) then p.main_role
            else null
          end,
        'roles',
          case
            when v_is_owner_or_delegate then p.roles
            when coalesce(p.is_public, true) then p.roles
            else null
          end
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
            'artist_profile', (
              select jsonb_build_object(
                'id', ap.id,
                'username', ap.username,
                'display_name', ap.display_name,
                'display_name_ko', ap.display_name_ko,
                'display_name_en', ap.display_name_en,
                'main_role', ap.main_role,
                'roles', ap.roles
              )
              from public.profiles ap
              where ap.id = c.artist_profile_id
            ),
            'external_artist_id', c.external_artist_id,
            'created_at', c.created_at,
            'status', c.status,
            'period_status', c.period_status,
            'start_date', c.start_date,
            'end_date', c.end_date,
            'profiles', (
              select jsonb_build_object(
                'username', sp.username,
                'display_name', sp.display_name,
                'display_name_ko', sp.display_name_ko,
                'display_name_en', sp.display_name_en
              )
              from public.profiles sp
              where sp.id = c.subject_profile_id
            ),
            'external_artists', (
              select jsonb_build_object(
                'display_name', ea.display_name,
                'display_name_ko', ea.display_name_ko,
                'display_name_en', ea.display_name_en
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
        (v_aw.story is not null and length(btrim(v_aw.story)) > 0)
        or (v_aw.story_ko is not null and length(btrim(v_aw.story_ko)) > 0)
        or (v_aw.story_en is not null and length(btrim(v_aw.story_en)) > 0)
      )
    ),
    'relationship', v_relationship,
    'viewer_id',    v_uid
  );
end;
$a$;

grant execute on function public.get_artwork_passport_for_viewer(uuid) to authenticated;
grant execute on function public.get_artwork_passport_for_viewer(uuid) to anon;

notify pgrst, 'reload schema';
