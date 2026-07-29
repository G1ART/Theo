-- Orphan cover_image_paths cleanup + prevention (2026-07-29 hotfix)
--
-- 증상: 전시 상세 페이지(`/e/[id]`)가 "대표 썸네일" 자리에 깨진 이미지
-- 타일을 보여줌. 원인: `/my/exhibitions/[id]`의 "대표 썸네일" 피커
-- (`toggleCoverPath` → `saveCoverDraft` → `updateExhibition`)가
-- `exhibition_media.storage_path` (또는 `artwork_images.storage_path`)
-- 값을 `projects.cover_image_paths` 에 그대로 저장하는데, 이후 해당
-- `exhibition_media` 행(또는 `artwork_images` 행)이 삭제돼도
-- `cover_image_paths` 의 참조는 정리되지 않아 ghost 참조로 남는다.
-- 실제 프로덕션에서 확인된 사례: project id
-- 9eb67d7a-328e-415c-a04d-ffc904963001 ("남겨진 흔적")의
-- `cover_image_paths[0]` 이 `exhibition_media` 에도, `storage.objects`
-- (버킷 `artworks`) 에도 대응 행이 없는 경로를 계속 참조 중.
--
-- 구성 (3개 섹션):
--   1) 백필/일괄 정리 — 현재 모든 project 의 `cover_image_paths` 에서
--      `storage.objects` (버킷 `artworks`) 에 존재하지 않는 경로를
--      제거한다. URL 빌더(`getArtworkImageUrl`)가 실제로 렌더링을
--      시도하는 대상과 정확히 같은 기준(storage.objects 존재 여부)을
--      사용한다.
--   2) 트리거 — `exhibition_media` DELETE 이후, 삭제된 행의
--      `storage_path` 를 해당 전시(project)의 `cover_image_paths` 에서
--      제거한다. (이번 버그의 주 트리거 케이스.)
--   3) 트리거 — `artwork_images` DELETE 이후, 삭제된 행의
--      `storage_path` 를 그 작품이 포함된 모든 전시의
--      `cover_image_paths` 에서 제거한다. (작품이 전시에서 빠지거나
--      이미지가 교체될 때 같은 유형의 ghost 참조가 생기는 것을 방지.)
--
-- 적용 방법 (Supabase Dashboard SQL Editor):
-- `.cursor/rules/release-workflow.mdc` 규칙에 따라 섹션을 한 번에
-- 붙여넣지 말고, `== SECTION N ==` 배너 단위로 하나씩 하이라이트 →
-- Run → 성공 확인 후 다음 섹션으로 진행한다. 각 섹션은 독립적으로
-- idempotent 하다 (다시 실행해도 안전).
--
-- 참고: `projects` 테이블에는 이미 모든 UPDATE 에 `updated_at = now()`
-- 를 세팅하는 `trg_projects_updated_at` (BEFORE UPDATE) 트리거가 있다
-- (20260701000001 마이그레이션). 그래서 아래 SECTION 1/2/3 의 UPDATE
-- 문들은 `updated_at` 을 별도로 세팅하지 않는다 — 이미 트리거가 처리함.

-- ===========================================================================
-- == SECTION 1 == 백필: cover_image_paths 에서 orphan 경로 제거
-- ===========================================================================
-- 기준: storage.objects (bucket_id = 'artworks') 에 name 이 존재하지
-- 않는 경로는 orphan 으로 간주하고 배열에서 제거한다. 이 기준 하나만
-- 사용하는 이유: `getArtworkImageUrl` 이 실제로 렌더링을 시도하는
-- 대상과 정확히 일치하기 때문 (exhibition_media / artwork_images 중
-- 무엇에서 유래했는지와 무관하게, 스토리지 파일이 없으면 깨진다).
do $backfill$
declare
  v_orphan_projects_before int;
  v_orphan_entries_before  int;
  v_orphan_projects_after  int;
