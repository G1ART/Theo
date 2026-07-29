-- QA 2026-07-29 — 외부 작가(external_artists) "프로필 관심(profile interest)"
-- 알림 인프라. 이 마이그레이션은 가격 문의 이메일 인프라
-- (`20260729100000_external_artist_inquiry_email.sql`) 위에 쌓이는 형제
-- (sibling) 기능이다: 문의(inquiry)가 아니라 "누군가 이 작가의 프로필/작품을
-- 궁금해했다"는 훨씬 약한 신호를 모아, explicit(명시적 클릭) 은 즉시,
-- passive(그룹전 섹션 헤더를 본 것만으로 발생하는 수동 신호)는 7일 내
-- distinct viewer 3명 이상 누적됐을 때만 이메일로 알린다.
--
-- 원칙 (기존 마이그레이션들과 동일):
--   - additive only — 기존 호출자를 부수지 않는다.
--   - external_artists 컬럼 grant 는 절대 넓히지 않는다 (PII 는 SECURITY
--     DEFINER RPC 로만 노출).
--   - notify_on_inquiry_via_email / external_artist_inquiry_email_log 는
--     동시 작업 중인 다른 패치의 소유물 — 이 마이그레이션은 손대지 않는다.
--
-- release-workflow.mdc 규칙 — PL/pgSQL 함수 정의가 2개 이상이므로
-- SECTION 배너로 분리했다. Supabase SQL Editor 에 붙여넣을 때 전체를
-- 한 번에 실행하지 말고, `== SECTION N ==` 배너 단위로 하나씩 하이라이트
-- → Run. dollar tag 는 letters-only (`$record$`, `$unsub$`, `$getorcreate2$`,
-- `$createclaim2$`).
--
-- 이 파일은 `20260729100000_external_artist_inquiry_email.sql` 이 먼저
-- 적용되어 있음을 전제로 한다 (SECTION 6/7 은 그 파일의
-- `get_or_create_external_artist` / `create_external_artist_and_claim`
-- 5-arg / 14-arg 버전 위에 6번째 / 15번째 trailing default 파라미터를
-- 추가하는 `create or replace`).

begin;

-- ────────────────────────────────────────────────────────────────────
-- == SECTION 1 == external_artists: 프로필 관심 이메일 opt-in 컬럼
-- ────────────────────────────────────────────────────────────────────
alter table public.external_artists
  add column if not exists notify_on_profile_interest_via_email boolean not null default false,
  add column if not exists notify_profile_interest_consented_at timestamptz;

comment on column public.external_artists.notify_on_profile_interest_via_email is
  'True only when the inviter explicitly opted in at invite time to have Theo send profile-interest notifications (someone views/asks about this artist) to invite_email. Independent from notify_on_inquiry_via_email so gallery can grant fine-grained control.';
comment on column public.external_artists.notify_profile_interest_consented_at is
  'Timestamp when notify_on_profile_interest_via_email was flipped to true. Audit trail for consent.';

-- ────────────────────────────────────────────────────────────────────
-- == SECTION 2 == external_artist_profile_interest_events (관심 이벤트 로그)
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.external_artist_profile_interest_events (
  id uuid primary key default gen_random_uuid(),
  external_artist_id uuid not null references public.external_artists(id) on delete cascade,
  viewer_user_id uuid references auth.users(id) on delete set null,
  trigger_kind text not null check (trigger_kind in ('explicit', 'passive')),
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  aggregated_into_email_at timestamptz
);

comment on table public.external_artist_profile_interest_events is
  'QA 2026-07-29 — 뷰어가 미가입 작가에게 보인 관심 이벤트(명시적 클릭 또는 그룹전 섹션 헤더 노출로 인한 수동 신호). RLS 는 켜두되 정책 없음 — SECURITY DEFINER RPC 로만 접근.';

create index if not exists idx_eapie_ext on public.external_artist_profile_interest_events(external_artist_id, created_at desc);

