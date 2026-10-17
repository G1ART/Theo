-- People search merges search_artists_by_artwork (people found through a
-- work's title, medium, or story) with search_people. Cards render the
-- name with formatIdentityPair(row, t, locale), which needs
-- display_name_ko / display_name_en. search_people returns both; this
-- function returned only the legacy display_name (KO first), so a person
-- found only through a work showed the Korean name on the English UI.
--
-- Matching, order, limit, and grants are unchanged. Section 5 of
-- 20261007160000 (not applied) returns the same keys and widens matching.
--
-- Safe to re-run. Dollar tag is letters only.

create or replace function public.search_artists_by_artwork(
  p_q text,
  p_roles text[] default '{}',
  p_limit int default 20
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public
as $artists$
declare
  v_q text := coalesce(trim(p_q), '');
  v_pattern text;
  v_roles text[] := coalesce(p_roles, '{}');
begin
  if v_q = '' then
    return;
  end if;
  v_pattern := '%' || v_q || '%';

  return query
  select jsonb_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name,
    'display_name_ko', p.display_name_ko, 'display_name_en', p.display_name_en,
    'avatar_url', p.avatar_url, 'bio', p.bio, 'main_role', p.main_role,
    'roles', p.roles, 'is_public', p.is_public, 'reason', 'artwork',
    'match_rank', 2
  )
  from profiles p
  where p.id in (
      select distinct a.artist_id
      from artworks a
      where a.artist_id is not null
        and a.visibility = 'public'
        and (
          a.title ilike v_pattern
          or a.medium ilike v_pattern
          or a.story ilike v_pattern
        )
    )
    and (array_length(v_roles, 1) is null or array_length(v_roles, 1) = 0
         or (p.main_role::text = any(v_roles))
         or (coalesce(p.roles, '{}'::text[]) && v_roles))
  order by p.id desc
  limit greatest(coalesce(p_limit, 20), 1);
end;
$artists$;

grant execute on function public.search_artists_by_artwork(text, text[], int)
  to anon, authenticated;
