-- 2026-07-28 — 업로드 자동 압축을 위한 artwork_images 확장 (additive)
--
-- 배경
-- ----
-- 지금까지는 클라이언트가 원본 파일을 그대로 Supabase Storage 에
-- 올렸다. 이 때문에 50 MiB (config.toml 서버 상한) 을 넘는 큰 스캔/
-- 카메라 원본은 아예 업로드가 불가능하고, 통과하는 경우에도 스토리지
-- 비용과 업로드 시간이 크다.
--
-- 이 스키마는 다음 구조를 지원한다:
--   * `storage_path` — 표시용 이미지 (자동 압축된 WebP, 4K 롱엣지, q88).
--     기존 코드베이스 전체가 이 컬럼만 읽으므로 무영향.
--   * `original_storage_path` — 원본 파일. 정책상 별도 slot 에 보관해
--     아티스트가 나중에 원본 다운로드/재편집 가능. Storage RLS 정책
--     (`can_manage_artworks_storage_path`) 는 이미 `{userId}/...` 를
--     허용하므로 `{userId}/original/{uuid}-{name}` 도 자동으로 커버됨.
--   * `display_bytes` / `original_bytes` — 관측/디버깅 용. UI chip 도
--     이 값을 쓴다 ("원본 47MB → 압축 4MB").
--   * `compression_meta` jsonb — 어떤 알고리즘/파라미터/decode 소스로
--     찍혔는지 기록. 나중에 알고리즘 튜닝 시 A/B 비교 근거.
--
-- 모두 nullable. 옛 행은 자연스럽게 NULL 로 남고, 새 업로드부터 채워짐.
-- 인덱스는 필요 없음 (표시 쿼리는 전부 `storage_path` 만 씀).

begin;

alter table public.artwork_images
  add column if not exists original_storage_path text,
  add column if not exists display_bytes         bigint,
  add column if not exists original_bytes        bigint,
  add column if not exists compression_meta      jsonb;

comment on column public.artwork_images.original_storage_path is
  'Storage path of the untouched user-uploaded file (kept for artist download / re-edit). NULL for legacy rows that predate auto-compression, and for uploads where compression was skipped (HEIC / animated GIF / decode failure).';

comment on column public.artwork_images.display_bytes is
  'Size in bytes of the file at storage_path (after compression). NULL for legacy rows.';

comment on column public.artwork_images.original_bytes is
  'Size in bytes of the untouched original before compression. NULL for legacy rows.';

comment on column public.artwork_images.compression_meta is
  'jsonb: { algo, quality, longEdge, sourceMime, sourceWidth, sourceHeight, outWidth, outHeight, iterations }. NULL when compression was skipped.';

commit;