-- passive 신호는 (artist, viewer) 당 주(week) 1회로 dedupe — 같은 뷰어가
-- 같은 섹션을 여러 번 봐도 카운트가 부풀지 않게 한다.
create unique index if not exists uq_eapie_passive_viewer_per_week
  on public.external_artist_profile_interest_events(external_artist_id, viewer_user_id, (date_trunc('week', created_at)))
  where trigger_kind = 'passive' and viewer_user_id is not null;

alter table public.external_artist_profile_interest_events enable row level security;
revoke all on public.external_artist_profile_interest_events from anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- == SECTION 3 == external_artist_profile_interest_email_log (발송 이력)
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.external_artist_profile_interest_email_log (
  id uuid primary key default gen_random_uuid(),
  external_artist_id uuid not null references public.external_artists(id) on delete cascade,
  sent_at timestamptz not null default now(),
  invite_email_at_send text not null,
  trigger_kind text not null check (trigger_kind in ('explicit', 'aggregated')),
  distinct_viewer_count int not null default 1,
  unsubscribe_token text not null unique,
  context jsonb not null default '{}'::jsonb
);

comment on table public.external_artist_profile_interest_email_log is
  'QA 2026-07-29 — 프로필 관심 opt-in 이메일 발송 이력. rate-limit(7일 1회) 근거 + 수신거부 토큰 저장. RLS 는 켜두되 정책 없음 — SECURITY DEFINER RPC 로만 접근.';

create index if not exists idx_eapiel_ext on public.external_artist_profile_interest_email_log(external_artist_id, sent_at desc);
alter table public.external_artist_profile_interest_email_log enable row level security;
revoke all on public.external_artist_profile_interest_email_log from anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- == SECTION 4 == record_external_artist_profile_interest_click
-- ────────────────────────────────────────────────────────────────────
--
-- 호출자(뷰어)의 인증 세션에서 호출. 이벤트를 기록하고, 가드를 모두
-- 통과하면 dispatch 페이로드를 반환 — 실제 SendGrid 발송은
-- `/api/artist-profile-interest-email` 라우트가 담당한다.
create or replace function public.record_external_artist_profile_interest_click(
  p_external_artist_id uuid,
  p_trigger_kind text,
  p_context jsonb default '{}'::jsonb
)
returns table (
  external_artist_id uuid,
  invite_email text,
  display_name text,
  trigger_kind_out text,
  distinct_viewer_count int,
  unsubscribe_token text
)
language plpgsql
security definer
set search_path = public
as $record$
declare
  v_uid uuid := auth.uid();
  v_ea record;
  v_recent_send_count int;
  v_distinct_count int;
  v_token uuid;
