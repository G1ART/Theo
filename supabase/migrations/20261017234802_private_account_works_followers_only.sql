-- 2026-10-17 — Private accounts: their public works are seen only by the
-- artist, editors (uploader, claim holders, delegates) and accepted
-- followers (대표님 결정 followers_only).
--
-- artworks_public_read (visibility = 'public' for everyone) made the
-- account rule in artworks_select_public and
-- artworks_select_follower_accepted moot, so it is dropped. Delegates had
-- no read policy of their own and relied on it; artworks_select_delegate
-- keeps their access to the artist's public works (no drafts, as before).
--
-- Definer RPCs skip RLS, so they get the same rule from
-- artwork_account_visible_to_viewer: card judging (artwork_viewer_fields,
-- and through it artwork_viewer_fields_for / _as and the likes tab), the
-- detail passport, the room and board-token RPCs (a hidden work stays an
-- item with artwork_visible = false), the upload duplicate check, and the
-- liker alerts. No row is deleted.
--
-- Apply section by section in the SQL editor.

-- == SECTION 1 == artwork_account_visible_to_viewer

create or replace function public.artwork_account_visible_to_viewer(p_artist_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $a$
  select p_artist_id is null
    or public.is_artist_publicly_visible(p_artist_id)
    or (
      auth.uid() is not null
      and (
        auth.uid() = p_artist_id
        or public.viewer_is_accepted_follower_of(p_artist_id)
        or public.is_active_delegate_of(p_artist_id)
      )
    );
$a$;

revoke all on function public.artwork_account_visible_to_viewer(uuid) from public, anon, authenticated;

-- == SECTION 2 == artwork_viewer_fields

create or replace function public.artwork_viewer_fields(p_artwork_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $a$
declare
  v_aw public.artworks;
  v_editor boolean;
  v_private boolean;
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

  if not v_editor and v_aw.artist_id is not null then
    v_private := exists (
      select 1 from public.profiles p
      where p.id = v_aw.artist_id and p.is_public = false
    );
    if v_private and not public.artwork_account_visible_to_viewer(v_aw.artist_id) then
      return null;
    end if;
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

-- == SECTION 3 == get_artwork_passport_for_viewer

create or replace function public.get_artwork_passport_for_viewer(p_artwork_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
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

  if v_vis_text = 'public'
     and not v_is_owner_or_delegate
     and not v_is_editor
     and not public.artwork_account_visible_to_viewer(v_owner) then
    return null;
  end if;

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

-- == SECTION 4 == get_room_for_viewer_by_token

create or replace function public.get_room_for_viewer_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $a$
declare
  v_uid uuid := auth.uid();
  v_token uuid;
  v_room_id uuid;
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

  v_meta := (
    select jsonb_build_object(
      'id', s.id,
      'title', s.title,
      'description', s.description,
      'owner_id', s.owner_id,
      'owner_username', p.username,
      'owner_display_name', p.display_name,
      'owner_display_name_ko', p.display_name_ko,
      'owner_display_name_en', p.display_name_en
    )
    from public.shortlists s
    join public.profiles p on p.id = s.owner_id
    where s.share_token = v_token
      and s.room_active = true
      and (s.expires_at is null or s.expires_at > now())
  );

  if v_meta is null then
    return null;
  end if;

  v_room_id := (v_meta->>'id')::uuid;
  v_owner := (v_meta->>'owner_id')::uuid;
  v_resolution := public.resolve_visibility_for_viewer(v_owner, 'room', v_room_id, '*');
  v_relationship := public.get_viewer_relationship_context(v_owner);
  v_can := coalesce((v_resolution->>'can_view')::boolean, false);

  if v_can then
    begin
      insert into public.shortlist_views (shortlist_id, viewer_id, action)
      values (v_room_id, v_uid, 'viewed');
    exception when others then
      null;
    end;

    v_items := (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'item_id', si.id,
            'artwork_id', si.artwork_id,
            'artwork_visible', a.id is not null,
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
              order by ai.sort_order nulls last, ai.created_at
              limit 1
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
      left join public.artworks a
        on a.id = si.artwork_id
       and a.visibility = 'public'
       and (
         public.artwork_account_visible_to_viewer(a.artist_id)
         or public.artwork_viewer_is_editor(a.id, a.artist_id, a.created_by)
       )
      left join public.profiles prof on prof.id = a.artist_id
      left join public.projects proj on proj.id = si.exhibition_id
      where si.shortlist_id = v_room_id
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
$a$;

-- == SECTION 5 == get_shortlist_items_by_token

create or replace function public.get_shortlist_items_by_token(p_token uuid)
returns table(item_id uuid, artwork_id uuid, exhibition_id uuid, note text, "position" integer, artwork_title text, artwork_image_path text, artwork_artist_name text, exhibition_title text)
language plpgsql
security definer
set search_path to 'public'
as $a$
declare
  v_shortlist_id uuid;
begin
  v_shortlist_id := (
    select s.id
      from public.shortlists s
     where s.share_token = p_token
       and s.room_active = true
       and (s.expires_at is null or s.expires_at > now())
  );
  if v_shortlist_id is null then return; end if;

  insert into public.shortlist_views (shortlist_id, viewer_id, action)
    values (v_shortlist_id, auth.uid(), 'viewed');

  return query
    select si.id as item_id, si.artwork_id, si.exhibition_id, si.note, si."position",
           a.title as artwork_title,
           (select ai.storage_path from public.artwork_images ai where ai.artwork_id = a.id order by ai.sort_order nulls last, ai.created_at limit 1) as artwork_image_path,
           public.artwork_display_artist_name(a.id, prof.display_name) as artwork_artist_name,
           proj.title as exhibition_title
      from public.shortlist_items si
      left join public.artworks a
        on a.id = si.artwork_id
       and a.visibility = 'public'
       and (
         public.artwork_account_visible_to_viewer(a.artist_id)
         or public.artwork_viewer_is_editor(a.id, a.artist_id, a.created_by)
       )
      left join public.profiles prof on prof.id = a.artist_id
      left join public.projects proj on proj.id = si.exhibition_id
     where si.shortlist_id = v_shortlist_id
     order by si."position", si.created_at;
end;
$a$;

-- == SECTION 6 == search_works_for_dedup

create or replace function public.search_works_for_dedup(p_artist_profile_id uuid default null::uuid, p_external_artist_id uuid default null::uuid, p_q text default null::text, p_limit integer default 20)
returns table(id uuid, title text, title_ko text, title_en text, created_at timestamptz)
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
      and (
        public.artwork_account_visible_to_viewer(a.artist_id)
        or public.artwork_viewer_is_editor(a.id, a.artist_id, a.created_by)
      )
      and (
        v_q is null
        or a.title ilike '%' || v_q || '%'
        or a.title_ko ilike '%' || v_q || '%'
        or a.title_en ilike '%' || v_q || '%'
        or (
          char_length(v_q) >= 4 and (
            word_similarity(v_q, coalesce(a.title, '')) >= 0.5
            or word_similarity(v_q, coalesce(a.title_ko, '')) >= 0.5
            or word_similarity(v_q, coalesce(a.title_en, '')) >= 0.5
          )
        )
      )
    order by coalesce(
        a.title ilike '%' || v_q || '%'
        or a.title_ko ilike '%' || v_q || '%'
        or a.title_en ilike '%' || v_q || '%',
        false
      ) desc,
      greatest(
        word_similarity(v_q, coalesce(a.title, '')),
        word_similarity(v_q, coalesce(a.title_ko, '')),
        word_similarity(v_q, coalesce(a.title_en, ''))
      ) desc nulls last,
      a.created_at desc
    limit v_limit;
  elsif p_external_artist_id is not null then
    return query
    select a.id, a.title, a.title_ko, a.title_en, a.created_at
    from public.artworks a
    join public.claims c on c.work_id = a.id and c.external_artist_id = p_external_artist_id
    where a.visibility = 'public'
      and (
        public.artwork_account_visible_to_viewer(a.artist_id)
        or public.artwork_viewer_is_editor(a.id, a.artist_id, a.created_by)
      )
      and (
        v_q is null
        or a.title ilike '%' || v_q || '%'
        or a.title_ko ilike '%' || v_q || '%'
        or a.title_en ilike '%' || v_q || '%'
        or (
          char_length(v_q) >= 4 and (
            word_similarity(v_q, coalesce(a.title, '')) >= 0.5
            or word_similarity(v_q, coalesce(a.title_ko, '')) >= 0.5
            or word_similarity(v_q, coalesce(a.title_en, '')) >= 0.5
          )
        )
      )
    order by coalesce(
        a.title ilike '%' || v_q || '%'
        or a.title_ko ilike '%' || v_q || '%'
        or a.title_en ilike '%' || v_q || '%',
        false
      ) desc,
      greatest(
        word_similarity(v_q, coalesce(a.title, '')),
        word_similarity(v_q, coalesce(a.title_ko, '')),
        word_similarity(v_q, coalesce(a.title_en, ''))
      ) desc nulls last,
      a.created_at desc
    limit v_limit;
  else
    return query
    select a.id, a.title, a.title_ko, a.title_en, a.created_at
    from public.artworks a
    where a.visibility = 'public'
      and (
        public.artwork_account_visible_to_viewer(a.artist_id)
        or public.artwork_viewer_is_editor(a.id, a.artist_id, a.created_by)
      )
      and (
        v_q is null
        or a.title ilike '%' || v_q || '%'
        or a.title_ko ilike '%' || v_q || '%'
        or a.title_en ilike '%' || v_q || '%'
        or (
          char_length(v_q) >= 4 and (
            word_similarity(v_q, coalesce(a.title, '')) >= 0.5
            or word_similarity(v_q, coalesce(a.title_ko, '')) >= 0.5
            or word_similarity(v_q, coalesce(a.title_en, '')) >= 0.5
          )
        )
      )
    order by coalesce(
        a.title ilike '%' || v_q || '%'
        or a.title_ko ilike '%' || v_q || '%'
        or a.title_en ilike '%' || v_q || '%',
        false
      ) desc,
      greatest(
        word_similarity(v_q, coalesce(a.title, '')),
        word_similarity(v_q, coalesce(a.title_ko, '')),
        word_similarity(v_q, coalesce(a.title_en, ''))
      ) desc nulls last,
      a.created_at desc
    limit v_limit;
  end if;
end;
$a$;

-- == SECTION 7 == liker alerts: sold / price listed

create or replace function public.notify_likers_on_state_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_type text;
  v_aw public.artworks;
  v_actor uuid := auth.uid();
  v_liker uuid;
  v_fields jsonb;
  v_account_public boolean;
begin
  if new.kind = 'availability' and new.to_state = 'sold' and new.from_state is distinct from 'sold' then
    v_type := 'liked_work_sold';
  elsif new.kind = 'price' and new.to_state = 'listed' and new.from_state is distinct from 'listed' then
    v_type := 'liked_work_price_listed';
  else
    return new;
  end if;

  v_aw := (select a from public.artworks a where a.id = new.artwork_id);
  if v_aw.id is null or coalesce(v_aw.visibility::text, '') <> 'public' then
    return new;
  end if;
  if v_type = 'liked_work_price_listed' and coalesce(v_aw.ownership_status::text, '') <> 'available' then
    return new;
  end if;
  v_account_public := public.is_artist_publicly_visible(v_aw.artist_id);

  for v_liker in
    select l.user_id
    from public.artwork_likes l
    where l.artwork_id = v_aw.id
      and l.user_id <> v_aw.artist_id
      and l.user_id is distinct from v_aw.created_by
      and l.user_id is distinct from v_actor
      and not exists (
        select 1 from public.alert_preferences ap
        where ap.user_id = l.user_id and ap.liked_work_alerts = false
      )
      and not exists (
        select 1 from public.notifications n
        where n.user_id = l.user_id
          and n.type = v_type
          and n.artwork_id = v_aw.id
          and n.created_at > now() - interval '1 day'
      )
  loop
    if v_type = 'liked_work_price_listed' or not v_account_public then
      v_fields := public.artwork_viewer_fields_as(v_liker, v_aw.id);
      if v_fields is null then
        continue;
      end if;
      if v_type = 'liked_work_price_listed'
         and (coalesce(v_fields->>'pricing_mode', '') <> 'fixed'
              or coalesce(v_fields->>'is_price_public', '') <> 'true') then
        continue;
      end if;
    end if;
    insert into public.notifications (user_id, type, actor_id, artwork_id, payload)
    values (v_liker, v_type, v_aw.artist_id, v_aw.id, '{}'::jsonb);
  end loop;

  return new;
end;
$a$;

-- == SECTION 8 == liker alerts: linked to an exhibition

create or replace function public.notify_likers_on_exhibition_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_aw public.artworks;
  v_show public.projects;
  v_phase text;
  v_actor uuid := coalesce(new.added_by_profile_id, auth.uid());
  v_liker uuid;
  v_existing uuid;
  v_account_public boolean;
begin
  v_aw := (select a from public.artworks a where a.id = new.work_id);
  if v_aw.id is null or coalesce(v_aw.visibility::text, '') <> 'public' then
    return new;
  end if;

  v_show := (select p from public.projects p where p.id = new.exhibition_id and p.project_type = 'exhibition');
  if v_show.id is null then
    return new;
  end if;

  v_phase := case
    when v_show.end_date is not null and v_show.end_date < current_date then 'ended'
    when v_show.start_date is not null and v_show.start_date > current_date then 'upcoming'
    when v_show.start_date is not null and v_show.end_date is not null then 'ongoing'
    when v_show.status = 'live' then 'ongoing'
    when v_show.status = 'planned' and (v_show.start_date is null or v_show.start_date > current_date) then 'upcoming'
    else 'ended'
  end;
  if v_phase not in ('ongoing', 'upcoming') then
    return new;
  end if;
  if not (
    (v_show.host_profile_id is null or public.is_artist_publicly_visible(v_show.host_profile_id))
    and (v_show.curator_id is null or public.is_artist_publicly_visible(v_show.curator_id))
  ) then
    return new;
  end if;
  v_account_public := public.is_artist_publicly_visible(v_aw.artist_id);

  for v_liker in
    select l.user_id
    from public.artwork_likes l
    where l.artwork_id = v_aw.id
      and l.user_id <> v_aw.artist_id
      and l.user_id is distinct from v_aw.created_by
      and l.user_id is distinct from v_actor
      and not exists (
        select 1 from public.alert_preferences ap
        where ap.user_id = l.user_id and ap.liked_work_alerts = false
      )
  loop
    if not v_account_public and public.artwork_viewer_fields_as(v_liker, v_aw.id) is null then
      continue;
    end if;
    v_existing := (
      select n.id
      from public.notifications n
      where n.user_id = v_liker
        and n.type = 'liked_work_exhibited'
        and n.read_at is null
        and n.payload->>'exhibition_id' = v_show.id::text
        and n.created_at > now() - interval '6 hours'
      order by n.created_at desc
      limit 1
    );
    if v_existing is not null then
      update public.notifications n
      set payload = n.payload || jsonb_build_object(
        'artwork_ids', coalesce(n.payload->'artwork_ids', '[]'::jsonb) || jsonb_build_array(v_aw.id::text),
        'count', jsonb_array_length(coalesce(n.payload->'artwork_ids', '[]'::jsonb)) + 1
      )
      where n.id = v_existing
        and not (coalesce(n.payload->'artwork_ids', '[]'::jsonb) ? v_aw.id::text);
    elsif not exists (
      select 1
      from public.notifications n
      where n.user_id = v_liker
        and n.type = 'liked_work_exhibited'
        and n.artwork_id = v_aw.id
        and n.payload->>'exhibition_id' = v_show.id::text
    ) then
      insert into public.notifications (user_id, type, actor_id, artwork_id, payload)
      values (
        v_liker,
        'liked_work_exhibited',
        v_actor,
        v_aw.id,
        jsonb_build_object(
          'exhibition_id', v_show.id,
          'exhibition_title', v_show.title,
          'exhibition_title_ko', v_show.title_ko,
          'exhibition_title_en', v_show.title_en,
          'artwork_ids', jsonb_build_array(v_aw.id::text),
          'count', 1
        )
      );
    end if;
  end loop;

  return new;
end;
$a$;

-- == SECTION 9 == artworks read policies

drop policy if exists artworks_public_read on public.artworks;
drop policy if exists artworks_select_delegate on public.artworks;

create policy artworks_select_delegate
  on public.artworks
  for select
  to authenticated
  using (
    visibility = 'public'::public.artwork_visibility
    and artist_id is not null
    and public.is_active_delegate_of(artist_id)
  );

notify pgrst, 'reload schema';
