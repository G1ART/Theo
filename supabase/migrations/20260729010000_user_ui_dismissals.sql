-- QA 2026-07-29 — user_ui_dismissals: 이중언어 채택 UX (Layer 2 배너, Layer 3
-- 컨텍스트 넛지) 등 "한 번 보고 나면 다시 조르지 않는" UI 조각들이 사용자별
-- 로 dismiss 상태를 저장할 수 있는 최소 스키마.
--
-- 설계 결정
-- ---------
-- * `dismissal_key` 는 자유 문자열이지만 도메인 프리픽스 규칙을 따른다
--   ("bilingual_discovery_banner_v1", "bilingual_contextual_nudge_profile_v1",
--    "bilingual_contextual_nudge_artwork_v1" 등). 새 dismissible surface 를
--   추가할 때 여기에 새 row 를 upsert 한다.
-- * `dismiss_count` 는 재노출 정책이 있는 배너("나중에" 스누즈 후 다시
--   등장, 3 회를 넘으면 영구 dismiss) 를 지탱한다. 컨텍스트 넛지처럼 세션
--   +30일 정책만 있는 경우엔 그냥 1 로 남는다.
-- * `snoozed_until` 이 미래 timestamp 이면 "아직 다시 보여주지 말 것".
--   snooze 없이 영구 dismiss 한 경우엔 NULL 로 남는다.
--
-- RLS
-- ---
--   * 사용자는 자기 dismissal 만 읽고 쓸 수 있다. cross-user 조회/변경 불가.
--   * service role 은 정책을 우회하므로 백엔드 스크립트도 필요 시 접근 가능.

begin;

create table if not exists public.user_ui_dismissals (
  user_id uuid not null references auth.users(id) on delete cascade,
  dismissal_key text not null,
  dismissed_at timestamptz not null default now(),
  snoozed_until timestamptz,
  dismiss_count int not null default 1,
  primary key (user_id, dismissal_key)
);

comment on table public.user_ui_dismissals is
  'QA 2026-07-29 — per-user UI dismissal state. Layer 2 discovery banner + Layer 3 contextual nudges (bilingual adoption UX) live here. dismissal_key 는 free-form 이지만 도메인 프리픽스 규칙을 따른다.';
comment on column public.user_ui_dismissals.snoozed_until is
  'null → 영구 dismiss. 미래 timestamp → 그 시점까지는 다시 보여주지 않음. 과거 timestamp → 다시 노출 가능 (dismiss_count 는 유지).';
comment on column public.user_ui_dismissals.dismiss_count is
  '재노출 정책이 있는 배너의 누적 dismiss 횟수. 컨텍스트 넛지처럼 한 번 dismiss = 영구인 경우엔 1 로 남는다.';

create index if not exists user_ui_dismissals_user_key_idx
  on public.user_ui_dismissals (user_id, dismissal_key);

alter table public.user_ui_dismissals enable row level security;

-- Idempotent policy install — DROP-then-CREATE so re-runs don't ERROR.
drop policy if exists "user_ui_dismissals owner" on public.user_ui_dismissals;
create policy "user_ui_dismissals owner" on public.user_ui_dismissals
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- RPC: record a dismissal. Upserts the row, increments dismiss_count, and
-- optionally sets snoozed_until = now() + snooze_days. Returns the resulting
-- row so the client can read the new count without a follow-up SELECT.
--
-- SECURITY DEFINER intentionally not used — we WANT auth.uid() to be the
-- caller so RLS applies. Function is invocable by authenticated only.
create or replace function public.record_ui_dismissal(
  p_key text,
  p_snooze_days int default null
) returns public.user_ui_dismissals
language plpgsql
security invoker
set search_path = public
as $recorddismissal$
declare
  v_uid uuid := auth.uid();
  v_row public.user_ui_dismissals;
  v_snoozed_until timestamptz := null;
begin
  if v_uid is null then
    raise exception 'record_ui_dismissal requires an authenticated session';
  end if;
  if p_key is null or length(trim(p_key)) = 0 then
    raise exception 'record_ui_dismissal: p_key must be non-empty';
  end if;
  if p_snooze_days is not null and p_snooze_days > 0 then
    v_snoozed_until := now() + (p_snooze_days || ' days')::interval;
  end if;

  insert into public.user_ui_dismissals (
    user_id, dismissal_key, dismissed_at, snoozed_until, dismiss_count
  ) values (
    v_uid, p_key, now(), v_snoozed_until, 1
  )
  on conflict (user_id, dismissal_key) do update set
    dismissed_at = now(),
    snoozed_until = v_snoozed_until,
    dismiss_count = public.user_ui_dismissals.dismiss_count + 1
  returning * into v_row;

  return v_row;
end;
$recorddismissal$;

revoke all on function public.record_ui_dismissal(text, int) from public;
grant execute on function public.record_ui_dismissal(text, int) to authenticated;

commit;