begin
  if v_uid is null then
    return;
  end if;
  if p_trigger_kind not in ('explicit', 'passive') then
    return;
  end if;

  begin
    insert into public.external_artist_profile_interest_events (
      external_artist_id, viewer_user_id, trigger_kind, context
    ) values (
      p_external_artist_id, v_uid, p_trigger_kind, coalesce(p_context, '{}'::jsonb)
    )
    on conflict (external_artist_id, viewer_user_id, (date_trunc('week', created_at)))
      where trigger_kind = 'passive' and viewer_user_id is not null
      do nothing;
  exception when others then
    -- Never let event logging block the caller's UX.
    null;
  end;

  select ea.* into v_ea
    from public.external_artists ea
   where ea.id = p_external_artist_id;

  if v_ea.id is null then
    return;
  end if;

  -- 이미 온보딩된 작가는 인앱 알림 경로가 있으므로 이메일 스킵.
  if v_ea.claimed_profile_id is not null then
    return;
  end if;
  if v_ea.notify_on_profile_interest_via_email is not true then
    return;
  end if;
  if nullif(trim(coalesce(v_ea.invite_email, '')), '') is null then
    return;
  end if;

  -- Rate limit: 최근 7일 내 이미 발송한 적이 있으면 스킵.
  select count(*) into v_recent_send_count
    from public.external_artist_profile_interest_email_log l
   where l.external_artist_id = p_external_artist_id
     and l.sent_at > now() - interval '7 days';
  if v_recent_send_count > 0 then
    return;
  end if;

  if p_trigger_kind = 'explicit' then
    v_token := gen_random_uuid();
    insert into public.external_artist_profile_interest_email_log (
      external_artist_id, invite_email_at_send, trigger_kind, distinct_viewer_count, unsubscribe_token, context
    ) values (
      p_external_artist_id, v_ea.invite_email, 'explicit', 1, v_token::text, coalesce(p_context, '{}'::jsonb)
    );

    external_artist_id := p_external_artist_id;
    invite_email := v_ea.invite_email;
    display_name := v_ea.display_name;
    trigger_kind_out := 'explicit';
    distinct_viewer_count := 1;
    unsubscribe_token := v_token::text;
    return next;
    return;
  end if;

  -- passive: aggregate — dispatch only once >= 3 distinct viewers have
  -- shown passive interest within the trailing 7 days and haven't already
  -- been folded into a previous aggregated send.
  select count(distinct e.viewer_user_id) into v_distinct_count
    from public.external_artist_profile_interest_events e
   where e.external_artist_id = p_external_artist_id
     and e.trigger_kind = 'passive'
     and e.viewer_user_id is not null
     and e.created_at > now() - interval '7 days'
     and e.aggregated_into_email_at is null;

  if v_distinct_count >= 3 then
    v_token := gen_random_uuid();
    insert into public.external_artist_profile_interest_email_log (
      external_artist_id, invite_email_at_send, trigger_kind, distinct_viewer_count, unsubscribe_token, context
    ) values (
      p_external_artist_id, v_ea.invite_email, 'aggregated', v_distinct_count, v_token::text, coalesce(p_context, '{}'::jsonb)
    );

    update public.external_artist_profile_interest_events e
       set aggregated_into_email_at = now()
     where e.external_artist_id = p_external_artist_id
       and e.trigger_kind = 'passive'
       and e.viewer_user_id is not null
       and e.created_at > now() - interval '7 days'
       and e.aggregated_into_email_at is null;

    external_artist_id := p_external_artist_id;
    invite_email := v_ea.invite_email;
    display_name := v_ea.display_name;
    trigger_kind_out := 'aggregated';
    distinct_viewer_count := v_distinct_count;
    unsubscribe_token := v_token::text;
    return next;
  end if;

  return;
end;
$record$;

revoke all on function public.record_external_artist_profile_interest_click(uuid, text, jsonb) from public;
grant execute on function public.record_external_artist_profile_interest_click(uuid, text, jsonb) to authenticated;