begin
  select count(*) into v_orphan_projects_before
  from public.projects p
  where p.cover_image_paths is not null
    and array_length(p.cover_image_paths, 1) is not null
    and exists (
      select 1 from unnest(p.cover_image_paths) as pth
      where not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'artworks' and o.name = pth
      )
    );

  select count(*) into v_orphan_entries_before
  from public.projects p, unnest(p.cover_image_paths) as pth
  where p.cover_image_paths is not null
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'artworks' and o.name = pth
    );

  raise notice 'projects.cover_image_paths cleanup — BEFORE: % project(s) with at least one orphan path, % orphan path entr(y/ies) total',
    v_orphan_projects_before, v_orphan_entries_before;

  update public.projects p
  set cover_image_paths = coalesce(
    (
      select array_agg(x.pth order by x.ord)
      from unnest(p.cover_image_paths) with ordinality as x(pth, ord)
      where exists (
        select 1 from storage.objects o
        where o.bucket_id = 'artworks' and o.name = x.pth
      )
    ),
    array[]::text[]
  )
  where p.cover_image_paths is not null
    and array_length(p.cover_image_paths, 1) is not null
    and exists (
      select 1 from unnest(p.cover_image_paths) as pth
      where not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'artworks' and o.name = pth
      )
    );

  select count(*) into v_orphan_projects_after
  from public.projects p
  where p.cover_image_paths is not null
    and array_length(p.cover_image_paths, 1) is not null
    and exists (
      select 1 from unnest(p.cover_image_paths) as pth
      where not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'artworks' and o.name = pth
      )
    );

  raise notice 'projects.cover_image_paths cleanup — AFTER: % project(s) still with an orphan path (expected 0)',
    v_orphan_projects_after;
end;
$backfill$;

-- ===========================================================================
-- == SECTION 2 == 트리거: exhibition_media 삭제 시 cover_image_paths 정리
-- ===========================================================================
-- `/my/exhibitions/[id]` 의 handleDeleteMedia 가 exhibition_media 행을
-- 지울 때마다 자동으로 실행된다. 이게 이번 버그(2026-07-29, 상세 페이지
-- 포스터 타일 깨짐)의 주 트리거 케이스이므로, 클라이언트 코드가 놓치는
-- 경로가 있어도 DB 레벨에서 항상 정리되도록 방어한다.
create or replace function public.prune_project_cover_on_media_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $prune$
begin
  if OLD.storage_path is null then
    return OLD;
  end if;

  update public.projects
     set cover_image_paths = array_remove(cover_image_paths, OLD.storage_path)
   where id = OLD.exhibition_id
     and cover_image_paths is not null
     and OLD.storage_path = any(cover_image_paths);

  return OLD;
end;
$prune$;

drop trigger if exists exhibition_media_prune_project_cover on public.exhibition_media;
create trigger exhibition_media_prune_project_cover
  after delete on public.exhibition_media
  for each row execute function public.prune_project_cover_on_media_delete();

-- ===========================================================================
-- == SECTION 3 == 트리거: artwork_images 삭제 시 cover_image_paths 정리
-- ===========================================================================
-- 대표 썸네일 피커는 exhibition_media.storage_path 뿐 아니라
-- artwork_images.storage_path 도 cover_image_paths 에 쓸 수 있다
-- (coverCandidates = fromWorks ++ fromMedia, 파일:
-- src/app/my/exhibitions/[id]/page.tsx). 작품이 전시에서 빠지거나
-- 이미지가 교체되어 artwork_images 행이 삭제되면 같은 유형의 ghost
-- 참조가 생길 수 있어 방어적으로 동일 패턴을 적용한다. 하나의 작품
-- 이미지가 여러 전시에 걸쳐 커버로 선택될 수 있으므로, 그 작품이
-- 포함된(exhibition_works 를 통해 연결된) 모든 전시를 갱신한다.
-- exhibition_works 의 작품 FK 컬럼명은 `work_id` (artwork_id 아님) —
-- p0_exhibition_works.sql 참고.
create or replace function public.prune_project_cover_on_artwork_image_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $pruneimg$
begin
  if OLD.storage_path is null then
    return OLD;
  end if;

  update public.projects p
     set cover_image_paths = array_remove(p.cover_image_paths, OLD.storage_path)
   where p.cover_image_paths is not null
     and OLD.storage_path = any(p.cover_image_paths)
     and exists (
       select 1 from public.exhibition_works ew
       where ew.exhibition_id = p.id
         and ew.work_id = OLD.artwork_id
     );

  return OLD;
end;
$pruneimg$;

drop trigger if exists artwork_images_prune_project_cover on public.artwork_images;
create trigger artwork_images_prune_project_cover
  after delete on public.artwork_images
  for each row execute function public.prune_project_cover_on_artwork_image_delete();
