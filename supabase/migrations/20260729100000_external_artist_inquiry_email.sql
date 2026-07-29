-- QA 2026-07-29 — 외부 작가(external_artists) 가격 문의 이메일 알림 (opt-in) +
-- 그 흐름을 지탱하는 동의(consent) 파이프라인 확장.
--
-- 배경
-- ----
-- 아직 온보딩하지 않은 외부 작가는 가격 문의가 들어와도 인앱 알림을 받을
-- 계정이 없다. 초대자(갤러리/큐레이터)가 업로드 시점에 명시적으로
-- 동의(opt-in)한 경우에 한해, `invite_email` 로 문의 발생을 이메일로
-- 전달한다. 스팸/오남용 방지를 위해 30일 3회 rate-limit + (external_artist,
-- inquiry) 당 1회 dedupe 를 로그 테이블로 강제한다.
--
-- 이 마이그레이션 (release-workflow.mdc 규칙 — PL/pgSQL 함수 4개 이상 →
-- SECTION 배너로 분리, dollar tag 는 letters-only):
--
--   SECTION 1 — external_artists: notify_on_inquiry_via_email(bool) +
--               notify_email_consented_at(timestamptz) 컬럼 추가.
--   SECTION 2 — external_artist_inquiry_email_log: 발송 이력(rate-limit +
--               dedupe) 테이블. RLS 는 켜두되 정책 없음 → RPC(SECURITY
--               DEFINER) 로만 접근.
--   SECTION 3 — request_price_inquiry_email_dispatch(p_inquiry_id): 문의자
--               세션에서 호출. 대상 external_artist 각각에 대해 가드를
--               통과하면 로그 행을 INSERT 하고 발송에 필요한 페이로드를
--               반환. 실제 SendGrid 발송은 API 라우트가 담당.
--   SECTION 4 — unsubscribe_external_artist_inquiry_emails(p_token): 로그인
--               없이 접근 가능한 수신거부 링크의 배후 RPC. anon 실행 허용.
--   SECTION 5 — get_or_create_external_artist: p_notify_on_inquiry_via_email
--               (5번째 trailing default 파라미터) 수용. 기존 4-arg 오버로드는
--               남겨두되(240005 SECTION 2 관례와 동일), 내부 호출자
--               (create_external_artist_and_claim) 는 항상 positional 5-arg
--               로 부르므로 오버로드 충돌 없음. 동의는 "한 번 true 는
--               true 로만" — 기존 true 를 false 로 되돌리지 않는다.
--   SECTION 6 — create_external_artist_and_claim: 동일 파라미터를 받아
--               get_or_create_external_artist 로 forward. 재선택된
--               (p_external_artist_id) 기존 행에도 동일한 "only flip true"
--               규칙 적용.
--
-- 원칙: additive · 옛 호출자를 부수지 않는다 · external_artists 컬럼
-- grant 는 절대 넓히지 않는다(PII 는 SECURITY DEFINER RPC 로만 노출).

begin;

-- ────────────────────────────────────────────────────────────────────
-- == SECTION 1 == external_artists: 이메일 알림 opt-in 컬럼
-- ────────────────────────────────────────────────────────────────────
alter table public.external_artists
  add column if not exists notify_on_inquiry_via_email boolean not null default false,
  add column if not exists notify_email_consented_at timestamptz;

comment on column public.external_artists.notify_on_inquiry_via_email is
  'True only when the inviter (gallery/curator) explicitly opted in at invite time to have Theo send price-inquiry notifications to invite_email. Never flip to true retroactively without a fresh explicit consent event.';
comment on column public.external_artists.notify_email_consented_at is
  'Timestamp when notify_on_inquiry_via_email was flipped to true. Audit trail for consent.';

