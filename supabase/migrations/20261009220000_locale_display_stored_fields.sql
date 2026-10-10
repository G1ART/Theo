-- 2026-10-09 — show stored KO/EN fields on viewer RPCs.
--
-- Columns already exist. The artwork passport and the room viewer JSON
-- only returned the legacy title / medium / story / display_name, and the
-- legacy column is Korean whenever title_ko is filled. The screen language
-- toggle then had nothing English to switch to.
--
-- This does not translate. It returns the stored slots so the client picker
-- can prefer the UI language and fall back when that slot is empty.
--
-- Dashboard SQL Editor: highlight one section, Run, then the next.
-- Do not paste the whole file. Dollar tags are letters only.

-- == SECTION 1 == artist name slot (same credited person, one language)
--
-- artwork_display_artist_name stays the attribution rule: external artist
-- when that claim has a name, otherwise the profile fallback. This function
-- returns one language slot of that same person. An empty slot stays empty
-- so the client can fall back to the other language of the same person,
-- and never to the uploading account.

create or replace function public.artwork_artist_name_slot(
  p_work_id uuid,
  p_fallback text,
  p_slot text
) returns text
language sql
stable
security definer
set search_path to public
as $slot$
  select coalesce(
    (
      select case p_slot
        when 'en' then nullif(btrim(coalesce(ea.display_name_en, '')), '')
        when 'ko' then nullif(btrim(coalesce(ea.display_name_ko, '')), '')
        else nullif(btrim(coalesce(ea.display_name, '')), '')
      end
      from public.claims c
      join public.external_artists ea on ea.id = c.external_artist_id
      where c.work_id = p_work_id
        and ea.display_name is not null
        and btrim(ea.display_name) <> ''
        and (c.status is null or c.status = 'confirmed')
      order by (case when c.claim_type = 'CREATED' then 0 else 1 end), c.created_at
      limit 1
    ),
    case
      when exists (
        select 1
        from public.claims c
        join public.external_artists ea on ea.id = c.external_artist_id
        where c.work_id = p_work_id
          and ea.display_name is not null
          and btrim(ea.display_name) <> ''
          and (c.status is null or c.status = 'confirmed')
      ) then null
      else nullif(btrim(coalesce(p_fallback, '')), '')
    end
  );
$slot$;

grant execute on function public.artwork_artist_name_slot(uuid, text, text) to anon;
grant execute on function public.artwork_artist_name_slot(uuid, text, text) to authenticated;

-- == SECTION 2 == get_artwork_passport_for_viewer bilingual slots
--
-- Same redaction as the live function. Title, medium, and names are not
-- gated. Story and bio stay behind the existing description / public gates.

create or replace function public.get_artwork_passport_for_viewer(p_artwork_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to public
as $passport$
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
    a.id, a.title, a.title_ko, a.title_en, a.year,
    a.medium, a.medium_ko, a.medium_en,
    a.size, a.size_unit,
    a.story, a.story_ko, a.story_en,
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
$passport$;

-- == SECTION 3 == get_room_for_viewer_by_token bilingual slots

create or replace function public.get_room_for_viewer_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to public
as $room$
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
    return null;
  end;

  select s.id, s.title, s.description, s.owner_id,
         p.username as owner_username,
         p.display_name as owner_display_name,
         p.display_name_ko as owner_display_name_ko,
         p.display_name_en as owner_display_name_en
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
    'description', v_room.description,
    'owner_id', v_room.owner_id,
    'owner_username', v_room.owner_username,
    'owner_display_name', v_room.owner_display_name,
    'owner_display_name_ko', v_room.owner_display_name_ko,
    'owner_display_name_en', v_room.owner_display_name_en
  );

  if v_can then
    begin
      insert into public.shortlist_views (shortlist_id, viewer_id, action)
      values (v_room.id, v_uid, 'viewed');
    exception when others then
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
            'artwork_title_ko', a.title_ko,
            'artwork_title_en', a.title_en,
            'artwork_image_path', (
              select ai.storage_path
              from public.artwork_images ai
              where ai.artwork_id = a.id
              order by ai."position" limit 1
            ),
            'artwork_artist_name', public.artwork_display_artist_name(a.id, prof.display_name),
            'artwork_artist_name_ko', public.artwork_artist_name_slot(a.id, prof.display_name_ko, 'ko'),
            'artwork_artist_name_en', public.artwork_artist_name_slot(a.id, prof.display_name_en, 'en'),
            'exhibition_title', proj.title,
            'exhibition_title_ko', proj.title_ko,
            'exhibition_title_en', proj.title_en
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
$room$;
