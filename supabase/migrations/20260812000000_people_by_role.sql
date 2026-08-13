-- People-by-role RPC — 2026-08-12
--
-- Powers the new `RoleDiscoveryPanel` on `/my/network` overview and the
-- URL-driven "Browse by role" surface (`/my/network?tab=discover&role=…`).
--
-- Given a target role (artist / collector / curator / gallerist) and the
-- viewer's uid (implicit via `auth.uid()`), returns candidate profiles in
-- the same JSONB shape that `get_people_recs` emits — so the client can
-- render them through the shared `SuggestionCard`.
--
-- Ranking (composite, higher wins):
--   1. Persona pairing boost — viewer's `main_role` × target_role
--      → +1.0 for the "natural" pairs (see PAIRING_BOOSTS table below),
--        +0.5 for the "adjacent" pairs, 0.0 otherwise.
--   2. Mutual accepted-follow count (through the viewer's follow graph).
--   3. Freshness — `last_active_at` within 30 days → +0.25.
--   4. Fallback tiebreak — `created_at` DESC → profile id DESC.
--
-- Only public profiles are surfaced; the viewer, existing follows, and
-- snoozed / blocked people (public.people_dismissals) are filtered out.
-- Guests (no auth.uid) can still call this — pairing / mutuals collapse
-- to 0 and freshness / created_at do the ranking.
--
-- ===========================================================================
--  HOW TO APPLY (Supabase Dashboard SQL editor)
-- ===========================================================================
-- Single PL/pgSQL function, small body. Safe to paste the whole file at
-- once. Uses letters-only dollar tag (`$body$`) per release-workflow rule.
-- Idempotent (create-or-replace) — re-runnable.
-- ===========================================================================

begin;

create or replace function public.get_people_by_role(
  p_target_role text,
  p_limit int default 6,
  p_offset int default 0
)
returns setof jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $body$
declare
  v_uid uuid := auth.uid();
  v_role text := lower(coalesce(trim(p_target_role), ''));
  v_limit int := least(greatest(coalesce(p_limit, 6), 1), 60);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_viewer_role text := null;
  v_active_threshold timestamptz := now() - interval '30 days';
begin
  -- Validate the target role. Anything unknown → empty set (silent-safe
  -- so the client doesn't error on a stray query param).
  if v_role not in ('artist', 'collector', 'curator', 'gallerist') then
    return;
  end if;

  -- Pull viewer's primary role once so the pairing boost is O(1).
  if v_uid is not null then
    v_viewer_role := (
      select lower(coalesce(nullif(trim(p.main_role::text), ''), ''))
        from public.profiles p
       where p.id = v_uid
    );
    if v_viewer_role = '' then v_viewer_role := null; end if;
  end if;

  return query
  with candidates as (
    select p.id,
           p.username,
           p.display_name,
           p.avatar_url,
           p.bio,
           p.main_role,
           p.roles,
           p.is_public,
           p.last_active_at,
           p.created_at
      from public.profiles p
     where p.is_public = true
       and public.is_presentable_profile(p.display_name, p.username)
       and (
         lower(coalesce(p.main_role::text, '')) = v_role
         or v_role = any(coalesce(p.roles, '{}'::text[]))
       )
       and (v_uid is null or p.id != v_uid)
       and (
         v_uid is null
         or not exists (
           select 1 from public.follows f
            where f.follower_id = v_uid
              and f.following_id = p.id
              and f.status = 'accepted'
         )
       )
       and (
         v_uid is null
         or not exists (
           select 1 from public.people_dismissals d
            where d.user_id = v_uid
              and d.target_id = p.id
              and (d.expires_at is null or d.expires_at > now())
         )
       )
  ),
  mutuals as (
    -- Count how many of the viewer's accepted follows also follow the
    -- candidate. Skipped entirely for guests.
    select f2.following_id as candidate_id,
           count(distinct f2.follower_id)::int as mutual_sources
      from public.follows f1
      join public.follows f2 on f2.follower_id = f1.following_id
     where v_uid is not null
       and f1.follower_id = v_uid
       and f1.status = 'accepted'
       and f2.status = 'accepted'
     group by f2.following_id
  ),
  scored as (
    select c.*,
           coalesce(m.mutual_sources, 0) as mutual_sources,
           -- Persona pairing boost (CASE table).
           case
             when v_viewer_role is null then 0.0
             when v_viewer_role = 'collector' and v_role = 'artist'    then 1.0
             when v_viewer_role = 'collector' and v_role = 'gallerist' then 0.5
             when v_viewer_role = 'artist'    and v_role = 'curator'   then 1.0
             when v_viewer_role = 'artist'    and v_role = 'gallerist' then 1.0
             when v_viewer_role = 'artist'    and v_role = 'collector' then 0.5
             when v_viewer_role = 'curator'   and v_role = 'artist'    then 1.0
             when v_viewer_role = 'curator'   and v_role = 'gallerist' then 0.5
             when v_viewer_role = 'gallerist' and v_role = 'artist'    then 1.0
             when v_viewer_role = 'gallerist' and v_role = 'curator'   then 0.5
             else 0.0
           end as pair_boost,
           case
             when c.last_active_at is not null
              and c.last_active_at > v_active_threshold then 0.25
             else 0.0
           end as fresh_boost
      from candidates c
      left join mutuals m on m.candidate_id = c.id
  ),
  ranked as (
    select s.*,
           (s.pair_boost
            + (s.mutual_sources::numeric * 0.1)
            + s.fresh_boost) as rank_score
      from scored s
     order by rank_score desc,
              s.mutual_sources desc,
              s.last_active_at desc nulls last,
              s.created_at desc,
              s.id desc
     limit v_limit
     offset v_offset
  )
  select jsonb_build_object(
    'id', r.id,
    'username', r.username,
    'display_name', r.display_name,
    'avatar_url', r.avatar_url,
    'bio', r.bio,
    'main_role', r.main_role,
    'roles', r.roles,
    'is_public', r.is_public,
    'reason_tags', to_jsonb(array['role_match', r.rank_score::text]),
    'reason_detail', jsonb_build_object(
      'target_role', v_role,
      'viewer_role', v_viewer_role,
      'pair_boost', r.pair_boost,
      'fresh_boost', r.fresh_boost,
      'rank_score', r.rank_score
    ),
    'mutual_follow_sources', r.mutual_sources,
    'liked_artists_count', 0,
    'mutual_avatars', '[]'::jsonb,
    'signal_count', r.mutual_sources,
    'top_signal', case
      when r.pair_boost > 0 then 'role_pair'
      when r.mutual_sources > 0 then 'follow_graph'
      else 'role_match'
    end,
    'is_recently_active', (
      r.last_active_at is not null and r.last_active_at > (now() - interval '14 days')
    )
  )
    from ranked r;
end;
$body$;

-- Grant to both authenticated and anon. `profiles` SELECT is already
-- open to public via `profiles_read_public_or_self` (SELECT on
-- is_public=true), so exposing role-filtered discovery to anon does not
-- weaken RLS. The RPC still filters by `is_public = true` internally.
grant execute on function public.get_people_by_role(text, int, int) to authenticated;
grant execute on function public.get_people_by_role(text, int, int) to anon;

commit;
