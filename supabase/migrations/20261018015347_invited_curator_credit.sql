-- 2026-10-17 — Invited curator: once the invite email is verified, the
-- exhibition's curator credit is that account.
--
-- projects.external_curator_id points at the curator's invite
-- (external_artists). The verified-email merge
-- (link_matching_external_artists_for_user: same trigger points and the
-- same email_confirmed_at rule as artist invites) sets that invite's
-- claimed_profile_id, and the credit follows the invite to the account.
-- projects.curator_id stays the creating account, so its rights on the
-- exhibition (edit, works, media, delete, downloads) do not change and no
-- host credit is made up. The curator account gets the credit and its
-- profile lists the show; editing stays with the creating account.
--
--   * Section 1: visitors, signed in or not, can read the invite an
--     exhibition they can see points at. Column grants still hide
--     invite_email. Before, only the inviter could read it, so visitors saw
--     the creating account as curator.
--   * Section 2: anon / authenticated may set external_curator_id only to
--     an invite no account has taken yet, or clear it. A taken invite
--     would credit an account that never accepted this exhibition.
--
-- Existing rows are not changed (no exhibition uses the column today).
-- Two functions: in the SQL Editor run one section at a time. Dollar tags
-- are letters only.

-- == SECTION 1 == visitors read the invited curator of a visible exhibition
drop policy if exists external_artists_select_invited_curator on public.external_artists;
create policy external_artists_select_invited_curator
  on public.external_artists
  for select
  to public
  using (
    exists (
      select 1
        from public.projects p
       where p.external_curator_id = external_artists.id
    )
  );

-- == SECTION 2 == external_curator_id points only at an invite nobody has taken
create or replace function public.external_artist_invite_is_taken(p_external_artist_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $a$
  select exists (
    select 1
      from public.external_artists ea
     where ea.id = p_external_artist_id
       and ea.claimed_profile_id is not null
  );
$a$;

revoke all on function public.external_artist_invite_is_taken(uuid) from public;
grant execute on function public.external_artist_invite_is_taken(uuid) to anon, authenticated;

create or replace function public.projects_guard_external_curator()
returns trigger
language plpgsql
set search_path = public
as $b$
begin
  if current_user in ('anon', 'authenticated')
     and new.external_curator_id is not null
     and (tg_op = 'INSERT' or new.external_curator_id is distinct from old.external_curator_id)
     and public.external_artist_invite_is_taken(new.external_curator_id) then
    raise exception 'projects.external_curator_id must point at an invite no account has taken yet'
      using errcode = '42501';
  end if;
  return new;
end;
$b$;

revoke all on function public.projects_guard_external_curator() from public, anon, authenticated;

drop trigger if exists trg_projects_guard_external_curator on public.projects;
create trigger trg_projects_guard_external_curator
  before insert or update of external_curator_id on public.projects
  for each row execute function public.projects_guard_external_curator();

notify pgrst, 'reload schema';
