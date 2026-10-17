-- New operations (studio manager) delegations must include public
-- profile editing. create_delegation_invite expands the preset through
-- delegation_preset_permissions, which still omitted
-- edit_profile_public_content. The client preset list already has it.
-- Existing active rows were backfilled in 20261017140000.
--
-- Safe to re-run. Dollar tag is letters only.

create or replace function public.delegation_preset_permissions(
  p public.delegation_preset_type
) returns text[]
language sql
immutable
set search_path = public
as $presetperm$
  select case p
    when 'operations' then array[
      'view',
      'edit_metadata',
      'manage_works',
      'manage_artworks',
      'manage_exhibitions',
      'manage_inquiries',
      'manage_claims',
      'edit_profile_public_content'
    ]
    when 'content' then array[
      'view',
      'edit_metadata',
      'manage_works',
      'manage_artworks',
      'manage_exhibitions',
      'edit_profile_public_content'
    ]
    when 'review' then array['view']
    when 'project_co_edit' then array[
      'view',
      'edit_metadata',
      'manage_works'
    ]
    when 'project_works_only' then array[
      'view',
      'manage_works'
    ]
    when 'project_review' then array['view']
  end;
$presetperm$;

grant execute on function public.delegation_preset_permissions(public.delegation_preset_type)
  to authenticated, anon;
