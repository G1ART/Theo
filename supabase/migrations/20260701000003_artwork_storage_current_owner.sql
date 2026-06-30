-- Phase 2 — 온보딩/연결 후 이미지 관리 권한 (스토리지 바이트).
--
-- 문제: 외부 작가가 온보딩(또는 소유자 연결)하면 artworks.artist_id 는 작가
-- 본인으로 바뀌지만, 이미지 바이트는 여전히 업로더(갤러리)의 스토리지 폴더
-- 아래에 남는다. 현재 can_manage_artworks_storage_path 는 "폴더 owner =
-- caller" 또는 위임 관계만 허용하므로, 새 작가는 자기 작품의 이미지를
-- 교체/삭제할 수 없다. (artwork_images ROW 정책은 이미 artist_id 기반이라 OK,
-- 빠진 건 storage.objects 바이트 권한뿐이다.)
--
-- 해결: Shape 5 추가 — 이 storage_path 를 참조하는 artwork_images 가 있고
-- 그 작품의 현재 artist_id 가 caller 이면 허용. 폴더 위치와 무관.
-- additive: 기존 Shape 1~4 / exhibition-media 분기는 그대로.

begin;

-- storage_path 조회를 빠르게(정책이 매 스토리지 op 마다 평가).
create index if not exists idx_artwork_images_storage_path
  on public.artwork_images (storage_path);

create or replace function public.can_manage_artworks_storage_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $c$
declare
  v_parts text[];
  v_exhibition_id uuid;
  v_folder_owner uuid;
begin
  if auth.uid() is null or p_name is null then
    return false;
  end if;

  v_parts := storage.foldername(p_name);
  if array_length(v_parts, 1) is null then
    return false;
  end if;

  -- a) owner folder
  if v_parts[1] = auth.uid()::text then
    return true;
  end if;

  begin
    v_folder_owner := v_parts[1]::uuid;
  exception when others then
    v_folder_owner := null;
  end;

  if v_folder_owner is not null then
    -- Shape 1 (account-scope, into principal folder)
    if exists (
      select 1 from public.delegations d
       where d.delegator_profile_id = v_folder_owner
         and d.delegate_profile_id  = auth.uid()
         and d.scope_type           = 'account'
         and d.status               = 'active'
    ) then
      return true;
    end if;

    -- Shape 2 (mutual cleanup)
    if exists (
      select 1 from public.delegations d
       where d.delegator_profile_id = auth.uid()
         and d.delegate_profile_id  = v_folder_owner
         and d.scope_type           = 'account'
         and d.status               = 'active'
    ) then
      return true;
    end if;

    -- Shape 3 (peer cleanup)
    if exists (
      select 1
        from public.delegations d_owner
        join public.delegations d_caller
          on d_owner.delegator_profile_id = d_caller.delegator_profile_id
       where d_owner.delegate_profile_id  = v_folder_owner
         and d_owner.scope_type           = 'account'
         and d_owner.status               = 'active'
         and d_caller.delegate_profile_id = auth.uid()
         and d_caller.scope_type          = 'account'
         and d_caller.status              = 'active'
    ) then
      return true;
    end if;

    -- Shape 4 (project-scope, into principal folder)
    if public.is_active_project_delegate_works_writer(v_folder_owner) then
      return true;
    end if;
  end if;

  -- Shape 5 (current artwork owner) — QA 2026-07-01: after onboarding/link,
  -- artworks.artist_id flips to the artist but the bytes may still live under
  -- the original uploader's folder. Let the work's CURRENT artist manage the
  -- bytes that belong to one of their own works, regardless of folder.
  if exists (
    select 1
      from public.artwork_images ai
      join public.artworks a on a.id = ai.artwork_id
     where ai.storage_path = p_name
       and a.artist_id = auth.uid()
  ) then
    return true;
  end if;

  -- b) exhibition-media/{uuid}/...  (curator/host or project delegate)
  if v_parts[1] = 'exhibition-media' and array_length(v_parts, 1) >= 2 then
    begin
      v_exhibition_id := v_parts[2]::uuid;
    exception when others then
      return false;
    end;

    return exists (
      select 1 from public.projects p
       where p.id = v_exhibition_id
         and (p.curator_id = auth.uid() or p.host_profile_id = auth.uid())
    )
    or exists (
      select 1 from public.delegations d
       where d.project_id          = v_exhibition_id
         and d.delegate_profile_id = auth.uid()
         and d.scope_type          = 'project'
         and d.status              = 'active'
         and ('edit_metadata' = any(d.permissions)
              or 'manage_works' = any(d.permissions))
    );
  end if;

  return false;
end;
$c$;

grant execute on function public.can_manage_artworks_storage_path(text)
  to anon, authenticated, service_role;

commit;