-- ────────────────────────────────────────────────────────────────────
-- == SECTION 5 == unsubscribe_external_artist_profile_interest_emails
-- ────────────────────────────────────────────────────────────────────
create or replace function public.unsubscribe_external_artist_profile_interest_emails(
  p_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $unsub$
declare
  v_ext_id uuid;
begin
  if p_token is null then
    return false;
  end if;

  select l.external_artist_id into v_ext_id
    from public.external_artist_profile_interest_email_log l
   where l.unsubscribe_token = p_token::text
   order by l.sent_at desc
   limit 1;

  if v_ext_id is null then
    return false;
  end if;

  update public.external_artists
     set notify_on_profile_interest_via_email = false
   where id = v_ext_id;

  return true;
end;
$unsub$;

revoke all on function public.unsubscribe_external_artist_profile_interest_emails(uuid) from public;
grant execute on function public.unsubscribe_external_artist_profile_interest_emails(uuid) to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- == SECTION 6 == get_or_create_external_artist: 6번째 trailing 파라미터
-- ────────────────────────────────────────────────────────────────────
--
-- `20260729100000` SECTION 5 가 만든 5-arg 버전 위에 6번째 trailing
-- default 파라미터 p_notify_on_profile_interest_via_email 을 추가한다.
-- 유일한 내부 호출자(create_external_artist_and_claim, SECTION 7)가
-- 항상 positional 6-arg 로 호출하므로 오버로드 충돌 없음. "only flip
-- true" 규칙은 두 opt-in 컬럼 모두에 독립적으로 적용된다.
create or replace function public.get_or_create_external_artist(
  p_display_name   text,
  p_invite_email   text default null,
  p_display_name_ko text default null,
  p_display_name_en text default null,
  p_notify_on_inquiry_via_email boolean default false,
  p_notify_on_profile_interest_via_email boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $getorcreate2$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_id    uuid;
  v_name_ko text := nullif(trim(coalesce(p_display_name_ko, '')), '');
  v_name_en text := nullif(trim(coalesce(p_display_name_en, '')), '');
  v_notify boolean := coalesce(p_notify_on_inquiry_via_email, false);
  v_notify_interest boolean := coalesce(p_notify_on_profile_interest_via_email, false);
begin
  if v_uid is null then
    raise exception 'auth.uid() is null';
  end if;
  if p_display_name is null or length(trim(p_display_name)) < 2 then
    raise exception 'display_name must be at least 2 characters';
  end if;
  v_email := nullif(trim(p_invite_email), '');

  if v_email is not null then
    select id into v_id from public.external_artists
     where claimed_profile_id is null
       and lower(trim(invite_email)) = lower(v_email)
     order by created_at asc limit 1;
    if v_id is not null then
      update public.external_artists
         set display_name_ko = coalesce(display_name_ko, v_name_ko),
             display_name_en = coalesce(display_name_en, v_name_en),
             notify_on_inquiry_via_email = case
               when v_notify and notify_on_inquiry_via_email is not true then true
               else notify_on_inquiry_via_email end,
             notify_email_consented_at = case
               when v_notify and notify_on_inquiry_via_email is not true then now()
               else notify_email_consented_at end,
             notify_on_profile_interest_via_email = case
               when v_notify_interest and notify_on_profile_interest_via_email is not true then true
               else notify_on_profile_interest_via_email end,
             notify_profile_interest_consented_at = case
               when v_notify_interest and notify_on_profile_interest_via_email is not true then now()
               else notify_profile_interest_consented_at end
       where id = v_id
         and (
           (display_name_ko is null and v_name_ko is not null)
           or (display_name_en is null and v_name_en is not null)
           or (v_notify and notify_on_inquiry_via_email is not true)
           or (v_notify_interest and notify_on_profile_interest_via_email is not true)
         );
      return v_id;
    end if;
    select id into v_id from public.external_artists
     where invited_by = v_uid and claimed_profile_id is null
       and nullif(trim(invite_email), '') is null
       and lower(trim(display_name)) = lower(trim(p_display_name))
     order by created_at asc limit 1;
    if v_id is not null then
      update public.external_artists
         set invite_email    = v_email,
             display_name_ko = coalesce(display_name_ko, v_name_ko),
             display_name_en = coalesce(display_name_en, v_name_en),
             notify_on_inquiry_via_email = case
               when v_notify and notify_on_inquiry_via_email is not true then true
               else notify_on_inquiry_via_email end,
             notify_email_consented_at = case
               when v_notify and notify_on_inquiry_via_email is not true then now()
               else notify_email_consented_at end,
             notify_on_profile_interest_via_email = case
               when v_notify_interest and notify_on_profile_interest_via_email is not true then true
               else notify_on_profile_interest_via_email end,
             notify_profile_interest_consented_at = case
               when v_notify_interest and notify_on_profile_interest_via_email is not true then now()
               else notify_profile_interest_consented_at end
       where id = v_id;
      return v_id;
    end if;
  else
    select id into v_id from public.external_artists
     where invited_by = v_uid and claimed_profile_id is null
       and lower(trim(display_name)) = lower(trim(p_display_name))
       and nullif(trim(invite_email), '') is null
     order by created_at asc limit 1;
    if v_id is not null then
      update public.external_artists
         set display_name_ko = coalesce(display_name_ko, v_name_ko),
             display_name_en = coalesce(display_name_en, v_name_en),
             notify_on_inquiry_via_email = case
               when v_notify and notify_on_inquiry_via_email is not true then true
               else notify_on_inquiry_via_email end,
             notify_email_consented_at = case
               when v_notify and notify_on_inquiry_via_email is not true then now()
               else notify_email_consented_at end,
             notify_on_profile_interest_via_email = case
               when v_notify_interest and notify_on_profile_interest_via_email is not true then true
               else notify_on_profile_interest_via_email end,
             notify_profile_interest_consented_at = case
               when v_notify_interest and notify_on_profile_interest_via_email is not true then now()
               else notify_profile_interest_consented_at end
       where id = v_id
         and (
           (display_name_ko is null and v_name_ko is not null)
           or (display_name_en is null and v_name_en is not null)
           or (v_notify and notify_on_inquiry_via_email is not true)
           or (v_notify_interest and notify_on_profile_interest_via_email is not true)
         );
      return v_id;
    end if;
  end if;

  begin
    insert into public.external_artists (
      display_name, invite_email, invited_by, status,
      display_name_ko, display_name_en,
      notify_on_inquiry_via_email, notify_email_consented_at,
      notify_on_profile_interest_via_email, notify_profile_interest_consented_at
    )
    values (
      trim(p_display_name), v_email, v_uid, 'invited',
      v_name_ko, v_name_en,
      v_notify, case when v_notify then now() else null end,
      v_notify_interest, case when v_notify_interest then now() else null end
    )
    returning id into v_id;
  exception when unique_violation then
    if v_email is not null then
      select id into v_id from public.external_artists
       where claimed_profile_id is null
         and lower(trim(invite_email)) = lower(v_email)
       order by created_at asc limit 1;
    else
      select id into v_id from public.external_artists
       where invited_by = v_uid and claimed_profile_id is null
         and lower(trim(display_name)) = lower(trim(p_display_name))
         and nullif(trim(invite_email), '') is null
       order by created_at asc limit 1;
    end if;
    if v_id is not null then
      update public.external_artists
         set display_name_ko = coalesce(display_name_ko, v_name_ko),
             display_name_en = coalesce(display_name_en, v_name_en),
             notify_on_inquiry_via_email = case
               when v_notify and notify_on_inquiry_via_email is not true then true
               else notify_on_inquiry_via_email end,
             notify_email_consented_at = case
               when v_notify and notify_on_inquiry_via_email is not true then now()
               else notify_email_consented_at end,
             notify_on_profile_interest_via_email = case
               when v_notify_interest and notify_on_profile_interest_via_email is not true then true
               else notify_on_profile_interest_via_email end,
             notify_profile_interest_consented_at = case
               when v_notify_interest and notify_on_profile_interest_via_email is not true then now()
               else notify_profile_interest_consented_at end
       where id = v_id;
    end if;
  end;

  return v_id;
end;
$getorcreate2$;

grant execute on function public.get_or_create_external_artist(text, text, text, text, boolean, boolean) to authenticated;

-- ────────────────────────────────────────────────────────────────────
-- == SECTION 7 == create_external_artist_and_claim: 15번째 trailing 파라미터
-- ────────────────────────────────────────────────────────────────────
--
-- `20260729100000` SECTION 6 이 만든 14-arg 버전 위에 15번째 trailing
-- default 파라미터 p_notify_on_profile_interest_via_email 을 추가하고,
-- get_or_create_external_artist 의 새 6-arg 시그니처로 forward한다.
create or replace function public.create_external_artist_and_claim(
  p_display_name       text,
  p_invite_email       text default null,
  p_work_id            uuid default null,
  p_project_id         uuid default null,
  p_claim_type         text default 'OWNS',
  p_website            text default null,
  p_instagram          text default null,
  p_visibility         text default 'public',
  p_period_status      text default null,
  p_subject_profile_id uuid default null,
  p_external_artist_id uuid default null,
  p_display_name_ko    text default null,
  p_display_name_en    text default null,
  p_notify_on_inquiry_via_email boolean default false,
  p_notify_on_profile_interest_via_email boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $createclaim2$
declare
  v_uid        uuid := auth.uid();
  v_subject    uuid;
  v_ext_id     uuid;
  v_email      text;
  v_ext_row    jsonb;
  v_claim_row  jsonb;
  v_check      uuid;
  v_name_ko    text := nullif(trim(coalesce(p_display_name_ko, '')), '');
  v_name_en    text := nullif(trim(coalesce(p_display_name_en, '')), '');
  v_notify     boolean := coalesce(p_notify_on_inquiry_via_email, false);
  v_notify_interest boolean := coalesce(p_notify_on_profile_interest_via_email, false);
begin
  if v_uid is null then
    raise exception 'auth.uid() is null';
  end if;
  if p_display_name is null or length(trim(p_display_name)) < 2 then
    raise exception 'display_name must be at least 2 characters';
  end if;
  if (p_work_id is null and p_project_id is null)
     or (p_work_id is not null and p_project_id is not null) then
    raise exception 'exactly one of work_id, project_id required';
  end if;
  if p_visibility is null then
    p_visibility := 'public';
  end if;
  if p_period_status is not null
     and p_period_status not in ('past', 'current', 'future') then
    raise exception 'period_status must be past, current, or future';
  end if;

  v_subject := coalesce(p_subject_profile_id, v_uid);
  if v_subject <> v_uid then
    if not public.is_active_writer_for(v_subject) then
      raise exception 'forbidden: caller is not an active account delegate writer for subject_profile_id';
    end if;
  end if;

  v_email := nullif(trim(p_invite_email), '');

  if p_external_artist_id is not null then
    select ea.id
      into v_check
      from public.external_artists ea
     where ea.id = p_external_artist_id
       and ea.claimed_profile_id is null
       and ea.invited_by in (v_uid, v_subject)
     limit 1;
    if v_check is not null then
      v_ext_id := v_check;
      update public.external_artists
         set website      = coalesce(nullif(trim(website), ''), nullif(trim(p_website), '')),
             instagram    = coalesce(nullif(trim(instagram), ''), nullif(trim(p_instagram), '')),
             invite_email = coalesce(nullif(trim(invite_email), ''), v_email),
             display_name_ko = coalesce(display_name_ko, v_name_ko),
             display_name_en = coalesce(display_name_en, v_name_en),
             notify_on_inquiry_via_email = case
               when v_notify and notify_on_inquiry_via_email is not true then true
               else notify_on_inquiry_via_email end,
             notify_email_consented_at = case
               when v_notify and notify_on_inquiry_via_email is not true then now()
               else notify_email_consented_at end,
             notify_on_profile_interest_via_email = case
               when v_notify_interest and notify_on_profile_interest_via_email is not true then true
               else notify_on_profile_interest_via_email end,
             notify_profile_interest_consented_at = case
               when v_notify_interest and notify_on_profile_interest_via_email is not true then now()
               else notify_profile_interest_consented_at end
       where id = v_ext_id;
    end if;
  end if;

  if v_ext_id is null then
    v_ext_id := public.get_or_create_external_artist(
      trim(p_display_name),
      v_email,
      v_name_ko,
      v_name_en,
      v_notify,
      v_notify_interest
    );

    if v_ext_id is not null and (
         nullif(trim(coalesce(p_website, '')), '') is not null
         or nullif(trim(coalesce(p_instagram, '')), '') is not null
       ) then
      update public.external_artists
         set website   = coalesce(nullif(trim(website), ''),   nullif(trim(p_website), '')),
             instagram = coalesce(nullif(trim(instagram), ''), nullif(trim(p_instagram), ''))
       where id = v_ext_id;
    end if;
  end if;

  if v_ext_id is null then
    raise exception 'failed to resolve external_artist for display_name=% email=%',
      p_display_name, coalesce(v_email, '<none>');
  end if;

  insert into public.claims (
    subject_profile_id, claim_type, work_id, project_id,
    external_artist_id, visibility, period_status
  )
  values (
    v_subject, p_claim_type, p_work_id, p_project_id,
    v_ext_id, p_visibility, p_period_status
  );

  select to_jsonb(e.*) into v_ext_row from public.external_artists e where e.id = v_ext_id;
  select to_jsonb(c.*) into v_claim_row
    from public.claims c
   where c.subject_profile_id = v_subject
     and c.external_artist_id = v_ext_id
   order by c.created_at desc
   limit 1;

  return jsonb_build_object('external_artist', v_ext_row, 'claim', v_claim_row);
end;
$createclaim2$;

grant execute on function public.create_external_artist_and_claim(
  text, text, uuid, uuid, text, text, text, text, text, uuid, uuid, text, text, boolean, boolean
) to authenticated;

commit;
