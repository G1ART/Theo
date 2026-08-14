-- Staff founder seed + in-app lookup — 2026-08-16
-- 운영진: henry@g-1.art 를 admin 으로 시드하고, UUID 없이 사람 검색으로 부여
--
-- EN: Seed founder admin (no-op if auth.users has no match yet).
--     staff_claim_founder() lets that email self-grant when opening
--     /my/ops/staff after signup. staff_lookup() is admin-only people
--     search (name / username / email). Email is RPC-only — not a
--     PostgREST table grant. Existing staff_grant / staff_revoke stay.
--
-- ===========================================================================
--  HOW TO APPLY (Supabase Dashboard SQL Editor)
-- ===========================================================================
-- This file has 2+ PL/pgSQL function bodies. The Dashboard tokenizer
-- splits on `;` and can leak function bodies as top-level SQL
-- (`relation "v_x" does not exist`).
--
-- Run ONE SECTION AT A TIME: highlight from `-- == SECTION N ==` through
-- the end of that section, click Run, confirm success, then the next.
-- Do NOT paste the whole file and Run once.
--
-- Dollar tags are letters-only (`$claim$`, `$lookup$`). Prefer expression
-- assignment (`v_x := (select …)`) over `SELECT … INTO`.
-- ===========================================================================


-- ===========================================================================
-- == SECTION 1 == seed founder
-- ===========================================================================
-- No-op when henry@g-1.art is not yet in auth.users (do not fail).

insert into public.platform_admins (profile_id, role, note, granted_at)
select u.id, 'admin', 'founder: henry@g-1.art', now()
from auth.users u
where lower(trim(u.email)) = 'henry@g-1.art'
on conflict (profile_id) do update
  set role = 'admin',
      note = coalesce(public.platform_admins.note, excluded.note);


-- ===========================================================================
-- == SECTION 2 == staff_claim_founder
-- ===========================================================================
-- SECURITY DEFINER. Only henry@g-1.art (JWT email and/or auth.users row
-- for the caller uid) may self-upsert as admin. Everyone else gets
-- {ok:false} — no grant, no exception.

create or replace function public.staff_claim_founder()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $claim$
declare
  v_uid uuid;
  v_jwt_email text;
  v_user_email text;
  v_ok boolean;
  v_role text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  v_jwt_email := lower(trim(coalesce(auth.jwt()->>'email', '')));
  v_user_email := lower(trim(coalesce(
    (select u.email from auth.users u where u.id = v_uid),
    ''
  )));
  v_ok := (v_jwt_email = 'henry@g-1.art') or (v_user_email = 'henry@g-1.art');
  if not v_ok then
    return jsonb_build_object('ok', false, 'role', null);
  end if;

  insert into public.platform_admins (profile_id, role, note, granted_at)
  values (v_uid, 'admin', 'founder: henry@g-1.art', now())
  on conflict (profile_id) do update
    set role = 'admin',
        note = coalesce(public.platform_admins.note, excluded.note);

  v_role := (
    select a.role from public.platform_admins a where a.profile_id = v_uid
  );

  return jsonb_build_object('ok', true, 'role', v_role);
end;
$claim$;

comment on function public.staff_claim_founder() is
  'Self-grant admin for founder email henry@g-1.art only. Used when migrate-time seed missed the user.';

revoke all on function public.staff_claim_founder() from public;
grant execute on function public.staff_claim_founder() to authenticated;


-- ===========================================================================
-- == SECTION 3 == staff_lookup
-- ===========================================================================
-- Admin-only people search. Email is returned here only — never via
-- PostgREST grants on auth.users or profiles.

create or replace function public.staff_lookup(p_q text, p_limit int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $lookup$
declare
  v_q text;
  v_limit int;
  v_pat text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_staff_at_least('admin') then
    raise exception 'forbidden';
  end if;

  v_q := nullif(trim(coalesce(p_q, '')), '');
  if v_q is null then
    return '[]'::jsonb;
  end if;

  v_limit := least(greatest(coalesce(p_limit, 8), 1), 20);
  v_pat := '%' || v_q || '%';

  return coalesce((
    select jsonb_agg(q.obj)
    from (
      select
        jsonb_build_object(
          'id', pr.id,
          'username', pr.username,
          'display_name', coalesce(
            nullif(trim(pr.display_name), ''),
            nullif(trim(pr.display_name_ko), ''),
            nullif(trim(pr.display_name_en), '')
          ),
          'email', u.email
        ) as obj
      from public.profiles pr
      left join auth.users u on u.id = pr.id
      where pr.username ilike v_pat
         or pr.display_name ilike v_pat
         or pr.display_name_ko ilike v_pat
         or pr.display_name_en ilike v_pat
         or u.email ilike v_pat
      order by pr.username nulls last, pr.display_name nulls last
      limit v_limit
    ) q
  ), '[]'::jsonb);
end;
$lookup$;

comment on function public.staff_lookup(text, int) is
  'Admin-only profile search by username / display name / email. Email is RPC-only.';

revoke all on function public.staff_lookup(text, int) from public;
grant execute on function public.staff_lookup(text, int) to authenticated;
