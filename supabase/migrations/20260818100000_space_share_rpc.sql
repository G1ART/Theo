-- ============================================================
-- 2026-08-17 (16) Display / Hang Simulation P1 — public share RPC
-- ------------------------------------------------------------
-- Chunk B set `spaces` / `space_surfaces` / `space_placements`
-- RLS to `to authenticated USING (owner_id = auth.uid())` so
-- private drafts stay owner-scoped. Chunk C then exposed a
-- `/space/[token]` public read-only view, but with no anon
-- policy on those tables the anon client returned an empty
-- result — breaking the share flow end-to-end.
--
-- Naive fix: add `to anon USING (share_token IS NOT NULL AND
-- is_active AND (expires_at IS NULL OR expires_at > now()))`
-- policies. That would satisfy the app-side `.eq('share_token', …)`
-- query, but it *also* permits an anonymous caller to
--   `SELECT share_token FROM spaces WHERE is_active = true`
-- and enumerate every active share_token, defeating the whole
-- "token is an unguessable secret" model.
--
-- Correct fix: keep the tables closed to anon and expose a
-- single SECURITY DEFINER RPC that takes the token as an input
-- argument. The RPC is a pure challenge-response — anon must
-- present the token to get anything back, and there is no
-- table-level `SELECT` grant they can pivot from.
--
-- Payload shape matches the existing embedded-select response
-- so the client can reuse the same `rowToSceneSpace` /
-- `rowToArtworkThumb` deserializers already used by
-- `getSpaceById` (no separate branch needed).
--
-- Artworks are filtered to `visibility = 'public'` to prevent
-- leakage if an artist later hides a work referenced by an
-- older share (mirrors Chunk B `fetchArtworkThumbs`
-- `publicOnly = true` path).
-- ============================================================

begin;

create or replace function public.get_space_by_share_token(_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $body$
declare
  v_space_id uuid;
  v_result   jsonb;
begin
  -- Resolve token → space id, gated on the same predicates the
  -- previous embedded-select applied on the client
  -- (`is_active = true` AND (`expires_at IS NULL` OR
  -- `expires_at > now()`)).
  select id
    into v_space_id
    from public.spaces
   where share_token = _token
     and is_active   = true
     and (expires_at is null or expires_at > now());

  if v_space_id is null then
    return null;
  end if;

  -- Compose payload that matches the shape
  -- `client.from('spaces').select('… space_surfaces(…), space_placements(…)').maybeSingle()`
  -- returns, plus a separate `artwork_rows` bag of public artwork
  -- thumbs (Supabase JS treats top-level `rpc()` results as
  -- opaque JSON, so we bundle both under one call to avoid a
  -- second round-trip).
  select jsonb_build_object(
    'space_row',
      to_jsonb(s) ||
      jsonb_build_object(
        'space_surfaces', coalesce((
          select jsonb_agg(to_jsonb(sf) order by sf.surface_index nulls last, sf.created_at)
            from public.space_surfaces sf
           where sf.space_id = s.id
        ), '[]'::jsonb),
        'space_placements', coalesce((
          select jsonb_agg(to_jsonb(sp) order by sp.z_order nulls last, sp.created_at)
            from public.space_placements sp
           where sp.space_id = s.id
        ), '[]'::jsonb)
      ),
    'artwork_rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',         a.id,
        'title',      a.title,
        'title_ko',   a.title_ko,
        'title_en',   a.title_en,
        'visibility', a.visibility,
        'work_form',  a.work_form,
        'width_cm',   a.width_cm,
        'height_cm',  a.height_cm,
        'depth_cm',   a.depth_cm,
        'artwork_images', coalesce((
          select jsonb_agg(jsonb_build_object(
            'storage_path', ai.storage_path,
            'sort_order',   ai.sort_order,
            'view_type',    ai.view_type
          ) order by ai.sort_order nulls last)
            from public.artwork_images ai
           where ai.artwork_id = a.id
        ), '[]'::jsonb)
      ))
        from public.artworks a
       where a.visibility = 'public'
         and a.id in (
           select artwork_id
             from public.space_placements
            where space_id = s.id
         )
    ), '[]'::jsonb)
  )
    into v_result
    from public.spaces s
   where s.id = v_space_id;

  return v_result;
end
$body$;

comment on function public.get_space_by_share_token(uuid) is
  '2026-08-17 (16) Display sim P1 — challenge-response reader for /space/[token] '
  'public share view. SECURITY DEFINER because `spaces` / `space_surfaces` / '
  '`space_placements` are closed to anon RLS. Caller must present the exact '
  'share_token; enumeration is not possible. Artworks filtered to '
  '`visibility = ''public''` so stale shares cannot leak later-hidden works.';

-- Least-privilege grants. Revoke the implicit PUBLIC grant that
-- Postgres attaches to any new function so `anon` cannot call
-- via the fallback path, then explicitly grant to the three
-- roles that need it. Mirrors the pattern already in
-- `20260516000000` and other SECURITY DEFINER helpers.
revoke all      on function public.get_space_by_share_token(uuid) from public;
grant  execute  on function public.get_space_by_share_token(uuid) to anon;
grant  execute  on function public.get_space_by_share_token(uuid) to authenticated;
grant  execute  on function public.get_space_by_share_token(uuid) to service_role;

commit;
