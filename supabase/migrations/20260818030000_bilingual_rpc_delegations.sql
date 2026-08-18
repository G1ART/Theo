-- QA 2026-08-17 (14) — 이중언어(KO/EN) RPC patch: 위임(Delegations) 계열
--
-- 배경
-- ----
-- (13) 감사에서 client 는 `formatDisplayName(..., t, locale)` /
-- `pickLocalizedTitle` 로 라우팅했지만, 위임 RPC 들은 여전히 legacy
-- `display_name` / `title` 만 반환해서 pickLocalized 가 뽑을 값이
-- 없었다. 아래 3개 RPC 의 jsonb payload 에 KO/EN 슬롯을 additive 로
-- 주입한다. 반환 타입은 모두 `jsonb` (또는 `setof jsonb`) 라 signature
-- 변경이 없어 drop 없이 `create or replace` 만으로 충분하다.
--
-- 변경 대상
--   1) list_my_delegations()           → sent[].delegate_profile, sent[].project,
--                                        received[].delegator_profile, received[].project
--                                        에 display_name_ko/en / title_ko/en 추가
--   2) get_delegation_by_token(uuid)   → delegator + project 에 KO/EN 추가
--   3) get_delegation_detail(uuid)     → delegator_profile + delegate_profile + project 에 KO/EN 추가
--
-- 보안 posture
--   - 원본과 동일: SECURITY DEFINER, `stable` (읽기 전용), search_path=public
--   - `get_delegation_by_token` 은 원본과 동일하게 anon + authenticated grant
--   - 나머지는 authenticated only
--
-- 릴리즈 룰
--   - 파일 내에 PL/pgSQL 함수 정의가 2개 이상 → `-- == SECTION N ==`
--     배너로 분리, 각 함수는 letters-only dollar tag 사용 (`$a$`/`$b$`/`$c$`).
--   - Supabase dashboard 로 붙여넣을 때는 SECTION 단위로 highlight → Run.

begin;

-- == SECTION 1 == list_my_delegations — KO/EN 슬롯 추가 (jsonb payload additive)
create or replace function public.list_my_delegations()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $a$
declare
  v_uid      uuid := auth.uid();
  v_sent     jsonb;
  v_received jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('sent', '[]'::jsonb, 'received', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(row_payload order by created_at desc), '[]'::jsonb)
    into v_sent
  from (
    select
      jsonb_build_object(
        'id', d.id,
        'delegator_profile_id', d.delegator_profile_id,
        'delegate_email', d.delegate_email,
        'delegate_profile_id', d.delegate_profile_id,
        'scope_type', d.scope_type,
        'project_id', d.project_id,
        'permissions', d.permissions,
        'preset', d.preset,
        'note', d.note,
        'status', d.status,
        'invited_at', d.invited_at,
        'accepted_at', d.accepted_at,
        'declined_at', d.declined_at,
        'revoked_at', d.revoked_at,
        'expires_at', d.expires_at,
        'created_at', d.created_at,
        'updated_at', d.updated_at,
        'delegate_profile', case when dp.id is null then null else
          jsonb_build_object(
            'id', dp.id,
            'username', dp.username,
            'display_name', dp.display_name,
            'display_name_ko', dp.display_name_ko,
            'display_name_en', dp.display_name_en,
            'avatar_url', dp.avatar_url
          )
        end,
        'project', case when pr.id is null then null else
          jsonb_build_object(
            'id', pr.id,
            'title', pr.title,
            'title_ko', pr.title_ko,
            'title_en', pr.title_en
          )
        end
      ) as row_payload,
      d.created_at
    from public.delegations d
    left join public.profiles dp on dp.id = d.delegate_profile_id
    left join public.projects pr on pr.id = d.project_id
    where d.delegator_profile_id = v_uid
  ) s;

  select coalesce(jsonb_agg(row_payload order by created_at desc), '[]'::jsonb)
    into v_received
  from (
    select
      jsonb_build_object(
        'id', d.id,
        'delegator_profile_id', d.delegator_profile_id,
        'delegate_email', d.delegate_email,
        'delegate_profile_id', d.delegate_profile_id,
        'scope_type', d.scope_type,
        'project_id', d.project_id,
        'permissions', d.permissions,
        'preset', d.preset,
        'note', d.note,
        'status', d.status,
        'invited_at', d.invited_at,
        'accepted_at', d.accepted_at,
        'declined_at', d.declined_at,
        'revoked_at', d.revoked_at,
        'expires_at', d.expires_at,
        'created_at', d.created_at,
        'updated_at', d.updated_at,
        'delegator_profile', jsonb_build_object(
          'id', p.id,
          'username', p.username,
          'display_name', p.display_name,
          'display_name_ko', p.display_name_ko,
          'display_name_en', p.display_name_en,
          'avatar_url', p.avatar_url
        ),
        'project', case when pr.id is null then null else
          jsonb_build_object(
            'id', pr.id,
            'title', pr.title,
            'title_ko', pr.title_ko,
            'title_en', pr.title_en
          )
        end
      ) as row_payload,
      d.created_at
    from public.delegations d
    join public.profiles p on p.id = d.delegator_profile_id
    left join public.projects pr on pr.id = d.project_id
    where d.delegate_profile_id = v_uid
  ) r;

  return jsonb_build_object(
    'sent', coalesce(v_sent, '[]'::jsonb),
    'received', coalesce(v_received, '[]'::jsonb)
  );
