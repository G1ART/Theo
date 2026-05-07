-- ===========================================================================
-- Hotfix: get_artwork_passport_for_viewer enum/text comparison bug
-- ===========================================================================
--
-- NOTE FOR THE OPERATOR
--   Paste this ENTIRE file into the Supabase SQL Editor and press Run.
--   The header comments below intentionally avoid single quotes because
--   the dashboard SQL splitter tokenizes paste-input client-side and a
--   stray apostrophe in a line comment can confuse its quote tracker
--   (per .cursor/rules/release-workflow.mdc paragraph 1-1). If you ever
--   see ERROR 42P01 relation v_aw does not exist on a function paste,
--   that is the same class of bug.
--
-- WHAT THIS FIXES
--   Symptom: every viewer (logged in or not, follower or stranger) who
--   clicks an artwork from the feed sees
--     invalid input value for enum artwork_visibility:
--   The Sprint 5.2 and Sprint 6 builds of get_artwork_passport_for_viewer
--   guard the non-public lane with coalesce(v_aw.visibility, empty-text).
--   v_aw.visibility is the artwork_visibility enum, so Postgres tries to
--   cast the empty-text fallback TO the enum and fails with 22P02 before
--   any redaction logic runs.
--
-- HOW THIS FIXES IT
--   Cast the enum to text before coalescing. The behavior is identical
--   (an artwork with NULL visibility is still treated as non-public,
--   matching the pre-Sprint-5.2 backfill). The DTO body is otherwise
--   100% identical to Sprint 6 SECTION 1.

create or replace function public.get_artwork_passport_for_viewer(
  p_artwork_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $hotfix$
declare
  v_uid uuid := auth.uid();
  v_aw record;
  v_owner uuid;
  v_vis_text text;
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

  if v_vis_text <> 'public' then
    if v_uid is null
       or (v_uid <> v_owner
           and not public.is_active_account_delegate_writer(v_owner)) then
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
    'created_by', v_aw.created_by,
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
            'role', c.role,
            'is_primary', c.is_primary,
            'sort_order', c.sort_order,
            'profiles', case
              when c.profile_id is not null then (
                select jsonb_build_object(
                  'id', cp.id,
                  'username', cp.username,
                  'display_name', cp.display_name,
                  'avatar_url', cp.avatar_url,
                  'main_role', cp.main_role,
                  'roles', cp.roles
                )
                from public.profiles cp
                where cp.id = c.profile_id
              )
              else null
            end,
            'external_artists', case
              when c.external_artist_id is not null then (
                select jsonb_build_object(
                  'id', ea.id,
                  'display_name', ea.display_name
                )
                from public.external_artists ea
                where ea.id = c.external_artist_id
              )
              else null
            end
          )
          order by c.is_primary desc nulls last, c.sort_order nulls last, c.created_at
        ),
        '[]'::jsonb
      )
      from public.claims c
      where c.artwork_id = v_aw.id
    )
  );

  return jsonb_build_object(
    'artwork', v_artwork,
    'visibility', jsonb_build_object(
      'price',        v_price,
      'availability', v_avail,
      'description',  v_desc
    ),
    'relationship', v_relationship,
    'viewer_id',    v_uid
  );
end;
$hotfix$;

grant execute on function public.get_artwork_passport_for_viewer(uuid) to authenticated;
grant execute on function public.get_artwork_passport_for_viewer(uuid) to anon;
