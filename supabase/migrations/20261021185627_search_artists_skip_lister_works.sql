-- == SECTION 2 == search_artists_by_artwork ignores lister-only uploads
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
  v_q text := regexp_replace(coalesce(trim(p_q), ''), '^@+', '');
  v_pattern text;
  v_roles text[] := coalesce(p_roles, '{}');
begin
  if v_q = '' then
    return;
  end if;
  v_pattern := '%' || v_q || '%';

  return query
  with matched as (
    select a.artist_id, m.exact
    from artworks a
    cross join lateral (
      select coalesce(
        a.title ilike v_pattern
        or a.title_ko ilike v_pattern
        or a.title_en ilike v_pattern
        or a.medium ilike v_pattern
        or a.medium_ko ilike v_pattern
        or a.medium_en ilike v_pattern
        or a.story ilike v_pattern
        or a.story_ko ilike v_pattern
        or a.story_en ilike v_pattern,
        false
      ) as exact
    ) m
    where a.artist_id is not null
      and a.visibility = 'public'
      and public.work_is_profile_authorship(a.artist_id, a.id)
      and (
        m.exact
        or (
          char_length(v_q) >= 4 and (
            word_similarity(v_q, coalesce(a.title, '')) >= 0.5
            or word_similarity(v_q, coalesce(a.title_ko, '')) >= 0.5
            or word_similarity(v_q, coalesce(a.title_en, '')) >= 0.5
          )
        )
      )
  ),
  hits as (
    select matched.artist_id, bool_or(matched.exact) as exact
    from matched
    group by matched.artist_id
  )
  select jsonb_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name,
    'display_name_ko', p.display_name_ko, 'display_name_en', p.display_name_en,
    'avatar_url', p.avatar_url, 'bio', p.bio, 'main_role', p.main_role,
    'roles', p.roles, 'is_public', p.is_public, 'reason', 'artwork',
    'match_rank', 2
  )
  from profiles p
  join hits h on h.artist_id = p.id
  where (array_length(v_roles, 1) is null or array_length(v_roles, 1) = 0
         or (p.main_role::text = any(v_roles))
         or (coalesce(p.roles, '{}'::text[]) && v_roles))
  order by h.exact desc, p.id desc
  limit greatest(coalesce(p_limit, 20), 1);
end;
$artists$;

grant execute on function public.search_artists_by_artwork(text, text[], int)
  to anon, authenticated;
