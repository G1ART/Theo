-- Artist recommendations share one authorship rule with isOwnArtistWork.
-- A profile is not the artist of a work when their only confirmed
-- relationship is a lister claim (curated, inventory, exhibited, owns, host).
-- main_role / roles remain the artist persona. This does not rewrite rows.

-- == SECTION 1 == authorship predicate
create or replace function public.work_is_profile_authorship(
  p_profile_id uuid,
  p_work_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $auth$
  select
    p_profile_id is not null
    and p_work_id is not null
    and not exists (
      select 1
      from public.claims c
      where c.work_id = p_work_id
        and c.status = 'confirmed'
        and c.subject_profile_id = p_profile_id
        and c.claim_type in (
          'CURATED', 'INVENTORY', 'EXHIBITED', 'OWNS', 'HOSTS_PROJECT', 'INCLUDES_WORK'
        )
        and not exists (
          select 1
          from public.claims created
          where created.work_id = p_work_id
            and created.status = 'confirmed'
            and created.claim_type = 'CREATED'
            and (
              created.subject_profile_id = p_profile_id
              or created.artist_profile_id = p_profile_id
            )
        )
    );
$auth$;

grant execute on function public.work_is_profile_authorship(uuid, uuid) to anon, authenticated;
