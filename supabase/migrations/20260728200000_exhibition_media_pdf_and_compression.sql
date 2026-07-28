-- 2026-07-28 (QA) — 전시 미디어 업로드 갭 해소
--
-- QA 리포트 요약: "전시 탭에서 installation/포스터 업로드시 pdf, jpg
-- 업로드가 안됩니다. (draft 생성시까지 오래걸림, 이후 최종업로드가 안됨)"
--
-- 원인:
--   (a) PDF: exhibition_media 스키마와 UI 어디에도 PDF 배관이 없어서
--       'accept="image/*"' 로 브라우저가 필터링. 기능 자체 부재.
--   (b) JPG: uploadExhibitionMedia 가 자동 압축을 안 거쳐서 큰 사진이
--       50 MiB 서버 벽에 걸리거나 침묵 실패.
--
-- 이 마이그레이션은 스키마 side 에서 (a) + (b) 를 준비한다:
--   * `media_kind text` — 'image' | 'pdf'. 렌더링에서 아이콘 vs 이미지
--     썸네일 갈림길. default 'image' 로 legacy row 무영향.
--   * artwork_images 와 동일한 4개 컬럼 — 자동 압축 파이프라인 재사용:
--       - original_storage_path — 원본 백업 경로 (nullable)
--       - display_bytes / original_bytes — 관측용
--       - compression_meta jsonb — 알고리즘 파라미터
--
-- 모두 additive nullable. Storage RLS 는 이미 exhibition-media/{uuid}/
-- 경로를 커버하고 있어 새 policy 필요 없음. 원본 백업 경로는
-- `exhibition-media/{exhibition_id}/original/{uuid}-<name>` 를 쓸 예정.

begin;

alter table public.exhibition_media
  add column if not exists media_kind            text not null default 'image',
  add column if not exists original_storage_path text,
  add column if not exists display_bytes         bigint,
  add column if not exists original_bytes        bigint,
  add column if not exists compression_meta      jsonb;

-- Guard rails: 알려진 kind 만 허용. 나중에 video 등 추가 시 여기 확장.
alter table public.exhibition_media
  drop constraint if exists exhibition_media_media_kind_check;

alter table public.exhibition_media
  add constraint exhibition_media_media_kind_check
  check (media_kind in ('image', 'pdf'));

comment on column public.exhibition_media.media_kind is
  'Attachment kind. "image" (default) renders as a thumbnail via Supabase Storage Image Transform; "pdf" renders as an icon card with an "Open" link. Extend the check constraint before introducing new kinds.';

comment on column public.exhibition_media.original_storage_path is
  'Storage path of the untouched original when auto-compression ran (image only). Path pattern: "exhibition-media/{exhibition_id}/original/{uuid}-<name>". NULL when compression was skipped (PDF or unsupported source format).';

comment on column public.exhibition_media.display_bytes is
  'Size in bytes of the file at storage_path (post-compression for images, raw for pdf).';

comment on column public.exhibition_media.original_bytes is
  'Size in bytes of the untouched original before compression.';

comment on column public.exhibition_media.compression_meta is
  'jsonb: same shape as artwork_images.compression_meta. NULL when compression was skipped.';

commit;
