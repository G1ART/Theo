-- People 페이지 페르소나 실시간 카운터.
--
-- count_personas(): 페르소나 슬롯 기준 집계(멀티 페르소나는 각 역할 +1).
--   roles 배열이 비어 있으면 main_role 로 보정한다(초기 온보딩 계정 포함).
--   집계만 반환하므로 security definer 로 RLS 를 우회해도 PII 노출 없음.
--
-- 또한 신규 가입/역할 변경이 클라이언트에 실시간 반영되도록 profiles 를
-- supabase_realtime 퍼블리케이션에 추가한다(집계는 이벤트 트리거 후 RPC 재조회).

begin;

-- == SECTION 1 == 페르소나 슬롯 집계 함수
create or replace function public.count_personas()
returns table(persona text, cnt bigint)
language sql
stable
security definer
set search_path = public
as $a$
  with eff as (
    select case
             when p.roles is null or cardinality(p.roles) = 0
               then array[p.main_role::text]
             else p.roles
           end as roles
      from public.profiles p
  )
  select r::text as persona, count(*)::bigint as cnt
    from eff, unnest(roles) as r
   where r = any (array['artist', 'curator', 'gallerist', 'collector'])
   group by r;
$a$;

grant execute on function public.count_personas() to anon, authenticated;

-- == SECTION 2 == profiles 실시간 퍼블리케이션 등록(중복 등록 방지)
do $b$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end;
$b$;

commit;