-- ────────────────────────────────────────────────────────────────────
-- == SECTION 2 == external_artist_inquiry_email_log (rate-limit + dedupe)
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.external_artist_inquiry_email_log (
  id uuid primary key default gen_random_uuid(),
  external_artist_id uuid not null references public.external_artists(id) on delete cascade,
  inquiry_id uuid not null references public.price_inquiries(id) on delete cascade,
  sent_at timestamptz not null default now(),
  invite_email_at_send text not null,  -- snapshot for audit (in case invite_email later changes/deleted)
  unsubscribe_token text not null,     -- HMAC token, one per send
  unique (external_artist_id, inquiry_id)  -- dedupe: at most one email per (external_artist, inquiry)
);

comment on table public.external_artist_inquiry_email_log is
  'QA 2026-07-29 — price-inquiry opt-in email 발송 이력. rate-limit(30일 3회) + dedupe((external_artist, inquiry) 당 1회) 근거. RLS 는 켜두되 정책 없음 — SECURITY DEFINER RPC 로만 접근.';

create index if not exists idx_eaiel_ext on public.external_artist_inquiry_email_log(external_artist_id, sent_at desc);
alter table public.external_artist_inquiry_email_log enable row level security;
-- No policies granted → RPC-only access (SECURITY DEFINER bypasses RLS).
revoke all on public.external_artist_inquiry_email_log from anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- == SECTION 3 == request_price_inquiry_email_dispatch
-- ────────────────────────────────────────────────────────────────────
--
-- 호출자(문의를 방금 생성한 inquirer)의 세션에서 호출. RLS 를 우회하는
-- SECURITY DEFINER 이므로 함수 내부에서 inquirer_id = auth.uid() 를
-- 직접 재검증한다. work 에 걸린 CURATED/기타 claim 중 external_artist_id
-- 가 있는 모든 행을 훑어(복수 초대자 가능) 각각 가드를 통과하면 로그
-- 행을 남기고 발송 페이로드를 반환한다.
create or replace function public.request_price_inquiry_email_dispatch(
  p_inquiry_id uuid
)
returns table (
  external_artist_id uuid,
  invite_email text,
  display_name text,
  inviter_display_name text,
  artwork_title text,
  unsubscribe_token text,
  inquiry_id uuid
)
language plpgsql
security definer
set search_path = public
as $dispatch$
declare
  v_uid uuid := auth.uid();
  v_inquiry record;
  v_artwork_title text;
  v_ea record;
  v_token uuid;
  v_recent_count int;
  v_already_count int;
begin
  if v_uid is null then
    return;
  end if;

  select pi.id, pi.artwork_id, pi.inquirer_id
    into v_inquiry
    from public.price_inquiries pi
   where pi.id = p_inquiry_id;

  if v_inquiry.id is null then
    return;
  end if;

  -- 문의를 만든 본인만 dispatch 를 트리거할 수 있다 (재요청 남용 방지).
  if v_inquiry.inquirer_id <> v_uid then
    return;
  end if;

  select a.title into v_artwork_title
    from public.artworks a
   where a.id = v_inquiry.artwork_id;

  for v_ea in
    select distinct ea.*
      from public.claims c
      join public.external_artists ea on ea.id = c.external_artist_id
     where c.work_id = v_inquiry.artwork_id
       and c.external_artist_id is not null
  loop
    -- 초대자가 명시적으로 opt-in 하지 않았으면 스킵.
    if v_ea.notify_on_inquiry_via_email is not true then
      continue;
    end if;

    -- 이미 계정을 가진 작가(자동 링크 완료)는 인앱 알림 경로가 이미
    -- 커버한다 — 중복 채널로 이메일을 또 보내지 않는다.
    if v_ea.claimed_profile_id is not null then
      continue;
    end if;

    if nullif(trim(coalesce(v_ea.invite_email, '')), '') is null then
      continue;
    end if;

    -- 30일 rate-limit: 같은 external_artist 에게 3회 초과 발송 금지.
    select count(*) into v_recent_count
      from public.external_artist_inquiry_email_log l
     where l.external_artist_id = v_ea.id
       and l.sent_at > now() - interval '30 days';
    if v_recent_count >= 3 then
      continue;
    end if;

    -- (external_artist, inquiry) dedupe: 이미 발송했으면 재발송 안 함.
    select count(*) into v_already_count
      from public.external_artist_inquiry_email_log l
     where l.external_artist_id = v_ea.id
       and l.inquiry_id = v_inquiry.id;
    if v_already_count > 0 then
      continue;
    end if;

    v_token := gen_random_uuid();

    begin
      insert into public.external_artist_inquiry_email_log (
        external_artist_id, inquiry_id, invite_email_at_send, unsubscribe_token
      ) values (
        v_ea.id, v_inquiry.id, v_ea.invite_email, v_token::text
      );
    exception when unique_violation then
      -- 동시 요청 경합 — 이미 다른 호출이 로그를 남겼으니 스킵.
      continue;
    end;

    external_artist_id := v_ea.id;
    invite_email := v_ea.invite_email;
    display_name := v_ea.display_name;
    select p.display_name into inviter_display_name
      from public.profiles p where p.id = v_ea.invited_by;
    artwork_title := v_artwork_title;
    unsubscribe_token := v_token::text;
    inquiry_id := v_inquiry.id;
    return next;
  end loop;

  return;