end;
$a$;

grant execute on function public.list_my_delegations() to authenticated;

-- == SECTION 2 == get_delegation_by_token — delegator + project KO/EN 슬롯 추가
--
-- 원본 (20260506000000) 과 동일하게 pending 이 아닌 상태도 반환하고,
-- delegator sub-select 에 KO/EN 을 추가한다. security posture 유지:
-- SECURITY DEFINER, stable, search_path=public, anon + authenticated grant.
create or replace function public.get_delegation_by_token(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $b$
declare
  v_row       record;
  v_delegator record;
  v_project   record;
begin
  select d.id,
         d.delegate_email,
         d.scope_type,
         d.project_id,
         d.status,
         d.preset,
         d.delegator_profile_id
    into v_row
    from public.delegations d
   where d.invite_token = p_token;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  select p.id, p.username, p.display_name, p.display_name_ko, p.display_name_en
    into v_delegator
    from public.profiles p
   where p.id = v_row.delegator_profile_id;

  if v_row.project_id is not null then
    select pr.id, pr.title, pr.title_ko, pr.title_en
      into v_project
      from public.projects pr
     where pr.id = v_row.project_id;
  end if;

  return jsonb_build_object(
    'found',          true,
    'id',             v_row.id,
    'delegate_email', v_row.delegate_email,
    'scope_type',     v_row.scope_type,
    'status',         v_row.status,
    'preset',         v_row.preset,
    'delegator',      to_jsonb(v_delegator),
    'project',        case when v_project is null then null else to_jsonb(v_project) end
  );
end;
$b$;

grant execute on function public.get_delegation_by_token(uuid) to anon, authenticated;

-- == SECTION 3 == get_delegation_detail — owner/delegate/project KO/EN 슬롯 추가
create or replace function public.get_delegation_detail(p_delegation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $c$
declare
  v_uid     uuid := auth.uid();
  v_d       record;
  v_owner   jsonb;
  v_dele    jsonb;
  v_project jsonb;
  v_events  jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'permission_denied');
  end if;

  select d.* into v_d from public.delegations d where d.id = p_delegation_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_d.delegator_profile_id <> v_uid and v_d.delegate_profile_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'code', 'permission_denied');
  end if;

  select to_jsonb(p) into v_owner
    from (select id, username, display_name, display_name_ko, display_name_en, avatar_url
            from public.profiles where id = v_d.delegator_profile_id) p;
  if v_d.delegate_profile_id is not null then
    select to_jsonb(p) into v_dele
      from (select id, username, display_name, display_name_ko, display_name_en, avatar_url
              from public.profiles where id = v_d.delegate_profile_id) p;
  end if;
  if v_d.project_id is not null then
    select to_jsonb(p) into v_project
      from (select id, title, title_ko, title_en
              from public.projects where id = v_d.project_id) p;
  end if;

  select coalesce(jsonb_agg(payload order by created_at desc), '[]'::jsonb)
    into v_events
  from (
    select jsonb_build_object(
      'id', e.id,
      'event_type', e.event_type,
      'target_type', e.target_type,
      'target_id', e.target_id,
      'summary', e.summary,
      'metadata', e.metadata,
      'actor_profile_id', e.actor_profile_id,
      'created_at', e.created_at
    ) as payload, e.created_at
      from public.delegation_activity_events e
     where e.delegation_id = v_d.id
     order by e.created_at desc
     limit 25
  ) sub;

  return jsonb_build_object(
    'ok', true,
    'delegation', jsonb_build_object(
      'id', v_d.id,
      'delegator_profile_id', v_d.delegator_profile_id,
      'delegate_profile_id', v_d.delegate_profile_id,
      'delegate_email', v_d.delegate_email,
      'scope_type', v_d.scope_type,
      'project_id', v_d.project_id,
      'permissions', v_d.permissions,
      'preset', v_d.preset,
      'note', v_d.note,
      'status', v_d.status,
      'invited_at', v_d.invited_at,
      'accepted_at', v_d.accepted_at,
      'declined_at', v_d.declined_at,
      'revoked_at', v_d.revoked_at,
      'expires_at', v_d.expires_at,
      'created_at', v_d.created_at,
      'updated_at', v_d.updated_at
    ),
    'delegator_profile', v_owner,
    'delegate_profile', v_dele,
    'project', v_project,
    'events', v_events
  );
end;
$c$;

grant execute on function public.get_delegation_detail(uuid) to authenticated;

commit;
