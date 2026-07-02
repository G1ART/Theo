-- 외부(초대 전) 작가 dedupe "이메일 전역화" — QA 2026-07-01 (김수철 2명 분리).
--
-- 배경: 20260630/20260701 dedupe 는 *초대자별* 로만 병합했다. 그래서
--   (a) 같은 이메일(na-camos@daum.net)이라도 초대자가 다르면(갤러리 A vs B)
--       각각 별도 external_artists 행 → 피드/전시에서 동일인이 2명으로 분리.
--   (b) 같은 초대자 안에서도 "이메일 없는 행" 과 "이메일 있는 행" 은 보수적으로
--       병합하지 않아 분리.
-- 그리고 getArtworkArtistGroupKey 가 external_artist_id 기준으로 묶으면서
-- 위 잔여 중복이 별개 작가로 노출됐다.
--
-- 결정(사용자 승인 2026-07-01):
--   * 같은 이메일 → 초대자 달라도 동일인으로 전역 병합.
--   * 같은 (초대자, 이름) 의 무이메일 행 → 이메일 있는 형제 행으로 흡수.
--   * claimed_profile_id 가 있는(온보딩된) 행은 미변경.
--
-- 적용: PL/pgSQL 본문이 여러 개이므로 Supabase SQL Editor 에서는 SECTION 단위
-- highlight → Run. (letters-only dollar tag 사용.)

begin;

-- == SECTION 1 == 같은 (초대자, 이름) 의 무이메일 행 → 이메일 있는 형제 행으로 병합
do $a$
declare
  g record;
  v_canonical uuid;
begin
  for g in
    select invited_by, lower(trim(display_name)) as name_key
      from public.external_artists
     where claimed_profile_id is null
       and coalesce(trim(display_name), '') <> ''
     group by invited_by, lower(trim(display_name))
    having count(*) filter (where nullif(trim(invite_email), '') is not null) >= 1
       and count(*) filter (where nullif(trim(invite_email), '') is null) >= 1
  loop
    select ea.id into v_canonical
      from public.external_artists ea
     where ea.claimed_profile_id is null
       and ea.invited_by = g.invited_by
       and lower(trim(ea.display_name)) = g.name_key
       and nullif(trim(ea.invite_email), '') is not null
     order by (select count(*) from public.claims c where c.external_artist_id = ea.id) desc,
              ea.created_at asc, ea.id asc
     limit 1;

    update public.claims
       set external_artist_id = v_canonical
     where external_artist_id in (
       select id from public.external_artists
        where claimed_profile_id is null
          and invited_by = g.invited_by
          and lower(trim(display_name)) = g.name_key
          and nullif(trim(invite_email), '') is null
     );

    delete from public.external_artists
     where claimed_profile_id is null
       and invited_by = g.invited_by
       and lower(trim(display_name)) = g.name_key
       and nullif(trim(invite_email), '') is null;
  end loop;
end;
$a$;

-- == SECTION 2 == 같은 이메일 → 초대자 달라도 전역 병합
do $b$
declare
  g record;
  v_canonical uuid;
begin
  for g in
    select lower(trim(invite_email)) as email_key
      from public.external_artists
     where claimed_profile_id is null
       and nullif(trim(invite_email), '') is not null
     group by lower(trim(invite_email))
    having count(*) > 1
  loop
    select ea.id into v_canonical
      from public.external_artists ea
     where ea.claimed_profile_id is null
       and lower(trim(ea.invite_email)) = g.email_key
     order by (select count(*) from public.claims c where c.external_artist_id = ea.id) desc,
              ea.created_at asc, ea.id asc
     limit 1;

    update public.external_artists c
       set website   = coalesce(nullif(trim(c.website), ''), src.website),
           instagram = coalesce(nullif(trim(c.instagram), ''), src.instagram)
      from (
        select max(nullif(trim(website), '')) as website,
               max(nullif(trim(instagram), '')) as instagram
          from public.external_artists
         where claimed_profile_id is null
           and lower(trim(invite_email)) = g.email_key
      ) src
     where c.id = v_canonical;

    update public.claims
       set external_artist_id = v_canonical
     where external_artist_id in (
       select id from public.external_artists
        where claimed_profile_id is null
          and lower(trim(invite_email)) = g.email_key
          and id <> v_canonical
     );

    delete from public.external_artists
     where claimed_profile_id is null
       and lower(trim(invite_email)) = g.email_key
       and id <> v_canonical;
  end loop;
end;
$b$;

-- == SECTION 3 == 유니크 인덱스: 이메일은 전역, 무이메일은 초대자별
drop index if exists public.uq_external_artists_inviter_email;

create unique index if not exists uq_external_artists_email_global
  on public.external_artists (lower(trim(invite_email)))
  where nullif(trim(invite_email), '') is not null and claimed_profile_id is null;

create unique index if not exists uq_external_artists_inviter_name_noemail
  on public.external_artists (invited_by, lower(trim(display_name)))
  where nullif(trim(invite_email), '') is null and claimed_profile_id is null;

-- == SECTION 4 == get_or_create_external_artist — 이메일 전역 재사용 + 무이메일 흡수
create or replace function public.get_or_create_external_artist(
  p_display_name text,
  p_invite_email text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $c$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_id    uuid;
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
      return v_id;
    end if;
    -- 이메일 행이 아직 없으면, 같은 초대자의 무이메일 동명 행을 흡수(이메일 backfill).
    select id into v_id from public.external_artists
     where invited_by = v_uid and claimed_profile_id is null
       and nullif(trim(invite_email), '') is null
       and lower(trim(display_name)) = lower(trim(p_display_name))
     order by created_at asc limit 1;
    if v_id is not null then
      update public.external_artists set invite_email = v_email where id = v_id;
      return v_id;
    end if;
  else
    select id into v_id from public.external_artists
     where invited_by = v_uid and claimed_profile_id is null
       and lower(trim(display_name)) = lower(trim(p_display_name))
       and nullif(trim(invite_email), '') is null
     order by created_at asc limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  begin
    insert into public.external_artists (display_name, invite_email, invited_by, status)
    values (trim(p_display_name), v_email, v_uid, 'invited')
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
  end;

  return v_id;
end;
$c$;

grant execute on function public.get_or_create_external_artist(text, text) to authenticated;

commit;