end;
$dispatch$;

revoke all on function public.request_price_inquiry_email_dispatch(uuid) from public;
grant execute on function public.request_price_inquiry_email_dispatch(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────
-- == SECTION 4 == unsubscribe_external_artist_inquiry_emails
-- ────────────────────────────────────────────────────────────────────
--
-- 로그인 없이 이메일 안의 링크만으로 동작해야 하므로 anon 실행을 허용한다.
-- 토큰은 발송 로그(SECTION 2)에 1회성으로 심어둔 값이라 추측 불가능한
-- 범위에서 안전. 성공/실패 모두 boolean 으로 반환(row 존재 여부 노출은
-- 정보량이 적어 안전 — PII 는 반환하지 않는다).
create or replace function public.unsubscribe_external_artist_inquiry_emails(
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
    from public.external_artist_inquiry_email_log l
   where l.unsubscribe_token = p_token::text
   order by l.sent_at desc
   limit 1;

  if v_ext_id is null then
    return false;
  end if;

  update public.external_artists
     set notify_on_inquiry_via_email = false
   where id = v_ext_id;

  return true;
end;
$unsub$;

revoke all on function public.unsubscribe_external_artist_inquiry_emails(uuid) from public;
grant execute on function public.unsubscribe_external_artist_inquiry_emails(uuid) to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- == SECTION 5 == get_or_create_external_artist: notify opt-in (only flip true)
-- ────────────────────────────────────────────────────────────────────
--
-- 새 trailing default 파라미터 p_notify_on_inquiry_via_email 을 추가한다.
-- 240005 SECTION 2 와 동일한 관례: 오버로드가 하나 더 생기지만, 유일한
-- 내부 호출자(create_external_artist_and_claim, SECTION 6)가 항상
-- positional 5-arg 로 호출하므로 충돌 없음. 규칙: 기존 true 를 false 로
-- 되돌리지 않는다 — 사전 동의가 있었다면 항상 존중.
create or replace function public.get_or_create_external_artist(
  p_display_name   text,
  p_invite_email   text default null,
  p_display_name_ko text default null,
  p_display_name_en text default null,
  p_notify_on_inquiry_via_email boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $getorcreate$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_id    uuid;
  v_name_ko text := nullif(trim(coalesce(p_display_name_ko, '')), '');
  v_name_en text := nullif(trim(coalesce(p_display_name_en, '')), '');
  v_notify boolean := coalesce(p_notify_on_inquiry_via_email, false);
begin
  if v_uid is null then
    raise exception 'auth.uid() is null';
  end if;
  if p_display_name is null or length(trim(p_display_name)) < 2 then
    raise exception 'display_name must be at least 2 characters';
  end if;
  v_email := nullif(trim(p_invite_email), '');

  if v_email is not null then
    -- 이메일은 전역 신원: 초대자 무관하게 재사용.
    select id into v_id from public.external_artists
     where claimed_profile_id is null
       and lower(trim(invite_email)) = lower(v_email)
     order by created_at asc limit 1;
    if v_id is not null then
      -- Backfill KO/EN if the reused row has an empty slot. Never
      -- overwrite an existing slot. Notify consent: only flip false→true,
      -- never true→false (a later upload without the checkbox checked
      -- must not revoke a prior explicit consent).
      update public.external_artists
         set display_name_ko = coalesce(display_name_ko, v_name_ko),
             display_name_en = coalesce(display_name_en, v_name_en),
             notify_on_inquiry_via_email = case
               when v_notify and notify_on_inquiry_via_email is not true then true
               else notify_on_inquiry_via_email end,
             notify_email_consented_at = case
               when v_notify and notify_on_inquiry_via_email is not true then now()
               else notify_email_consented_at end
       where id = v_id
         and (
           (display_name_ko is null and v_name_ko is not null)
           or (display_name_en is null and v_name_en is not null)
           or (v_notify and notify_on_inquiry_via_email is not true)
         );
      return v_id;
    end if;
    -- 이메일 행이 아직 없으면, 같은 초대자의 무이메일 동명 행을 흡수(이메일 backfill).
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
               else notify_email_consented_at end
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
               else notify_email_consented_at end
       where id = v_id
         and (
           (display_name_ko is null and v_name_ko is not null)
           or (display_name_en is null and v_name_en is not null)
           or (v_notify and notify_on_inquiry_via_email is not true)
         );
      return v_id;
    end if;
  end if;

  begin
    insert into public.external_artists (
      display_name, invite_email, invited_by, status,
      display_name_ko, display_name_en,
      notify_on_inquiry_via_email, notify_email_consented_at
    )
    values (
      trim(p_display_name), v_email, v_uid, 'invited',
      v_name_ko, v_name_en,
      v_notify, case when v_notify then now() else null end
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
    -- Race winner may have empty slots; backfill best-effort.
    if v_id is not null then
      update public.external_artists
         set display_name_ko = coalesce(display_name_ko, v_name_ko),
             display_name_en = coalesce(display_name_en, v_name_en),
             notify_on_inquiry_via_email = case
               when v_notify and notify_on_inquiry_via_email is not true then true
               else notify_on_inquiry_via_email end,
             notify_email_consented_at = case
               when v_notify and notify_on_inquiry_via_email is not true then now()
               else notify_email_consented_at end
       where id = v_id;
    end if;
  end;

  return v_id;
end;
$getorcreate$;

grant execute on function public.get_or_create_external_artist(text, text, text, text, boolean) to authenticated;

-- ────────────────────────────────────────────────────────────────────
-- == SECTION 6 == create_external_artist_and_claim: notify opt-in forward
-- ────────────────────────────────────────────────────────────────────
--
-- 새 trailing default 파라미터 p_notify_on_inquiry_via_email 을 추가하고
-- get_or_create_external_artist 로 forward (positional 5-arg — 오버로드
-- 충돌 없음). 재선택된(p_external_artist_id) 기존 행에도 "only flip true"
-- 규칙을 동일 적용.
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
  p_notify_on_inquiry_via_email boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $createclaim$
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
             -- Backfill KO/EN best-effort (never overwrite existing).
             display_name_ko = coalesce(display_name_ko, v_name_ko),
             display_name_en = coalesce(display_name_en, v_name_en),
             -- Notify opt-in: only flip false→true, never revert.
             notify_on_inquiry_via_email = case
               when v_notify and notify_on_inquiry_via_email is not true then true
               else notify_on_inquiry_via_email end,
             notify_email_consented_at = case
               when v_notify and notify_on_inquiry_via_email is not true then now()
               else notify_email_consented_at end
       where id = v_ext_id;
    end if;
  end if;

  if v_ext_id is null then
    v_ext_id := public.get_or_create_external_artist(
      trim(p_display_name),
      v_email,
      v_name_ko,
      v_name_en,
      v_notify
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
$createclaim$;

grant execute on function public.create_external_artist_and_claim(
  text, text, uuid, uuid, text, text, text, text, text, uuid, uuid, text, text, boolean
) to authenticated;

commit;
