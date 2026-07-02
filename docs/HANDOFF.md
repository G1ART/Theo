# Abstract MVP — HANDOFF (Single Source of Truth)

Last updated: 2026-07-02

## 2026-07-02 — QA 리포트 패치 (일괄 업로드 5종 + 외부작가 중복)

QA(2026-07-01, PC/Windows) 5개 이슈 진단·수정.

### 무엇을 했나
1. **제목 일괄 적용에 "모두 같은 제목으로(set)" 모드 추가**
   - `src/app/upload/bulk/page.tsx`: `titleBulkMode`에 `set` 추가, `transformTitle`
     에 set 분기(전체를 동일 제목으로). i18n `bulk.titleModeSet` /
     `bulk.titleSetPlaceholder` (EN/KO). 기존 접두/접미/치환은 유지.
2. **초안 확인 표에 Size 컬럼 추가(인라인 편집)**
   - 일괄 사이즈 적용값이 게시 전 표에서 확인 가능. `updateDraftField`에
     `size`/`size_unit` 처리 추가. 일괄 적용 시 `bulkVersion` 키로 행을
     remount → 저장값 즉시 반영(포커스 유지 위해 per-row onBlur는 remount 안 함).
3. **전시 작품추가에 draft 누출 차단**
   - `src/app/my/exhibitions/[id]/add/page.tsx`: `listMyArtworks({publicOnly:true})`.
     게시 안 된 일괄 초안이 전시 후보로 뜨던 문제 해결.
   - `src/app/e/[id]/page.tsx`: 전시 상세에서 `visibility==='draft'` 방어 필터.
4. **일괄 게시 후 이동 동선을 단일 업로드와 일치**
   - `handlePublish`: 전부 성공 시 전시 유입은 `/my/exhibitions/[id]`(상세),
     일반은 `/u/[username]`(프로필)로 이동. 부분 실패 시에만 현 페이지 유지(재시도).
5. **외부작가 중복(김수철 3행 → 1행) 정리 + 재발 차단**
   - `supabase/migrations/20260702000000_external_artist_email_global_dedupe.sql`.
   - 정책: 같은 이메일이면 **초대자 달라도 전역 병합**, 같은 (초대자,이름)의
     무이메일 행은 이메일 행으로 흡수. `get_or_create_external_artist`를
     이메일 전역 재사용 + 무이메일 흡수(backfill)로 하드닝, 유니크 인덱스를
     `(lower(email)) 전역` + `(invited_by, lower(name)) 무이메일`로 교체.
   - **Supabase SQL: 이미 MCP로 적용 완료** (김수철 43 claims 단일행 확인,
     전역/무이메일 중복 0). 다른 환경 재현 시 위 마이그레이션을 SECTION 단위 실행.

### Verified
- `npx tsc --noEmit` 통과, `npm run build` 통과.
- DB: 김수철 external_artists 1행(43 claims), 전역 이메일 중복·무이메일 중복 없음.

---

## 2026-07-02 — UI/UX 리디자인 2차: 페이지 내부 콘텐츠 재구성

1차에서 씌운 3단 AppShell 위에서, 4개 대상 페이지의 **본문**을 와이어프레임에
맞춰 재구성. 기존 로직(재정렬/권한/좋아요/문의/개인화 피드)은 그대로 보존.

### 무엇을 했나
1. **Explore `/feed` 공개 랜딩 + 5탭 택소노미**
   - `AuthGate` 제거(`src/app/feed/page.tsx`) — 로그아웃 사용자도 접근 가능.
   - 탭: `For you · Artworks · Artists · Exhibitions · All`
     (`FeedHeader.tsx` 교체, `FeedClient.tsx` 라우팅 확장).
     - `For you` = 기존 Living Salon(`FeedContent`)을 `suppressHeader` 로 감쌈.
       로그아웃 클릭 시 `/login?next=/feed?tab=foryou` 로 유도.
     - `Artworks / Artists / Exhibitions / All` = 신규 `ExploreTaxonomyContent`
       가 각각 `listPublicArtworks / listPublicProfiles(role=artist) /
       listPublicExhibitionsForFeed` 로 무한스크롤. `latest/popular` 정렬은
       For you / All 에서만 노출(단일 타입 탭은 필터가 무의미).
   - 비로그인 블러 게이트: 카드에 `locked` 를 넘겨 작가 핸들/캡션을 `blur-sm
     select-none` 처리, 클릭·hover CTA 는 `/login?next=…` 이동
     (`ExploreArtworkCard.tsx`, `ExploreArtistCard.tsx`,
     `ExploreExhibitionCard.tsx`).
   - 하위호환: 기존 `?tab=all|following` 은 로그인 여부에 따라 `foryou` 또는 `all`
     로 매핑(`FeedClient.normalizeTab`).

2. **프로필 `/u/[username]` 역할 상단탭 + 스택 재구성** (`UserProfileContent.tsx`)
   - `isArtistRole()` 이 true 이면서 컬렉터 활동(OWNS claim 또는 명시 role)이
     있는 경우에만 **상단 역할탭** `Artist(main) | Collector` 노출. 단일 역할
     프로필은 탭을 렌더하지 않음(회귀 방지).
   - Artist 탭 = 기존 `ProfileSurfaceCards`(Statement/CV) + 기존 페르소나 스트립
     (All/CREATED/CURATED/…) 그대로. 오너·작품 없음 상태에서 그리드에
     `Upload your work +` 타일 노출.
   - Collector 탭 = `active` 를 `{persona, OWNS}` 로 강제 → 기존
     `filterArtworksByPersona(...,'OWNS')` 재사용 (자기소장 포함). 상단
     Statement/CV·페르소나 스트립은 이 탭에서 숨김.
   - 오너에겐 헤더 우측 `edit profile` → `/settings` CTA 추가.
   - dnd-kit 재정렬, 편집 권한, `PrivateProfileShell` 등 기존 기능 그대로.

3. **작품 상세 `/artwork/[id]` 대형 히어로 레이아웃** (`page.tsx`)
   - 상단 `Back → ArtworkImageStage`(중앙, `max-w-xl`) → 아래에 Title/Artist/
     follow/좋아요/사이즈/가격·문의/전시/story/provenance 스택. 좌우 2단
     그리드를 세로 스택으로 전환하되 **모든 기능 블록(GatedField, 문의, 전시,
     provenance)은 그대로 유지**.

4. **전시 상세 `/e/[id]` 히어로 + 캐러셀 + 큐레이션 그리드** (`page.tsx`)
   - 히어로: 좌측 세로 커버 + 우측 dl(Curator / Location / Exhibition info).
   - `Exhibition Photos`: 기존 media buckets 를 하나로 flatten 해서 좌우
     화살표 캐러셀(`ExhibitionPhotosCarousel` 인라인 컴포넌트, native
     scroll-snap 사용).
   - `Artwork curated`: 참여 작품을 2열 `ExploreArtworkCard` 그리드로.
   - 관리(오너) 링크 / SaveToShortlist / status 라벨은 그대로.

5. **데이터/유틸**
   - `listPublicProfiles({role, limit, cursor})` 신규 (RLS 공개 read,
     `is_public=true`, `main_role` 또는 `roles[]` 매치).
   - i18n 키 en/ko 추가: `feed.tab.*`, `feed.anonHint/anonLockCta`,
     `profile.tab.*`, `profile.editProfile`, `profile.section.*`,
     `profile.collectorEmpty`, `artwork.follow`, `exhibition.photos/curated`,
     `exhibition.curatorLabel/locationLabel/infoLabel`.

### 검증
- `tsc --noEmit` 통과, `npm run build` 통과. **SQL·환경변수 변경 없음**.
- 데스크톱 1440: `/feed?tab=all|artworks|artists|exhibitions` 각 탭 정상 렌더
  (로그아웃 상태에서 작가명·캡션 블러, 카드 hover 시 "Log in to see the full
  view" CTA 노출). 프로필(`blue_greentree`) 역할탭 `Artist(main) | Collector`
  정상 토글, Collector 탭 시 3점 OWNS 작품만 표시, Artist 탭 시 Statement/CV
  카드 + 페르소나 스트립 복귀. 작품 상세 히어로+메타 스택 정상, 전시 상세
  히어로+Exhibition Photos 캐러셀+2열 curated 그리드 정상.
- 모바일 390(CDP): 좌측/우측 aside `display:none`, 상단 header/햄버거 유지,
  프로필 역할탭 그대로 노출.

### SQL / 환경변수
- **Supabase SQL 돌려야 할 것은 없음**.
- 환경변수 변경 없음.

### 아직 남은 것(다음 턴 후보)
- Explore For you 로그인 상태에서 새 UI 카드(ExploreArtworkCard)를 옵션으로
  옮기는 A/B(현재는 기존 Living Salon 카드 유지).
- Theo News 정적 플레이스홀더 → 실데이터 소스 연결.
- 프로필 편집 진입점을 `/settings` 대신 인라인 편집(모달)로 승격.

## 2026-07-02 — UI/UX 리디자인 1차: 3단 AppShell + SUIT 폰트

UI/UX팀 와이어프레임(데스크톱 3단) 기반 공통 셸을 도입. 이번 1차는 **구조/셸
적용까지**이며, 각 페이지 내부 로직/기능은 무수정으로 감싸 기능 크래시가 없도록 함.

### 무엇을 했나
1. **SUIT 폰트 전역 적용** — `next/font/local` 로 self-host(Light~ExtraBold 6웨이트,
   `src/app/fonts/`). `--font-suit` 를 `--font-sans` 스택 최상위로(`globals.css`),
   `layout.tsx` body 에 변수 주입. 한글·라틴 커버, 모노는 기존 유지.
2. **3단 AppShell** (`src/components/shell/`)
   - `AppShell.tsx`: `[좌 사이드바(lg+) | 중앙 본문 | 우 레일(xl+)]`. 중앙은 각
     페이지의 기존 `<main>`/컨테이너를 그대로 감싸 nested `<main>` 회피.
   - `AppSidebar.tsx`: 세로 네비(Theo 로고, Upload/Profile/Notifications/Messages/
     Insights/Explore, 하단 EN·KO 토글/Setting/계정전환/Logout·Login). Header의
     세션·위임·미읽음 로직 재사용. Insights→`/my`(Studio 지표).
   - `RightRail.tsx`: 검색창(→`/people?q=`) + "Theo News" **정적 플레이스홀더**
     (데이터 미연결, 추후 실데이터 교체 시 item 소스만 교체).
3. **셸 적용 라우트** — `/feed`, `/u/[username]`, `/artwork/[id]`, `/e/[id]` 에
   `layout.tsx` 추가로 `AppShell` 래핑. `src/lib/shell/routes.ts`(`isShellRoute`).
4. **반응형/크롬 정리** (`Header.tsx`) — 셸 라우트에서 **데스크톱 상단 네비만 숨김**
   (`lg:hidden`), 모바일은 기존 Header+햄버거 유지. 위임(acting-as) 배너 유지.
5. i18n 키 추가(en/ko): `nav.*`, `shell.*`.

### 검증
- 데스크톱(1440): 프로필/작품/전시 모두 3단 셸 정상. 작품 사이즈 변환 표시 정상
  (`47.2 × 47.2 in`, EN).
- 모바일(390, CDP 측정): `innerWidth 390`, 양쪽 `<aside> display:none`, 본문 풀폭,
  기존 상단 헤더 노출. → 반응형 정상.
- `/feed` 로그아웃 시 `/login` 리다이렉트(기존 동작 유지).
- `tsc --noEmit` 통과, `npm run build` 통과. SQL·환경변수 변경 없음.

### 아직 안 한 것(다음 턴 후보)
- 와이어프레임 **페이지 내부 콘텐츠 세부 정렬**(예: Explore 탭 택소노미
  For you/Artworks/Artists/Exhibitions 로 교체, 작품 상세 이미지 대형 배치 등)은
  기존 기능(피드 all/following·latest/popular 등) 크래시 위험 + 와이어프레임 원본
  재확인 필요로 **보류**. 진행하려면 와이어프레임 재공유 필요.
- 셸의 점진 확산(나머지 라우트).

## 2026-07-01 — 헤더 알림 배지 잘림 수정

아바타 우상단 미읽음 배지("19" 등)가 아바타 원형에 잘려 숫자·빨간 원이 온전히
안 보이던 문제. 원인은 아바타 버튼에 걸린 `overflow-hidden`(이미지를 원형으로
자르려는 용도)이 밖으로 튀어나온 배지까지 함께 잘랐던 것.

- `src/components/Header.tsx`: 버튼에서 `overflow-hidden` 제거, 아바타
  이미지/이니셜만 감싸는 **내부 래퍼**(`overflow-hidden rounded-full`)로 원형
  클리핑을 국한. 배지는 클리핑되지 않는 버튼의 직속 자식으로 두고
  `z-10 ring-2 ring-white pointer-events-none` 로 또렷하게 노출.
- 전체 알림 레드닷 레이어 점검 결과 실제 잘림은 이 한 곳뿐. StudioHero
  위임/네트워크 점(relative 필, 클리핑 부모 없음), 알림페이지/메시지/문의
  배지(모두 inline)는 정상.
- SQL·환경변수 변경 없음. `tsc --noEmit` 통과.

## 2026-07-01 — 작품 사이즈 단위(cm/inch) 정리

업로더·뷰어 모두 헷갈리던 사이즈 단위 처리를 의도대로 재정립. 근본 원인은
전체 작품 343점 중 **298점(87%)이 `size_unit` 비어있음(unitless)** + 텍스트
포맷 난립(`91*72.2`, `9" x 12"`, `42x29.7(cm)`, `53cm x 45.5cm`, `30F` 등) +
표면마다 다른 표시 로직(피드는 단위불명 숨김, 상세는 "약 8F ·" 호수 추정 노출).

### 무엇을 어떻게 고쳤나
1. **표시 재작성** (`src/lib/size/format.ts`)
   - 파서 강건화: `*`, `X`, `×` 구분자, `(cm)`, `"`(inch), `inch`, `cm` 감지.
     텍스트에 박힌 단위는 렌더 시 감지(데이터 변형 아님).
   - 로케일/선호 기반 표시: 한글=cm, 영문=inch 기본. **1 in = 2.54 cm** 변환 후
     **소수점 첫째자리 반올림**(`.0` 은 정수로 표기).
   - **호수는 작가가 직접 입력했을 때만** 라벨 표시(`30F · …`). 자동 추정
     ("약/~ NF") 제거.
   - `size_unit` 컬럼이 진짜 단위의 source of truth. 없으면 텍스트 감지→그래도
     없으면 "단위 미상"으로 수치만(피드는 계속 숨김).
2. **개인 설정(3안) 구현** — `설정 > 작품 사이즈 단위`: 자동/cm/inch 토글.
   `profiles.profile_details.size_unit_pref` 에 영속(unified RPC merge),
   localStorage 미러로 모든 표면 즉시 반영(`src/lib/size/preference.ts`).
   Header 로드 시 서버값→localStorage 하이드레이션.
3. **업로드/편집 UX** — 단일/발크/편집 모두 cm·inch 를 **명시 선택 상태**로 저장.
   기존엔 문자열 suffix 에서 역추론 → 단위 누락 잦음. 이제 셀렉터가 진실이고
   텍스트에 명시 단위가 있으면 셀렉터를 동기화. 발크 기본단위=로케일.

### 데이터/SQL
- **백필 없음**(사용자 결정): 기존 unitless 행은 그대로. 단, 텍스트에 단위가
  박힌 다수 행은 표시 파서가 렌더 시 정상 해석 → 즉시 개선됨.
- **새 마이그레이션 없음.** `size_unit_pref` 는 jsonb merge 라 스키마 변경 불필요.
  → **Supabase SQL 돌릴 것 없음.**
- **환경 변수 변경 없음.**

### 검증
- `test:size-display`(신규)·`test:size-unit-toggle` 통과.
  `website-import`·`feed-*` 회귀 통과. `tsc --noEmit`·`next build` 통과.

## 2026-07-01 — 데이터구조 업그레이드 Phase 3 (claims 무결성)

라이브 감사(위반 0건) 후 `claims` 에 구조 무결성 제약 추가. 멀티 페르소나
조합은 제한하지 않음 — "한 claim 의 작가 참조는 최대 1개", "CREATED 는 작가
1명", "work 당 창작자 claim 1개" 같은 형태 규칙만 강제.

### 적용 SQL — `20260701000004_claims_integrity_phase3.sql` (production 적용 완료)
- `claims_claim_type_valid`: claim_type ∈ {CREATED,OWNS,INVENTORY,EXHIBITED,CURATED,
  INCLUDES_WORK,HOSTS_PROJECT} (provenance/types.ts CLAIM_TYPES 동기).
- `claims_artist_ref_not_both`: `num_nonnulls(artist_profile_id, external_artist_id) <= 1`.
- `claims_created_requires_artist`: CREATED 는 작가 참조 정확히 1개.
- `uq_claims_one_created_per_work`: work 당 CREATED claim 1개.
- CHECK 는 NOT VALID→VALIDATE 패턴으로 무중단 적용. 편집 플로우는 기존 claim 을
  `updateClaim` 으로 in-place 갱신하므로 유니크와 충돌하지 않음.

### 검증
- `test:claims-integrity-phase3` 통과. 라이브 4개 제약 convalidated=true 확인.
  `tsc --noEmit`·`next build` 통과.

### 데이터구조 업그레이드 (Phase 1~3) 완료
- D안(작가 정체성 비정규화)은 멀티 페르소나(작가=갤러리 등) 정당성 때문에 제외.
- 향후 수동 검토: `oh jeong`(2개 이메일), `april ej oh`(오타 이메일 혼재) — 보류.

## 2026-07-01 — 데이터구조 업그레이드 Phase 2 (외부작가 라이프사이클)

비온보딩 작가 → 온보딩 전환을 매끄럽게 만드는 패치. **이메일 정책은 soft**
(사용자 결정): 기본은 초대 이메일 입력을 요구하되 "이메일 없음/나중에 연결"
체크박스로 예외 허용, 예외 케이스는 소유자 연결 RPC로 커버.

### 적용 SQL (production 적용 완료)
- **`20260701000002_external_artist_link.sql`**
  - `link_external_artist_to_profile(ext_id, target_profile_id)`: 초대자(또는 그
    계정/프로젝트 writer)가 외부 작가 행을 실제 프로필에 수동 연결. signup 트리거와
    동일 의미 — `claimed_profile_id` 설정 → claims 이관(`artist_profile_id`,
    `external_artist_id=null`) → `artworks.artist_id` 전환.
  - `list_my_external_artists(inviter)`: 미연결 외부 작가 목록 + 작품 수 + 이메일 유무.
- **`20260701000003_artwork_storage_current_owner.sql`**
  - `can_manage_artworks_storage_path`에 **Shape 5** 추가: 이 storage_path 를 참조하는
    작품의 현재 `artist_id` 가 caller 이면 허용 → 온보딩/연결 후 작가가 (업로더 폴더에
    남아있는) 자기 작품 이미지 바이트를 교체/삭제 가능. `idx_artwork_images_storage_path` 추가.

### 코드
- 신규 페이지 `/my/artists` (초대한 작가 관리): 프로필 검색 → 연결 확인 모달.
  진입 링크는 `/my` 포트폴리오 헬퍼 줄에 추가.
- `src/lib/provenance/externalArtists.ts` (list/link 래퍼).
- 업로드 단일/벌크/편집: 외부 작가 이메일 소프트 필수 + "이메일 없음" 옵트아웃.
- i18n: `myArtists.*`, `upload.externalArtistEmailRequired/NoEmail` (한/영).

### 검증
- `test:external-artist-link-phase2`, `test:external-artist-dedupe-phase1` 통과.
  `tsc --noEmit`·`next build` 통과.

### 다음 (예정)
- Phase 3: `claim_type` enum/CHECK + 작가식별(artist_profile_id XOR external_artist_id)
  + work당 CREATED 1개 무결성(데이터 정리 후 NOT VALID→VALIDATE 단계 적용).

## 2026-07-01 — 데이터구조 업그레이드 Phase 1 (외부작가 정규화 완결 + 정합성)

데이터 구조 심층 점검 후, 벌크/전시/보드/비온보딩작가/프로비넌스가 충돌 없이
돌아가도록 단계적 업그레이드를 시작(Phase 1). **D안(작가 정체성 비정규화)은
의도적으로 제외** — 갤러리 운영자=작가 같은 멀티 페르소나 조합이 정당하므로
claims 기반 유연 모델을 유지한다.

### 적용 SQL (production 적용 완료, MCP)
- **`20260701000000_external_artist_dedupe_phase1.sql`**
  - 2차 병합: 같은 `(invited_by, 이메일)`은 이름 표기 변형까지 한 사람으로 통합,
    이메일 없는 `(invited_by, 이름)` 중복도 병합. **서로 다른 이메일은 병합 금지**
    (복수계정 가능성 — 사용자 규칙).
  - 부분 유니크 인덱스 2개: `uq_external_artists_inviter_email`,
    `uq_external_artists_inviter_name_noemail` (claimed 행 제외) → 중복 재발 차단.
  - `get_or_create_external_artist(p_display_name, p_invite_email)` RPC 추가
    (race-safe: unique_violation 시 재조회). `create_external_artist_and_claim`
    이 이를 재사용. 편집 화면의 `createExternalArtist`도 직접 insert 대신 이 RPC 경유.
- **`20260701000001_provenance_integrity_phase1.sql`**
  - `claims.project_id` FK → **ON DELETE CASCADE** (전시 삭제 풋건 제거;
    `exhibition_works`/`exhibition_media`와 동작 일관).
  - `claims`/`external_artists`/`projects`에 `updated_at` + `tg_set_updated_at` 트리거.

### 검증
- 병합 후 잔여 중복 0 확인. 라이브 스키마에 FK CASCADE / 유니크 인덱스 2 /
  updated_at 3 / helper 1 반영 확인.
- `test:external-artist-dedupe`, `test:external-artist-dedupe-phase1` 통과.
  `tsc --noEmit`·`next build` 통과.

### 수동 검토 권장(미병합, 안전상 보류)
- `oh jeong`: 같은 갤러리가 `aniimal2@naver.com` / `aniimal2js@gmail.com` 두
  주소로 초대 → 복수계정/동일인 여부 확인 후 수동 처리.
- `april ej oh`: `apriloh8@gmail.com` 외에 `"april"`(오타성 이메일)·이메일無 행 혼재.

### 다음 (예정)
- Phase 2: 초대 이메일 필수화(단일/벌크/편집) + 소유자용 외부작가→온보딩 프로필
  연결/병합 RPC·UI + 온보딩 후 이미지 관리용 스토리지 RLS.
- Phase 3: `claim_type` enum/CHECK + 작가식별 XOR + work당 CREATED 1개 무결성.



## 2026-06-30 — 전시 페이지 "← 피드" 백 링크 진입경로 인식

### 문제
- `/e/[id]` 전시 페이지의 뒤로가기 링크가 진입 경로와 무관하게 **항상
  "← 피드"(/feed)** 로 하드코딩되어 있었다. 프로필/룸/숏리스트에서 전시로
  들어와도 피드로 튕겨나갔다.

### 수정 (artwork 의 검증된 패턴 미러링)
- 새 헬퍼 `src/lib/exhibitionBack.ts` (`setExhibitionBack`/`getExhibitionBack`)
  — `artworkBack.ts` 와 동일한 sessionStorage 기반 "진입 경로 stamp → 상세에서
  읽기" 패턴. 진입 경로별로 라벨도 매핑(피드/프로필/내 스튜디오/보드).
- 전시로 진입하는 표면 4곳이 클릭 시 자기 경로를 stamp:
  `feed/ExhibitionMemoryStrip`, `UserProfileContent`(프로필 전시 목록),
  `room/[token]`, `my/shortlists/[id]`.
- `e/[id]/page.tsx` 가 `getExhibitionBack()` 로 백 링크의 경로/라벨을 결정
  (클라이언트 useEffect 에서 읽어 hydration 안전).
- 참고: 작품 상세(`/artwork/[id]`)는 이미 동일 패턴(`artworkBack`)으로 진입경로
  인식이 되어 있었음(변경 없음).

### 아직 남은 유사 케이스(우선순위 낮음, 미수정)
- `/notifications` 의 "← 피드" 는 전역 진입(헤더 종)이라 고정 피드도 무난.
- `/my/exhibitions/[id]`(관리) 의 "← 내 정보(/my)" 는 관리 페이지의 홈이
  /my 라 합리적. (공개 전시 → 전시 관리 진입 시엔 /my 로 가는 미세한 비대칭만 존재.)

### 검증
- `test:exhibition-back-context` 통과. `tsc --noEmit`·`next build` 통과.
  SQL/환경 변수 변경 없음.



## 2026-06-30 — 외부(초대 전) 작가 엔티티 정규화(dedupe)

### 배경 / 근본 원인
- 비온보딩 작가의 작품을 업로드할 때마다 `create_external_artist_and_claim`
  이 **매번 새 `external_artists` 행**(난수 id)을 만들었다. 그래서 같은
  작가(예: "김수철")의 작품이 `external_artist_id` 기준으로는 작품 수만큼
  쪼개졌고, 전시 페이지 "작가별 섹션"이 한 작가를 여러 섹션으로 분해했다.
- 이전 임시 픽스(이름 기준 그룹핑)는 표시는 맞췄지만 **동명이인을
  구분 못 하는 한계**가 있었다. 이번에 "변동 없는 유니크 엔티티"로
  정규화하는 정공법으로 전환.

### 변경 (SQL — 적용 필요)
- **`supabase/migrations/20260630000000_external_artist_dedupe.sql`** — ✅ production 적용 완료(MCP).
  - **SECTION 1 (백필):** 기존 중복 `external_artists`를 정규화된
    `display_name` 기준으로 canonical 1행으로 병합 → `claims.external_artist_id`
    재지정 → 잔여 행 삭제. 안전장치:
    - 같은 이름에 **서로 다른 non-null 이메일이 2개 이상**이면 동명이인
      가능성으로 **병합 건너뜀**(가드). → 적용 후 남은 그룹: `oh jeong`,
      `april ej oh` 2건. **이 둘은 수동 검토 필요**(같은 사람의 두 이메일인지,
      실제 동명이인인지 확인 후 수동 병합/분리).
    - canonical은 invite_email 보유 행 우선(가입 시 이메일 매칭 트리거 유지),
      없으면 최초 생성행. 이미 온보딩된(`claimed_profile_id` not null) 행은 미변경.
  - **SECTION 2 (업로드 dedupe):** `create_external_artist_and_claim` 이 같은
    초대자에 대해 `(이메일 있으면 이메일, 없으면 이름)` 기준으로 **기존 행을
    재사용**하도록 수정. → 앞으로 `external_artist_id`가 작가당 안정적.
    위임(writer) 가드/시그니처/반환형은 그대로 유지.

### 변경 (프론트)
- `getArtworkArtistGroupKey()`(`src/lib/supabase/artworks.ts`)를 **안정화된
  `external_artist_id` 우선**으로 전환(이름은 id 없을 때만 폴백). 정규화
  이후 한 작가의 작품이 한 섹션으로 모이고, 진짜 동명이인(다른 행/이메일)은
  분리된다. 검증: 전시 `7e9f2db5…`의 김수철 8점 → 단일 id로 통합 확인.

### 후속 검토 과제(별도)
- 비온보딩 작가를 **매 업로드마다 재초대**하는 UX 자체 개선(작가 선택/재사용
  UI, 초대 이메일 필수화, 온보디드/비온보디드 작가 통합 관리 관점).

### 검증
- `test:external-artist-dedupe`, `test:external-artist-name-everywhere` 통과.
- `tsc --noEmit`·`next build` 통과. SQL production 적용 완료. 환경 변수 변경 없음.



## 2026-06-29 — 브랜드명 변경: Abstract → Theo

- 플랫폼 이름이 **Abstract → Theo** 로 변경됨 (GitHub/Vercel 프로젝트명도 theo 로 변경됨). 로고 이미지는 추후 첨부 예정.
- 변경 범위(사용자 노출 + 브랜드 표기):
  - 헤더 로고(`Header.tsx`), 로딩 화면(`page.tsx`, `AuthGate.tsx`, `onboarding/*`), 메타데이터 타이틀(`layout.tsx`).
  - i18n 전체 문자열(`messages.ts`, 한/영) — 단 미술 용어 "Abstraction"(추상)은 유지.
  - 초대/위임 이메일(`api/artist-invite-email`, `api/delegation-invite-email`), 투어 카피(`tourKoCopy.ts`).
  - AI 시스템 프롬프트/세이프티(`lib/ai/prompts`, `lib/ai/safety.ts`, `lib/ai/types.ts`) — 모델이 플랫폼명을 Theo 로 칭하도록.
  - 임포트 봇 User-Agent(`crawlSite.ts`, `cv/extract.ts`) → Theo* / theo.art.
  - README 제목.
- **의도적으로 유지(브랜드 표기 아님):**
  - 내부 타입 식별자 `AbstractActionVerb`(`persona/actionGrammar.ts`) — 크로스파일 리팩터링이라 별도 작업으로 분리.
  - 과거 작업지시서 파일명 참조 주석(`Abstract_..._.md`) — 실제 파일명 레퍼런스.
  - `docs/` 내 과거 기록 문서 — 히스토리 보존.
- SQL/환경 변수 변경 없음. `tsc --noEmit`·`next build` 통과.


## 2026-06-29 — QA 3건: 전시 작가 그룹핑 / 외부 작가명 게시물 단위 / 온보딩 배너 루프

### 이슈 1 — 전시 페이지에서 여러 작가 작품이 "한 작가"로 묶임
- **원인:** 전시 작가별 섹션 그룹 키가 `artwork.artist_id`(= 업로더 갤러리,
  외부 작가 작품끼리 동일)였다. `artist_id`가 항상 truthy라 서로 다른 외부
  작가(예: 최지인·이의연) 작품이 한 버킷으로 합쳐지고 섹션 헤더에 첫 작품의
  작가명만 표시됨.
- **수정:** `getArtworkArtistGroupKey()` 공통 헬퍼(`src/lib/supabase/artworks.ts`)
  추가 — 외부 작가는 `external_artist_id` 기준으로 분리, 온보딩 작가는 기존
  `artist_id` 유지. `src/app/e/[id]/page.tsx`, `src/app/my/exhibitions/[id]/page.tsx`
  적용.

### 이슈 3 — 외부(미온보딩) 작가명이 게시물 단위에서 업로더명으로 표시 + 링크 오연결
- **원인:** 피드는 외부 작가명을 맞게 표시했지만, 작품 상세 헤더는
  `formatIdentityPair(artwork.profiles)`(갤러리)가 `getArtworkArtistLabel`보다
  우선 표시됐고, 피드의 작가명 링크는 `artistProfile.username`(갤러리)로 갔다.
  룸/숏리스트 RPC는 `prof.display_name`(artist_id=갤러리)만 사용.
- **수정:**
  1. 공통 컴포넌트 `src/components/artwork/ArtworkArtistName.tsx` — 표시명은
     **항상 작가명**. 온보딩 작가는 `/u/<handle>` 직접 링크, **외부 작가는
     클릭 시 "아직 온보딩이 완료되지 않은 작가예요 …" 확인 모달(ConfirmActionDialog)
     후** 업로드한 계정으로 이동. 링크 대상 없으면 일반 텍스트.
  2. `FeedArtworkCard`, 작품 상세 헤더(`artwork/[id]/page.tsx`)가 이 컴포넌트
     사용. 상세는 외부 작가일 때 갤러리 핸들/역할뱃지/팔로우 숨김.
  3. **마이그레이션** `supabase/migrations/20260629000000_external_artist_name_everywhere.sql`
     (**production 적용 완료 + schema_migrations 동기화**):
     - 헬퍼 `artwork_display_artist_name(work_id, fallback)` — 공개/confirmed
       claim의 외부 작가명(CREATED 우선) 반환, 없으면 업로더명.
     - 룸 RPC `get_room_for_viewer_by_token`, 숏리스트 RPC
       `get_shortlist_items_by_token`가 이 헬퍼로 `artwork_artist_name` 해석.
  4. i18n `artwork.externalArtistRedirect.*`(EN/KO) 추가.

### 이슈 2 — 신규 가입 "한 단계만 더 남았어요" 배너 무한 루프 / 스튜디오 진입 불가
- **원인:** `RandomIdBanner`·`Header`가 루트 레이아웃에 상주하면서 프로필을
  **마운트 시 1회만** 읽음. App Router는 클라이언트 이동 시 루트 레이아웃을
  리마운트하지 않으므로, 온보딩 저장이 DB에 반영돼도 배너는 placeholder 상태로
  남고 "내 스튜디오" 링크가 계속 `/onboarding/identity`를 가리켜 루프.
- **수정:**
  - 저장 SSOT `saveProfileUnified` 성공 시 `window` `profile-updated` 이벤트
    디스패치(SSR 가드).
  - `RandomIdBanner`: `profile-updated` + `auth.onAuthStateChange` 구독해
    재조회, 체크에 `main_role` 포함(서버 `get_my_auth_state`와 정렬).
  - `Header`: `profile-updated` 구독해 username/아바타(=내 스튜디오 링크) 갱신.
  - 온보딩 저장 라우팅에 read-after-write 방어 재조회(`getMyProfile` completeNow).
- **SQL:** 이슈 2는 코드 전용(추가 SQL 없음).

### Supabase SQL
- 적용 필요: `20260629000000_external_artist_name_everywhere.sql` →
  **이미 production 적용 + schema_migrations 동기화 완료** (헬퍼 동작 검증:
  이의연/Namu Choi 등 외부명 정상 해석).

### 후속 픽스 — 외부 작가 확인 모달 텍스트 오버플로우
- 증상: 피드에서 외부 작가명 클릭 시 뜨는 확인 모달 본문이 박스 밖으로 넘침.
- 원인: 모달이 피드 카드의 `truncate`(=`white-space: nowrap`) 작가명 span 안에서
  렌더되어 그 속성을 **상속** → 본문이 한 줄로 렌더.
- 수정: 공유 `ConfirmActionDialog` 박스에 `whitespace-normal break-words text-left`
  추가(상속 리셋). 메시지 텍스트 자체는 변경 없음(한/영 그대로 정상 표기).

### Verified
- `tests/external-artist-name-everywhere.test.ts`,
  `tests/onboarding-banner-refresh.test.ts`,
  `tests/external-artist-public-credit.test.ts` 통과.
- `tsc --noEmit` 통과, `next build` 통과.



## 2026-06-27 — 외부(초대 전) 작가 표기명이 제3자에게 안 보이던 버그 (QA)

### 증상
갤러리가 아직 온보딩 안 한 작가 이름을 넣고 이메일 초대 후 업로드하면,
피드/작품 상세/전시에서 **비로그인·제3자 뷰어에게는 작가 자리에 외부
작가명(예: 김수철)이 아니라 업로더 계정명(예: 지원닷아트코리아)**이 노출.

### 원인 (확정)
- `claims` 는 public SELECT 가 열려 있으나, `external_artists` 는
  `external_artists_all_own (invited_by = auth.uid())` 정책 하나뿐이라
  **초대한 갤러리 본인만** 읽을 수 있었음.
- 그래서 `claims(..., external_artists(display_name, invite_email))`
  임베드가 제3자에게는 external_artists 행을 **null** 로 반환 →
  표시 로직(`FeedArtworkCard` / `getArtworkArtistLabel`)이 외부명이
  없으면 `artworks.artist_id`(=갤러리)로 폴백 → 갤러리명 출력.
- anon 롤 시뮬레이션으로 확정 (claim 은 보이고 display_name 만 null).
- 피드뿐 아니라 작품 상세·전시 페이지 동일 영향(셋 다 같은 임베드).

### 수정 (A안 — 정규화 유지, SQL + 코드)
- **마이그레이션** `supabase/migrations/20260627000000_external_artist_public_credit.sql`
  (production `apply_migration` 적용 완료 + `schema_migrations` 동기화):
  1. `external_artists_select_public` 정책 — **공개(visibility='public')·
     confirmed claim 에서 참조되는 행만** 누구나 SELECT 가능 →
     display_name 공개.
  2. `invite_email`(PII) 차단 — 테이블 SELECT 를 anon/authenticated 에서
     **revoke** 후 invite_email 을 **제외한** 컬럼만 재부여.
     (컬럼 레벨 revoke 만으로는 테이블 grant 가 있으면 무효라 테이블
     revoke + 컬럼 grant 조합 사용.) 소유자도 직접 임베드로는 못 읽음.
  3. `get_external_artist_invite_email(uuid)` SECURITY DEFINER RPC —
     초대자 본인(`invited_by = auth.uid()`)에게만 invite_email 반환.
- **코드**:
  - `src/lib/supabase/artworks.ts`: 공개 임베드 3곳
    (ARTWORK_SELECT / getArtworkById / getArtworksByIds)에서
    `external_artists(display_name, invite_email)` →
    `external_artists(display_name)`. `ArtworkClaim` 타입에서 invite_email 제거.
  - `src/lib/provenance/rpc.ts`: `getExternalArtistInviteEmail()` 추가.
  - `src/app/artwork/[id]/edit/page.tsx`: 편집 프리필을 임베드 대신
    위 RPC 로 조회(비초대자는 빈 값).
- **회귀 보호**: `tests/external-artist-public-credit.test.ts`
  (정책/권한/RPC/임베드 계약 검증).

### Supabase SQL 적용 필요
- `20260627000000_external_artist_public_credit.sql` — production 적용 완료.
  로컬/스테이징은 SQL Editor 에서 실행.

### 환경 변수
- 추가 없음.

---

## 2026-06-26 — QA 12건 일괄 수정·업그레이드 (Wave 5)

Wave 5 까지 모든 코드 변경 완료. 멀티 이미지 / 대체 뷰 / cm·in 단위
토글 / 매체 datalist / CV PDF 업로드 + 공개 다운로드.

### Wave 5 #2 + #5 — 작품당 멀티 이미지 + 대체 뷰

- **스키마** (`supabase/migrations/20260626100000_qa_wave5_schema_extensions.sql`,
  production 적용 완료):
  - `artwork_images.view_type text not null default 'wall_mounted'` +
    `('wall_mounted','detail','angle','in_situ','other')` 체크 제약.
  - `profiles.cv_pdf_path text` (Wave #6 에서 사용).
- **타입/SDK** (`src/lib/supabase/artworks.ts`):
  - `ArtworkImage.view_type`, `attachArtworkImage(opts: { sortOrder?, viewType? })`.
  - 모든 `artwork_images` SELECT 에 `view_type` 포함
    (`shortlists`, `import/website/session/.../match` 포함).
- **단일 업로드** (`src/app/upload/page.tsx`):
  - 단일 `image` 상태 → `images: PendingImage[]` 로 교체. 다중 첨부,
    이미지별 view_type select, 위/아래 순서 변경, 삭제 지원. 첫 번째 이미지
    = primary (`sort_order=0`). 업로드 실패 시 직전까지 attach 된
    이미지들을 best-effort 롤백.
- **상세 캐러셀** (`src/components/artwork/ArtworkImageStage.tsx`):
  - 이전/다음 버튼 + 키보드 ArrowLeft/Right + thumbnail strip +
    카운터 캡션 (view N of M · {viewType}). 라이트박스도 현재 인덱스 노출.
- **i18n**: `upload.multiImageHint`, `upload.imagePrimaryChip`,
  `upload.imageViewTypeLabel`, `upload.imageMoveUp/Down/Remove`,
  `upload.viewType.{wallMounted|detail|angle|inSitu|other}`,
  `artwork.carouselPrev/Next/Counter/Thumbs` (EN/KO).

### Wave 5 #4 — 단위(cm/in) · 매체 datalist

- **`src/lib/size/format.ts`**:
  - `setSizeUnitSuffix(size, unit)`: cm ↔ in 접미사 안전 교체. hosu
    (`^\s*\d+\s*[FPMS]\b`) 는 cm-anchored 라 손대지 않음. 단위 없는
    문자열은 unit 추가. `parseSizeWithUnit` 와 round-trip 보장.
  - `detectSizeUnit(size, locale)`: 명시 접미사 우선, 없으면 locale
    (ko → cm, 그 외 → in).
- **단일 업로드 + 작품 편집** (`src/app/upload/page.tsx`,
  `src/app/artwork/[id]/edit/page.tsx`):
  - size 인풋 옆에 `cm` / `in` aria-pressed 토글 버튼.
  - medium 인풋에 `datalist` (TAXONOMY.mediumOptions 14종) — 자유입력 보존.
- 회귀 보호: `tests/size-unit-toggle.test.ts`.

### Wave 5 #6 — CV PDF 업로드 + 공개 다운로드

- **DB**:
  - `supabase/migrations/20260626200000_qa_wave5_cv_pdf_rpc.sql` —
    SECURITY DEFINER `update_my_cv_pdf_path(text)`. owner 폴더
    접두사 검증, profile_updated_at 동기화.
  - `supabase/migrations/20260626300000_qa_wave5_lookup_profile_cv_pdf.sql` —
    `lookup_profile_by_username` 공개 분기에 `cv_pdf_path` 노출 +
    부수 회귀픽스로 `viewer_follow_status` 복구 (20260601400000 에서
    누락 → PrivateProfileShell follow 버튼이 항상 "none" 으로 떨어지던
    이슈).
- **Storage** (`src/lib/supabase/storage.ts`): `uploadProfileCvPdf`,
  `removeProfileCvPdf`, `getProfileCvPdfUrl`, `PROFILE_CV_MAX_BYTES = 10MB`,
  `ProfileCvValidationError`. `artworks` 버킷의 owner 폴더에 저장하므로
  기존 storage RLS 그대로 통과 (Shape 1).
- **UI**:
  - `src/app/my/profile/cv/CvPdfUploader.tsx` 신설 + `CvEditorClient`
    하단에 통합 — 업로드/교체/삭제 + 새 탭 열기 + 다운로드. RPC 실패
    시 storage 롤백, 교체/삭제 시 이전 파일 best-effort 정리.
  - `ProfileSurfaceCards.cvPdfPath` prop 추가 — CV 모달 상단 칩으로
    "CV(PDF) 다운로드" 노출. PDF 만 있어도 visitor 에게 CV 카드 표시.
- **타입/셀렉터**: `ProfilePublic.cv_pdf_path`, `PROFILE_ME_SELECT` 확장.
- **i18n**: `cv.pdf.*` (title/lead/upload/replace/remove/empty/preview/
  download/sizeLimit/errors/toasts), `profile.public.cvPdf`.
- 회귀 보호: `tests/profile-cv-pdf.test.ts` (SQL 계약 — cv_pdf_path
  노출, viewer_follow_status 복구, owner 폴더 가드, 스키마 컬럼).

### Wave 5 — Supabase SQL 적용 필요 (요약)

- `20260626100000_qa_wave5_schema_extensions.sql`
- `20260626200000_qa_wave5_cv_pdf_rpc.sql`
- `20260626300000_qa_wave5_lookup_profile_cv_pdf.sql`

Production 은 본 작업에서 `apply_migration` MCP 로 모두 적용 완료
(`schema_migrations` 동기화 포함). 로컬/스테이징은 SQL Editor 에서
파일 순서대로 실행.

### Wave 0 — 배포 설정 (사용자 액션 필요, 코드 외)

- **환경 변수**:
  - Vercel `NEXT_PUBLIC_APP_URL` = 운영 도메인 그대로 (예:
    `https://abstract-mvp-dxfn.vercel.app` 또는 새로 붙인 Porkbun
    도메인). 설정 후 Redeploy.
- **Supabase Dashboard → Authentication → URL Configuration**:
  - **Site URL** = `NEXT_PUBLIC_APP_URL` 과 동일한 값.
  - **Redirect URLs (allowlist)** 에 다음 3 개 추가:
    - `https://<운영 도메인>/auth/callback`
    - `https://<운영 도메인>/auth/reset`
    - `https://<운영 도메인>/set-password`
  - 로컬 개발용 `http://localhost:3000/auth/callback`,
    `http://localhost:3000/auth/reset` 도 함께 유지.
- **검증**: `/auth/forgot` 에서 본인 메일 → 링크가 운영 도메인의
  `/auth/reset?…` 로 떨어지는지 1 회 확인.
- 자세한 단계는 `docs/03_RUNBOOK.md` → "Supabase Auth redirect URLs"
  섹션과 `.env.example` 의 `NEXT_PUBLIC_APP_URL` 주석 참고.

---

## 2026-06-26 — QA 12건 일괄 수정·업그레이드 (Wave 1-4)

### Wave 1 — 퀵픽스 3건

- **#7 일괄 업로드 스크롤·포커스 튐** (`src/app/upload/bulk/page.tsx`)
  - `fetchDrafts(opts?: { silent?: boolean })` 도입. 필드 저장 / 일괄
    적용 / 웹사이트 import 새로고침은 `silent: true` → `<table>` 가
    더 이상 `Loading…` 으로 언마운트되지 않아 스크롤·포커스 유지.
  - 초기 로드와 발행 후 새로고침만 정상 로딩 게이트 유지.
- **#9 위임 권한 모달 닫힘 루프** (`src/app/my/delegations/page.tsx`)
  - 드로어 `onClose` 에서 `?openId&action=update` 쿼리 정리,
    `consumedDeepLinkRef` 1회 가드 추가 → 알림 딥링크 1회만 소비,
    X 클릭 후 모달 재오픈 차단.
- **#11 [관리하기] 라우팅 정리** (`src/lib/delegation/manageDestination.ts`)
  - 모든 mutation 가능 project preset → `/my/exhibitions/{id}` 허브로
    통일 (이전: `/edit` 또는 `/add` 직행). `project_review` 는 기존
    view-only stay 유지.

### Wave 2 — Publish failed 근본수정 + 부분성공 UX (#8)

- **근본 원인**: `publishArtworksWithProvenance` 가 claim RPC 에
  `work_id` + `project_id` 동시 전달 → DB invariant
  `exactly one of work_id, project_id required` 로 모든 CURATED 일괄
  publish 가 실패. 토스트는 `error instanceof Error` 분기라
  PostgREST 에러를 못 잡고 "Publish failed"만 노출.
- **수정** (`src/lib/supabase/artworks.ts`, `src/app/upload/page.tsx`,
  `src/app/upload/bulk/page.tsx`):
  - `PublishWithProvenanceOptions.projectId` 제거, claim 호출에서도
    `projectId` 미전달. 전시 연결은 기존 `addWorkToExhibition` 로 일원화.
  - 결과를 per-work `PublishWithProvenanceResult.results` 배열로 반환
    → 부분 성공 토스트("N점 중 M점만 게시했어요. X점은 게시하지 못했어요
    — <사유>") + 실패분은 draft 유지·성공분만 public.
  - `formatSupabaseError(error, t, "upload.publishFallback")` 로 사유별
    친화 메시지 (권한/용량/네트워크) — `upload.publishFallback /
    publishAllFailed / publishPartial` i18n EN/KO 추가.
  - 단일 업로드 기존작가 경로의 claim 에서도 동일한 `projectId` 제거.

### Wave 3 — Header sticky 상단 고정 (#1)

- `src/components/Header.tsx`: staleCleared / acting-as 배너 + 메인 바를
  하나의 `sticky top-0 z-40 bg-white` 컨테이너로 감쌈. 깊은 링크 / SSR
  스크롤 진입에서도 첫 페인트부터 헤더가 보이도록 보장. `z-40` 으로 두어
  모달(z-50+) 이 자연스럽게 위로 떠 동작 보존.

### Wave 4 — project-scope 위임 작품 업로드 (#10)

- **SQL 마이그레이션 필요**: `supabase/migrations/20260626000000_qa_project_delegate_artwork_upload.sql`
  (Supabase SQL Editor 에서 **섹션별로 실행** — PL/pgSQL 함수 3개 포함).
  본 작업에서 `apply_migration` MCP 로 production DB 에 이미 적용 완료.
- **추가된 helper**:
  - `is_active_project_delegate_works_writer(p_owner uuid)` — project-scope
    delegations 중 `manage_works` 보유한 활성 위임이 있으면 true.
  - `is_active_writer_for(p_owner uuid)` — account-scope writer OR
    project-scope works writer. claim RPC 에서 사용.
- **확장된 RLS / RPC**:
  - `can_manage_artworks_storage_path` — Shape 4 (principal folder 에
    project-scope writer 가 쓸 수 있음) 추가.
  - `artworks_update_project_delegate` / `artworks_delete_project_delegate`
    정책 신설.
  - `artwork_images_insert_project_delegate` / `_update_` / `_delete_`
    정책 신설.
  - `create_claim_for_existing_artist` / `create_external_artist_and_claim`
    SECURITY DEFINER 가드를 `is_active_writer_for` 로 일원화 — project-scope
    writer 도 CURATED claim 을 principal 명의로 등록 가능.
- **UI 정리** (`src/components/delegation/UpdatePermissionsModal.tsx`):
  project-scope 위임 권한 편집에서 RLS 효과가 없는 account-wide 토큰
  (manage_artworks 등) 을 가림 → `view / edit_metadata / manage_works`
  3 종으로 축소. `DelegationDetailDrawer` 에서 `scopeType` 전달.

### 검증
- `npx tsc --noEmit` 통과.
- 새 회귀 테스트: `tests/delegation-manage-destination.test.ts`,
  `tests/publish-with-provenance-no-project.test.ts`,
  `tests/header-sticky.test.ts`,
  `tests/project-delegate-artwork-upload.test.ts` (모두 통과).

### Supabase SQL 적용 필요 (재현용)
- `supabase/migrations/20260626000000_qa_project_delegate_artwork_upload.sql`
  — production 은 이미 `apply_migration` 으로 적용 완료(`schema_migrations`
  에 `20260626000000` 등록). 로컬/스테이징 환경에 동기화 시 동일 파일
  실행 필요 (SQL Editor 에서 **섹션 단위 실행** 권장).

### 환경 변수
- 추가 없음 (Wave 0 에서 `NEXT_PUBLIC_APP_URL` + Supabase Site URL
  콜아웃은 별도 — 상단 Wave 0 섹션 참조).

---

## 2026-06-05 — QA 오류/제안 리포트 3건 (availability 게이트 / 문구 한국어화 / 프로비넌스 온보딩 가드)

### 1. 작품 상세 — availability 게이트가 "두 번" 뜨고 첫 칸 무반응 (오류, 2026-06-01)

- **위치**: `src/app/artwork/[id]/page.tsx` (availability + price 게이트 렌더 블록).
- **원인**:
  - 한정공개(예: mutuals) 작품은 availability·price 두 필드가 각각 게이트 박스를 그려 거의 동일한 문구가 두 번 나란히 뜸(②의 영문 `availability` 미번역까지 겹쳐 "같은 칸 반복"으로 인지).
  - availability 게이트에 **`onAskAboutWork` 가 누락**되어, price 류 필드의 보조 "이 작품 문의" 버튼(`shouldShowSecondaryInquiryCta`)이 **죽은 no-op** → "첫 번째 칸 클릭 무반응". price 게이트만 핸들러가 있어 "두 번째 칸 반응".
- **수정**:
  - availability·price 가 **같은 공개대상+요청모드**로 둘 다 게이트될 때는 **단일 병합 게이트**(`fieldKey="price_availability"`, 문구 "가격과 소장 가능 여부를 …") 하나만 렌더 → 중복 인상 제거.
  - 분리 렌더 시에도 availability 게이트에 `onAskAboutWork` 연결 → 문의 버튼 항상 동작.
  - `cta.ts` `PRICE_FIELDS` 에 `price_availability` 추가(병합 게이트도 inquiry CTA 제공).
  - 값이 보이는 경우(소장상태/가격)는 기존과 동일하게 인라인 표시 — 동작 보존.

### 2. availability 문구 한국어화 + 조사 정리 (제안, 2026-06-01)

- **위치**: `src/lib/visibility/copy.ts` (게이트 문구 생성기, room/artwork 공용).
- **원인**: KO 명사 매핑이 `availability: "availability"`(영문) + 모든 문장이 하드코딩 `…을(를) 공개합니다.`.
- **수정**:
  - availability → **"소장 가능 여부"** 한국어화. exhibition_preview 도 한국어 종결("전시 전 미리보기")로 정리.
  - **받침(jongseong) 기반 조사 헬퍼** `objectParticleKo` 도입 — `(code-0xAC00)%28` 으로 을/를 단일 선택, 비-한글 종결은 "를" 폴백. `을(를)` 플레이스홀더를 **모든 게이트 문장**(가격·노트 등 포함)에서 제거.
  - 예) "…소장 가능 여부를 공개합니다.", "…가격을 공개합니다.", 병합 "…가격과 소장 가능 여부를 공개합니다."

### 3. 프로필 설정 전 소장/큐레이팅 기록 → 프로비넌스에 "설정 중인 프로필" 고정 (오류, 2026-06-01)

- **위치**: `create_claim_request` RPC + `src/app/artwork/[id]/page.tsx`.
- **진단(실데이터)**: "Moment with Moments"의 OWNS claim 이 가리키는 프로필이 **플레이스홀더**(`user_7d79b96eec1a`, display_name null, completeness 0). 이 계정 이메일은 `sienna.m.ko@gmail.com` → **Sienna Ko 본인의 미완성 2번째 계정**. 작가 프로필(`siennamko`)은 별개 auth 계정이라, 화면이 중립 라벨 "설정 중인 프로필"을 정확히 보여줘도(표시 로직 정상) **완료 프로필이 영원히 반영 불가**. claim 생성 RPC 에 온보딩 가드가 전혀 없어 미완성 계정도 OWNS/CURATED/EXHIBITED claim 생성 가능(큐레이팅 동일 경로 → 동일 증상).
- **수정**:
  - **서버 가드(권위)**: `create_claim_request` 에 subject 프로필이 placeholder(`is_placeholder_username`)이면 `profile_incomplete` 예외(errcode P0001). 마이그레이션 `20260622000000_qa_claim_onboarding_guard.sql`. 아티스트-귀속 RPC(`create_external_artist_and_claim`/`create_claim_for_existing_artist`)는 의미가 달라 범위 제외.
  - **클라이언트 안내**: `handleRequestClaim` 에서 `profile_incomplete` 감지 시 친절 문구(`errors.claimProfileIncomplete`) + 1.2초 후 `/onboarding` 이동.
  - **이 레코드(데이터)**: Sienna Ko 중복계정/잘못된 claim 은 코드 예방과 별개로 케이스별 수동 처리 필요(이번 패치 범위 외).

### 검증

- `npx tsx tests/visibility-copy.test.ts` ✅ · `tests/relationship-access.test.ts` ✅
- KO 문구 샘플 출력으로 조사/병합 문구 육안 확인 ✅
- `npx tsc --noEmit` — 신규 에러 0 (사전 `.next/types/routes.d 2.ts` 중복파일 노이즈만)
- 수정 파일 ESLint — 신규 문제 0 (artwork page 159/407/417 등은 사전 `set-state-in-effect` 노이즈, 이번 diff 무관)

### Supabase SQL (적용 필요)

- **이미 production 에 `apply_migration` 으로 적용 완료** + `schema_migrations` 에 `20260622000000` 기록 동기화함.
- 파일: `supabase/migrations/20260622000000_qa_claim_onboarding_guard.sql` (단일 PL/pgSQL 함수 → 한 블록 실행 가능). 다른 환경 적용 시 그대로 실행.

### 환경 변수

- 추가/변경 없음.

---

Last updated (prev): 2026-05-29

## 2026-05-29 — QA 오류 리포트 3건 핫픽스 (일괄 업로드 / 설정 저장 / AI 제안 404)

### 1. 일괄 업로드 — 제목 입력칸이 너무 작음 (오류, 2026-05-18)

- **위치**: `src/app/upload/bulk/page.tsx` 초안 목록 테이블의 제목 `<input>`.
- **원인**: `table-auto` + 8개 컬럼 구조에서 제목 컬럼에만 최소 너비가 없어, 상태 컬럼의 긴 "누락: …" 텍스트가 가로폭을 잠식하면 제목 칸이 ~150px로 쪼그라들었다. `w-full` 은 td 너비의 100%일 뿐 td 자체를 넓혀주지 못함.
- **수정**: 제목 `<th>`/`<td>` 에 `min-w-[220px]`, input 에 `min-w-[200px]` 부여. 순수 시각, 데이터 흐름 변경 0.

### 2. 헤더 이미지만 수정 후 저장 → "변경 사항 없음" 오메시지 (오류, 2026-05-18)

- **위치**: `src/app/settings/page.tsx`.
- **원인(데이터 손실 아님, 메시지 오인)**: 커버/아바타/포커스/스테이트먼트-히어로 같은 미디어 필드는 변경 즉시 `persistIdentityField` 로 **자동 저장**된다. 그래서 그 필드만 바꾼 뒤 [저장] 을 누르면 base/details diff 가 비어 `common.noChanges` ("저장할 변경 사항이 없습니다") 가 떴고, 실제로는 이미 저장된 상태라 사용자가 실패로 오인.
- **수정**: `mediaSavedSinceSaveRef` 도입. 미디어 자동저장 성공 시(`persistIdentityField`) `true`, 전체 저장 성공 시 `false` 리셋. 메인 저장이 diff 없음이지만 미디어가 자동저장된 적 있으면 → "변경 없음" 대신 **성공 메시지(`setSaved(true)` → 초록색 `settings.saveSuccess`)** 표시.

### 3. 프로필 AI 제안 → "작가 소개문/거주도시 추가" 클릭 시 404 (오류, 2026-05-28) — P0

- **위치**: `src/components/studio/intelligence/ProfileCopilotCard.tsx` (+ `PortfolioCopilotCard.tsx`), AI 라우트 `/api/ai/profile-copilot`.
- **원인**: 제안의 `actionHref` 는 **LLM 이 자유 생성**하는데 실존 경로 allowlist 가 없어, `/settings/bio`·`/profile/edit`·`/settings/location` 같은 **환각 경로**가 그대로 `<Link>` 로 렌더 → 404. ("새로고침만 계속됨" 은 404 페이지 재시도.) `actionHref` 는 코드 어디에서도 검증되지 않았음.
- **수정**:
  - 신규 `src/lib/ai/sanitizeActionHref.ts` — `src/app/**` 실존 경로(static set + dynamic regex)로 href 검증. 외부/프로토콜상대/미지 경로는 거부. query/hash 는 보존.
  - `ProfileCopilotCard`: 무효 href → **`/settings` 폴백** (버튼 항상 동작). bio/location/themes/mediums 는 모두 `/settings` 에서 편집되므로 안전.
  - `PortfolioCopilotCard`: 무효 href → **버튼 숨김** (보편 폴백이 없는 작품-단위 액션이므로).
  - 프롬프트(`PROFILE_COPILOT_SYSTEM`) 에 허용 경로 명시(`/settings`, `/my/exhibitions/new`)로 이중 안전장치.
- **테스트**: `npm run test:ai-action-href-sanitize` (정적/동적/쿼리 통과 + 환각·외부 경로 거부 케이스).

### 검증

- `npm run test:ai-action-href-sanitize` ✅
- `npx tsc --noEmit` — 신규 에러 0 (사전 `.next/types/routes.d 2.ts` 중복파일 노이즈만)
- 변경 6개 파일 ESLint — 신규 문제 0 (settings 의 `finalRoles`/`detailsPatch`/`payloadEqual`/useEffect-dep 4건은 사전 노이즈, 이번 diff 무관)

### Supabase SQL

이번 패치는 **코드/UI 변경만**. 새/수정 마이그레이션 없음.

### 환경 변수

변경 없음.

---

## 2026-05-09 — 피드 누락 전시 핫픽스: cover_image_paths 부족분 자동 채움 (display-only)

### 문제 (QA report)

`@thegreen_oc` 의 전시 "영웅은 은퇴하지 않는다" (id `43310699-be98-4eb5-9a67-6b561f418596`) 는 작품 6점이 정상적으로 등록돼 있고 status=`live` 인데도 메인 피드에 **나타나지 않는** 이슈. 전시 상세 페이지 (`/e/[id]`) 로 직접 가면 정상 표시. 콘솔 에러 / 네트워크 에러 / 토스트 모두 없음.

### 진단

production SQL 로 게이트별 통과 여부를 한 줄에 나열한 결과:

| 게이트 | 결과 |
|---|---|
| status=live, curator public, RLS anon 노출 | ✅ |
| `exhibition_works` 6점 (shell 필터 통과) | ✅ |
| **`cover_image_paths.length >= EXHIBITION_MIN_COVERS(2)`** | ❌ (1장만) |

원인: `src/lib/feed/livingSalon.ts` 의 `collectExhibitions` 가 `cover_image_paths.length >= 2` 인 전시만 strip 으로 만든다 (단일 floating thumb 방지 디자인 의도). 큐레이터가 cover 사진을 1장만 올린 전시는 silently 사라짐. 게이트 자체는 의도된 디자인이지만 **"작품은 다 있는데 cover 만 부족" 한 케이스의 first-value 가 사라지는 부작용**이 있음.

### 픽스 — 옵션 C (synthetic cover from first artworks)

`src/lib/supabase/exhibitions.ts` 에 `enrichExhibitionsCoversFromWorks(exhibitions, target=2)` 헬퍼 추가. cover 가 부족한 전시에 한해 `exhibition_works.sort_order asc` 의 첫 N 작품 → 각 작품의 `artwork_images.sort_order asc` 첫 1장을 합성으로 끝에 push 한다. 큐레이터가 직접 올린 cover 는 무조건 앞에 보존.

`getArtworkImageUrl(path)` 가 cover/artwork 양쪽을 같은 storage bucket 으로 변환하기 때문에 (확인: `ExhibitionMemoryStrip.tsx:126`), 합성 path 는 큐레이터 cover 와 byte-for-byte 같은 방식으로 렌더된다.

### 적용 boundary — 다른 표면 영향 0

| 표면 | enrich? | 이유 |
|---|---|---|
| 메인 피드 (`listExhibitionsForFeed`, `listExhibitionsForFollowingFeed`, `listPublicExhibitionsForFeed`) | ✅ | 게이트와 같은 surface |
| 다른 사용자 프로필 (`UserProfileContent`) | ❌ | 별도 fetch path. 데이터 정직성 우선 |
| 자기 전시 list (`/my/exhibitions`) | ❌ | 큐레이터에게 "내가 안 올린 cover" 보이면 혼란 |
| 자기 전시 edit (`/my/exhibitions/[id]`) | ❌ | DB 진실값 그대로 |
| AI route (`exhibition-review`, `delegation-brief`) | ❌ | "cover 있음" 으로 prompt 오인 방지 |

DB 미수정. 큐레이터가 추후 cover 를 추가하면 `cover_image_paths.length >= 2` 가 되는 순간 enrich 가 자동으로 비활성 (`needs.length === 0` 으로 early return). UX/타입/컴포넌트/마이그레이션 변경 0.

### 영웅 전시 시뮬레이션

production SQL 로 본 결과:

- 기존 cover (1장): IMG_2384.JPG (큐레이터 업로드)
- 합성될 cover (1장): IMG_2454.jpg (첫 작품의 첫 이미지)
- 결과: 2장 → 게이트 통과 → 다음 피드 fetch 부터 정상 노출

### 검증

- `npm run test:exhibition-cover-enrichment` ✅ — 신규 (7 invariant: 빈 입력, 포화 입력, 0/1 cover 채움, 중복 skip, works 없음, images 없음)
- `npm run test:feed-living-salon` / `feed-personalization` / `feed-telemetry` ✅ — 회귀 0
- `npx tsc --noEmit` — 신규 에러 0 (사전 `.next/types/routes.d 2.ts` 노이즈만)
- `npm run lint` — 신규 에러 0 (사전 `useT.ts` / `artworks.ts` 노이즈만)

### Supabase SQL

이번 패치는 **코드 변경만**. 새/수정된 마이그레이션 없음.

### 환경 변수

변경 없음.

---

## 2026-05-08 — Production DB drift 점검 + Sprint 6/7/7.1 누락 SQL backfill (코드 변경 없음)

### 배경 — 잘못된 sanity check 정정

이전 Sprint 7.1 마무리 보고에서 "production DB 에 `access_requests` 테이블이 없는 것 같다 (Sprint 5/6 SQL 미적용 의심)" 라고 적었지만, **그건 잘못된 진단이었다.** Cursor 에 등록된 `user-supabase` MCP 가 abstract-mvp (`sgufonscldvdwfgzltfw`) 가 아니라 **다른 supabase 프로젝트 (`jenqxlbfqgqjwuonrmav`)** 에 연결돼 있었다. Sprint 7 와 7.1 작업 중 우리가 그 MCP 로 호출한 두 번의 `apply_migration` 도 abstract-mvp 가 아니라 그 다른 프로젝트로 갔다.

다른 MCP 인 `plugin-supabase-supabase` 는 호출마다 `project_id` 를 인자로 받는 형태라 abstract-mvp 의 진짜 프로젝트 ref 를 직접 넘겨 점검 + 적용이 가능했다. 이 채널로 다시 점검한 결과:

- `access_requests`, `access_grants`, `audience_lists`, `audience_list_members`, `relationship_private_notes`, `visibility_owner_settings`, `visibility_policies`, `is_active_account_delegate_writer`, `get_relationship_desk_for_owner`, `create_access_request`, `resolve_access_request`, `cancel_access_request`, `get_artwork_passport_for_viewer`, `visibility_subject_belongs_to_owner`, `resolve_visibility_for_viewer`, `can_view_by_relationship`, `upsert_visibility_policy`, `set_visibility_preset`, `get_room_for_viewer_by_token`, `resolve_visibility_for_preview`, `upsert_relationship_private_note`, `get_viewer_relationship_context`, `get_relationship_card_for_owner` — **전부 OK**. Sprint 5 / 5.2 / 6 / 6.1 의 핵심 surface 는 production 에 정상 적용돼있다.
- `supabase_migrations.schema_migrations` 에는 `20260423224142` (`seed_plan_matrix`) 까지만 등록돼 있다. 즉 supabase CLI 흐름이 아니라 dashboard 직접 paste/run 으로 적용된 흔적이 많아서 **migration history 와 실제 schema 가 sync out** 되어 있다 (operational risk: 다음에 누가 CLI db push 를 시도하면 충돌).

### 진짜 미적용 — Critical 3건만 즉시 적용

`plugin-supabase-supabase` MCP 의 `apply_migration` 으로 abstract-mvp production 에 직접 적용 완료 (`create or replace` 라 idempotent):

| 적용 SQL | 출처 마이그레이션 | 적용 효과 |
|---|---|---|
| `resolve_access_request_v2` (single function) | [`20260608000000_sprint6_phase0_and_relationship_desk.sql`](supabase/migrations/20260608000000_sprint6_phase0_and_relationship_desk.sql) SECTION 7 만 추출 | Sprint 7 의 4-scope grant narrowing UI ("Approve for this work" / "Approve for 30 days") 가 production 에서 정상 동작 |
| `get_artwork_passport_for_viewer` redefine | [`20260620000000_sprint7_phase0_passport_owner_minimization.sql`](supabase/migrations/20260620000000_sprint7_phase0_passport_owner_minimization.sql) 전체 | 비공개 owner 의 nested profile (`bio`/`main_role`/`roles`) 가 anon viewer 에게 더 이상 노출되지 않음 (Sprint 7 work order §2.1 trust-floor) |
| `list_access_requests_for_owner_v2` | [`20260621000000_sprint7_1_access_request_row_identity.sql`](supabase/migrations/20260621000000_sprint7_1_access_request_row_identity.sql) 전체 | `/my/network?tab=requests` 의 enriched row 표시 (요청자 이름/역할) 가 production 에서 정상 동작 |

세 함수 모두 `pg_proc` 에서 정확한 signature 로 등록 확인 완료.

### 적용하지 않은 누락 항목 (별도 추적 필요)

향후 어느 시점에 한 번 더 dashboard / MCP 로 적용 권장:

- `lookup_profile_identity` ([`20260430000200`](supabase/migrations/20260430000200_lookup_profile_identity.sql))
- `upsert_my_profile_identity` ([`20260430000100`](supabase/migrations/20260430000100_upsert_my_profile_identity.sql))
- `lookup_profile_studio_portfolio` ([`20260428000000`](supabase/migrations/20260428000000_lookup_profile_studio_portfolio.sql))
- `lookup_profile_cv` ([`20260601400000`](supabase/migrations/20260601400000_lookup_profile_cv.sql))
- `resolve_room_source_from_token` ([`20260608000000`](supabase/migrations/20260608000000_sprint6_phase0_and_relationship_desk.sql) 의 한 SECTION)
- `connection_message_threads` 테이블 ([`20260425000000`](supabase/migrations/20260425000000_connection_message_threads.sql))
- 그 외 schema_migrations 에 미등록된 ~30+ 마이그레이션 (대부분 idempotent, 그러나 dependency 는 이미 dashboard 로 적용된 상태)

이들 누락이 production 코드에 즉시 영향을 주는지는 surface 별로 sanity 필요. 우선 critical path 만 닫음.

### 권장 후속 액션

1. ~~`supabase_migrations.schema_migrations` 와 실제 schema 의 sync 회복~~ → **2026-05-08 후속 패치에서 완료**. 폴더 67개 마이그레이션 모두 register, 향후 `supabase db push` 가 안전.
2. MCP 설정에서 `user-supabase` 를 abstract-mvp 의 ref (`sgufonscldvdwfgzltfw`) 로 바꾸거나, 또는 향후 모든 db 작업에 `plugin-supabase-supabase` + `project_id` 인자를 사용하기로 합의.
3. `release-workflow.mdc` 에 "MCP 가 어느 프로젝트에 연결돼있는지 매번 `get_project_url` 로 검증 후 진행" 항목 추가 검토.

### 변경 파일

- (코드 변경 없음 — production DB 만 수정)
- 본 HANDOFF 섹션 추가

### Verified

- `pg_proc` 에서 세 함수의 signature 모두 OK
- 다른 dependent 함수/테이블 모두 사전 점검 완료
- 환경 변수 추가/변경 없음

---

## 2026-05-08 — Operational tech debt 청산: 함수 5개 backfill + schema_migrations sync

위 drift 점검의 후속 정리 패치. 다음 sprint 전에 production DB 의 metadata + missing object 까지 깨끗하게 맞춤. 코드 변경은 여전히 0 — DB metadata / 함수만 정리.

### Phase A — 누락 객체 backfill (5건)

`production_funcs vs local_migration_funcs` wide diff 에서 production 영향 가능성 있는 5건을 식별 후 `apply_migration` 으로 적용 (모두 `create or replace`, idempotent):

| 마이그레이션 timestamp | 정의 객체 | 비고 |
|---|---|---|
| `20260428000000` | `lookup_profile_by_username` (redefine v1) | 더 늦은 v3 가 superset 이라 효과 무 |
| `20260430000100` | `upsert_my_profile` redefine | `cover_image_url` / `artist_statement` 등 5개 신규 컬럼 처리 추가 |
| `20260430000200` | `lookup_profile_by_username` (redefine v2) | 더 늦은 v3 가 superset |
| `20260601400000` | `lookup_profile_by_username` (redefine v3 — superset, **최종 정의**) | CV 컬럼 (`education`/`exhibitions`/`awards`/`residencies`) 노출 |
| `20260608000000` SECTION 2 만 | `resolve_room_source_from_token` | Sprint 6 의 누락 함수. 다른 SECTION 들은 이미 production 에 OK. |

→ 이로써 `lookup_profile_by_username` 가 가장 최신 (CV) 정의로 production 에 반영됐고, `upsert_my_profile` 도 P1-0 identity 컬럼을 처리하는 정의로 갱신됨.

### Phase B — `schema_migrations` register-only sync

기존에 `supabase_migrations.schema_migrations` 에는 supabase CLI 가 등록한 16개 (G1 / p0 wave3 / 일부 23일자 entry) + 우리가 sprint 7/7.1 작업에서 마지막에 register 한 8개 marker 만 있었다. 즉 폴더의 67개 마이그레이션 중 60개 이상이 미등록 상태로, **다음에 누가 `supabase db push` 를 하면 이미 적용된 것을 다시 migrate 하려 시도할 위험**이 있었다.

다음 SQL 한 줄로 폴더의 모든 timestamp 를 register (이미 등록된 것은 `on conflict (version) do nothing` 으로 skip):

```sql
insert into supabase_migrations.schema_migrations (version, name) values
  ('20260420120000','v_ai_events_summary'),
  ('20260421120000','identity_completeness'),
  -- ... (60 rows total, 폴더 timestamp + name)
  ('20260621000000','sprint7_1_access_request_row_identity')
on conflict (version) do nothing;
```

→ 60개 신규 register 완료. 이전 backfill 시 자동 생성된 `20260508*` marker 8개는 폴더 timestamp 와 중복 history 라 cleanup (DELETE).

### 최종 상태 (2026-05-08 기준)

- `schema_migrations` 갯수: **77 entries** (폴더 67개 + supabase CLI 가 자체 timestamp 로 등록한 legacy 10개 noise. legacy 는 이름이 일부 중복되지만 향후 db push 매칭에 무해하므로 그대로 둠)
- 다음 검증 SQL 모두 OK:
  - `resolve_access_request_v2`, `list_access_requests_for_owner_v2`, `get_artwork_passport_for_viewer`, `resolve_room_source_from_token`, `lookup_profile_by_username`, `upsert_my_profile` 모두 `pg_proc` 에 존재
- production 의 모든 핵심 surface SQL dependency 가 정리됨. 향후 supabase CLI db push 안전.

### 누락이 아닌 것으로 확인 (false positive)

- `exhibitions` 테이블 → 코드 어디서도 사용 안 함 (`grep .from\('exhibitions'\) src` → 0 hits). 마이그레이션 work order placeholder. 무시.
- `plan_matrix` → 실제 production 에는 `plan_feature_matrix` + `plan_quota_matrix` + `plans` 분리 적용됨. 이름 혼동.
- `connection_message_threads` → 실제로는 `connection_messages` 테이블에 `participant_key` 컬럼/index 추가 + `list_connection_conversations` RPC. 모두 production 에 이미 OK.
- `has_account_delegate_permission`, `has_project_delegate_permission`, `is_active_account_delegate`, `is_active_project_delegate` → 더 옛 정의 함수 이름. 코드에서 사용 안 함 (`grep` 0 hits). production 의 `is_active_account_delegate_writer` / `has_active_account_delegate_perm` 가 이들의 후속.

### 변경 파일

- (코드 변경 없음 — production DB 만 수정)
- 본 HANDOFF 섹션 추가

### Verified

- 폴더의 67개 마이그레이션 모두 `schema_migrations` 에 등록 확인
- 6개 핵심 함수 production `pg_proc` 등록 확인
- 환경 변수 추가/변경 없음
- (코드 변경이 없으므로 빌드/테스트 수행 불필요)

---

## 2026-05-08 — QA hardening: 비밀번호 찾기 진입점 + 회원가입 중복 이메일 leak fix

QA 팀의 두 건(제안 1 + 오류 1)을 처리한 작은 하드닝 패치. 다음 메이저 스프린트 전에 정합성 누수만 정확히 닫음.

### #1 (제안) — 비밀번호 찾기 surface

`src/lib/supabase/auth.ts` 의 `sendPasswordReset` 함수와 `/auth/reset` 페이지(메일 링크 도착 후 새 비번 입력)는 이미 존재했으나, **사용자가 시작할 진입점이 없었다.** Linear / Notion / Figma / Slack 의 표준 패턴을 따라 다음을 추가:

- **신규 [/auth/forgot](src/app/auth/forgot/page.tsx)** — 단일 목적 페이지. 이메일 입력 → `sendPasswordReset` → "메일을 보냈어요" 표준 confirmation. **anti-enumeration 적용** (rate-limit 외의 모든 응답은 동일한 confirmation 으로 collapse — 이메일 등록 여부를 노출하지 않음). `?email=` 쿼리로 pre-fill 지원.
- **[/login](src/app/login/page.tsx)** — 비밀번호 input 라벨 옆에 작은 "비밀번호를 잊으셨나요?" 링크. 사용자가 이미 이메일을 입력했으면 `?email=` 으로 pre-fill 해서 forgot 페이지로 보냄.
- **[/auth/reset](src/app/auth/reset/page.tsx)** — i18n 적용 (기존엔 영문 하드코딩), expired-link fallback 추가 (세션 없이 도착한 경우 "링크가 만료됐어요 → 새 링크 요청" CTA 로 `/auth/forgot` 재진입).

### #2 (오류) — 회원가입 중복 이메일 false confirmation

QA 가 지적한 "이미 가입된 메일로 회원가입 시 중복 메시지가 안 뜨고 메일 전송 메시지만 출력 (실제로는 메일 미발송)" 의 root cause:

- Supabase Auth 의 default 동작은 user enumeration 공격을 막기 위해 **이미 등록된 이메일에 대해 에러를 던지지 않고** synthetic user payload (`data.user.identities = []`) 를 반환한다. 메일도 발송되지 않는다.
- 우리 [`/onboarding`](src/app/onboarding/page.tsx) 코드는 `err` 만 체크하고 `data.user && !data.session` 분기로 흘러서 **거짓 "확인 메일을 보냈어요" 화면**을 띄우고 있었음. **로직 의도가 이 케이스를 커버하지 못한 leak**.

**Fix**: `signUpWithPassword` 응답에서 `data.user.identities` 가 빈 배열이면 duplicate-email 분기로 분기. 친절한 amber 톤 panel 에 다음 노출:
- "이미 가입된 이메일이에요" + 어떤 이메일인지
- "로그인으로 이동" 1차 CTA (`/login`)
- "재설정 링크 받기" 2차 CTA (`/auth/forgot?email=...` 으로 pre-fill)
- "다른 이메일로 가입" 토글

보안 trade-off 노트: 이미 `signInWithPassword` 가 unknown 이메일에 대해 동일 도메인에서 "Invalid login credentials" 를 돌려주므로, 본 변경은 enumeration vector 를 의미 있게 넓히지 않는다. UX 명확성을 우선했다.

### 신규 / 갱신 파일

| 분류 | 파일 |
|---|---|
| 신규 페이지 | `src/app/auth/forgot/page.tsx` |
| 신규 테스트 | `tests/auth-password-recovery.test.ts` |
| 수정 (페이지) | `src/app/login/page.tsx`, `src/app/onboarding/page.tsx`, `src/app/auth/reset/page.tsx` |
| 수정 (i18n) | `src/lib/i18n/messages.ts` (27개 신규 키, EN+KO 모두) |
| 수정 (스크립트) | `package.json` (`test:auth-password-recovery`) |

### 검증

| 검증 | 결과 |
|---|---|
| `npm run test:auth-password-recovery` (신규) | ✅ |
| `npm run test:sprint7-1-principal-network` | ✅ 회귀 |
| `npm run test:sprint6-2-network-hub` | ✅ 회귀 |
| `npm run test:privacy-token-audit` | ✅ (336 files / 81 sites) |
| `npx tsc --noEmit` | ✅ |
| `npx eslint <touched files>` | ✅ |
| `npm run build` | ✅ |

### Supabase / 환경 변수

- SQL 변경 없음.
- 환경 변수 변경 없음.
- Supabase Dashboard 의 Auth → URL Configuration 에서 `<NEXT_PUBLIC_APP_URL>/auth/reset` 가 redirect allowlist 에 포함되어 있어야 비밀번호 재설정 메일 링크가 정상 동작한다 (이미 `/auth/callback` 가 등록돼 있다면 추가 등록 권장). Sprint 5 운영 시 등록되지 않았다면 dashboard 에서 한 번 확인 필요.

---

## 2026-05-07 — Sprint 7.1: First-Value Principal, Routing & Activation Polish

**무엇을 바꿨나.** Sprint 7 의 first-value 레이어가 production-ready 가 되도록 5개 phase 의 정밀 하드닝 패치를 수행했다. 이미 잘 동작하는 부분은 보존하면서, 위임/라우팅/신호 정확성/마일스톤 측정의 작은 누수만 닫는 폴리싱 스프린트.

### 변경 사항 요약

- **Phase A — AccessRequestsPanel 위임 principal 정합** ([src/components/network/AccessRequestsPanel.tsx](src/components/network/AccessRequestsPanel.tsx))
  - `useActingAs()` 도입 후 `effectiveOwnerProfileId = actingAsProfileId ?? sessionUserId` 패턴으로 교체. 위임자가 acting-as 한 상태에서도 본인이 아닌 **principal 의 access requests** 를 보게 된다 (RelationshipDeskPanel 과 동일한 패턴).
  - acting-as 활성 시 panel 상단에 조용한 컨텍스트 라인 ("{display_name} 계정의 접근 요청을 관리 중이에요.") 추가. 큰 경고 배너 아님.
  - `i18n` 키: `accessRequestInbox.actingAsHint`, `accessRequestInbox.requesterUnknown` (EN/KO).

- **Phase B — Access Request Row Identity (SECURITY DEFINER RPC)** ([supabase/migrations/20260621000000_sprint7_1_access_request_row_identity.sql](supabase/migrations/20260621000000_sprint7_1_access_request_row_identity.sql) + [src/lib/supabase/relationshipAccess.ts](src/lib/supabase/relationshipAccess.ts))
  - 신규 RPC `public.list_access_requests_for_owner_v2(p_owner_profile_id, p_status, p_limit)`. SECURITY DEFINER, 함수 본문에서 caller 가 owner 또는 active delegate writer 인지 직접 검증, profiles 와 LEFT JOIN.
  - 반환되는 requester 식별 필드는 4개로 strict allowlist: `display_name`, `username`, `avatar_url`, `main_role`. 비공개 프로필이면 `avatar_url` / `main_role` 도 NULL (단, 자기 자신이 보면 노출).
  - **명시적 비반환**: `email`, `bio`, `roles[]`, `is_public`, `private_note`, audience-list membership.
  - Client wrapper: `listAccessRequestsForOwnerEnriched` + `AccessRequestRowEnriched` DTO 타입 신설. Panel 의 row UI 가 UUID 8자 fragment 대신 `{display_name} · {role}` 형식으로 렌더.

- **Phase C — First-Value Routing Correction** ([src/lib/persona/actionGrammar.ts](src/lib/persona/actionGrammar.ts) + [src/lib/i18n/messages.ts](src/lib/i18n/messages.ts))
  - `curator.request_access` href: `/my/network?tab=requests` → `/feed`. Curator 는 owner inbox 가 아니라 **작품/작가 surface 에서** 요청을 시작해야 한다.
  - `collector.request_access` href: `/my/network?tab=requests` → `/my/library`. Collector 는 **이미 저장한 작품**에서 요청을 시작.
  - i18n title/desc 도 destination 에 맞게 다듬음 (EN/KO).
  - `gallery.review_access_requests` 만 owner inbox (`/my/network?tab=requests`) 로 라우팅 (작업지시서 §5 명시).

- **Phase D — 신호 프록시 교체** ([src/app/my/page.tsx](src/app/my/page.tsx))
  - `roomCount`: `boardSaveSignal.boards_count` (= "내 작품을 담은 보드 수") → `listMyShortlists({ forProfileId })` 로 교체. 진짜 principal 의 shortlist 수.
  - `relationshipCount`: 항상 `null` → 이미 fetch 중인 `relationshipDeskRows.length` 사용.
  - `hasPrivateNote`: 항상 `null` → `relationshipDeskRows.some(r => r.has_private_note === true)` 사용.
  - `missingArtworkContextCount`: `null` → 로드된 `artworks` 의 description 누락 카운트 (lightweight heuristic).
  - 추가 N+1 없음 — desk rows 는 이미 StudioHero 네트워크 핀의 dot 신호용으로 1회 fetch 중이었음.

- **Phase E — Activation Milestone wiring** ([src/lib/persona/activationTelemetry.ts](src/lib/persona/activationTelemetry.ts) + [src/components/studio/FirstValuePathPanel.tsx](src/components/studio/FirstValuePathPanel.tsx))
  - `deriveActivationMilestones(input)` 신설 — 순수 deterministic, 입력으로 `FirstValueSelectorInput` 의 카운트/불리언만 사용 (ID/이름/노트 본문 절대 미접근).
  - 6개 마일스톤 키만 emit 가능: `artist_profile_started`, `artist_three_works_uploaded`, `artist_first_visibility_set`, `gallery_first_room_created`, `collector_first_save_or_follow`, `first_relationship_note_saved`.
  - `emitActivationMilestonesOnce()` — localStorage 기반 dedup (per-persona). 같은 세션 내 매 렌더마다 재발사 안 됨. 저장값은 마일스톤 키 + persona 만 (식별자 없음).
  - FirstValuePathPanel 의 view-once effect 에서 1회 호출.

### 신규 / 갱신 테스트

- **신규**: `tests/sprint7-1-principal-network.test.ts` — Phase A + B 의 정합성 정적 검증.
- **갱신**: `tests/first-value-paths.test.ts` (#9, #10) — collector/curator `request_access` 가 owner inbox 로 라우팅되지 않음을 강제, gallery review action 만 owner inbox 허용.
- **갱신**: `tests/activation-telemetry.test.ts` (#8–10) — `deriveActivationMilestones` 의 keys allowlist, persona gating, 그리고 emit 경로가 sanitizer 를 우회 못 함을 검증.

### 빌드 / 타입 / 린트

| 검증 | 결과 |
|---|---|
| `npm run test:sprint7-1-principal-network` | OK |
| `npm run test:first-value-paths` | OK |
| `npm run test:activation-telemetry` | OK |
| `npm run test:sprint7-passport-owner-minimization` | OK (회귀) |
| `npm run test:sprint7-grant-v2-wiring` | OK (회귀) |
| `npm run test:sprint6-2-network-hub` | OK (회귀) |
| `npm run test:sprint6-delegation-principal` | OK (회귀) |
| `npm run test:relationship-card-privacy` | OK (회귀) |
| `npm run test:privacy-token-audit` | OK (335 files / 81 telemetry sites scanned) |
| `npm run test:inquiry-source` | OK (회귀) |
| `npx tsc --noEmit` | OK |
| `npm run lint` | 83 problems (baseline 84 → 1 감소; 우리가 worsen 시키지 않음) |
| `npm run build` | OK |

### Supabase SQL (적용 필요)

- **`supabase/migrations/20260621000000_sprint7_1_access_request_row_identity.sql`** — Phase B 의 `list_access_requests_for_owner_v2` SECURITY DEFINER 함수. 단일 함수 정의이므로 `apply_migration` MCP 로 한 번에 적용 가능 (이전 sprint 와 동일한 방식).

### ⚠️ 발견된 별도 이슈 (Sprint 7.1 외 범위)

- Production DB 에 **`access_requests`, `access_grants`, `access_audit_events` 등 Sprint 5/6 테이블이 실제로 존재하지 않음** (information_schema 확인 결과 `[]`). 이는 Sprint 5 의 `20260606000000_relationship_access_layer.sql` 을 비롯한 `20260607/20260608/20260610` 마이그레이션이 dashboard 에서 실행되지 않은 것으로 보인다.
- 결과적으로 AccessRequestsPanel / RelationshipDeskPanel 이 production 에서 항상 빈 결과만 받아왔을 가능성. 본 sprint 의 책임 범위는 아니지만, **사용자가 dashboard SQL Editor 에서 Sprint 5/6/6.1 마이그레이션을 모두 적용한 뒤 본 sprint 7.1 마이그레이션을 적용해야** 한다 (apply_migration MCP 로 일괄 가능).

### 알려진 한계 / 다음 후보

- `missingArtworkContextCount` 는 description 누락만 카운트 (medium/size/story 까진 미포함). 정밀 신호가 필요할 때 가벼운 SQL 카운트 RPC 로 대체 가능.
- `first_access_request_sent` / `first_access_request_approved` 마일스톤은 신호 부재로 v1 에서 제외 (작업지시서 §7 의 "if signal exists" 단서 따름).
- 다음 추천: **Sprint 8 — Guided Onboarding & Persona-Specific First Session** (작업지시서 §12).

---

## 2026-05-07 — Sprint 7: Persona First-Value Paths & Activation Learning Loop

**무엇을 바꿨나.** 깊이 있게 만들어둔 관계/가시성/룸 스파인을 사용자 입장에서 "지금 무엇부터 하면 의미가 있는가" 로 번역하는 **first-value translation layer** 도입. Sprint 7 작업지시서 + Addendum 의 UI/UX 계약을 모두 충족하도록 구현했고, Phase 0 의 캐리오버 두 건도 함께 닫음.

### 1. Phase 0 캐리오버 클로저

**0.1 — Passport DTO nested owner profile minimization (SQL).** `get_artwork_passport_for_viewer` 의 nested `'profiles'` 블록이 그동안 `bio / main_role / roles` 를 무조건 노출하던 문제를 해소. 이제는 `viewer = owner` 또는 active delegate writer 가 아니고, 동시에 `coalesce(profiles.is_public, true) = false` 인 경우, 세 필드를 NULL 로 강등. DTO 모양은 그대로 유지(`RedactedArtworkPassport.profiles` 는 이미 세 필드를 nullable 로 선언하고 있어 클라이언트 호환). Identity 4-key (`id / username / display_name / avatar_url`) 는 attribution 을 위해 유지.

**0.2 — Grant v2 narrowing UI 배선.** Sprint 6 에서 API-ready 로 출하된 `resolve_access_request_v2` 를 calmest v1 UI 로 배선. 디폴트 row 는 그대로 single Approve / Decline (calm 유지), expanded detail 안에서 "승인 옵션 보기" 토글을 누르면 4-button narrowing pad 가 등장: **그대로 승인 / 이 작품만 승인 / 30일 동안 승인 / 거절**. 어댑터 (`src/lib/access/resolveV2Adapter.ts`) 가 4 scope 을 RPC 인자로 매핑하므로 호출자는 declarative.

### 2. Phase A — Persona Action Grammar 확장

`src/lib/persona/actionGrammar.ts` 에 Sprint 7 작업지시서가 요구한 `FirstValueAction` / `FirstValueActionKind` / `getFirstValueActions(input)` selector 를 **additively** 추가. 기존 `ActionPath` / `FIRST_VALUE_PATHS` / `getFirstValuePaths` 는 unchanged (인접 호출자/Sprint 6 테스트 깨지지 않음).

핵심 selector 규칙:

- 결정론적 priority + signal-driven urgency boost (예: `pendingAccessRequestCount > 0` 이면 gallery 의 `review_access_requests` 가 top 3 로 부상).
- 한 번에 최대 3개 반환.
- "all clear" dead state 방지 — 모든 기본을 마친 사용자에게도 deeper-value 액션 (relationships / room / save_or_follow) 을 fallback 으로 보장.
- Persona 결정은 `src/lib/persona/resolvePersonaMode.ts` 에 별도 분리: `actingAs` 면 gallery 카탈로그, owner-like + viewer-like 활동이 둘 다 있으면 multi_persona, 그 외엔 가장 owner-leaning 한 역할 우선.

### 3. Phase B — `/my` FirstValuePathPanel

`src/components/studio/FirstValuePathPanel.tsx` 신설. `/my` 의 StudioHeroPanel `rail` 슬롯 (기존 "오늘 하면 좋은 일" 자리) 을 차지. 레이아웃: `[kicker] / [title] / [one-sentence subtitle] / [primary pill] [secondary pill] [secondary pill]`. 디자인 톤은 기존 StudioNextStepsRail 의 zinc-50 + rounded-2xl 패밀리에 맞춤 (절대 marketing banner 화 X).

핵심 안전장치 — selector 가 0 액션을 반환하는 극단의 경우 (e.g. 알 수 없는 페르소나) `StudioNextStepsRail` 을 fallback 으로 자동 렌더 (`fallback={<StudioNextStepsRail …/>}`). 회귀 위험 0.

### 4. Phase C — 페르소나 빈상태 5곳

다음 5곳의 EmptyState 카피를 "왜 이게 의미 있는가 / 무엇을 먼저 하면 되는가 / 다음에 무엇이 일어나는가" 의 3-문장 패턴으로 통일:

- `/my/library` — 작품이 0개일 때 "라이브러리는 작품이 ‘작품 세계’가 되는 자리예요" + Upload CTA.
- `/my/shortlists` — 룸이 0개일 때 "룸은 작품을 공개 매장으로 바꾸지 않고도…".
- `/my/network?tab=relationships` (`RelationshipDeskPanel`) — "관계는 누군가가 작품을 저장하거나 문의하거나…" + Create-room CTA.
- `/my/network?tab=requests` (`AccessRequestsPanel`) — "접근 요청은 비공개로 둔 가격·소장 가능 여부…" + Visibility CTA.
- `/my/visibility` — preset selector 위에 quiet helper banner 한 줄 추가 ("프리셋에서 출발해보세요…").

### 5. Phase D — Activation Telemetry Spine

`src/lib/persona/activationTelemetry.ts` 신설. 6개 신규 이벤트가 `BetaEventName` 에 추가됨:

```
first_value_panel_viewed
first_value_action_clicked
first_value_action_completed
persona_mode_hint_seen
persona_mode_hint_clicked
activation_milestone_reached
```

**Defence in depth.** `sanitizeActivationPayload` 가 allowlist (`surface / persona_mode / action_id / action_kind / milestone_key / acting_as / locale`) 외의 모든 키를 런타임에서 strip. Forbidden 키 (`profile_id`, `owner_profile_id`, `principal_id`, `viewer_id`, `room_token`, `email`, `price_amount`, `note_body`, `message_body`, `relationship_name`, `inquirer_name`) 는 호출자가 실수로 넘기더라도 절대 `beta_analytics_events` 테이블에 도달 못 함. `acting_as` 는 strict boolean 으로 강제 coerce. 비-원시 값 (object / array) 도 reject.

### 6. Phase E — Gentle Mode Switching

FirstValuePathPanel 의 kicker / footer 에 차분한 한 줄 컨텍스트 라벨 (i18n `studio.context.{studio|viewing|delegate}`). hard switcher 는 만들지 않음 (Addendum §1 의 "no heavy role switcher" 원칙). `actingAsProfileId` 활성 시 → `studio.context.delegate` ("지금은 {name} 님을 위해 작업 중이에요") 표기. 표시명은 `profile.display_name` (이미 effectiveProfileId 로 fetch 한 principal 의 것). principal id 는 telemetry 에 절대 포함 X.

### 7. 변경된 파일 목록

신규:

- `supabase/migrations/20260620000000_sprint7_phase0_passport_owner_minimization.sql`
- `src/lib/access/resolveV2Adapter.ts`
- `src/lib/persona/activationTelemetry.ts`
- `src/lib/persona/resolvePersonaMode.ts`
- `src/components/studio/FirstValuePathPanel.tsx`
- `tests/sprint7-passport-owner-minimization.test.ts`
- `tests/first-value-paths.test.ts`
- `tests/activation-telemetry.test.ts`
- `tests/sprint7-grant-v2-wiring.test.ts`

수정:

- `src/lib/persona/actionGrammar.ts` (FirstValueAction / FirstValueActionKind / FIRST_VALUE_ACTION_KINDS / getFirstValueActions / toTelemetryActionPayload 추가)
- `src/lib/beta/logEvent.ts` (BetaEventName 에 6개 활성화 이벤트 추가)
- `src/lib/i18n/messages.ts` (firstValue.* / studio.context.* / empty.* / accessRequestInbox.narrow.* 키 EN+KO 추가)
- `src/components/network/AccessRequestsPanel.tsx` (4-scope narrowing 토글 + 빈상태)
- `src/components/network/RelationshipDeskPanel.tsx` (페르소나 빈상태)
- `src/app/my/library/page.tsx`, `src/app/my/shortlists/page.tsx`, `src/app/my/visibility/page.tsx` (페르소나 빈상태/helper)
- `src/app/my/page.tsx` (FirstValuePathPanel wire + selector input + delegateDisplayName)
- `src/components/studio/index.ts` (FirstValuePathPanel export)
- `package.json` (4개 npm script)
- `docs/HANDOFF.md`, `docs/QA_SMOKE.md`

### 8. Supabase SQL

**적용 필요.** dashboard SQL Editor 에 `supabase/migrations/20260620000000_sprint7_phase0_passport_owner_minimization.sql` 전체를 paste → Run. 단일 함수 redefine 이라 SECTION 단위 분할 불요. dollar tag 는 letters-only `$pport$` 사용.

### 9. 환경 변수

변경 없음.

### 10. Verified

- `npm run test:sprint7-passport-owner-minimization` ok
- `npm run test:first-value-paths` ok
- `npm run test:activation-telemetry` ok
- `npm run test:sprint7-grant-v2-wiring` ok
- `npm run test:sprint6-trust-floor` / `test:persona-grammar` / `test:relationship-desk` / `test:sprint6-delegation-principal` / `test:relationship-card-privacy` / `test:privacy-token-audit` / `test:access-enforcement` / `test:visibility-sql-contract` / `test:relationship-access` / `test:access-request` / `test:inquiry-source` / `test:sprint6-2-network-hub` 전부 ok
- `npx tsc --noEmit` ok
- `npm run build` ok
- `npm run lint` — 신규 lint 0건 (기존 baseline 유지)

### 11. Known limitations / next sprint candidates

- `missingArtworkContextCount` / `relationshipCount` / `hasPrivateNote` 는 현재 selector input 으로 `null` 을 넘김 (서버에서 정확한 카운트를 아직 별도 RPC 로 제공하지 않음). selector 는 `null` 을 "unknown → 액션 유지" 로 안전하게 다루지만, 다음 sprint 에서 이 세 카운트를 정밀화하면 `add_artwork_context` / `open_relationships` 의 dismiss 정확도가 더 올라감.
- `first_value_action_completed` 이벤트는 정의만 추가; emission 은 다음 sprint 의 milestone-detection 작업에서 wire (Sprint 7 은 `first_value_action_clicked` + `activation_milestone_reached` helper 까지만 노출).
- Phase 0.1 의 SQL 은 함수 1개 redefine 이라 quote 위험 낮지만, `release-workflow.mdc` 의 SECTION 가이드는 "함수 정의 2개 이상" 일 때만 적용되므로 그대로 paste 한 번에 Run 가능.

### 12. Recommended next sprint

- **Activation milestone detection**: 클라이언트가 첫 번째 작품 업로드 / 첫 룸 생성 / 첫 접근 요청 승인을 감지하는 곳에서 `activation_milestone_reached` emission 추가. 이미 panel 에서 `first_value_action_clicked` 를 잡고 있으므로, completion 신호만 붙이면 funnel 이 닫힘.
- **First-value action ↔ guide tour 연동**: 사용자가 panel 의 한 액션을 따라간 직후 해당 페이지의 mini-tour 를 자동 트리거 (현재 tour 는 사용자가 "도움말 보기" 를 직접 눌러야 함).
- **Multi-persona explicit hint**: 현재는 자동 detection 만 있음. "지금은 컬렉터로 보고 있어요 — 스튜디오로 전환" 같은 1-tap 컨텍스트 토글을 추가하면 multi-persona 사용자 만족도가 더 올라갈 듯.

---

## 2026-05-07 — Sprint 6.2 polish: tab reorder + Korean line-wrap fix

**무엇을 바꿨나.** 사용자 피드백 반영 두 건.

1. **탭 순서 재배열.** 기존 `팔로워 → 팔로잉 → 관계 → 접근 요청` 을 `팔로워 → 팔로잉 → 접근 요청 → 관계` 로 변경. 가이드 카피의 흐름("수락된 요청은 다음 탭(관계)의 관계 이력으로 이어져요") 이 시각적 좌→우 스캔과 일치하게 됨. 좌측은 inbound prompt(누가 왔다), 우측은 history(이미 함께 시작했다) 라는 더 자연스러운 read.
2. **Korean line-wrap widow 제거.** 가이드 카피가 줄바꿈 시 "요." 한 글자만 마지막 줄에 남는 현상 해결. 카피 `<p>` 에 `break-keep` (`word-break: keep-all`, 한글 어절 중간 분절 방지) + `text-pretty` (브라우저에 widow/orphan 회피 요청) + `max-w-prose` 적용. CSS만으로 해결되니 카피 자체는 그대로 유지.

**파일.**

- `src/app/my/network/page.tsx`: TabKey union 순서 swap (`requests` 가 `relationships` 앞), 4-tab 렌더 순서 swap, guide `<p>` className 에 `break-keep text-pretty max-w-prose` 추가.
- `src/lib/tours/tourRegistry.ts`: network 투어 step 순서를 `requests → relationships` 로 swap, 버전 v3 → v4 (returning user 가 새 흐름을 한 번 더 보도록).
- `src/lib/i18n/messages.ts`: `tour.network.tabs.body` (en/ko) 본문을 새 탭 순서에 맞춰 재배열 ("Followers → Following → Access requests → Relationships" 흐름이 한 문장 안에서 자연스럽게 읽히도록).
- `tests/sprint6-2-network-hub.test.ts`: TabKey 순서 정규식 갱신, 새 가드 추가 (4 NetworkTabButton 의 visible 렌더 순서 deepEqual 매칭, network 투어 step 안에서 `requests` 가 `relationships` 보다 먼저 나타나는지 검사).

**환경 변수.** 변경 없음. **Supabase SQL.** 돌릴 것 없음.

**Verified.** `npx tsc --noEmit` ok / `npm run build` ok / 정적 회귀 4종 (sprint6-2-network-hub / sprint6-delegation-principal / relationship-card-privacy / relationship-desk) 모두 ok.

---

## 2026-05-07 — Sprint 6.2: Network Hub (Studio Hero pill + 4-tab consolidation)

**무엇을 바꿨나.** Sprint 6 / 6.1 에서 만든 _관계 데스크_ 와 기존 _접근 요청 받은 함_ 의 진입점이 너무 조용했던 문제(`/my` 하단 작은 텍스트 링크 두 개 + `/my/shortlists/[id]` 의 한 줄)를 정리하면서, 사람 그래프 전부를 한 화면에서 다루도록 통합한 release. UI/UX 옵션 비교 후 사용자가 골라준 **옵션 C** 를 그대로 구현.

핵심 변화 4가지:

1. **`/my/network` 가 4-tab 허브가 됨.** 기존 `followers` / `following` 두 탭에 더해 **`relationships`** (관계 데스크 본체) 와 **`requests`** (접근 요청 받은 함) 가 같은 페이지의 탭으로 들어옴. 활성 탭 위에는 그 탭의 의미를 짧게 설명하는 `network.guide.*` 카피가 한 줄 떠서 처음 보는 사용자도 바로 이해할 수 있게 함.
2. **StudioHero 에 단일 "네트워크" 버튼 + 점 배지.** Hero action row 의 `Visibility` / `Delegations` 와 같은 quiet outline 톤의 pill 한 개. `pending_access_request_count + open_inquiry_count > 0` 일 때만 (delegations 와 동일한 ring-2 / -right-1 / -top-1 / bg-rose-500) 작은 점만 뜸. **숫자 배지는 띄우지 않음** — 존재 신호일 뿐.
3. **레거시 두 페이지는 redirect 페이지로 다이어트.** `/my/relationships` → `/my/network?tab=relationships`, `/my/access-requests` → `/my/network?tab=requests`. `router.replace` 로 즉시 hop. 기존 북마크 / 이메일 / 다른 surface 의 링크가 깨지지 않음. 두 redirect 페이지가 각자 desk/inbox 본체를 또 mount 하면 의미가 없으므로, 이를 막는 정적 회귀 가드를 새로 추가 (`tests/sprint6-2-network-hub.test.ts`).
4. **가이드투어 친절히 갱신.** Network 투어를 v3 으로 bump 하고 `relationships` / `requests` / `activity-dot` 3개 step 추가. Studio 투어도 v10 으로 bump 하고 `studio-network` anchor 에 한 step 추가. 두 투어의 i18n (en/ko) 본문은 "왜 두 개의 페이지가 탭이 되었는지" 와 "헤더의 빨간 점은 숫자가 아니라 존재 신호" 를 분명히 안내.

**파일.**

- 새 컴포넌트: `src/components/network/RelationshipDeskPanel.tsx`, `src/components/network/AccessRequestsPanel.tsx`. 두 파일 모두 Sprint 6.1 의 acting-as / principal-aware RPC 호출 (`effectiveOwnerProfileId = actingAsProfileId ?? userId`) 을 그대로 가져옴.
- `/my/network/page.tsx`: 4-tab 으로 확장. `parseTab` 4 케이스, `NetworkTabButton` helper, follow-tab 일 때만 search/sort UI, relationships/requests 탭일 때 새 panel 렌더, 활성 탭 위에 `network.guide.*` 카피.
- `/my/relationships/page.tsx`, `/my/access-requests/page.tsx`: thin redirect (`router.replace`).
- `src/components/studio/StudioHero.tsx`: `pendingNetworkActivityCount?: number | null` prop, `studio-network` anchor, dot 렌더링 (delegations 와 동일 패턴).
- `src/app/my/page.tsx`: `getRelationshipDeskForOwner({ ownerProfileId, filter: "all" })` 추가 호출, 행들의 `pending_access_request_count + open_inquiry_count` 합산 → `pendingNetworkActivityCount` state → Hero 로 전달. 기존 quiet 텍스트 strip 은 **acting-as 모드 전용** 으로 좁힘 (owner 모드에선 Hero pill 이 진입점, acting-as 모드에선 Hero 가 없으므로 strip 이 마지막 quiet 진입점). 두 strip 링크는 `/my/network?tab=requests`, `/my/network?tab=relationships` 로 갱신.
- 레거시 cross-link 정리: `src/app/my/inquiries/page.tsx`, `src/app/my/shortlists/[id]/page.tsx`, `src/lib/persona/actionGrammar.ts` 의 `/my/access-requests` / `/my/relationships` 직접 링크를 모두 새 hub URL 로 교체.
- i18n (en/ko): `studio.hero.network`, `studio.hero.networkHint`, `studio.hero.networkPendingDot`, `network.tabs.relationships`, `network.tabs.requests`, `network.guide.{followers,following,relationships,requests}`, `tour.studio.network.{title,body}`, `tour.network.{relationships,requests,activityDot}.{title,body}` 와 기존 `tour.network.{tabs,search,list}.body` refresh.
- Tour: `src/lib/tours/tourRegistry.ts` 에서 `TOUR_IDS.network` v3 (3 step 추가), `TOUR_IDS.studio` v10 (1 step 추가).
- 테스트: `tests/sprint6-2-network-hub.test.ts` 신규 (4-tab 구조 / redirect / Hero 배선 / 투어 step + version 보장). `package.json` 에 `test:sprint6-2-network-hub` 스크립트. 기존 `tests/sprint6-delegation-principal.test.ts` / `tests/relationship-card-privacy.test.ts` / `tests/relationship-desk.test.ts` 는 desk body 가 panel component 로 이동했으므로 검사 path 를 `src/app/my/relationships/page.tsx` → `src/components/network/RelationshipDeskPanel.tsx` 로 정정.

**보안 / 프라이버시.** Sprint 6.1 의 위임 / 접근 / 노트 redaction 모델은 **하나도 건드리지 않음**. desk / inbox / 카드 / 노트의 모든 RPC 호출은 panel component 로 이주한 후에도 `effectiveOwnerProfileId` (acting-as 시 principal id) 를 `p_owner_profile_id` 로 그대로 넘김. 텔레메트리 — `pendingNetworkActivityCount` 는 클라이언트 derived 값이라 별도 이벤트를 발생시키지 않음 (이미 `relationship_desk_viewed` 가 카운트 fetch 의 부수 효과로 한 번 emit 됨). 새 Hero pill 자체는 텔레메트리 없음 (calm presence-only).

**환경 변수.** 변경 없음.

**Supabase SQL 적용.** **돌려야 할 것 없음.** Sprint 6.2 는 순수 frontend / UI 변경이며, 새 마이그레이션 파일은 없음. RPC contract 도 동일.

**Verified.**

- `npx tsc --noEmit` ok.
- `npm run lint` 우리 새/수정 파일 (RelationshipDeskPanel, AccessRequestsPanel, network/page, my/page, redirect 페이지, StudioHero) 에 신규 lint 이슈 없음. 기존 pre-existing warning/error 만 잔존.
- `npm run build` 성공. `/my/network`, `/my/relationships`, `/my/access-requests` 모두 prerendered static 으로 출력됨.
- 정적 회귀 (모두 ok): `test:sprint6-2-network-hub`, `test:sprint6-trust-floor`, `test:sprint6-delegation-principal`, `test:relationship-card-privacy`, `test:relationship-desk`, `test:relationship-access`, `test:access-request`, `test:access-enforcement`, `test:visibility-sql-contract`, `test:visibility-copy`, `test:persona-grammar`, `test:privacy-token-audit` (79 telemetry call sites scanned across 331 files).

**스모크 (수동, 권장 순서).**

1. (Owner) `/my` 진입 → StudioHero action row 에 "네트워크" 버튼이 `Visibility` / `Delegations` 와 같은 톤으로 보이는지. pending request / open inquiry 가 있는 계정이면 **빨간 점**이 뜨는지 (숫자 X).
2. 그 버튼 클릭 → `/my/network` 로 이동, 4 탭 (팔로워 / 팔로잉 / 관계 / 접근 요청) 이 한 줄 또는 wrap 되어 보이고, 활성 탭 위에 한 줄 가이드 카피가 보이는지.
3. `?tab=relationships` 또는 탭 클릭 → 관계 데스크 본체가 panel 로 mount, LaneChips / 행 / 카드 drawer / 비공개 메모 모두 정상 동작.
4. `?tab=requests` → 접근 요청 받은 함 본체가 panel 로 mount, filter / approve / decline 정상 동작.
5. 옛 URL `/my/relationships` 와 `/my/access-requests` 를 직접 입력 → 짧은 "Loading…" 이후 hub 로 redirect.
6. 가이드 도움말 (`?` 버튼) → Studio 투어 v10 / Network 투어 v3 가 새 step 들을 노출. 위치/탭 anchor 가 없으면 그 step 이 자동 skip 되는 것도 확인.
7. (Delegate) acting-as 모드로 들어가면 StudioHero 가 숨겨지고, 페이지 하단에 "접근 요청" / "관계" quiet 텍스트 링크 두 개가 acting-as 전용으로 노출되는지. 두 링크 모두 hub 의 해당 탭으로 이동.

**알려진 한계 / 다음 sprint 고려.** acting-as 모드에서는 Hero 가 안 보이므로 점 배지 시각 신호가 없음. 향후 `ActingAsBanner` 또는 `account-switcher` 에 동등한 quiet 신호를 붙이는 것을 검토 가능 (이번 sprint 범위 밖).

---

## 2026-05-07 — Sprint 6.1 paste hotfix: relationship_private_notes table safety net

**증상.** 사용자가 SECTION 단위로 Sprint 6.1 SQL 을 paste 하던 중 SECTION 3 (`upsert_relationship_private_note`) 에서:

```
ERROR: 42704: type "public.relationship_private_notes" does not exist
```

가 발생.

**근본 원인.** SECTION 3 의 함수가 `returns public.relationship_private_notes` (composite type) 로 선언돼 있는데, 사용자 DB 에 그 이름의 테이블이 없는 상태였음. Sprint 6 (`20260608`) SECTION 3 가 원래 그 테이블을 생성하지만, 당시 dashboard splitter 사고로 그 SECTION 이 누락됐을 가능성 (Sprint 6 hotfix 시리즈를 만들었던 그 동일한 tokenizer 버그 family). Postgres 는 모든 테이블을 같은 이름의 composite type 으로 취급하므로, 테이블이 없으면 `returns ...` 절을 파싱할 때 42704 로 실패.

**해결.** Sprint 6.1 마이그레이션 (`20260610...`) 의 맨 앞에 **SECTION 0 = relationship_private_notes 테이블 + 인덱스 + RLS 정책 멱등 보장** 을 추가. 모든 객체는 `create table if not exists`, `create index if not exists`, `drop policy if exists` → `create policy` 패턴이라 Sprint 6 에서 이미 만들어진 경우 no-op, 누락된 경우 정상 생성. SECTION 0 → 1 → 2 → 3 → 4 순으로 paste 하면 SECTION 3 이 반드시 type 을 찾을 수 있게 됨. 파일 헤더의 paste 가이드와 `docs/QA_SMOKE.md` 의 Sprint 6.1 paste 가이드도 SECTION 0 포함으로 갱신.

**Supabase 적용.** 이미 SECTION 1, 2 를 돌려놓은 상태라면 그건 그대로 두고, **SECTION 0 만 highlight → Run** 후, 다시 SECTION 3 을 highlight → Run, 이어서 SECTION 4 highlight → Run 하면 됨. SECTION 0 은 멱등이라 이미 테이블이 존재하면 no-op.

**환경 변수.** 변경 없음.

**Verified.** 정적 테스트 4종 (sprint6-trust-floor / relationship-desk / sprint6-delegation-principal / relationship-card-privacy) 모두 SECTION 0 추가 후에도 통과.

---

## 2026-05-07 — Sprint 6.1: Relationship Trust, Delegation Scope & Operator Privacy Polish

**스프린트 성격.** 신규 기능 스프린트 아님. Sprint 6 가 실수로 남긴 5가지 신뢰 갭을 닫는 polish 패치. 추가 기능 없이 기존 기능의 권한·minimization 만 정밀화.

**왜 필요했나.** Sprint 6 의 Relationship Desk RPC 트리오는 `auth.uid()` 를 그대로 owner 로 사용하고 "위임 acting-as 가 session uid 를 swap 한다" 는 잘못된 가정의 주석을 남겨두었다. 이 앱의 acting-as 는 `localStorage` 기반 클라이언트 product context 일 뿐이고, `auth.uid()` 는 위임 중에도 항상 실제 로그인한 delegate 의 id 다. 그 결과:

- 위임자가 acting-as 로 `/my/relationships` 를 열면 principal 의 데스크가 아니라 본인의 데스크가 떴고,
- `upsert_relationship_private_note` 는 `owner_profile_id = auth.uid()` 로 저장돼서 위임자가 principal 을 대신해 메모를 적는 게 불가능했으며,
- 데스크 행은 메모 본문 첫 120자를 그대로 list payload 에 실어 owner-only 라곤 해도 노출 표면이 불필요하게 컸고,
- Relationship Card 는 `shortlist_views` 를 join 해서 named "last viewed at" 을 카드 payload 에 노출 (v1 의 "no named viewer surveillance" 약속과 충돌),
- artwork passport 는 모든 viewer 에게 `created_by` (실제 업로드한 delegate/operator 의 id 일 수 있음) 를 그대로 노출.

**해결.** 단일 마이그레이션 `supabase/migrations/20260610000000_sprint6_1_principal_scoping_and_minimization.sql` 으로 4개 함수를 재정의:

1. **`get_relationship_desk_for_owner(p_owner_profile_id uuid default null, p_limit int default 50, p_offset int default 0, p_status text default null)`** — `v_owner = coalesce(p_owner_profile_id, auth.uid())`, `auth.uid() = v_owner OR is_active_account_delegate_writer(v_owner)` 로 권한 검증, 실패 시 `[]` 반환. 데스크 행 payload 에서 `private_note_preview` 제거 → `has_private_note: bool` + `private_note_updated_at: timestamptz`.
2. **`get_relationship_card_for_owner(p_owner_profile_id uuid default null, p_target_profile_id uuid default null)`** — 같은 권한 패턴. `shortlist_views` join 완전 제거. `RelationshipCardRoomRef` 가 `was_shared_or_granted: bool` (모든 행은 grant 가 있거나 있었던 방) 만 노출. `last_viewed_at` 은 응답에 없음.
3. **`upsert_relationship_private_note(p_owner_profile_id uuid default null, p_target_profile_id uuid default null, p_note text default null)`** — 같은 권한 패턴. row 의 `owner_profile_id` 는 effective principal (`v_owner`), `created_by`/`updated_by` 는 실제 행위자 (`auth.uid()`). RLS 의 `is_active_account_delegate_writer` 정책과 일치.
4. **`get_artwork_passport_for_viewer(p_artwork_id uuid)`** — Sprint 6 hotfix v3 의 enum cast / claims 스키마 수정을 그대로 보존하면서 `created_by` 만 owner / delegate-writer 한정으로 redact (`v_is_owner_or_delegate := auth.uid() is not null and (auth.uid() = v_owner or is_active_account_delegate_writer(v_owner))` → `case when v_is_owner_or_delegate then v_aw.created_by else null end`).

**Legacy 시그니처 명시 DROP.** `create or replace` 는 시그니처가 다르면 새 함수를 만든다. 기존 (3, 1, 2) 인자 버전이 PostgREST 에 남아있으면 구 클라이언트가 우연히 그쪽으로 라우팅돼 권한 검증 없는 body 를 실행할 수 있다. 그래서 마이그레이션 상단에서 `drop function if exists public.get_relationship_desk_for_owner(integer, integer, text)` / `(uuid)` / `(uuid, text)` 를 명시적으로 실행 후 새 시그니처로 `create or replace`.

**TS / UI 변경.**

- `src/lib/supabase/relationshipAccess.ts`: 3개 wrapper 가 `ownerProfileId?: string | null` 를 받고 `p_owner_profile_id` 로 전달. 미지정 시 `null` (RPC default 로 `auth.uid()`).
- `src/lib/visibility/types.ts`: `RelationshipDeskRow.private_note_preview` 제거 → `has_private_note` + `private_note_updated_at`. `RelationshipCardRoomRef.last_viewed_at` 제거 → `was_shared_or_granted`.
- `src/app/my/relationships/page.tsx`: `useActingAs` 임포트, `effectiveOwnerProfileId = actingAsProfileId ?? userId` 를 모든 RPC 호출에 전달. acting-as 모드면 calm 배너 ("Viewing relationships for…") 노출. 데스크 행은 본문 대신 quiet "Private note" 칩만. 카드의 룸 행은 `last_viewed_at` 분기 제거.
- `src/app/my/page.tsx`: `/my/access-requests` + `/my/relationships` 진입 strip 을 owner-header 블록 밖으로 빼서 acting-as 모드에서도 노출 (delegate-writer 가 principal 의 요청·관계 데스크에 접근할 수 있어야 함). Studio hero / operation grid 자체는 여전히 acting-as 일 때 숨김 (그 영역은 본인 role 컨텍스트 기반).
- `src/lib/i18n/messages.ts`: `relationships.notePrefix` 제거, `relationships.privateNoteChip` + `relationships.actingAsBanner` 추가 (en/ko).

**Telemetry boundary.** 데스크/카드/노트 저장 이벤트에 `acting_as: !!actingAsProfileId` (boolean) 만 추가. principal id 자체는 절대 페이로드에 들어가지 않는다 (로그 reader 가 위임 그래프를 역산할 수 없도록). 정적 테스트가 `: actingAsProfileId` (raw id 송출) 패턴을 forbid.

**Phase F (resolve_access_request_v2 wiring).** 작업지시서의 default 권고대로 **Option 1 — UI unwired 유지**. 현재 `/my/access-requests` 는 그대로 legacy `resolveAccessRequest` 를 사용한다. v2 RPC 와 `resolveAccessRequestV2` wrapper 는 API-ready 이지만 owner UI 와 wired 되지 않은 상태. 다음 스프린트에서 narrowing 컨트롤 (필드 단위 승인, 30일 한정 승인 등) 의 calm UX 를 별도로 디자인한 뒤 wire 한다.

**신규 정적 테스트 2개.**

- `tests/sprint6-delegation-principal.test.ts` — Relationship 3종 RPC 가 `p_owner_profile_id` 인자 + `coalesce(p_owner_profile_id, v_uid)` + `is_active_account_delegate_writer(v_owner)` 검증을 모두 갖추는지, legacy overload DROP 이 명시적으로 있는지, `/my/relationships` 가 `useActingAs` 와 `effectiveOwnerProfileId` 를 사용하는지, wrapper 가 `ownerProfileId` 를 받고 `p_owner_profile_id` 로 보내는지, "swap session uid" 잘못된 주석이 다시 들어오지 않는지, 텔레메트리 페이로드에 principal id 가 raw 로 emit 되지 않는지를 모두 정적 검사로 핀.
- `tests/relationship-card-privacy.test.ts` — 데스크 RPC body 에 `private_note_preview` / `left(rpn.note,...)` 가 절대 없고 `has_private_note` / `private_note_updated_at` 가 노출되는지, 카드 RPC body 에 `shortlist_views` / `artwork_views` / `profile_views` / `last_viewed_at` 같은 passive viewer 신호가 절대 없고 `was_shared_or_granted` 가 노출되는지, TS 타입이 일치하는지, passport 의 `created_by` 가 `v_is_owner_or_delegate` gate 뒤에 있는지를 정적 검사로 핀.

**기존 테스트 업데이트.** `tests/relationship-desk.test.ts` 가 데스크 RPC 시그니처 검증 대상을 Sprint 6 (legacy) 에서 Sprint 6.1 (live) 마이그레이션으로 이동, legacy overload DROP 이 있는지 추가 핀, 텔레메트리 페이로드의 `acting_as` boolean key 는 허용 (note/private_note/noteDraft 는 여전히 forbid). `tests/sprint6-trust-floor.test.ts` 의 enum cast 가드와 claims 컬럼 가드에 Sprint 6.1 마이그레이션 파일도 포함하도록 확장.

**Supabase 적용 (REQUIRED).** `20260610000000_sprint6_1_principal_scoping_and_minimization.sql` 은 4개 PL/pgSQL 함수 본문을 담고 있어 `.cursor/rules/release-workflow.mdc §1-1` 의 "한 마이그레이션 파일에 PL/pgSQL 함수 정의가 2개 이상이면 SECTION 단위로 highlight → Run" 규칙이 적용된다. SECTION 1 → 2 → 3 → 4 순서로 각각 highlight → Run. 모든 dollar tag 는 letters-only (`$a$` / `$b$` / `$c$` / `$d$`) 이고 헤더 주석은 작은따옴표를 의도적으로 회피했다 (Sprint 6 hotfix 때 `relation "v_aw" does not exist (42P01)` 를 만든 dashboard tokenizer 버그 회피). 모든 CREATE 는 `OR REPLACE`, DROP 은 `IF EXISTS` 라 한 섹션이 실패해도 안전하게 재시도 가능. 자세한 verification SQL 은 `docs/QA_SMOKE.md` 의 "Sprint 6.1 verification SQL" 섹션 참조.

**환경 변수.** 변경 없음.

**Verified.**

- `npm run test:sprint6-trust-floor` ✅
- `npm run test:persona-grammar` ✅
- `npm run test:relationship-desk` ✅
- `npm run test:sprint6-delegation-principal` ✅ (신규)
- `npm run test:relationship-card-privacy` ✅ (신규)
- `npm run test:privacy-token-audit` ✅
- `npm run test:access-enforcement` ✅
- `npm run test:visibility-sql-contract` ✅
- `npm run test:relationship-access` ✅
- `npm run test:access-request` ✅
- `npm run test:inquiry-source` ✅
- `npx tsc --noEmit` ✅ (사전 cleanup: stale `.next/types/routes.d 2.ts` / `validator 3.ts` 제거)
- `npm run build` ✅
- `npm run lint` — 베이스라인 (34 errors / 49 warnings) 그대로, 신규 회귀 0.

**Known limitations.**

- `resolve_access_request_v2` 는 여전히 UI unwired (의도적). 다음 스프린트에서 calm narrowing UX 를 디자인 후 wiring.
- Phase 5 의 "if `profiles.is_public = false`, reduce nested owner profile to id/display_name/avatar_url" 권고는 이번 패치에 미포함 (Recommended/Optional 로 표기되어 있었고, owner profile 의 public/private 정책은 별도 surface 가 잡고 있어서 우선순위에서 밀림). 다음 스프린트에서 다룰 후보.
- 데스크/카드 RPC 의 `p_owner_profile_id` default 는 `null` 이라 미지정 호출은 여전히 `auth.uid()` 로 fallback. 의도적 backward-compatibility 선택. 다음 스프린트에서 모든 호출이 항상 explicit owner 를 보내도록 정리하면 default 를 제거할 수 있다.

**Next sprint recommendation.** Sprint 6 / 6.1 에서 닫지 못한 Phase 5 (owner profile minimization) 와 Phase F option 2 (access grant lifecycle 의 owner-side narrowing UX) 를 한 묶음으로 닫고, 그 다음 본격적인 Relationship Desk v2 / Private Room v2 product 작업으로 진입.

---

## 2026-05-07 — Sprint 6 hotfix v3: artwork passport claims schema fix

**증상.** v2 핫픽스를 SQL Editor 에 paste 하고 Run 한 직후, 작품을 클릭하면 enum 에러는 사라졌는데 새 에러가 생김.

```
column c.role does not exist
```

역시 모든 viewer (팔로우 관계 무관) 가 동일하게 실패.

**근본 원인.** v1/v2 핫픽스 파일을 작성할 때 내가 `public.claims` 테이블의 컬럼을 잘못 가정해서 `c.role`, `c.is_primary`, `c.sort_order`, `c.profile_id`, `c.artwork_id` 같이 **실제로 존재하지 않는 컬럼**을 사용했음. 실제 스키마 (`p0_claims.sql` + `p0_claims_period_and_price_inquiry_delegates.sql`) 는 `c.claim_type` / `c.subject_profile_id` / `c.artist_profile_id` / `c.external_artist_id` / `c.status` / `c.period_status` / `c.start_date` / `c.end_date` / `c.created_at` 이고, 작품 join 은 `c.work_id` 컬럼으로 한다.

흥미롭게도 Sprint 6 SECTION 1 의 source migration (`20260608...`) 은 *처음부터 올바른* 컬럼을 사용하고 있었어. 핫픽스 파일에서만 잘못 적었고, 그 잘못된 핫픽스가 dashboard 에서 정상이었던 SECTION 1 함수를 덮어버린 결과.

**핫픽스 v3.**

- `supabase/migrations/20260609000000_artwork_passport_enum_cast_hotfix.sql` 를 v3 로 재작성. enum cast 수정은 유지하고, `claims` 서브쿼리는 Sprint 5.2 (= 실제 스키마와 일치) 의 형태로 복원하되 Phase 0 의 redaction 목표는 유지 (`external_artists` 는 `display_name` 만, `to_jsonb` 미사용, `invite_email` 누수 없음).
- `presence` 블록도 함께 복원 (`price` / `availability` / `description` 의 raw value 가 존재하는지를 boolean 으로만 알려주는 채널 — UI 가 "값이 숨겨져 있음" vs "값이 아예 없음" 을 구분하는 데 필요).
- `tests/sprint6-trust-floor.test.ts` 에 회귀 가드 추가 — 세 SQL 파일 (5.2 마이그레이션, 6 마이그레이션, 핫픽스) 모두에 대해 `c.claim_type`, `c.subject_profile_id`, `c.work_id` 가 존재하고 `c.role`, `c.is_primary`, `c.sort_order`, `c.profile_id`, `c.artwork_id` 가 존재하지 않음을 검증.

**Supabase 적용.** `20260609000000_artwork_passport_enum_cast_hotfix.sql` 한 파일을 통째로 SQL Editor 에 paste → Run. dollar tag `$hotfix$`, 헤더 주석에 작은따옴표 없음. 이전 v2 핫픽스를 이미 돌렸어도 v3 가 그대로 덮어 정상화됨 (`create or replace`). 적용 후 검증:

```sql
-- 핫픽스 v3 가 적용됐는지 (claim_type 컬럼을 사용하고 c.role 미사용)
select
  pg_get_functiondef(p.oid) ilike '%c.claim_type%' as uses_real_column,
  pg_get_functiondef(p.oid) not ilike '%c.role%'   as no_phantom_column
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname='get_artwork_passport_for_viewer';
-- Expect: uses_real_column = t, no_phantom_column = t
```

그리고 anonymous browser 에서 피드 → public artwork 클릭 → 정상 렌더 + Network 탭에서 `get_artwork_passport_for_viewer` 응답 200.

**Verified.** `npm run test:sprint6-trust-floor` (cast + claims schema 회귀 가드 모두 통과).

**Known limitations.** Sprint 6 SECTION 1 도 동일한 (정확한) claims 서브쿼리를 가지고 있어서, 핫픽스와 SECTION 1 의 함수 본문은 사실상 동일. 다음에 passport DTO 를 또 변경할 때는 두 파일을 함께 갱신하거나, 한 번에 supersede 하는 단일 마이그레이션으로 정리하는 게 좋다.

---

## 2026-05-07 — Sprint 6 hotfix: artwork passport enum cast (`artwork_visibility: ""`)

**증상.** Sprint 5.2 + Sprint 6 SQL 을 모두 적용한 직후, 피드에서 작품을 클릭하면 팔로우 관계와 무관하게 모든 viewer (로그인 전·후, 팔로워, stranger) 가 다음 에러를 받았다.

```
invalid input value for enum artwork_visibility: ""
```

**근본 원인.** `get_artwork_passport_for_viewer` 의 비공개 차단 가드가

```sql
if coalesce(v_aw.visibility, '') <> 'public' then
```

로 작성되어 있었다. `v_aw.visibility` 는 `artwork_visibility` enum 이고, Postgres 가 `coalesce(enum, text)` 의 공통 타입을 추론할 때 `''` 를 enum 으로 캐스팅하려 시도한다. `''` 는 enum 라벨이 아니므로 22P02 가 발생, 모든 RPC 콜이 redaction 로직 도달 전에 실패. 동일한 패턴이 5.2 마이그레이션 (`20260607...`) 과 6 마이그레이션 (`20260608...`) 양쪽에 모두 있어, 둘 중 무엇을 마지막으로 적용했든 같은 에러를 보게 됐다.

**핫픽스.**

- `supabase/migrations/20260609000000_artwork_passport_enum_cast_hotfix.sql` 신설 — `get_artwork_passport_for_viewer` 를 단일 PL/pgSQL 함수로 다시 생성. 가드를 `coalesce(v_aw.visibility::text, '') <> 'public'` 로 수정. DTO 본문, 권한 체크, 모든 redaction 로직은 Sprint 6 SECTION 1 과 100% 동일하게 유지.
- 소스 마이그레이션 두 곳도 같은 cast 로 패치 (`20260607...` §SECTION 7, `20260608...` §SECTION 1) — 새로 클러스터를 부트스트랩할 때 핫픽스에 의존하지 않도록.
- `tests/sprint6-trust-floor.test.ts` 에 회귀 가드 추가 — 위 세 SQL 파일 중 어느 하나라도 cast 없는 `coalesce(v_aw.visibility, '')` 패턴을 다시 도입하면 즉시 실패.

**Supabase 적용.** `20260609000000_artwork_passport_enum_cast_hotfix.sql` 한 파일을 통째로 SQL Editor 에 paste → Run. 단일 함수라 섹션 분할 불필요. dollar tag 는 `$hotfix$` 로 unique 하게 잡았고, 헤더 주석은 작은따옴표를 의도적으로 제거 (`.cursor/rules/release-workflow.mdc §1-1` — naive client splitter 가 `--` 라인 주석 안의 `'` 를 문자열 열림으로 오인해서 quote tracking 을 놓치고 함수 본문을 외부 statement 로 흘려, `relation "v_aw" does not exist (42P01)` 로 깨지는 케이스를 1차 수정 시도에서 한 번 겪었음). 만약 같은 42P01 이 또 보이면 paste 한 텍스트에 여분의 따옴표/주석이 들어갔는지 확인.

적용 후 검증:

```sql
-- 1) 함수가 핫픽스 본문으로 교체됐는지 (cast 가 들어간 버전인지)
select pg_get_functiondef(p.oid) ilike '%v_aw.visibility::text%' as patched
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname='get_artwork_passport_for_viewer';
-- Expect: patched = t

-- 2) anon 으로 임의 public artwork 를 호출했을 때 에러 없이 jsonb 반환
select public.get_artwork_passport_for_viewer('<public-artwork-id>'::uuid) is not null as ok;
-- Expect: t (또는 null — RPC 가 더 이상 22P02 를 raise 하지 않음)
```

**Verified.** `npm run test:sprint6-trust-floor` 통과 (cast 가드 포함), 다른 sprint6/sprint5.2 정적 테스트도 그린.

**Known limitations.** 핫픽스 마이그레이션은 함수 본문이 Sprint 6 §SECTION 1 과 동일해야 하므로, 이후 passport DTO 를 또 변경할 때는 Sprint 6 마이그레이션과 핫픽스 둘 다 함께 갱신해야 한다 (혹은 다음 패치에서 두 파일을 한 번에 supersede).

---

## 2026-05-07 — Sprint 6: Phase 0 Trust-Floor Closure + Relationship Desk + Persona Action Grammar + Private Room v2 (+ Grant Lifecycle additive)

베이스라인: `84d52cb` (`release: Sprint 5.2 — Access Enforcement and Redaction Hardening`).

Sprint 5.2 가 *데이터 접근 척추* 였다면, Sprint 6 는 그 위에 **관계 기억 surface** 를 올렸다. 동시에 5.2 잔여 trust-floor edge case 3건을 함께 닫았다 (Phase 0 — DTO redaction, gated price inquiry continuity, 룸 토큰 attribution). Sprint 6 는 결제·체크아웃·buyer scoring·CRM 파이프라인을 일절 도입하지 않는다.

### Supabase SQL — 반드시 적용 필요

**`supabase/migrations/20260608000000_sprint6_phase0_and_relationship_desk.sql`** — 7 SECTION:
- `-- == SECTION 1 == get_artwork_passport_for_viewer (allowlisted DTO redaction)`
- `-- == SECTION 2 == resolve_room_source_from_token (attribution-safe)`
- `-- == SECTION 3 == relationship_private_notes (table + RLS)`
- `-- == SECTION 4 == upsert_relationship_private_note (RPC)`
- `-- == SECTION 5 == get_relationship_desk_for_owner (RPC)`
- `-- == SECTION 6 == get_relationship_card_for_owner (RPC)`
- `-- == SECTION 7 == resolve_access_request_v2 (additive grant lifecycle)`

**Supabase Dashboard SQL Editor 에서 섹션 단위로 highlight → Run** (release-workflow §1-1 — 한꺼번에 paste 금지, dollar tag letters-only). 모든 SECTION 이 idempotent (`create or replace function ...`, `create table if not exists ...`, `create policy ...` 앞에 `drop policy if exists ...`).

### Phase 0 — Trust-Floor Closure

| Audit | 변경 |
|---|---|
| Public-safe DTO redaction (P0 닫힘) | `get_artwork_passport_for_viewer` 본문에서 `to_jsonb(p)` 제거. 중첩 `profiles` (소유자) 와 `claims.profiles` / `claims.external_artists` 를 모두 **explicit allowlist** (`jsonb_build_object`) 로 교체. **`external_artists.invite_email` 유출 차단** (가장 큰 hit). 내부 owner 플래그 `is_public` 도 viewer 페이로드에서 제거. TS view-model `RedactedArtworkPassport.profiles` 에서 `is_public` 도 함께 drop. |
| Gated price inquiry 연속성 | `/artwork/[id]` 가 가격이 redacted 된 viewer (`pricing_mode === null`, `priceResolution.canView === false`) 도 inquiry 폼을 열 수 있게 했다. 기존 조건 (`pricing_mode === 'inquire'` OR `is_price_public === false`) 에 새 trigger `priceIsGated` 를 OR. 인콰이어리 source payload 는 변경 없음 (`sanitizeSourcePayload` 그대로). |
| 룸 토큰 attribution hardening | 새 RPC `resolve_room_source_from_token(text, uuid)` 가 **`{ room_id, source_surface }` 만** 반환. 토큰을 다시 echo 하지 않고, *해당 작품이 그 룸에 실제로 속해 있어야만* room_id 를 돌려준다 (URL 위조로 임의 작품에 룸 attribution 을 붙이는 시도 차단). artwork detail 의 `getRoomByToken` 호출 제거. |

### Phase A — Persona Action Grammar

**`src/lib/persona/actionGrammar.ts`** + **`docs/product/PERSONA_ACTION_GRAMMAR.md`** 를 신설했다. 5개 mode (`artist | gallery | curator | collector | multi_persona`) 와 15개 first-class verb 를 정의하고 mode 별 first-value path (제목 i18n 키, primary/secondary verb, route, telemetry event, success signal) 를 데이터로 표현한다. 강제 role 선택은 도입하지 않았다 (multi_persona 가 안전한 fallback). 금지 단어 `lead / prospect / hot collector / conversion / pipeline …` 은 `FORBIDDEN_PERSONA_TERMS` + `tests/persona-grammar.test.ts` 로 가드한다.

### Phase B + C — Relationship Desk + Card + Private Notes

- 새 라우트 **`/my/relationships`** (`PageShell variant="studio"`, `PageHeader variant="editorial"`, kicker `RELATIONSHIPS`) — 조용한 owner-only 관계 데스크. `LaneChips` 6칩 (All / Pending requests / Inquiries / Approved viewers / Followers / Notes).
- 새 RPC **`get_relationship_desk_for_owner(int, int, text)`** — `auth.uid()` 게이트, 5개 explicit relationship source (follows / access_requests / access_grants / price_inquiries / relationship_private_notes) 만 union. **passive surveillance source 일절 미사용** (`artwork_views`, `profile_views`, `buyer_score`, `lead_score` 등 전부 차단). 행 당 `relationship_status / last_activity / counts / private_note_preview(120자)`.
- 새 테이블 **`relationship_private_notes`** + RLS — owner/delegate-writer 만 SELECT/INSERT/UPDATE/DELETE. **target user 정책 의도적으로 추가하지 않음** (자기 얘기 메모 못 봄). `unique(owner_profile_id, target_profile_id)` 로 upsert 안전.
- 새 RPC **`upsert_relationship_private_note(uuid, text)`** — 4000자 cap, self-note raise. `relationship_private_note_saved` telemetry 는 본문 미포함.
- 새 RPC **`get_relationship_card_for_owner(uuid)`** — 단일 프로필 카드 (profile/relationship_status/requests/grants/inquiries/rooms/private_note). 모두 owner-only.
- 페이지 안에 **drawer** 로 카드 열기. private note 저장은 4000자 cap 적용. **suggested next action** 은 deterministic (pending 요청 → 검토 / 진행 중 inquiry → 답장 / 그 외 → 룸 공유). AI 점수·랭킹·자동승인 0건.

### Phase D — Private Room v2 viewer & owner

- `/room/[token]` 에 `private_room_v2_viewed` 텔레메트리 추가 (token 미포함, `subject_id` + `status` 만). 인증된 viewer 가 보일 때 헤더 아래에 calm CTA **"Ask about a work in this room"** (룸의 첫 번째 작품으로 `?fromRoom=` 어트리뷰션 deep-link). multi-work 룸 인콰이어리는 의도적으로 후속 (Known limitations 참조).
- `/my/shortlists/[id]` 헤더 아래에 **Relationship Desk 링크** 한 줄 추가 (스튜디오 안에서 룸 → 사람 pivot 가능).
- 서버측 룸 게이트/redaction 은 5.2 그대로 유지 (`get_room_for_viewer_by_token`).

### Phase E — Access Grant Lifecycle (additive RPC)

새 RPC **`resolve_access_request_v2(p_request_id, p_action, p_grant_subject_type?, p_grant_subject_id?, p_grant_field_key?, p_expires_at?)`** — 기존 `resolve_access_request(uuid, text)` 를 그대로 두고 **추가** RPC 로 grant 좁히기/만료시각 옵션을 도입했다. omit 시 legacy behavior 유지. UI 연동은 후속 sprint 에서 (RPC + wrapper + SQL contract test 만 셋업).

### TypeScript 변경 요약

- `src/lib/visibility/types.ts` — `RedactedArtworkPassport.profiles.is_public` 제거, `RoomSourceFromToken` / `RelationshipDeskRow` / `RelationshipCard*` / `RelationshipDeskFilter` 등 view-model 추가.
- `src/lib/supabase/relationshipAccess.ts` — `resolveRoomSourceFromToken / getRelationshipDeskForOwner / getRelationshipCardForOwner / upsertRelationshipPrivateNote / resolveAccessRequestV2` wrapper 추가.
- `src/app/artwork/[id]/page.tsx` — `getRoomByToken` 호출 제거 → `resolveRoomSourceFromToken`. `priceIsGated` trigger 추가.
- `src/app/room/[token]/page.tsx` — `private_room_v2_viewed` + room-level CTA.
- `src/app/my/relationships/page.tsx` — Sprint 6 핵심 surface (신설).
- `src/app/my/page.tsx` — 스튜디오 허브 quiet entry 에 "Relationship Desk" 링크 추가.
- `src/app/my/shortlists/[id]/page.tsx` — 헤더에 Relationship Desk 링크 한 줄.
- `src/lib/i18n/messages.ts` — `nav.relationships` + `relationships.*` + `persona.*` + `room.askSelectedWorks / requestRoomAccess / expiresOn` (영/한).
- `src/lib/beta/logEvent.ts` — Sprint 6 BetaEventName 9건 추가 (`relationship_desk_viewed`, `relationship_card_opened`, `relationship_private_note_saved`, `relationship_next_action_clicked`, `private_room_v2_viewed`, `private_room_selected_work_inquiry_clicked`, `access_grant_lifecycle_changed`, `persona_action_card_clicked`, `persona_action_card_secondary_clicked`).

### 새 테스트 (3건)

- `tests/sprint6-trust-floor.test.ts` — 패스포트 DTO 의 explicit allowlist + `resolve_room_source_from_token` 존재 + artwork page 의 attribution 교체 + gated-price inquiry 트리거 검증.
- `tests/persona-grammar.test.ts` — 5개 mode + first-value path 완전성 + 금지 단어 누설 검사.
- `tests/relationship-desk.test.ts` — 테이블/RLS/RPC contract + UI page 가 desk RPC wrapper 와 telemetry 를 사용하는지 + telemetry payload 에 note 본문 미포함 + `resolve_access_request_v2` 옵션 인자 정의.

`package.json` 에 `test:sprint6-trust-floor / test:persona-grammar / test:relationship-desk` 추가.

### Verified

- `npx tsc --noEmit` → 0 errors.
- `npm run lint` → 34 errors / 49 warnings (= Sprint 5.2 baseline 유지).
- `npm run build` → 통과, `/my/relationships` 라우트 prerender 확인.
- 13개 단위 테스트 (`privacy-token-audit, inquiry-source, feed-personalization, feed-living-salon, feed-telemetry, people-reason, relationship-access, access-request, access-enforcement, visibility-sql-contract, sprint6-trust-floor, persona-grammar, relationship-desk`) 전건 통과.

### Known limitations / 후속

- **Multi-work room inquiry**: room v2 의 "ask about a work in this room" CTA 는 현재 룸의 *첫 번째* 작품으로 deep-link 하는 단순 구현. 다중 선택 → 단일 인콰이어리 묶음은 의도적 후속.
- **Phase E UI**: `resolve_access_request_v2` SQL/wrapper 만 도입했고 owner inbox UI 연동은 다음 sprint. legacy `resolve_access_request` 호출 경로 그대로 작동.
- **Persona UI seed**: 작업지시서 5.3 의 옵션 카드 (`/my` Studio hub 의 "Start from your role today") 는 scope creep 위험이 있어 이번 patch 에서 도입하지 않음. 모듈 + 문서 + 텔레메트리 이벤트만 셋업, 다음 sprint 에서 안전하게 표시 가능.
- **외부 작가(`external_artists`) 표시명만 노출**: `display_name` 외 필드 (created_at 등) 는 viewer payload 에서 모두 차단. 만약 다른 합법 필드가 필요해지면 SECTION 1 의 jsonb_build_object 에 explicit add.
- **Relationship Desk passive signal**: v1 에서는 view/impression 추적 일절 사용하지 않음. 후속에서 owner-only "interested in this work" 시그널이 필요하면 explicit 사용자 액션 (save/like/follow/inquiry/request) 만 사용할 것.

### 환경 변수

추가/변경 없음.

---

## 2026-05-07 — Sprint 5.2: Access Enforcement & Redaction Hardening

베이스라인: `d269823` (`release: Sprint 5.1 — Visibility hub hot-link on StudioHero + studio tour step`).

Sprint 5 가 **owner UI / RPC / RLS / 카피 / 텔레메트리** 라는 *control surface* 를 깔았다면, Sprint 5.2 는 그것이 **실제 데이터 접근 척추** 가 되도록 조였다. 기능 신규 surface 0개, paywall 0개. Audit findings (P0-1 fail-open, P0-2 raw-row leak, P0-3 직접 UPDATE 정책, P1-1~P1-4) 를 각각 실데이터 enforcement 로 바꿨다.

### Supabase SQL — 반드시 적용 필요

**`supabase/migrations/20260607000000_relationship_access_enforcement_hardening.sql`** — 9 SECTION (validator helper · resolver/upsert/create-request/resolve-request 재생성 · cancel RPC · 관람자용 redacted artwork RPC · 관람자용 redacted room RPC · preview-as effective resolver). 파일에 `-- == SECTION N == ...` 배너로 분할되어 있다. **Supabase Dashboard SQL Editor 에서 섹션 단위로 highlight → Run** (한꺼번에 paste 금지 — release-workflow §1-1, dollar tag letters-only, 함수 본문 잘림 방지). 모든 섹션이 idempotent (`drop function if exists ... ; create or replace function ...`) 이라 재실행 안전.

### 1. visibility_subject_belongs_to_owner (validator helper)

`(owner, subject_type, subject_id)` 가 실제로 매칭되는지 확인하는 SECURITY DEFINER 헬퍼 1개. 기준:
- `subject_id is null` → owner-wide default 이므로 무조건 true.
- `artwork / artwork_field` → `artworks.id = subject_id and artist_id = owner`.
- `room` → `shortlists.id = subject_id and owner_id = owner`.
- `profile_section` → `subject_id = owner` (또는 null, 위에서 처리).
- `exhibition` (subject_id≠null) → 소유 모델이 모호 (curator vs host vs delegate) 라 v1 에서는 fail-closed. UI 에서 exhibition subject 직접 사용 안 함.

이 헬퍼를 `resolve_visibility_for_viewer` (잘못된 owner/subject 페어 → fail-closed 반환), `upsert_visibility_policy / create_access_request / resolve_access_request` (mutation 시 raise) 에 모두 끼워 넣었다. P1-1 closed.

### 2. resolve_visibility_for_viewer 재생성

기존 본문 + validator gate. 검증 실패 시 `{ can_view:false, required_audience:'owner_only', request_mode:null, reason:'subject_owner_mismatch' }`.

### 3. 관람자용 redacted RPC 2개 (P0-1 / P0-2 closed)

**`get_artwork_passport_for_viewer(p_artwork_id)`** — `{ artwork, visibility:{price,availability,description}, presence, relationship }` jsonb 반환.
- artwork 의 sensitive 필드 (`pricing_mode`, `is_price_public`, `price_*`, `fx_*`, `ownership_status`, `story`) 는 해당 필드의 `can_view=true` 일 때만 raw 값을, 그렇지 않으면 **null** 을 돌려준다 — 브라우저는 가려진 값을 영영 보지 못함.
- `presence:{price,availability,description}` boolean 시그널 — "값이 있긴 한데 가려졌다" 와 "원래 비어 있다" 를 UI 가 구분하도록. **boolean 만 노출**, 실제 값은 절대 흘리지 않음.
- 비-public artwork 은 owner / delegate-writer 만 통과 (기존 RLS lane 유지).

**`get_room_for_viewer_by_token(p_token)`** — `{ room, items, visibility, relationship, can_view }` jsonb. token text → uuid 캐스트 (실패 시 fail-closed null), `room_active=true and not expired` 검증, `resolve_visibility_for_viewer('room', id, '*')`. **`can_view=false` 면 items 는 빈 배열, 한 행도 DB 밖으로 나가지 않음.** view-log 부수 insert 는 best-effort try/except.

### 4. cancel_access_request RPC + 정책 정리 (P0-3 closed)

새 SECURITY DEFINER `cancel_access_request(p_request_id)` — 요청자 본인 / pending 만 / `status, updated_at` 만 변경. 동시에 `access_requests_update_requester_cancel` 정책을 **DROP** — 요청자는 더 이상 PostgREST 직접 UPDATE 로 row 의 다른 컬럼을 건드릴 수 없다. owner 측 `access_requests_update_owner` 는 유지 (resolve_access_request RPC 가 한 번 더 검증, 정책은 defense-in-depth).

### 5. create_access_request 재생성: 명시적 duplicate signal (P1-3 closed)

기존 return type `public.access_requests` → `jsonb`. 응답 shape: `{ "request": <row>, "duplicate": <bool> }`. 같은 (requester, subject, field, type) 의 pending 행이 있으면 그걸 반환하면서 `duplicate:true`. 이로써 client 가 더 이상 `created_at !== updated_at` 휴리스틱으로 추측하지 않는다 (default-inserted row 에서 두 값이 동일해 false-negative 가 났음).

### 6. resolve_visibility_for_preview RPC (P1-4 closed)

owner / delegate-writer 만 호출 가능 (그 외에는 raise). 기존 viewer resolver 와 **완전히 동일한** policy ladder + preset fallback 을 walk 한 뒤, `auth.uid()` 가 아닌 `p_fake_state` 의 신호 (signed_in / viewer_follows_target / target_follows_viewer / has_grant / is_delegate / is_self) 로 audience 판정. 결과는 같은 `{can_view, required_audience, request_mode, reason}` shape.

### 7. TypeScript 데이터 레이어

`src/lib/supabase/relationshipAccess.ts`
- 신규: `getArtworkPassportForViewer(artworkId)`, `getRoomForViewerByToken(token)`, `resolveVisibilityForPreview(args)`.
- `cancelAccessRequest` → 직접 UPDATE 대신 `cancel_access_request` RPC 호출, `AccessRequest` 반환.
- `createAccessRequest` 시그니처 변경 — `{ data, duplicate, error }` 반환. legacy row-shape rollback 도 방어적으로 처리.
- `normalizeResolution / normalizeRelationship` 헬퍼 — RPC payload 일부 필드가 빠져도 fail-closed 기본값으로 채움.

`src/lib/visibility/types.ts`
- 신규 view-model: `RedactedArtworkPassport`, `ArtworkFieldPresence`, `ArtworkPassportForViewer`, `RoomMetaForViewer`, `RoomItemForViewer`, `RoomForViewer`.

### 8. UI surface 변경

**`/artwork/[id]`** — 초기 fetch 가 `getArtworkPassportForViewer(id)` 1회로 통일 (artwork + 3 visibility resolutions + presence + relationship 한 번에 set). 별도 `resolveVisibilityForViewer` per-field useEffect 와 `getViewerRelationshipContext` 는 제거. owner 가 claim 승인/요청 후 refresh 도 새 `refreshPassport()` 로 일원화 (gate 상태 drift 방지). inline gate 로직은 fail-closed 패턴 (`if (eff.canView) return wrapped; if (!presence.field) return null; return <GatedField/>`). `priceResolution || canView` 같은 fail-open 패턴은 모두 제거.

**`/room/[token]`** — `getRoomForViewerByToken(token)` 1회로 통일. `getRoomByToken` + `getRoomItemsByToken` 직접 호출 제거. gated 룸은 GatedField 만 그리고 items grid 는 아예 mount 안 됨. `room_viewed` telemetry 는 `data.canView ? items.length : 0` 으로 수정 — gated 일 때 0 보고 (token-free 유지).

**`GatedField`** — `cta.kind === 'follow'` 일 때 더 이상 inert `<button onClick={onFollow?}>` 가 아니라 실제 `<FollowButton targetProfileId={ownerProfileId}>` 를 렌더한다 (P1-2 closed). `onMouseDownCapture` 로 telemetry intent 이벤트 (`follow_request_from_visibility_gate`) 를 click 즉시 한 번 기록, `onFollowed` 콜백으로 부모의 `onAfterFollow?.()` 호출 → artwork 페이지/룸 페이지가 `refreshPassport / load` 로 visibility 재해석. 결과적으로 follow 가 accept 되면 gate 가 즉시 사라진다.

**`/my/visibility`** — preview-as 가 `canViewByRelationshipDryRun` (preset-only) 대신 새 `resolveVisibilityForPreview` (실 정책 ladder) 를 호출. v1 은 여전히 owner-wide (subject_id=null) 만 미리보기 — 이 한계를 사용자에게 정직하게 알리는 한 줄 (`visibility.previewAs.scopeNote`) 을 결과 패널 위에 추가.

**`AccessRequestModal`** — `createAccessRequest` 의 새 jsonb 응답에서 `duplicate` 플래그 직접 사용. `data.created_at !== data.updated_at` 휴리스틱 제거.

### 9. 테스트 (신규 2 + 기존 11 재검증)

- `npm run test:access-enforcement` — 정적 source 텍스트 검사. (1) artwork 페이지가 `getArtworkPassportForViewer` 사용 + 기존 fail-open 패턴 부재, (2) artwork 페이지에서 `getArtworkById/resolveVisibilityForViewer/getViewerRelationshipContext` 직접 호출 부재, (3) room 페이지가 `getRoomForViewerByToken` 사용 + `getRoomItemsByToken/getRoomByToken/resolveVisibilityForViewer` 직접 호출 부재, (4) GatedField 가 FollowButton 사용 + `onFollow?:` prop 제거, (5) AccessRequestModal 이 `duplicate` 플래그 사용, (6) cancelAccessRequest 가 RPC 호출 (직접 `.from('access_requests').update(...)` 부재).
- `npm run test:visibility-sql-contract` — 마이그레이션 텍스트 검사. validator helper 정의 + grant, 4 mutation function 본문이 모두 validator 호출, `cancel_access_request` 정의 + 기존 직접 update 정책 drop, redacted RPC 2개 정의 + room RPC anon grant, preview-as 정의 + grant, create_access_request 가 jsonb + `'request'`/`'duplicate'` 키 포함, SECTION 배너 + dollar tag letters-only 검증 (`$p_link$` 같은 underscore-tag 거부).
- 기존 `test:privacy-token-audit / test:inquiry-source / test:visibility-copy / test:relationship-access / test:access-request / test:feed-personalization / test:feed-living-salon / test:feed-telemetry / test:people-reason` 전부 그린 유지.

### 10. 새 i18n 키

- `visibility.previewAs.scopeNote` (en + ko) — preview-as 가 owner-wide 정책까지만 시뮬레이션함을 정직하게 알림.

### 11. 알려진 한계 / 다음 작업 후보

- `visibility_subject_belongs_to_owner` 의 `exhibition` 분기는 v1 fail-closed. exhibition subject 정책을 도입하려면 ownership 정의 (curator vs host) 를 먼저 픽스해야 함.
- `/my/visibility` preview-as 는 여전히 owner-wide 만 시뮬레이션 (per-artwork override 까진 미반영). 작품을 골라 preview 하는 UI 가 필요해지면 `resolveVisibilityForPreview({subjectId: artworkId, ...})` 호출만 추가하면 됨.
- 첫급 필드 (`price / availability / description`) 외 신규 필드 (예: `studio_note`) 를 redacted RPC 가 자동 노출하도록 하려면 SQL 의 sensitive 컬럼 case 를 확장해야 함.

### Verified

- `npm run test:privacy-token-audit / test:inquiry-source / test:visibility-copy / test:relationship-access / test:access-request / test:feed-personalization / test:feed-living-salon / test:feed-telemetry / test:people-reason / test:access-enforcement / test:visibility-sql-contract` — 11/11 ✓
- `npx tsc --noEmit` 0 errors
- `npm run build` ✓
- `npm run lint` 34 errors / 49 warnings (Sprint 5.1 baseline 동일, Sprint 5.2 가 새로 도입한 것 없음)

신규 환경 변수 없음.

---

## 2026-05-06 — Sprint 5.1: Visibility hub discoverability (UX micro-patch)

Sprint 5 가 만든 **공개 범위 / 접근 권한** 레이어가 "프로필 편집 안" 에 묻혀 있다는 사용자 피드백 반영. 두 가지만 손봤다.

- **StudioHero hot-link** — `/my` 좌상단 hero 의 액션 row (프로필 편집 · 공개 프로필 미리보기 · 위임 옆) 에 **공개 범위** 버튼 추가. 형제와 같은 outline 톤, `data-tour="studio-visibility-hub"` anchor 부여. 같은 hub 로 가던 `/my` 본문의 muted text-link 한 줄은 중복이라 제거 (접근 요청 inbox 한 줄만 남김).
- **Studio tour 신규 step (v8 → v9)** — hero 다음에 `visibility` step 추가. 카피는 4개 preset 이름·필드 단위 미세조정·gate 의 hospitality 톤 (Follow / Request) 을 한 번에 알림. version bump 으로 returning users 에게도 자동 재표시.
- 새 i18n 키: `studio.hero.visibility`, `studio.hero.visibilityHint`, `tour.studio.visibility.title`, `tour.studio.visibility.body` (en + ko 동시).

수정 파일: `src/components/studio/StudioHero.tsx`, `src/lib/tours/tourRegistry.ts`, `src/app/my/page.tsx`, `src/lib/i18n/messages.ts`. 부수적으로 `tests/relationship-access.test.ts` 의 `typesMod.ViewerRelationshipContext` 타입 참조를 static `import type` 로 정리 (TS2503 fix — strict tsc 에서 dynamic import 의 namespace 는 type 으로 사용 못 함).

Supabase SQL 변경 없음 / 신규 환경 변수 없음. **Verified**: `npx tsc --noEmit` 0 errors · `npm run build` ✓ · 3 Sprint-5 단위 테스트 + privacy-token-audit ✓ · lint baseline 동일 (34 errors / 49 warnings, 모두 기존 — Sprint 5 패치가 도입하지 않음).

---

## 2026-05-06 — Sprint 5: Relationship Access Layer & Subscription-Ready Hospitality

Sprint 1–4 가 만든 가치 루프 (Feed → Artwork Passport → Private Room / Inquiry → Artist follow-up) 위에, **관계 기반 정보 공개·취득 권한 레이어** 를 깔았다. 새 marketplace UI 0개, paywall vocabulary 0개. 작가는 한 화면에서 큰 그림 (preset) 을 정하고, 필요할 때 항목·작품·룸 단위로 미세조정한다. 관람자는 잠긴 항목에서 paywall 이 아니라 *친절한 다음 동작* (Follow / Ask about this work / Request access) 을 본다.

베이스라인: Sprint 4 commit `223034e` (= `release: Sprint 4 — Minimalist Consolidation, Privacy Hardening, Official Records Readiness`).

### Supabase SQL — 반드시 적용 필요

**`supabase/migrations/20260606000000_relationship_access_layer.sql`** — 6 tables (`visibility_owner_settings`, `visibility_policies`, `access_requests`, `access_grants`, `audience_lists`, `audience_list_members`) + 8 RPCs + null-safe partial unique indexes + RLS. 파일에 `-- == SECTION N == ...` 배너로 12개 섹션 분할. **Supabase Dashboard SQL Editor 에서 섹션 단위로 highlight → Run** (한꺼번에 paste 금지 — release-workflow §1-1 참조).

### 1. 데이터 모델 / 권한

- **`visibility_owner_settings`** — owner-scope 1행. 4개 preset (`open_studio` · `follower_aware` · `mutual_first` · `private_studio`). 행이 없으면 `open_studio` fallback (기존 owner zero-friction).
- **`visibility_policies`** — generic subject (`profile_section / artwork / artwork_field / exhibition / room`) × `field_key` (예: `price`, `availability`, `description`, `studio_note`, `*`) × `audience` (`public / signed_in / followers / following / mutuals / approved / delegates / owner_only`) + 선택적 `request_mode` (null = audience-based, 또는 `inquiry / access_request / none`).
  - **null-safe partial unique idx 2개** — `subject_id is not null` (subject-keyed 행) 와 `subject_id is null` (owner-wide default) 를 분리해 dedupe. 단일 UNIQUE 로는 NULL 다중 insert 가 통과해 logical uniqueness 위반.
- **`access_requests` / `access_grants`** — 요청-승인 트랙. `access_requests` 는 `pending` 상태에서만 dedupe (subject keyed/null 두 줄 partial uniq). `access_grants` 는 `(owner, grantee, subject_type, subject_id, field_key)` 양변 partial uniq.
- **`audience_lists` / `audience_list_members`** — VIP 리스트 schema-only skeleton. 멤버는 자기 멤버십 행을 SELECT 못 함 (VIP 누설 방지).
- **RLS** — 모든 새 테이블 owner / delegate-writer 만 manage. `access_grants` 의 grantee 는 *자기* 행만 SELECT (siblings 노출 X).

### 2. RPC (8개)

- `get_viewer_relationship_context(target)` — 관람자 ↔ owner 의 coarse 신호 (`is_self`, `viewer_follows_target`, `target_follows_viewer`, `is_mutual`, `follow_status`, `target_is_public`, `is_delegate`, `has_any_approved_access`). **`approved_audience_ids` 절대 반환 X** (Sprint 5 amendment 2 — 리스트 ID 누설 방지).
- `resolve_visibility_for_viewer(owner, subject_type, subject_id, field_key)` — 관람자 surface 의 **유일한** visibility entry. server-side 정책 lookup → audience 결정 → `can_view` 판정. `{ can_view, required_audience, request_mode, reason }` 반환. UI 는 절대 `requiredAudience` 를 client-supply 하지 않는다 (Sprint 5 amendment 1 — spoofing 방지).
- `can_view_by_relationship(...)` — 내부 helper (다른 RPC 가 호출). UI 직접 호출 금지.
- `can_view_by_relationship_dryrun(...)` — owner/delegate-writer 의 preview-as. fake state 받아 시뮬레이션. 정책 변경 X.
- `upsert_visibility_policy(...)` — owner/delegate-writer 만. subject ownership (artwork.artist_id, shortlists.owner_id) 검증. `request_mode` enum lock (`'request'` 거부).
- `set_visibility_preset(owner, preset)` — `visibility_owner_settings` 만 update. **explicit subject/field policies 절대 덮어쓰지 않음** (Sprint 5 amendment 6).
- `create_access_request(...)` — 관람자 → owner. message 1000자 cap, `source_payload` 에서 token-shaped 키 strip + 2KB cap (서버측 belt-and-suspenders). 같은 (requester, subject, field, type) 의 pending 행 idempotent return.
- `resolve_access_request(id, action)` — owner/delegate-writer. approve 시 자동 `access_grants` insert (`grant_type='request_approved'`). status `pending` 만 처리.

### 3. UI surface

- **`/my/visibility`** (신규) — Studio operator hub. PageShell `studio` 폭. 3 FloorPanel:
  - **Visibility preset** — `VisibilityPresetSelector` (LaneChips), Save preset.
  - **Preview as** — `PreviewAsBar` (sort-tone LaneChips, audience 선택), 선택 시 검은 banner + 첫급 필드별 server-side dry-run 결과 (✓ / × pill).
  - **Advanced visibility** — collapse 기본. 펼치면 `AdvancedVisibilityPanel` (작품 25개 list + 첫급 3 필드 (`price` / `availability` / `description`) × audience pill + per-field `RequestModeSelect`).
- **`/my` 와 `/settings`** — calm entry link 추가. `/my` 는 StudioOperationGrid 아래 muted text-link 한 줄. `/settings` 는 visibility section 안에 hub 로 가는 row.
- **`/artwork/[id]/edit`** — `ArtworkFieldVisibilityPanel` (작품 owner 본인일 때만). 첫급 3 필드 audience pill + request_mode select. collapse 기본.
- **`/my/shortlists/[id]`** — header 아래 `RoomVisibilityPill` (room audience + request_mode).
- **`/artwork/[id]`** — viewer side. `priceResolution`, `availabilityResolution`, `descriptionResolution` 을 mount 시 server-side resolve. `canView=false` 면 `<GatedField>` 가 항목을 친절한 카피 + CTA (Follow / Ask about this work / Request access) 로 wrap. Owner 본인은 server 가 자동 통과하므로 깜빡임 없음.
- **`/room/[token]`** — viewer side. 같은 패턴 (`subject_type='room', subject_id=meta.id, field_key='*'`). owner 가 룸을 잠그면 token 보유자도 grid 대신 GatedField 만 봄.
- **`/my/access-requests`** (신규) — owner 의 inbox. PageShell `narrow`. LaneChips (All / Pending / Resolved). 행 collapse 기본 — 펼치면 message + Approve / Decline. 상단 chip 으로 `/my/inquiries` 에 pending count 노출 (`inquiries.accessRequestsChip` — 0이면 안 보임).

### 4. 카피·디자인 가드

- `src/lib/visibility/copy.ts` — 모든 GatedField 카피 single source. **forbidden 구절** (`pay to unlock`, `upgrade to see`, `locked`, `subscribe to view price`) 적발 helper + `tests/visibility-copy.test.ts` 가 audience × field 전수 검사.
- 모든 카피는 hospitality 톤 (`shares` / `공개합니다`). owner_only 만 `keeps private for now` / `비공개로 두었습니다`.
- DS primitives (`PageShell`, `PageHeader`, `FloorPanel`, `LaneChips`, `Chip`, `EmptyState`, `SectionLabel`) 만 사용. hand-rolled 박스 0건.

### 5. Telemetry (15 events)

`src/lib/beta/logEvent.ts` 의 `BetaEventName` 에 15개 이름 추가:
`visibility_policy_changed`, `visibility_preset_changed`, `visibility_gate_seen`, `visibility_gate_cta_clicked`, `follow_request_from_visibility_gate`, `mutual_connection_created`, `approved_viewer_added`, `artwork_sensitive_field_viewed`, `price_inquiry_from_gate`, `room_access_requested`, `vip_access_requested`, `preview_as_used`, `access_request_created`, `access_request_resolved`, `access_grant_created`.

- payload 화이트리스트 — `subject_type, subject_id (UUID), field_key, audience, preset_key, request_type, status, surface, target_profile_id`. message body / token / share_token / raw URL **절대 금지**. `tests/privacy-token-audit.test.ts` 가 정적으로 강제.
- `mutual_connection_created` 는 `src/lib/supabase/follows.ts` 의 `follow()` 안에서, 새 accepted 가 들어오고 target → viewer 도 이미 accepted 인 경우에만 한 번 fire (idempotent guard).

### 6. 신규 테스트 (3개)

- `npm run test:visibility-copy` — forbidden 구절 0건, hospitality 톤 보장, preset×field 매트릭스 audience 도출.
- `npm run test:relationship-access` — 15 invariant: canView 우선, owner override CTA, audience-default CTA, price-field add-on, 보조 inquiry CTA, **`ViewerRelationshipContext` 에 `approved_audience_ids` 부재 확인**, sanitizer 가 token-shape 차단, oversized payload 거부, preset 4개 enum lock, request_mode 유니온 lock.
- `npm run test:access-request` — sanitizer 단위 (token-shape, oversized, array reject, secret regex 매칭).

baseline regression 5개 (`privacy-token-audit`, `inquiry-source`, `feed-personalization`, `feed-living-salon`, `feed-telemetry`, `people-reason`, `website-import`) 모두 green.

### 7. 위험·리스크 매트릭스 (요약)

| 위험 | 차단 |
| --- | --- |
| Client 가 `requiredAudience` spoof | `resolveVisibilityForViewer` server-only entry. UI 는 `VisibilityResolution` 만 받아 표시. `can_view_by_relationship` 은 internal helper로 격리. |
| 정책 preset 이 explicit override 덮어씀 | `set_visibility_preset` 는 `visibility_owner_settings` 만 update. resolver 가 fallback 으로만 preset 적용. |
| VIP 리스트 ID 누설 | `get_viewer_relationship_context` 에서 `approved_audience_ids` 제거. 대신 `has_any_approved_access` boolean. |
| `subject_id IS NULL` 중복 행 | `visibility_policies / access_requests / access_grants` 모두 partial unique idx 2벌. |
| Telemetry 에 message body / token | `logBetaEvent` payload 화이트리스트 + `privacy-token-audit` 정적 검사. |
| Pending follow 이 follower audience 통과 | resolver 의 `accepted` 만 인정. 카피도 "shares with followers" 만. |

### 8. Verified

- `npm run test:privacy-token-audit` ✅ (69 sites scanned across 327 files)
- `npm run test:inquiry-source` ✅
- `npm run test:feed-personalization / feed-living-salon / feed-telemetry / people-reason / website-import` ✅
- `npm run test:visibility-copy / relationship-access / access-request` ✅
- `npx tsc --noEmit` ✅ (clean)
- `npm run lint` — 34 errors / 49 warnings (모두 pre-existing; Sprint 5 변경분에서 introduced 0건. baseline 36 errors → 34 errors, 2 errors fixed).
- `npm run build` ✅ (`/my/visibility`, `/my/access-requests` 모두 prerendered).

### 9. 환경 변수

추가/변경 없음. 기존 Supabase 스키마에 새 테이블만 추가.

---

## 2026-05-05 — Sprint 4: Minimalist Consolidation, Privacy Hardening, Official Records Readiness

Sprint 1–3 가 만든 가치 루프 (Feed → Passport → Room/Inquiry → 후속) 위에, 새 surface 추가 없이 **시각 안정화 + 프라이버시 하드닝**. 새 영역 빌드 0개, 기존 영역 더 trustworthy / calmer / inevitable 하게.

베이스라인: Sprint 3 commit `20623da` (= `release: Sprint 3 — Artwork Passport + Private Room + Inquiry attribution loop`).

### Preflight audit 요약

`docs/04_DESIGN_SYSTEM.md`, `src/app/room/[token]/page.tsx`, `src/app/artwork/[id]/page.tsx`, `src/app/my/inquiries/page.tsx`, `src/lib/room/source.ts`, `src/lib/supabase/priceInquiries.ts`, `src/lib/feed/personalizedSalon.ts`, `src/components/ds/*`, `package.json`, `tests/inquiry-source.test.ts`, `supabase/migrations/20260605000000_*.sql` 점검:

- DS primitives (PageShell, PageHeader, FloorPanel, FilterChip, LaneChips, EmptyState, SectionLabel) 풍부 — hand-rolled UI 정리 가능.
- **P0 누출 1건 발견**: `room/[token]/page.tsx` 의 `logBetaEventSync("room_viewed", { ..., token })` 가 share-token 을 분석에 흘리고 있었음 (Sprint 4 P0-A 에서 차단).
- 나머지 telemetry 호출은 token-shaped 누출 없음.
- `test:inquiry-source` script 는 Sprint 3 에서 이미 wired (P0-B 통과).

### A. P0 Fixes (보안 + 운영 안전)

1. **P0-A — Room token 누출 차단 + grep regression test.**
   - `src/app/room/[token]/page.tsx` 의 `room_viewed` payload 에서 `token` 제거. 대신 `item_count`, `has_description` 만 (둘 다 비-비밀, 운영 metric 으로 유용).
   - **신규 `tests/privacy-token-audit.test.ts`** — `src/**` 전체에서 `logBetaEventSync` / `logBetaEvent` / `logFeedEvent` 호출 site 51개를 정적 스캔, 페이로드 객체 리터럴에 `token / password / secret / apikey / authorization / cookie / bearer / magic` 키 (case-insensitive substring) 발견 시 fail.
     - line/block comment, string literal, template literal, spread (`...`) 모두 정확히 skip 하는 brace-balanced scanner 구현.
     - allowlist: `feed_session_id`, `source_feed_session_id` (telemetry session id, auth session 아님).
     - 향후 발견 시 regex 를 *넓히지 말고* 호출 site 를 고치는 것이 정책.
   - `package.json` 에 `test:privacy-token-audit` script 추가.

2. **P0-B — `test:inquiry-source` script 확인.** Sprint 3 에서 이미 wired (`package.json` line 19). 추가 작업 없음.

3. **P0-C — Production migration guard.**
   - **`docs/QA_SMOKE.md` 최상단에 신규 "Pre-deploy SQL checklist" 섹션** — `20260605000000_price_inquiry_source_attribution.sql` 가 미적용일 때의 fail mode (`PostgREST 42703 — unknown column source_surface` → "Ask about this work" silent break) 와 검증 SQL 3개 + 5단계 smoke flow.
   - `/my/diagnostics` 의 column-existence probe 는 service-role 코드 회피로 보류 — work order 도 "Consider, optional".

### B. UI/UX 정리 (calm the surfaces)

4. **Room v1.1 — `PageShell` + editorial kicker + line-clamp.**
   - `mx-auto max-w-5xl px-4` → `<PageShell variant="studio">` (DS 톤 일관).
   - 헤더 hand-rolled → `<PageHeader variant="editorial" kicker={t("room.privateRoom")}>`. 한 surface 에 kicker 1개 원칙 준수.
   - artwork tile 의 `note` 를 `WebkitLineClamp: 2` 로 clamp — 긴 큐레이터 노트가 그리드 시각 리듬을 지배 못 함.
   - exhibition placeholder: gray block → `border-dashed border-zinc-200 bg-zinc-50/40` calm dashed frame. broken-card 느낌 제거.
   - i18n: `room.privateRoom` (en/ko) 신규.

5. **Inquiry Inbox v1.1 — progressive disclosure + DS primitives + source filter.**
   - `<PageShell variant="narrow"> + <PageHeader>` 적용.
   - **기본 row 단순화** — 제목 / inquirer / 마지막 활동 + **status summary `Chip`** (tone: `success` for replied, `muted` for closed, `neutral` else). 4-way pipeline / assignee / next-action / notes 가 항상 보이던 dense layout 제거.
   - **expanded "Manage" panel** — pipeline / assignee / next-action 을 `<FloorPanel padding="sm">` + `<SectionLabel>` 에 묶음. 조작 가능성은 100% 보존, 시각 부하만 절제.
   - **Filter rail** — search input + status `LaneChips variant="sort"` (5 옵션) + **신규 source filter `LaneChips`** (6 옵션: All / Feed / Room / Artwork / Exhibition / Profile). pipeline 은 native select 유지 (7 옵션 → chip rail 시 모바일 폭 압박).
   - source filter 는 **client-side mask** (server-side 리스트 그대로). 빈 상태에서도 EmptyState 정상.
   - reply / load-more / note add 의 primary CTA 들 `rounded` → `rounded-full` (DS 일관). search input / select 도 `rounded-full` 톤 통일.
   - i18n: `inquiry.source.filter*` (6키), `priceInquiry.manageTitle`, `priceInquiry.statusSummary*` (4키) — en/ko 양쪽.
   - **기능 보존** verify: status filter, pipeline filter, search, message thread, notes, next action date, assignee, AI reply assist (preview-only), acting-as chip 위치, 작성자 시점 분리, markPriceInquiryRead, listPriceInquiriesForArtist 의 keyset 페이지네이션 — 전부 무수정.

6. **Artwork Passport v1.1 — surgical component split (2개만).**
   - 1160줄 monolith 에서 **pure-presentation 2 components 만** 추출:
     - `src/components/artwork/ArtworkPassportHeader.tsx` — breadcrumb + ARTWORK RECORD kicker + `?fromRoom` 우선순위.
     - `src/components/artwork/ArtworkImageStage.tsx` — image + full-size desktop modal.
   - `page.tsx` 에서 `Image`, `getArtworkImageUrl` import 제거 (양 component 가 흡수).
   - 나머지 (action rail / inquiry panel / owner panel) 는 state/effects 의존이 깊어 *risky split* 으로 판단, **Sprint 5 후보**로 보류 (work order §3.2 도 "Extract only where it reduces complexity without behavior changes" 명시).

### C. Privacy hardening (sanitizer 강화)

7. **`sanitizeInquirySource` 의 SECRET_KEY_RE 확장.**
   - 기존: `(token|password|secret)$|_(token|password|secret)$/i`
   - 신규: `(token|password|secret|apikey|authorization|cookie|bearer|magic)/i` (substring + case-insensitive).
   - snake_case (`api_token`, `share_token`) 와 camelCase (`apiKey`, `authorization`, `cookie`) 모두 잡음. defense-in-depth — 호출 site 는 절대 안 보낸다는 contract 위에 있는 안전망.

8. **`tests/inquiry-source.test.ts` 확장.**
   - `apiKey`, `authorization`, `cookie` strip 케이스 추가.
   - `direct` surface round-trip + legacy null surface chipless rendering invariant.
   - 미값 객체에서 secret-shaped key 가 들어와도 strip 되는지 sanity case.

### 변경 파일

```
신규 (3)
  src/components/artwork/ArtworkPassportHeader.tsx
  src/components/artwork/ArtworkImageStage.tsx
  tests/privacy-token-audit.test.ts

수정 (8)
  src/app/room/[token]/page.tsx
  src/app/artwork/[id]/page.tsx
  src/app/my/inquiries/page.tsx
  src/lib/supabase/priceInquiries.ts
  src/lib/i18n/messages.ts
  package.json
  docs/QA_SMOKE.md
  tests/inquiry-source.test.ts
```

### 검증 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run test:feed-personalization` | **PASS** | 13 invariants |
| `npm run test:feed-living-salon` | **PASS** | |
| `npm run test:feed-telemetry` | **PASS** | |
| `npm run test:people-reason` | **PASS** | |
| `npm run test:inquiry-source` | **PASS** | 9 cases (Sprint 3 7 → Sprint 4 9) |
| `npm run test:privacy-token-audit` | **PASS** | 51 telemetry call sites scanned across 310 files |
| `npm run build` | **PASS** | Next.js production build, type-checks pass |
| `npm run lint` | **83 problems (34 err / 49 warn)** — Sprint 3 baseline 84 (34/50) 대비 1 warning 감소, **신규 회귀 0** |
| `npm run test:ai-safety` | baseline 동일, **신규 회귀 0** (`IntroMessageAssist` auto-fire / hardcoded "ko" 는 별도 영역) |
| `npm run test:onboarding-smoke` | baseline 동일, **신규 회귀 0** |

### Privacy / RLS 영향

- **RLS 무수정.**
- **room TOKEN** 이 분석 payload 에서 완전히 제거됨 — 51개 telemetry call site 정적 스캔으로 영구 보장.
- **inquiry source attribution** 의 sanitizer 가 6 → 8개 secret-shape 패턴까지 차단 (snake/camel 양형).
- `setRoomSource` / `peekRoomSource` 의 token 미저장 invariant 그대로.

### Manual QA 권장

#### Feed
- `/feed?tab=all&sort=latest` — load-more 시 상단 tile freeze 무회귀.
- `/feed?tab=all&sort=popular`, `/feed?tab=following`.
- diagnostics personalization 줄 정상.

#### Room
- 유효 token / 만료 token / empty / 작품 있는 룸.
- room → artwork → "Back to room" 동작.
- room → artwork → inquiry → `/my/inquiries` 의 "From room" chip + source filter "Room" 적용 시 해당 row 만 노출.
- **분석 페이로드 검사 (브라우저 DevTools Network → `beta_events.insert`):** `room_viewed` payload 에 `token` 키가 없는지 확인.

#### Artwork Passport
- 이미지 있음 / 없음 / 다중 이미지 / 데스크탑 클릭 → full-size modal / Escape 닫힘.
- owner / delegate / non-owner / logged-out 모든 시점에서 ActionRail / InquiryPanel / OwnerPanel 무회귀.
- `?fromRoom=` 진입 시 "Back to room" primary, generic back secondary.

#### Inquiry inbox
- 기본 row: title / inquirer / last activity / status chip 만 보임.
- 클릭 → expanded → Manage panel + thread + reply textarea + AI reply assist + notes 모두 정상.
- source filter chip rail 클릭 → 해당 surface row 만 표시. legacy/null row 는 "All" 에서만.
- pipeline native select / status LaneChips / search / acting-as chip 모두 정상.

#### Mobile
- room / passport / inbox 모두 cramped 하지 않음, metadata wrap 깨지지 않음.

### 알려진 제약 (Sprint 5 후보)

- **Artwork Passport 의 큰 split** — Sprint 4 에서 2개만. ActionRail, InquiryPanel, OwnerPanel, ProvenancePanel 등은 state/effects 의존이 깊어 별도 sprint.
- **Liked-artist viewer-level cached read model** — Sprint 2 audit §2.2 그대로.
- **Inquiry inbox 의 server-side source filter** — 현재 client-side mask. row 가 많아지면 filter chip 클릭 후 페이지네이션 깊이가 비대칭.
- **Viewer role SSR inject** — 시각 영향 미미, defer.

### 환경 변수

이번 스프린트 추가/변경 **없음**.

### Supabase SQL — 수동 실행 필요 여부

이번 스프린트에서 **신규 SQL 마이그레이션 없음**. 다만 Sprint 3 의 `supabase/migrations/20260605000000_price_inquiry_source_attribution.sql` 가 미적용된 환경이면 즉시 실행 필수. 검증 SQL 은 `docs/QA_SMOKE.md` 의 "Pre-deploy SQL checklist" 섹션 참조.

---

## 2026-05-05 — Sprint 3: Artwork Passport + Private Room + Inquiry Loop

Opus Sprint Pack 의 세 번째 스프린트. **Living Salon 위에 첫 번째 진정한 가치 루프 — Feed → Artwork Passport → Save / Private Room / Inquiry → Artist 후속조치 — 의 골격 구축.** 결제·체크아웃·자동 발송 AI 일체 미도입.

베이스라인: Sprint 2 commit `b395922` (= `release: Sprint 2 — Personalized Salon Mixer & Taste Signals`).

### 변경 요약

#### A. Sprint 2 Hardening (preflight)

1. **§2.1 load-more 안정성 — `personalizeFeedEntries` 에 `frozenHeadCount` 옵션 도입.** Sprint 2 의 `alreadySeenPenalty(-4000)` + `jitter(±5500)` 조합이 base step(10000)을 인접 swap 한도 안에서 깰 수 있어, load-more 시 화면에 이미 있던 tile 이 미세하게 흔들릴 수 있었다. 이번 패치는:
   - `personalizedSalon.ts` 에 `PersonalizeOptions { frozenHeadCount? }` 추가. head 는 input 순서로 그대로 emit, tail 만 score → sort → emit.
   - `FeedContent.tsx` 에 `personalizedHeadLenRef` ref 추가. 매 paint 후 `feedEntries.length` 로 업데이트, **tab/sort 변경 시 reset**. force refresh 도 fetch 시작 시점에 reset (tab/sort effect 가 잡음).
   - `frozenHeadCount > entries.length` (예: tab 전환 직후 ref 가 stale) 인 경우 `Math.min` 으로 안전 bound. 새 invariant test 12, 13 추가 (head byte-identical 보존, oversized freeze 처리).
2. **§2.2 liked-artist affinity scope** — 현재 candidate set 의 liked artwork ids 만으로 derive. 큰 supabase analytics scan 명시적 금지 (work order §3.4). 더 풍부한 viewer-level liked artist map 은 Sprint 4 의 cached read model 후보로 HANDOFF 명시. v1 한계 그대로 유지.
3. **§2.3 viewer role first-paint race** — boost 가 ≤ ¼ position step 이라 시각 변화 없음. defer (Sprint 2 HANDOFF 의 알려진 제약 그대로).
4. **§2.4 jitter docstring 정합성** — `feedScoring.ts` 의 calibration philosophy 주석을 실제 상수 (`jitterAmplitude = 5_500`) 와 정확히 일치하도록 재작성. "no single signal can leapfrog more than ~1 position", "peak-to-peak just over one position step" 같이 실측-기반 표현으로 갱신.

#### B. Inquiry Source Attribution Spine (Sprint 3 의 척추)

5. **신규 migration `supabase/migrations/20260605000000_price_inquiry_source_attribution.sql`** — `price_inquiries` 에 7 nullable 컬럼 추가:
   - `source_surface text` — closed set CHECK (`feed | room | artwork | exhibition | profile | direct`).
   - `source_artwork_id uuid → artworks(id) on delete set null`
   - `source_exhibition_id uuid` — 외래키 없음 (exhibitions 스키마와 결합 회피, attribution 정보용).
   - `source_room_id uuid` — **share-token 이 아닌 resolved shortlist UUID 만**. 가벼운 partial index `idx_price_inquiries_source_room`.
   - `source_feed_session_id text` — Sprint 1 telemetry session id (auth session 아님).
   - `source_feed_item_key text` — 예: `art-<artwork.id>`.
   - `source_payload jsonb` — 1 KiB 이내 작은 구조적 hint (tab/sort/position 등).
   - **RLS 무수정**, RPC/trigger 추가 없음. 순수 additive schema 변경.
   - 모든 컬럼에 `comment on column` — privacy intent 가 schema 수준에 명시적.

6. **`createPriceInquiry` 시그니처 확장** — 세 번째 인자 `source?: InquirySource` 추가, **backward-compat**.
   - `InquirySource` 타입: `surface`, `artworkId`, `exhibitionId`, `roomId`, `feedSessionId`, `feedItemKey`, `payload`. 모두 optional.
   - `sanitizeInquirySource()` privacy gate:
     - unknown surface 는 silently drop (CHECK 와 defense-in-depth).
     - payload 에서 `token` / `password` / `secret` / `*_token` 키 제거 (regex 매칭).
     - nested object / array 제거 (v1 keep flat).
     - JSON 직렬화 1 KiB 초과 시 payload 통째로 drop.
   - 기존 호출자 무영향 — 두 번째 인자 (`message`)까지만 사용해도 정상 동작.
   - `inquiry_created` event payload 에 `source_surface` echo (없으면 `"direct"`) — dashboard 가 attribution column 조인 없이 funnel split 가능.

7. **`PriceInquiryRow` 에 source 필드 노출** + `INQUIRY_SELECT` / `INQUIRY_LIST_SELECT` 에 7개 컬럼 포함 + `normalizeInquiry` 도 source 필드를 안전하게 캐스팅.

#### C. Room → Artwork → Inquiry 흐름

8. **`src/lib/room/source.ts` 신설** — `setRoomSource` / `peekRoomSource` / `consumeRoomSource` (`feed/telemetry.ts` 패턴 차용).
   - **room TOKEN 절대 저장 안 함**. resolved shortlist UUID (`room_id`) 만.
   - 30분 TTL (feed source 와 동일).
   - SSR-safe.

9. **`src/app/room/[token]/page.tsx` 시각 업그레이드 (Sprint 3 §4.2)** — Living Salon 톤으로 전면 재작성.
   - `max-w-3xl` → `max-w-5xl`, breath 더 넉넉. uppercase tracking-[0.18em] 의 "CURATED BY" caption.
   - 4:5 portrait 카드 (`object-contain` 으로 작품 무결성 보존 — 살롱과 동일 톤).
   - Card hover transition 도 Sprint 1 톤 일치 (`opacity-95`, 부드러운 300ms).
   - Loading / not-found / empty 모두 i18n (`room.loading` / `room.notFound` / `room.empty`). owner 가 username 있으면 `/u/<username>` 링크.
   - Exhibition row 도 같은 4:5 ratio 의 muted placeholder 로 톤 통일.
   - artwork link 클릭 시 **synchronous setRoomSource** — 다음 페이지 (artwork detail) 가 mount 시점에 이미 breadcrumb 보유.

10. **`src/app/artwork/[id]/page.tsx` Passport tone refinement (Sprint 3 §3, surgical).**
    - **breadcrumb header 정비** — "ARTWORK RECORD" uppercase tracking caption 으로 페이지 장르를 ecommerce 가 아닌 official record 로 명료화. `?fromRoom=` 일 때 "Back to room" 이 primary, generic back 은 secondary 로 시각 우선순위 변경.
    - hardcoded `"Loading..." / "Artwork not found" / "No image" / "Untitled" / "Back to room"` → 모두 i18n keys 로 마이그레이션 (`common.loading`, `common.untitled`, `artwork.notFound`, `artwork.noImage`, `artwork.backToRoom`).
    - `?fromRoom=token` mount 시 `getRoomByToken` 으로 token → roomId resolve. **resolved id 만** sessionStorage 에 저장 (token 은 URL 에만 잔류). 실패는 silently degrade (attribution 없음).
    - `handleAskPrice` 가 source 결정 함수 `buildInquirySource()` 호출. 우선순위: 명시 `?fromRoom=` resolved → live `peekRoomSource()` → live `peekFeedSource()` (artwork id 일치 검증) → fallback `artwork`. token 은 어떤 경우에도 attribution payload 에 들어가지 않음.
    - **큰 component split 은 의도적 보류**. 1160줄 monolith 를 surgical refactor 하는 것보다 in-place 톤 정리가 risk-effective. work order §3.2 도 "extraction pragmatic, do not over-engineer" 명시. Sprint 4 후보.

11. **`/my/inquiries` source chip** — list row header 에 small uppercase muted chip (`From feed` / `From room` / `From artwork` / `From exhibition` / `From profile` / `Direct`).
    - `inquiry.source.<surface>` i18n keys 6개 (en/ko 양쪽).
    - `source_surface` 가 null 인 legacy row / direct 방문은 chip 미노출 (silent fallthrough).
    - 다른 inquiry 기능 (status / pipeline / search / message thread / notes / next action / assignee / AI reply assist preview-only / acting-as chip) **무수정**.

#### D. AI Reply Assist guardrails (Sprint 3 §5.6 verify)

12. `InquiryReplyAssist` 의 preview-first 패턴 유지 verify. 자동 발송 코드 경로 0. `markAiAccepted` 는 reply 가 실제로 발송된 후에만 호출 (기존 동작). Sprint 3 변경 없음.

### 검증 결과

| 명령 | 결과 | 비고 |
|------|------|------|
| `npm run test:feed-personalization` | **PASS** | 13 invariants (Sprint 2 의 11 + Sprint 3 §2.1 의 frozenHeadCount 2개) |
| `npm run test:feed-living-salon` | **PASS** | Sprint 1 builder invariants 보존 |
| `npm run test:feed-telemetry` | **PASS** | Sprint 1 telemetry helpers 보존 |
| `npm run test:people-reason` | **PASS** | people 추천 reason 보존 |
| `npm run test:inquiry-source` | **PASS** | 7 cases — sanitizer privacy invariants |
| `npm run build` | **PASS** | Next.js production build |
| `npm run lint` | baseline 동일 (34 errors / 50 warnings) — Sprint 3 신규 lint 회귀 0. 새 파일 모두 깨끗함 |
| `npm run test:ai-safety` | baseline 동일 — Sprint 3 신규 회귀 0. (`IntroMessageAssist` auto-fire / hardcoded "ko" 는 별도 영역) |
| `npm run test:onboarding-smoke` | baseline 동일 — Sprint 3 신규 회귀 0. (`src/app/page.tsx` 의 LOGIN_PATH redirect 별도 영역) |

### Privacy / RLS 검토

- **room TOKEN 보호** — 어떤 attribution column / payload 에도 token 이 들어가지 않음. `setRoomSource` 시그니처 자체가 `room_id` 만 받음. `sanitizeInquirySource` 는 `*token` / `password` / `secret` 키를 regex 로 strip (defense-in-depth).
- **RLS 무수정** — 이번 마이그레이션은 ALTER TABLE ADD COLUMN + CHECK + INDEX + COMMENT 만. 기존 `price_inquiries_*_*` 정책 그대로.
- **attribution 은 informational only** — 서버 권한과 무관. column 값으로 access grant 발생 가능성 없음.
- **payload 1 KiB cap** — analytics 행 폭주 방지. nested object/array 도 v1 에서 제거하여 형태 단순.
- **inquiry_created event payload 의 source_surface echo** — 절대 token 이 아닌 surface 라벨만.

### Manual QA 권장 시나리오

#### Feed regression
- `/feed?tab=all&sort=latest` — load-more 시 화면 위 tile 이 흔들리지 않는지 (Sprint 3 §2.1 핵심).
- `/feed?tab=all&sort=popular` — popular sort 의미 보존.
- `/feed?tab=following` — relationship-first 톤.
- `/my/diagnostics` — "Personalization (last paint)" 줄 표시.

#### Artwork Passport
- 이미지 있는 작품 / 없는 작품.
- 다중 이미지 작품.
- exhibition 연결된 작품.
- price public / inquire mode.
- owner / delegate / non-owner / logged-out 각 시나리오에서 action rail.
- `?fromRoom=<token>` 진입 시 "Back to room" 이 primary, generic back 이 secondary.
- mobile viewport (max-w-2xl 절제 유지).

#### Room
- 유효 token / 만료 token / empty room / 작품 있는 room.
- room → artwork → "Back to room" 동작.
- room → artwork → inquiry → `/my/inquiries` 에서 "From room" chip 노출 (artist/delegate 시점).

#### Inquiry
- artwork 직접 → inquiry → chip "From artwork" (또는 chip 없음).
- feed → artwork → inquiry → chip "From feed".
- room → artwork → inquiry → chip "From room".
- 기존 reply / notes / status / pipeline / AI reply assist preview-only.

### 알려진 제약 & Sprint 4 추천

- **artwork detail 의 component split** — 1160 줄 monolith 그대로. 향후 `ArtworkPassportShell` / `ArtworkActionRail` / `ArtworkInquiryPanel` 등으로 깔끔하게 쪼개면 유지보수 효율 상승. risk: 기존 동작 회귀, 그래서 Sprint 3 에서는 surgical refactor 만.
- **liked-artist viewer-level read model** — Sprint 2 audit §2.2. 현재 candidate set 한정. cached read model 신규 (예: `viewer_liked_artists` materialized view, 일배치 refresh) → 매 feed load Supabase scan 없이 풀어낼 수 있음.
- **viewer role SSR inject** — Sprint 2 §2.3. 시각 영향 미미하지만 깔끔함.
- **room 가 cart 처럼 보이지 않게 추가 디테일** — exhibition card 의 thumbnail 수확 (lookup_exhibition_thumb), owner 의 short bio 노출 등.
- **inquiry inbox 의 source 기반 필터/정렬** — chip 만 표시 중. 나중에 "From feed" / "From room" 만 필터링 가능하게 하면 conversion 분석 강해짐.
- **AI auto-classification of inquiry intent** — preview-first 유지. 현재 InquiryReplyAssist 의 triage chip 만 활용. 자동 발송은 영원히 금지.

### 환경 변수

이번 스프린트에서 추가/변경된 환경 변수 **없음**.

### Supabase SQL — 수동 실행 필수

**1개 신규 마이그레이션**: `supabase/migrations/20260605000000_price_inquiry_source_attribution.sql`

- ALTER TABLE ADD COLUMN 7개 + CHECK 1개 + partial INDEX 1개 + COMMENT 4개 만 포함. PL/pgSQL 함수 추가 없음.
- Supabase Dashboard SQL Editor 에서 **파일 전체를 한 번에 paste & Run** 가능 (workspace rule §1-1 의 "PL/pgSQL 함수 다수 포함 시 섹션별 실행" 케이스 아님).
- 실행 후 sanity check:
  ```sql
  -- 컬럼 추가 확인
  select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema='public' and table_name='price_inquiries' and column_name like 'source_%'
  order by column_name;

  -- CHECK 적용 확인
  select pg_get_constraintdef(oid)
  from pg_constraint
  where conname = 'price_inquiries_source_surface_chk';

  -- partial index 확인
  select indexname, indexdef
  from pg_indexes
  where tablename = 'price_inquiries' and indexname = 'idx_price_inquiries_source_room';
  ```

### 운영자 SQL — 첫 7일 funnel sanity check

```sql
-- inquiry surface 분포 (chip 가 의미를 가진 시점부터)
select
  coalesce(source_surface, 'legacy_or_direct') as surface,
  count(*) as inquiries
from public.price_inquiries
where created_at >= now() - interval '7 days'
group by 1
order by 2 desc;

-- room → inquiry conversion (room 별, attribution 가능한 row 만)
select
  s.id as room_id,
  s.title as room_title,
  count(pi.id) as attributed_inquiries
from public.price_inquiries pi
join public.shortlists s on s.id = pi.source_room_id
where pi.created_at >= now() - interval '30 days'
group by s.id, s.title
order by attributed_inquiries desc
limit 20;

-- feed → inquiry funnel (feed source 가 있는 inquiry 의 tab/sort 분포)
select
  coalesce(source_payload->>'tab', '?') as tab,
  coalesce(source_payload->>'sort', '?') as sort,
  count(*) inquiries
from public.price_inquiries
where created_at >= now() - interval '30 days'
  and source_surface = 'feed'
group by 1, 2
order by 3 desc;
```

---

## 2026-05-05 — Sprint 2: Personalized Salon Mixer & Taste Signals

Opus Sprint Pack 의 두 번째 스프린트. **결정론적 personalization layer 도입.** Sprint 1 의 Living Salon 시각 안정화 + 측정 토대 위에, 같은 입력에 대해 결정론적이고, 같은 viewer 에 대해 안정적이며, 다른 viewer 에 대해 의미 있는 차이를 만드는 ranking 레이어를 추가. **런타임 AI 호출 없음, 광고 없음, 외부 모델 호출 없음.**

베이스라인: Sprint 1 commit `9dc3398` (= `release: Sprint 1 — Feed face stabilization + measurement foundation`).

### 변경 요약

#### A. Sprint 1 Audit Gap Fix (선행 작업)

1. **`FEED_LAYOUT_VERSION` SSOT 통합** — `FeedContent.tsx` 에 local const 로 중복되어 있던 `FEED_LAYOUT_VERSION = "living_salon_v1.7_incremental"` 를 제거하고, **`@/lib/feed/telemetry` 의 export 만 사용**. dashboard split-brain 위험 영구 제거.
2. **`FeedContent.tsx` 의 직접 `logBetaEvent("feed_loaded" | "feed_first_paint" | "feed_load_more")` 5 호출** → **`logFeedEvent` 헬퍼로 마이그레이션**. 이로써 모든 feed-surface 이벤트가 동일한 envelope (`surface: "feed"` + `session_id` + `layout_version`) 를 공유.
3. **untracked 중복 파일 정리** — `src/lib/feed/telemetry 2.ts`, `tests/feed-telemetry.test 2.ts` (macOS 동기화 흔적) 삭제.
4. **Sprint 1 audit B-3, B-4, B-5 verify** — `PeopleCarouselStrip → FollowButton`, `FeedArtworkCard → LikeButton` 의 `surface={feedContext ? "feed" : undefined}` + `feedContext={feedContext}` 전달이 이미 코드에 적용되어 있음을 grep 으로 확인. `setFeedSource` 도 artwork / exhibition / person 세 surface 모두에서 fire 됨을 확인.

#### B. Personalization Layer (이번 스프린트의 척추)

5. **`src/lib/feed/feedSeed.ts` 신설** — non-cryptographic stable hash + PRNG.
   - **`fnv1a32(input)`** — FNV-1a 32-bit 해시. 식별자/저장 키 절대 사용 금지, **seed 용도 한정**.
   - **`createRngFromSeed(seed)`** — public-domain Mulberry32 PRNG. 같은 seed → 같은 [0, 1) 시퀀스.
   - **`seedFromViewer({ userId, tab, sort })`** — `v1:${userKey}:${tab}:${sort}` 의 FNV 해시. anonymous viewer 는 단일 bucket. **freshness day-bucket 의도적 미포함** (refresh stable).
   - **`jitterForItem(viewerSeed, itemKey)`** — XOR + Mulberry32 mixing step 으로 강한 avalanche. *주의: FNV-1a 만으로 `${seed}:${itemKey}` 를 해싱하면 인접 itemKey ("art-a0" vs "art-a1") 가 거의 동일한 jitter 를 만들어 viewer 간 차이가 안 생김 — initial 구현에서 발견하고 수정함.* 출력 ∈ (-1, 1).

6. **`src/lib/feed/feedSignals.ts` 신설** — viewer 신호 정의 + sessionStorage helper.
   - **`ViewerSignals`** 타입: `userId`, `tab`, `sort`, `followingIds`, `likedArtworkIds`, `viewerRole?`, `seenItemKeys?`. 모두 cheap-to-compute (Set / string).
   - **`readSeenItemKeys()`** — Sprint 1 의 `IMPRESSION_DEDUP_KEY` (sessionStorage) 에서 `${tab}:${sort}:${itemKey}` 튜플을 파싱해 **bare item key** Set 으로 반환. tab/sort scoping 은 dedup-fire 에는 유지하되 personalization 의 already-seen 판정은 broader (탭 전환 후에도 본 것 기억). SSR-safe (storage 미접근 시 빈 Set).
   - **`deriveLikedArtistIds(likedArtworkIds, artworkIdToArtistId)`** — feed entries 에서 직접 도출 가능한 affinity helper. extra fetch 없음.

7. **`src/lib/feed/feedScoring.ts` 신설 — named WEIGHTS + pure scorer.**
   - **`BASE_POSITION_WEIGHT = 10_000`** — 한 position 차이가 어떤 single bonus 보다도 크게 calibrate.
   - **`WEIGHTS`** (모두 named export, magic number 산재 금지):
     - `followedArtist: 9_500` — 팔로우한 artist 의 작품. ~1 position 상승.
     - `likedArtistAffinity: 6_500` — 본인이 좋아요 누른 artist 의 다른 작품. follow 보다 약함 (취향은 follow 보다 빨리 흐름).
     - `viewerRoleAffinity: 2_500` — 매우 작은 role 기반 nudge.
     - `inquiryAvailable: 2_000` × **role multiplier** (collector 1.0 / gallerist 0.5 / curator 0.25 / artist 0.0) — pricing_mode = "inquire" 작품의 collector-친화 boost.
     - `alreadySeenPenalty: 4_000` — 같은 세션에 impressed 된 작품.
     - `jitterAmplitude: 5_500` — viewer-stable per-item jitter 의 진폭. peak-to-peak 11_000 으로 인접 1자리 swap 까지만 허용 (work order §3.3 "vary first screens, not randomize the whole feed" 충족).
   - **`scoreArtworkEntry(...)`** — pure function. base position 점수 + signal boost/penalty + jitter. 반환값에 `reasons: ScoreReason[]` 첨부 — 향후 quiet hint UI 에 활용 가능, 빈 배열이면 "no clean reason → no hint" (work order §3.6 hallucination 금지 원칙).
   - **same-artist run penalty 는 여기 *없음*.** 이미 `livingSalon.ts` 의 `softenSameArtistRuns` 가 personalize 다음 단계인 builder 에서 동작하므로, 동일 제약을 두 곳에 두면 calibration drift 위험. canonical home 한 곳으로 통일.

8. **`src/lib/feed/personalizedSalon.ts` 신설** — `personalizeFeedEntries(entries, viewer): { entries, reasonsByArtworkId, topDebug }`.
   - **순수 함수**. 같은 입력 → 같은 출력. 시계/Math.random/Supabase 미접근.
   - artwork entries 만 reorder, exhibition entries 는 input position 유지 (cadence 는 builder 가 owner).
   - **anonymous viewer (userId == null) 는 personalization 자체를 skip** — entries.slice() 그대로 반환. degrade-gracefully 분기.
   - score desc + originalIndex tie-break stable sort. 최종 `out` 배열은 entries 의 *position* 을 유지하면서 artwork 슬롯만 새 순서로 채움 — exhibition cadence 100% 보존.
   - `topDebug` (12개 cap) 로 diagnostics 페이지에서 ranking 결과 inspect 가능.

9. **`src/lib/feed/viewerRole.ts` 신설** — `main_role` 만 가벼운 fetch + 10분 cache.
   - module-level `Map<userId, {role, fetchedAt}>` cache + inflight promise dedupe.
   - 실패는 silently null 처리. mixer 가 role==null 에서도 동작.
   - 기존 `getMyProfile()` 은 PROFILE_ME_SELECT 로 30+ 컬럼 fetch — main_role 한 글자에 그건 과함. 이 helper 는 `select main_role` 단일 컬럼만.

10. **`FeedContent.tsx` 통합** — `viewerRole` state + `livingSalonItems` useMemo 가 personalize → builder 순으로 흐름.
    - `readSeenItemKeys()` 를 useMemo 안에서 호출 — feed list 변경마다 최신 impression set 으로 알리아싱 정확.
    - useMemo deps: `feedEntries`, `discoveryData`, `userId`, `tab`, `sort`, `followingIds`, `likedIds`, `viewerRole` (모두 referential 안정).
    - `feed_first_paint` payload 에 `personalization: { enabled, has_role, following_count, liked_count }` 첨부 — dashboard 가 user_id 역추적 없이 personalized vs anonymous split 가능.

#### C. Diagnostics

11. **`/my/diagnostics`** — feed surface 섹션에 **"Personalization (last paint)"** 한 줄 추가. `feed_first_paint` payload 의 `personalization` 메타에서 가장 최신 한 건을 표시 (`enabled:yes/no · role:known/unknown · following:N · liked:N`). i18n 키 추가: `diagnostics.personalization.title` (en/ko).

#### D. Tests

12. **`tests/feed-personalization.test.ts` 신설** (`npm run test:feed-personalization`) — 11개 invariants:
    1. **same viewer + same input ⇒ identical output**.
    2. **다른 userId 는 적어도 한 pair 에서 다른 ordering** (boost 로 base 차이가 거의 상쇄된 인접 두 tile 시나리오).
    3. **followed-artist boost 가 tile 을 ~1 position 끌어올림** (절대 top 으로 leapfrog 하지 않음).
    4. **liked-artist affinity 는 mild** (≥ 3 position 깊이의 tile 은 2 position 이상 못 올라감).
    5. **anonymous viewer ⇒ entries 무수정 반환** (degrade branch).
    6. **mixer 는 entry 추가/제거 안 함, mutation 없음** (private/orphan filter 위임 보존).
    7. **single signal 로 깊게 묻힌 tile (idx 9) 이 idx 7 위로 못 올라감** (latest base 보존).
    8. **calibration invariants** — `WEIGHTS.followedArtist < BASE_POSITION_WEIGHT` 등.
    9. **`scoreArtworkEntry` 순수성** (같은 입력 두 번 호출 → 같은 score, 같은 reasons).
    10. **FNV-1a / Mulberry32 결정론**.
    11. **`alreadySeenPenalty` 정확히 configured weight 만큼 적용**.

### 검증 결과

| 명령                          | 결과 | 비고                                                                  |
|-------------------------------|------|----------------------------------------------------------------------|
| `npm run test:feed-personalization` | **PASS** | 11 invariants 모두 통과                                                |
| `npm run test:feed-living-salon`    | **PASS** | Sprint 1 builder invariants 보존                                       |
| `npm run test:feed-telemetry`       | **PASS** | Sprint 1 telemetry helpers 보존                                        |
| `npm run test:people-reason`        | **PASS** | people 추천 reason 보존                                                 |
| `npm run build`                     | **PASS** | Next.js production build 통과                                          |
| `npm run lint`                      | baseline 동일 (34 errors / 50 warnings — 새 파일에는 0 lint 문제) | error 들 모두 baseline pre-existing (`useT.ts` setState in effect, `artworks.ts` no-explicit-any 등) |
| `npm run test:ai-safety`            | baseline 동일 — Sprint 2 가 도입한 regression 없음 | `IntroMessageAssist` auto-fire / hardcoded "ko" 는 별도 영역, Sprint 1 에서도 동일 |
| `npm run test:onboarding-smoke`     | baseline 동일 — Sprint 2 가 도입한 regression 없음 | `src/app/page.tsx` 가 ONBOARDING_PATH 대신 LOGIN_PATH 로 redirect — 별도 영역 |

### Personalization 아키텍처 한눈에

```
raw RPC entries (latest desc / popular desc, RPC 가 결정)
  │
  ▼
personalizeFeedEntries(entries, viewer)        ← 순수, 결정론적, 이번 스프린트
  │  - artwork entries 만 score-based reorder
  │  - exhibition entries 는 position 유지
  │  - anonymous viewer 면 무수정 통과
  ▼
buildLivingSalonItems(entries, …)              ← Sprint 1, 무수정
  │  - rhythm / cadence / anchor / persona-cluster
  │  - softenSameArtistRuns
  ▼
LivingSalonItem[]  →  <LivingSalonGrid />      ← Sprint 1, 무수정
```

### 결정론 보장은 어떻게?

- **시계/Math.random 미사용** — scoring/seed/sort 의 모든 step 이 input 에 대한 순수 함수.
- **stable sort + originalIndex tie-break** — Array.prototype.sort 가 ES2019 부터 stable 하지만 belt-and-suspenders.
- **seed 는 (userId, tab, sort) 의 함수** — refresh 마다 변하지 않음. day-bucket 같은 freshness 차원 의도적 미포함 (Sprint 3 lever).
- **scoreArtworkEntry 의 모든 인자가 input** — `(artwork, position, listLength, viewer, likedArtistIds, jitter)` 외부 의존성 0.

### 고의적으로 personalize 하지 않은 영역

- **exhibition strip 순서 / 배치** — builder 의 cadence (`CONTEXT_MIN_GAP` / `EXHIBITION_MIN_COVERS`) 가 owner. mixer 가 건드리면 rhythm 파이프라인 두 번 빌드.
- **people carousel 내부 순서** — `LIVING_SALON_PERSONAS` 가 owner. v1 personalize 미적용.
- **sort 자체** — `latest` / `popular` 의 RPC sort 는 그대로. mixer 는 그 위 nudge 만.
- **persona / role 기반 hint UI** — `reasonsByArtworkId` 가 준비되어 있으나 v1 에서는 *카드 표면에 hint 를 띄우지 않음*. work order §3.6 의 "If no clean reason exists, show no reason" 보수 원칙 + 노이즈 회피. Sprint 3 의 quiet hint UI 후보.

### Manual QA 권장 시나리오

- `/feed?tab=all&sort=latest` — 다른 두 본인 계정으로 첫 화면 차이 비교 (followed/liked 분포 다른 계정).
- `/feed?tab=all&sort=popular` — popular sort 의미 보존 검증 (같은 viewer 에서 likes_count desc 전반적 유지).
- `/feed?tab=following` — relationship-first 톤 유지.
- 로그아웃 + `/feed` — 모든 시나리오에서 RPC 순서 그대로 (anonymous 분기 검증).
- `/feed` → 작품 클릭 → "Ask price" → `feed_item_inquiry_click` 발화 (Sprint 1 attribution 보존 확인).
- `/my/diagnostics` — `Personalization (last paint)` 줄에 viewer 본인의 last paint 메타가 노출되는지 확인.

### 알려진 제약 & Sprint 3 추천

- **viewerRole fetch 의 first-paint race** — first paint 시점에 role 이 아직 도착 안 했으면 `viewerRole = null` 로 score. boost 가 `viewerRoleAffinity = 2_500` (≤ ¼ position step) 이라 시각 변화 없음. 그럼에도 SSR / server component 단계에서 role 을 미리 inject 하면 더 깔끔. → Sprint 3 candidate.
- **seenItemKeys 는 sessionStorage 한정** — 새 탭/세션에서는 history 0. cross-session memory 가 필요하면 long-term storage 또는 supabase RPC 가 필요하지만, work order §3.4 가 명시적으로 금지 ("do not query large analytics history from Supabase on every feed load in this sprint"). Sprint 3 에서 *batched* 야간 집계로 풀 수 있음.
- **quiet hint UI** — `reasonsByArtworkId` 가 카드까지 흐르도록 prop drilling 만 하면 됨. Sprint 3 에서 "From artists you follow" 같은 1-line hint 를 first paint 에서 1-2 카드만 표시하는 식으로 추가 권장 (UI 노이즈 회피).
- **exhibition / people 의 personalize** — 데이터 양이 늘어나면 의미가 생김. Sprint 3 candidate.

### 환경 변수

- 이번 스프린트에서 추가/변경된 환경 변수 **없음**.

### Supabase SQL

- 이번 스프린트에서 추가/변경된 마이그레이션 **없음**. 기존 `beta_analytics_events` 테이블 (Sprint 0 에서 생성) 만 사용.

### 운영자 추천 SQL — personalization 효과 sanity check

```sql
-- Sprint 2 후 personalized vs anonymous first-paint 분포
select
  (payload->'personalization'->>'enabled')::boolean as personalized,
  count(*) as paints,
  avg((payload->>'item_count')::int) as avg_items,
  avg((payload->>'data_ms')::int) as avg_data_ms
from public.beta_analytics_events
where event_name = 'feed_first_paint'
  and created_at >= now() - interval '7 days'
group by 1
order by 1 desc;

-- 본인 viewerRole 분포 (운영자 슬랙 공유 전, role 다양성 확인)
select
  coalesce(payload->'personalization'->>'has_role', '?') as has_role,
  count(*)
from public.beta_analytics_events
where event_name = 'feed_first_paint'
  and created_at >= now() - interval '30 days'
group by 1;

-- followed_count 분포 - 누가 personalize 의 혜택을 가장 많이 받는가
select
  width_bucket((payload->'personalization'->>'following_count')::int, 0, 50, 10) as bucket,
  count(*) paints
from public.beta_analytics_events
where event_name = 'feed_first_paint'
  and created_at >= now() - interval '7 days'
group by 1
order by 1;
```

---

## 2026-05-05 — Sprint 1: Feed Face & Measurement Foundation

Opus Sprint Pack 의 첫 번째 스프린트. **Living Salon 피드의 시각 안정화 + 측정 토대 구축.** Sprint 2 (Personalized Salon Mixer) 가 사용할 신호 파이프라인을 깔되, 이번 패치에서는 personalization / ranking / AI 호출 *모두 미터치*.

베이스라인: `50f6f91c30e61972c41b9a476192b744a40346af`.

### 변경 요약

1. **Visual Refinement (surgical)** — 모바일 2-column 카드의 메타 절제. work order §A2 의 "two-column artwork tiles should show minimal metadata only" 를 정직하게 반영해, `md:` 미만에서는 `year · medium` 라인을 숨김. tablet+ 부터 다시 노출되어 살롱 톤은 그대로. 다른 시각 요소 (anchor 2x2 lg+ fold, exhibition strip floor-tint, people carousel scroll-snap) 는 v1.7 베이스라인이 이미 work order 의 "no full-screen hero / 작품 무결성 / 절제된 메타" 를 충족해 무리한 churn 없이 유지.

2. **`src/lib/feed/telemetry.ts` 신설 (이번 스프린트의 척추)** — 단일 헬퍼가 다음을 모두 처리:
   - `logFeedEvent(name, base)` — 모든 feed-surface 이벤트에 자동으로 `surface: "feed"` / `session_id` / `layout_version` 첨부.
   - `createImpressionTracker({ tab, sort })` — IntersectionObserver + 350ms dwell + sessionStorage-backed 세션 dedup. `(tab, sort, item_key)` 단위로 한 세션 안에서 한 번만 fire.
   - `setFeedSource / peekFeedSource / consumeFeedSource` — 클릭이 시작된 피드 컨텍스트를 sessionStorage 에 30분 TTL 로 저장. artwork detail 의 inquiry click 같은 다운스트림 액션을 피드로 attribution.
   - 모두 SSR-safe / fire-and-forget. IntersectionObserver 미지원 환경에서는 no-op 객체 반환.

3. **신규 텔레메트리 이벤트 (Sprint 1 work order §B 전부)** — `src/lib/beta/logEvent.ts` 의 `BetaEventName` 에 추가:
   - `feed_item_impression` — IntersectionObserver dwell 후 fire.
   - `feed_item_click` — 작품/전시/인물 카드 클릭 시.
   - `feed_item_like_or_save` — `LikeButton` 의 `surface="feed"` 컨텍스트에서 추가 fire (기존 `artwork_liked` 도 그대로 fire 되어 비-피드 surface 와의 비교 가능).
   - `feed_item_follow` — `FollowButton` 의 `surface="feed"` 컨텍스트에서 추가 fire.
   - `profile_view_from_feed` / `exhibition_view_from_feed` — 인물/전시 카드 클릭과 함께 즉시 fire.
   - `feed_item_inquiry_click` — artwork detail 의 "Ask price" CTA 클릭 시 `peekFeedSource()` 가 일치하면 fire (피드 → 작품 → inquiry intent 의 funnel 측정).

   기존 `feed_loaded` / `feed_first_paint` / `feed_load_more` 도 동일 helper 로 마이그레이션 가능하지만, 이번 패치는 `surface` / `layout_version` 의 envelope 호환만 점검하고 코드는 미수정 (regression 위험 최소화).

4. **`LikeButton` / `FollowButton`** — `surface?: "feed" | "artwork_detail" | …` + `feedContext?: { tab, sort, position }` 옵션 prop 추가. 비피드 호출자는 prop 없이 그대로 동작 (기본 surface는 `"other"`). 피드 카드 / people carousel 만 `surface="feed"` + feedContext 전달. `artwork_liked` / `profile_followed` payload 에도 surface 메타 추가됨 — 기존 dashboard 가 깨지지 않도록 키 이름은 그대로.

5. **`/my/diagnostics` 활성화 readout 보강** — RLS 가 본인 row 만 노출하므로 *본인용 진단*에 가장 의미 있는 단면을 추가:
   - **Activation events** — `signup_completed` / `profile_completed` / `upload_completed` / `bulk_publish_completed` / `exhibition_created` / `exhibition_artwork_added` / `inquiry_created` 의 본인 카운트.
   - **Feed surface events** — feed-surface 이벤트만 분리 카운트.
   - **Clicks by tab / by item kind** — `feed_item_click` payload 의 `tab` 과 `item_kind` 분포로, 피드의 어떤 모듈이 본인에게 가장 잘 작동했는지 즉시 확인.
   - i18n 키 추가: `diagnostics.activation.title`, `diagnostics.feedSurface.title`, `diagnostics.feedSurface.byTab`, `diagnostics.feedSurface.byKind`.
   - 같은 page 의 sample window 를 80 → 400 row 로 확장 (RLS limit 영향 없음).

6. **운영자용 활성화 SQL 런북** — `/my/diagnostics` 는 본인 row 만 보여주므로, 팀이 *오픈베타 전체* 활성화 funnel 을 보려면 Supabase SQL Editor 에서 service role 로 실행:

   ```sql
   -- 가입 → 첫 업로드 → 3+ → 10+ → 전시 publish funnel
   with users_with_event as (
     select user_id, event_name, count(*) as n
     from public.beta_analytics_events
     where created_at >= now() - interval '30 days'
     group by user_id, event_name
   )
   select
     count(distinct user_id) filter (where event_name = 'signup_completed')        as signups,
     count(distinct user_id) filter (where event_name = 'upload_completed' and n >= 1)  as uploaded_1,
     count(distinct user_id) filter (where event_name = 'upload_completed' and n >= 3)  as uploaded_3,
     count(distinct user_id) filter (where event_name = 'upload_completed' and n >= 10) as uploaded_10,
     count(distinct user_id) filter (where event_name = 'exhibition_created')      as exhibition_created
   from users_with_event;

   -- 피드 모듈 클릭 분포 (어떤 모듈이 효과적인가)
   select
     payload->>'item_kind' as item_kind,
     payload->>'tab'       as tab,
     count(*)              as clicks,
     count(distinct user_id) as uniq_users
   from public.beta_analytics_events
   where event_name = 'feed_item_click'
     and created_at >= now() - interval '30 days'
   group by 1, 2
   order by clicks desc;

   -- 피드 → inquiry intent funnel
   select
     date_trunc('day', created_at) as day,
     count(*) filter (where event_name = 'feed_item_impression')   as impressions,
     count(*) filter (where event_name = 'feed_item_click')        as clicks,
     count(*) filter (where event_name = 'feed_item_inquiry_click') as inquiry_intent,
     count(*) filter (where event_name = 'inquiry_created')        as inquiries_created
   from public.beta_analytics_events
   where created_at >= now() - interval '14 days'
   group by 1
   order by 1 desc;
   ```

7. **테스트 보강** — `tests/feed-living-salon.test.ts` 에 *opening-region anchor coexistence* invariant 추가 (anchor 가 있으면 첫 8타일 안에 standard artwork 가 ≥4개 있어야 함 = "single artwork 가 viewport 를 잡아먹지 않음"의 builder-side guard). `tests/feed-telemetry.test.ts` 신규 — sessionStorage 라이프사이클, 30분 TTL eviction, IntersectionObserver 미지원 환경에서의 no-op 동작 검증. `package.json` 에 `test:feed-telemetry` 스크립트 등록.

### 변경된 파일

- `src/lib/feed/telemetry.ts` *(신규)*
- `src/lib/beta/logEvent.ts` — `BetaEventName` 에 7개 신규 이벤트 추가
- `src/components/feed/LivingSalonGrid.tsx` — `tab`/`sort` prop + ImpressionTracker 통합 + 하위 카드에 `feedContext` 전파
- `src/components/feed/ExhibitionMemoryStrip.tsx` — `feedContext` prop, click 시 `feed_item_click` + `exhibition_view_from_feed` + setFeedSource
- `src/components/feed/PeopleCarouselStrip.tsx` — `feedContext` prop, person card click 시 `feed_item_click` + `profile_view_from_feed` + setFeedSource, FollowButton 에 surface/feedContext 전달
- `src/components/FeedArtworkCard.tsx` — `feedContext` prop, click 시 `feed_item_click` + setFeedSource, **모바일 `year·medium` 라인 `md:` 이상에서만 노출**, LikeButton 에 surface/feedContext 전달
- `src/components/LikeButton.tsx` — `surface` / `feedContext` prop, surface=='feed' 시 `feed_item_like_or_save` 추가 fire
- `src/components/FollowButton.tsx` — `surface` / `feedContext` prop, surface=='feed' 시 `feed_item_follow` 추가 fire
- `src/components/FeedContent.tsx` — `LivingSalonGrid` 에 tab/sort 전달
- `src/app/artwork/[id]/page.tsx` — Ask Price CTA click 시 `peekFeedSource()` 일치하면 `feed_item_inquiry_click` fire
- `src/app/my/diagnostics/page.tsx` — Activation / Feed surface readout, by-tab / by-kind 분포
- `src/lib/i18n/messages.ts` — diagnostics 신규 i18n 키 4개 (en/ko)
- `tests/feed-living-salon.test.ts` — opening-region anchor coexistence invariant
- `tests/feed-telemetry.test.ts` *(신규)*
- `package.json` — `test:feed-telemetry` script
- `docs/HANDOFF.md` (이 문서)

### 제품 동작 변화

- **데스크톱 피드** — 시각 변화 없음 (베이스라인 v1.7 의 매트/contain · anchor lg+ 2x2 · floor-tint 그대로). 이벤트만 조용히 흐름.
- **모바일 피드** — 2-column artwork 타일이 `artist + title` 두 줄로 단순해짐 (기존: `artist + title + year·medium`). work order 의 명시 요구 반영.
- **카드 클릭** — 동일하게 artwork/exhibition/profile 페이지로 이동. 추가로 fire-and-forget 텔레메트리 이벤트 발생, source 가 sessionStorage 에 저장됨.
- **좋아요 / 팔로우** — 동작 동일. 피드에서 시작된 액션이면 추가 이벤트 한 개 더 fire.
- **Inquiry** — 피드에서 진입한 작품의 "Ask price" 클릭 시 `feed_item_inquiry_click` 추가 fire. inquiry 자체 동작은 변화 없음.
- **/my/diagnostics** — 새 섹션 두 개 (Activation / Feed surface) 가 본인 row 기준으로 표시.

### 보안 / 개인정보 / RLS

- `beta_analytics_events` RLS 그대로 — 사용자는 *본인 row 만* insert/select. 신규 이벤트 페이로드는 ID + 카드 위치 + tab/sort 등 attribution 메타만 담음 (작품 제목 / 이미지 URL / 자유 텍스트 등 PII 없음).
- 피드 visibility/RLS 가드 (`isPublicSurfaceVisible`, RPC 단의 follower 가드) 미수정.
- `setFeedSource` 의 sessionStorage 키 (`ab_feed_click_source`) 는 30분 TTL + 단일 origin 안에 머묾.
- AI 호출 변경 없음, runtime AI feed generation 도입 없음.

### Supabase SQL 적용 필요

**없음.** `beta_analytics_events` 테이블·RLS·인덱스는 이미 `supabase/migrations/p0_beta_hardening_wave1.sql` 로 적용된 상태.

### 환경 변수

**없음.** 새/변경된 환경 변수 없음.

### 테스트 결과

| 명령 | 결과 |
|---|---|
| `npm run build` | ✅ pass |
| `npm run test:feed-living-salon` | ✅ pass (invariant 1개 신규 추가) |
| `npm run test:feed-telemetry` | ✅ pass (신규) |
| `npm run test:people-reason` | ✅ pass |
| `npm run test:onboarding-runtime` | ✅ pass |
| `npm run test:website-import` | ✅ pass |
| `npm run test:ai-safety` | ⚠️ pre-existing failure (베이스라인 50f6f91 동일, 본 패치 무관) |
| `npm run test:onboarding-smoke` | ⚠️ pre-existing failure (베이스라인 동일, `src/app/page.tsx` 가 onboarding 으로 리다이렉트하지 않는 P-existing 상태) |
| `npm run lint` | ⚠️ pre-existing 34 errors / 49 warnings (베이스라인 동일, 본 패치는 신규 lint 회귀 0건) |

### 알려진 제한 / Deferred

- `feed_loaded` / `feed_first_paint` / `feed_load_more` 는 기존 `logBetaEvent` 직접 호출을 유지 (이미 안정 동작). 다음 패치에서 `logFeedEvent` envelope 으로 일원화 가능.
- `feed_item_inquiry_click` 은 click 시점만 잡음. inquiry submit (`inquiry_created`) 시점의 attribution 은 기존 `inquiry_created` payload 에 surface 메타 추가하는 별도 패치로 분리 가능.
- Sprint 1 work order 가 언급한 `cv_import_completed` / `profile_materials_updated` / `delegation_created_or_accepted` / `room_created_or_shared` 는 이번 스프린트의 *피드 face* 범위에서 제외. 각 surface 의 후속 패치에서 동일 패턴 (`logFeedEvent` 가 아닌 일반 `logBetaEvent`) 으로 추가하면 됨.
- 운영자 dashboard UI 는 만들지 않음. 위 SQL 런북으로 SQL Editor 에서 query.

### 다음 권장 Sprint

**Sprint 2 — Personalized Salon Mixer & Taste Signals.** 이번 스프린트가 깔아둔 `feed_item_impression` / `feed_item_click` / `(profile|exhibition)_view_from_feed` / `(tab, sort, position)` 메타가 그대로 ranking 입력으로 들어감. `livingSalon.ts` 의 deterministic builder 위에 user-seeded score 레이어를 얹으면 됨. `layout_version` 을 bumping 하면 새 mix 가 dashboards 에서 분리 측정.

## 2026-05-02 — Design Spine 최신화 (cornerstone 박기)

`docs/DESIGN.md` 와 `docs/04_DESIGN_SYSTEM.md` 를 *그동안 사용자가 강조해온 가치 / 톤 / 안티패턴 / 운영 룰* 이 모두 cornerstone 으로 박힌 형태로 재구성. 새 기능 / 화면을 칠 때 매번 가치를 새로 창출할 필요가 없도록.

### `DESIGN.md` 재구성

기존 디자인 spine (shell / identity / cards / copy / spacing / a11y / deviations) 위에 다음을 보강:

- **§0. Cornerstone** — 신규. 8 개의 "ship 가능한가" 체크리스트 가치:
  - **0.1 Tone — quiet confidence over decoration** ("진중하고 단정하되 사려깊을 것", Pinterest/Instagram/LinkedIn 벤치, Saatchi/Artsy 안티벤치, "와, 정말 섬세하고 빈틈없다" 감탄 유발 목표).
  - **0.2 Red flags** — 한–영 직역체, raw 에러 코드 leak, 두 번째 H1, kicker + H1 중복, modal 안 쓰는 long body, silent failure.
  - **0.3 Primitives-first (SSOT)** — `src/components/ds/*` 외 hand-rolled `<main>` / `<header>` / `bg-zinc-50/...` panel 은 code smell.
  - **0.4 Persona-aware exposure** — 갤러리스트는 "갤러리스트를 소개합니다" 클러스터, 작가의 세계 row 가 아님. 비-아티스트 페이지에 빈 Statement 버튼 안 띄움.
  - **0.5 Quality-gated visibility** — 썸네일 1 개 전시는 살롱 미노출, 익명 프로필은 People 전용 lane 만, 모델이 추측 못한 unit 은 *없음* (→ no pill).
  - **0.6 Preview-first** — `FORBIDDEN_ACTIONS` enumerate 한 trust boundary. CV import wizard 가 canonical 예시.
  - **0.7 Loose-key preservation** — silent drop 금지, drop 은 empty / known-junk 한정.
  - **0.8 Concept naming over generic labels** — "오늘의 살롱", "작가의 세계", "큐레이터를 만나보세요", "이력 자동 가져오기" 같이 *이름 있는 컨셉* 만.
- **§3 Cards 확장** — Size pill (호수 → cm 추정 시에만, 절대 가짜 단위 부여 금지), People cluster (LinkedIn-style 가로 캐러셀), Modal trigger (Statement / CV).
- **§5 Spacing and color** — 단일 floor-tint `bg-zinc-50/70`, status semantic (amber 행동 필요, emerald 공개/활성, rose 강조, red 에러, zinc neutral).
- **§6. Surface composition rules** — 신규. 9 개 운영 룰:
  - 6.1 One H1 per surface (P4.1 lesson)
  - 6.2 Header order: H1 → lead → LaneChips
  - 6.3 Kicker page_or_strip
  - 6.4 Single floor-tint opacity
  - 6.5 Modal lightbox for long bodies
  - 6.6 Persona-gated sections
  - 6.7 Quality-gated rails
  - 6.8 Skeletons match the shell (geometrically invisible swap)
  - 6.9 Single ActingAsBanner
- **§8 Information accuracy** — 신규. Identity formatter SSOT, size pill 가짜 단위 금지, persona / role chip 추측 금지, loose-key 보존, AI normalizer post-process (enum slug snap or drop), 중복 detection default-skip.
- **§9 Workflow patterns** — 신규. 4 패턴 (Wizard 4-step, Bulk preview-edit grid, Confirm-before-destructive, Server → server-vision automatic fallback) 을 reusable shape 로 명시.

### `04_DESIGN_SYSTEM.md` 보강

상단에 *DESIGN.md 와의 분업* 한 줄 정리 (DESIGN = why/what, 04 = how). 하단에 **Patterns 카탈로그 7 개** 신규:

- **P1. Modal trigger for long bodies** (P5 — Statement / CV)
- **P2. Materials cards on /my** (P6.1 — Profile Materials)
- **P3. Wizard (4-step preview-and-apply)** (P6.2 — `CvImportWizard`)
- **P4. Server → vision automatic fallback** (P6.4 — `visionFallback: true`)
- **P5. Editor + sticky save bar** (P6.1 — `CvEditorClient`)
- **P6. Persona-gated surfaces** (P5–P6)
- **P7. Quality-gated rails** (P3 — 살롱 v1.5–v1.7.1)

### Supabase SQL — 변경 없음 / 환경 변수 — 변경 없음
### Verified: 문서만 갱신, 빌드 영향 없음.

## 2026-05-02 — Salon System v2 P6.4: CV import vision (이미지 + 스캔 PDF 자동 폴백)

P6.3 의 "다음 사이클 후보" 로 미뤄뒀던 vision multimodal 을 같은 사이클 안에 끌어당김. 사용자가 이력서를 *사진으로 찍어* 올리거나 *스캔 본 PDF* 를 올려도 파이프라인이 자동으로 처리.

### 두 진입 경로

1. **이미지 직접 업로드** — JPG / PNG / WEBP. Wizard 의 file picker 가 image MIME 도 허용. 이미지면 서버 텍스트 추출을 *완전히 스킵* 하고 vision 분기로 직행.
2. **스캔 PDF 자동 폴백** — 일반 PDF 업로드 → 서버 `pdf-parse` 실행 → 텍스트가 비면 (`pdf_empty`) 라우트가 `visionFallback: true` 로 응답 → wizard 가 *클라이언트에서* `pdfjs-dist` 로 페이지를 PNG 로 렌더 → `images: [...]` 로 재요청. 사용자에게는 호박색 배너로 "스캔 PDF 같아요 — 이미지 모드로 다시 분석할게요" + 처리 페이지 수 안내.

### Vision 통합

- **`generateJSON` SSOT 확장** — `imageInputs?: ImageInput[]` 옵션 추가. 비어있으면 기존 text-only 동작 그대로. 있으면 user message 가 multimodal `[{type:"text"}, {type:"image_url"} ...]` 배열로 전환. 이미지는 inline `data:` URL (외부 file API 업로드 불요), `detail: "low"` 로 토큰 비용 bounded.
- **`PreparedPrompt` 에 `imageInputs?` 추가** — 모든 AI route 가 동일한 SSOT 위에서 vision 옵션 사용 가능 (현재는 cv_import 만 사용).
- **모델 동일** — `gpt-4o-mini` 가 vision 지원하므로 별도 모델 환경 변수 불필요.

### 클라이언트 PDF 렌더링 (vision fallback)

- **`src/lib/cv/pdfImages.client.ts` 신규** — `renderPdfPagesToPng(base64)` 가 `pdfjs-dist` 의 v4 ESM worker 로 페이지를 canvas → PNG 로 렌더. 캡: 최대 6 페이지, 1240px wide, 단일 페이지 base64 가 2.5 MB 초과 시 JPEG (q=0.85) 로 자동 재인코딩. 메모리 회수 (canvas 0×0, doc.cleanup/destroy).
- **서버 의존성 없음** — Vercel serverless 에 native `canvas` 안 깔아도 됨. 모든 변환은 사용자 브라우저에서.

### 검증 + 캡

- **Validation** ([src/lib/ai/validation.ts](../src/lib/ai/validation.ts)) — `images[]` 가드. MIME `image/png|jpeg|webp` 만, base64 ≤ 3MB / 이미지, 배열 ≤ 8 개. URL / file / images 셋 중 정확히 하나 필수.
- **Vision context** ([src/lib/ai/contexts.ts](../src/lib/ai/contexts.ts)) — `buildCvImportVisionContext` 가 짧은 텍스트 ("Read the attached image(s) and extract per the schema. Do not describe the image; emit JSON only.") 만 전달, 무거운 일은 첨부 이미지로.
- **Source-kind 자동 분기** — 단일 이미지 = `image`, 복수 페이지 = `scanned_pdf`. 모델은 후자에서 "Each attached image is one page in reading order" 가이드를 받음.

### Supabase SQL — 변경 없음
### 환경 변수 — 변경 없음 (기존 `OPENAI_API_KEY` 그대로)

### 새 / 수정 파일

- **신규** [src/lib/cv/pdfImages.client.ts](../src/lib/cv/pdfImages.client.ts) — 클라 전용 PDF → PNG 렌더러 + `fileToBase64` 헬퍼.
- [src/lib/ai/client.ts](../src/lib/ai/client.ts) — `ImageInput` 타입 + `imageInputs?` 옵션 + multimodal user message 빌드.
- [src/lib/ai/route.ts](../src/lib/ai/route.ts) — `PreparedPrompt.imageInputs?` + `generateJSON` 에 전달.
- [src/lib/ai/contexts.ts](../src/lib/ai/contexts.ts) — `buildCvImportVisionContext` 신규.
- [src/lib/ai/validation.ts](../src/lib/ai/validation.ts) — `parseCvImportBody` 가 `images[]` + `imageSourceLabel` 도 검증.
- [src/app/api/ai/cv-import/route.ts](../src/app/api/ai/cv-import/route.ts) — vision 분기, `looksLikeScannedPdfFailure`, `visionFallback` 신호.
- [src/app/my/profile/cv/CvImportWizard.tsx](../src/app/my/profile/cv/CvImportWizard.tsx) — image picker 지원, 자동 폴백 흐름, scanFallback 배너, image-friendly 진행 카피, `arrayBufferToBase64` 제거 (`fileToBase64` 로 일원화).
- [src/lib/i18n/messages.ts](../src/lib/i18n/messages.ts) — `cv.import.fileHintWithImages` / `statusReadingImage` / `statusRenderingPages` / `statusVisionExtracting` / `scanFallbackBanner` / `scanFallbackMaxPages` / `errorRender` / `errorImage` KO/EN.

### 의존

- 신규: `pdfjs-dist@^4.10.38`. 클라 전용으로 사용 (서버 번들에 안 들어감 — `pdfImages.client.ts` 의 dynamic import 와 `"client"` directive 로 분리).

### Verified

- `npx tsc --noEmit` → 0 error
- `npm run build` → success
- 변경 파일 lint clean

### 다음 사이클 후보 (P6.5)

- 이미지 모드 *opt-in 토글* — 텍스트 추출이 가능한 PDF 라도 사용자가 명시적으로 "이미지 모드로 분석" 선택할 수 있게 (예: 텍스트 레이어가 망가진 OCR PDF).
- 페이지 미리보기 strip — vision 분기 진입 전에 렌더된 페이지 썸네일을 보여주고, 사용자가 *건너뛸 페이지를 드롭* 하게.
- normalizer (`normalizeEducationType` / `entriesAreSimilar`) 의 manual editor / website-import 재사용 (P6.3 에서 미뤄둔 항목).

## 2026-05-02 — Salon System v2 P6.3: CV import 정확도 ─ 중복 회피 + education enum 정규화

P6.2 의 import wizard 가 *결과물의 품질* 면에서 가장 자주 부딪힐 두 friction 을 잡아냄.

### 1. 중복 회피 (preview 단계)

- **신규** [src/lib/cv/normalize.ts](../src/lib/cv/normalize.ts) — `signatureForEntry` / `entriesAreSimilar` / `findSimilarIndex`. category 별로 *primary key* (education: school + program + year, exhibitions: title − solo/group prefix + venue + year, awards: name + organization + year, residencies: name + location + year_from/year_to/year) 를 normalize 후 비교. 정확 매치 + "primary 텍스트 + year" 의 looser 매치 두 단계.
- Wizard 가 preview 진입 시 baseline 의 동일 카테고리 항목과 비교해 *유사 항목은 자동으로 skip 으로 시작*. 항목 카드에 `이미 등록된 항목과 유사` 호박색 라벨, "유사 항목 모두 제외 / 모두 포함" 헤더 토글, 항목별 "포함 / 제외" 토글, dim + disabled 시각화.
- save 시 skip 된 항목은 grouped 결과에 빠짐 → 같은 history 가 두 줄로 들어가는 사고 차단. confirm 버튼은 included 가 0 일 때 disable.

### 2. Education `type` enum 정규화

- 기존: prompt 에 `"ba" | "ma" | "phd" | "diploma" | "certificate" | "other"` 였는데 settings taxonomy (`hs_art | ba | bfa | ma | mfa | phd | other`) 와 mismatch → 제출 후 manual editor 에서 `<select>` 가 빈 값으로 보이는 사고.
- **prompt** ([src/lib/ai/prompts/index.ts](../src/lib/ai/prompts/index.ts)) 가 settings 의 7-slug enum 그대로 사용하도록 갱신. 한국어/영어 표기 매핑 예시도 인라인 (학사→ba / BFA→bfa / 석사→ma / MFA→mfa / 박사→phd / 예술고→hs_art / 수료·certificate→other). "BFA → bfa, never ba" 같이 *strict-to-loose* 우선순위 명시.
- **route normalizer** ([src/app/api/ai/cv-import/route.ts](../src/app/api/ai/cv-import/route.ts)) 가 `normalizeEducationType` 으로 모델이 "Bachelor of Fine Arts" / "B.A." / "박사" 같은 free-text 를 뱉어도 다시 슬러그로 snap. unknown 은 `delete fields.type` 으로 drop (junk 라벨 보존하지 않음).
- normalizer 자체는 [src/lib/cv/normalize.ts](../src/lib/cv/normalize.ts) 에 위치 — 추후 manual editor 의 자동 보정 / website-import 에도 재사용 가능하도록 SSOT.

### Supabase SQL — 변경 없음
### 환경 변수 — 변경 없음

### 새 / 수정 파일

- **신규** [src/lib/cv/normalize.ts](../src/lib/cv/normalize.ts) — `EDUCATION_TYPE_VALUES`, `normalizeEducationType`, `signatureForEntry`, `entriesAreSimilar`, `findSimilarIndex`.
- [src/app/api/ai/cv-import/route.ts](../src/app/api/ai/cv-import/route.ts) — `normalizeEducationType` 호출 추가.
- [src/lib/ai/prompts/index.ts](../src/lib/ai/prompts/index.ts) — `CV_IMPORT_SYSTEM` education.type enum settings 동기화 + 표기 매핑 예시.
- [src/app/my/profile/cv/CvImportWizard.tsx](../src/app/my/profile/cv/CvImportWizard.tsx) — `skip` 셋 상태, duplicate 자동 skip, 일괄 토글, 항목별 라벨 + 토글, dim 처리, save 시 skip 제외 로직.
- [src/lib/i18n/messages.ts](../src/lib/i18n/messages.ts) — `cv.import.duplicate*` / `cv.import.entrySkipped|Include|Exclude` KO/EN.

### Verified

- `npx tsc --noEmit` → 0 error
- `npm run build` → success
- 변경 파일 lint clean (사전 존재 warning 은 P6.2 와 동일).

### 다음 사이클 (P6.4 후보)

- **이미지 / 스캔 PDF (vision LLM)** — `generateJSON` 이 현재 text-only chat completion 기반이므로 별도 `generateJSONWithVision` SSOT 가 필요. base64 image 를 multimodal user message 로 보내고, 스캔 PDF 는 `pdf-poppler` 같은 라이브러리로 페이지를 PNG 화 후 vision. Vercel 환경 의존성 점검 동반.
- **website-import / claim 플로우와 normalize 재사용** — 같은 `normalizeEducationType` + `entriesAreSimilar` 를 manual editor 와 website-import 의 dedup pass 에도 적용해 한 입력 경로를 통한 dirty data 가 다른 경로로 새지 않도록.

## 2026-05-02 — Salon System v2 P6.2: CV 자동 import wizard (URL / 이력서 → AI 정리)

P6.1 의 `/my/profile/cv` 수동 editor 위에 *URL 또는 이력서 파일에서 CV 를 자동으로 가져오는 4 단계 wizard* 를 얹음. 작가가 본인 홈페이지 주소 한 줄 또는 PDF/DOCX 한 파일로 *3 클릭 안에* 5 년치 CV 를 정리하는 동선.

### Pipeline

1. **클라이언트 (Wizard Step 1)** — URL 또는 파일 (PDF / DOCX, ≤ 5MB) 입력. base64 인코딩 후 `POST /api/ai/cv-import` 로 전송.
2. **서버 추출 단계** — `src/lib/cv/extract.ts`:
   - URL → fetch (8s timeout, 2MB cap, polite UA) + cheerio 로 script/style/nav/header/footer/aside 제거 후 body 텍스트.
   - PDF → `pdf-parse` (5MB raw cap).
   - DOCX → `mammoth.extractRawText`.
   - 추출 실패는 stable enum (`url_fetch_failed` / `pdf_empty` / ...) 으로 반환 → wizard 에서 i18n 매핑된 친절한 오류로 표시.
3. **LLM 정리 (Wizard Step 2)** — `handleAiRoute` SSOT 위에 `feature: "cv_import"` 로 얹음. `CV_IMPORT_SYSTEM` prompt 가 4 카테고리 (education / exhibitions / awards / residencies) 로 분류 + 정규화 키 (school/program/year/type, title/venue/city/year, name/organization/year, name/location/year_from/year_to) 로 출력. 텍스트 ≤ 24KB 캡 (모델 컨텍스트 안전), `truncated` 플래그로 모델 안내.
4. **Preview (Wizard Step 3)** — 항목별 카테고리 dropdown + 인라인 필드 편집 + 제거. 푸터에 *추가 / 대체* 라디오 토글 (기본 "추가"); "대체" 선택 시 *기존 N개 entry 삭제* 콜아웃. 빈 결과면 "이력서 파일을 첨부해 보세요" 권유.
5. **저장 (Wizard Step 4)** — 사용자 confirm → 같은 `update_my_profile_cv` RPC 로 즉시 persist. baseline 갱신 → editor save bar `saved` 상태로 정리. 4 초 토스트 "{count}개 가져옴".

### 안전 / 장벽

- **Soft-cap 만 적용** (별도 entitlement 매핑 없음) — 모든 작가가 첫 도입에서 부담 없이 한 번 쓸 수 있도록. 일일 AI 소프트캡 (`AI_USER_DAILY_SOFT_CAP`) 은 그대로 적용됨.
- **Forbidden actions** — 이미지 / 스캔 PDF (vision LLM) 는 P6.3 fast-follow 로 미룸. 콘택트 / 가격 / 소셜 핸들은 prompt-level 에서 제거 강제.
- **Preview 단계 강제** — LLM 출력은 사용자가 *명시적으로 confirm* 하기 전엔 절대 DB 에 쓰이지 않음. Wave 1 안전 정책 (`SAFETY_FOOTER`, `assertSafePrompt`) 그대로.
- **Loose-key 보존** — preview 의 항목이 정규화 외 키 (P6.3 import 가 도입할 수 있는) 를 들고 있을 때 editor 가 그대로 보존 (silent drop 없음).

### Supabase SQL — **돌릴 것 없음**

(P5 / P6.1 마이그레이션이 기 적용되었다면 P6.2 는 SQL 변경 없음.)

### 환경 변수 — 변경 없음

기존 `OPENAI_API_KEY` 와 `AI_USER_DAILY_SOFT_CAP` 그대로 재사용.

### 새 / 수정 파일

**런타임**
- [supabase/migrations/...] — 변경 없음.
- **신규** [src/app/api/ai/cv-import/route.ts](../src/app/api/ai/cv-import/route.ts) — `handleAiRoute` 위에 추출 단계 + LLM 호출 + 결과 normalizer (`normalizeResult`) + extract 실패 시 stable HTTP 코드.
- **신규** [src/lib/cv/extract.ts](../src/lib/cv/extract.ts) — URL / PDF / DOCX 추출 헬퍼 (서버 전용, dynamic import 로 edge bundle 분리).
- [src/lib/ai/types.ts](../src/lib/ai/types.ts) — `AiFeatureKey` 에 `"cv_import"` 추가. `CvImportCategory` / `CvImportEntry` / `CvImportResult` 타입 export.
- [src/lib/ai/safety.ts](../src/lib/ai/safety.ts) — `ALLOWED_FEATURES.cv_import = true`.
- [src/lib/metering/usageKeys.ts](../src/lib/metering/usageKeys.ts) — `AI_CV_IMPORT_GENERATED` + `AI_FEATURE_TO_METER_KEY.cv_import`. (entitlement 매핑은 의도적으로 미설정 → soft-cap 만 적용.)
- [src/lib/ai/prompts/index.ts](../src/lib/ai/prompts/index.ts) — `CV_IMPORT_SYSTEM` + `CV_IMPORT_SCHEMA` (4 카테고리 분류 룰, 노이즈 라인 drop, 가짜 사실 금지, 출처 언어 보존).
- [src/lib/ai/contexts.ts](../src/lib/ai/contexts.ts) — `buildCvImportContext` (24KB cap, source kind + label 라벨링).
- [src/lib/ai/validation.ts](../src/lib/ai/validation.ts) — `parseCvImportBody` (URL 스킴 가드 / 파일 kind 가드 / base64 6MB 캡 / URL or 파일 중 하나 필수).
- [src/lib/ai/browser.ts](../src/lib/ai/browser.ts) — `FEATURE_TO_PATH.cv_import` + `aiApi.cvImport()` 단축.

**UI**
- **신규** [src/app/my/profile/cv/CvImportWizard.tsx](../src/app/my/profile/cv/CvImportWizard.tsx) — 4 단계 (idle / running / preview / saving) wizard. URL+파일 입력, 진행 상태 회전 카피, preview 인라인 편집, 추가/대체 모드, ESC/취소 처리, browser-safe base64 인코더 (chunked).
- [src/app/my/profile/cv/CvEditorClient.tsx](../src/app/my/profile/cv/CvEditorClient.tsx) — `cv.editor.importHint` FloorPanel 자리를 `<CvImportWizard>` 로 교체. wizard confirm → `updateMyProfileCv` 즉시 persist + baseline 동기화 + 4 초 success toast.
- [src/lib/i18n/messages.ts](../src/lib/i18n/messages.ts) — `cv.import.*` 36 개 키 KO/EN (입력 / 진행 / 미리보기 / 모드 / 에러 매핑 / confidence / note).

**의존**
- 신규 패키지: `pdf-parse@^1.1.4` + `mammoth@^1.12.0` (서버 dynamic import 로만 사용).
- 신규 dev 패키지: `@types/pdf-parse`.

### Verified

- `npx tsc --noEmit` → 0 error
- `npm run build` → success (`/api/ai/cv-import` 라우트 + `/my/profile/cv` static prerender 모두 정상)
- Lint — 변경 파일 모두 clean.

### 다음 사이클 (P6.3 후보)

- 이미지 / 스캔 PDF 지원 (vision LLM) — `extractFromImage(base64)`.
- "이미 등록된 동일 항목" detection — preview 단계에서 baseline 과 string-similar entry 가 있으면 `(이미 등록된 항목과 유사)` 회색 라벨로 안내, 사용자가 토글로 제외 가능.
- Education `type` (BA / MA / PhD / ...) 자동 추론 — 프롬프트 레벨에서 enum 강제 + Settings 의 `educationTypeOptions` 와 동기화.

## 2026-05-02 — Salon System v2 P6.1: Profile Materials 카드 + CV 수동 editor

P5 의 공개 프로필 Statement / CV 모달이 *데이터를 보여줄 surface* 라면, P6.1 은 작가가 *데이터를 채울 surface*. P6.2 (자동 import wizard) 는 후속 PR.

### 사용자 결정

- 편집 surface 위치: **B** — `/my` 메인에 Profile Materials 카드 + 신규 `/my/profile/cv` 라우트 (전용 편집 surface).
- (P6.2) 자동 import 입력 소스: **γ** — URL + 이력서 파일 둘 다.
- (P6.2) 결과 review UX: **iii** — Preview + 수정 + 추가/대체 모드 선택.

### Audit 결과 (P6.1 진행 전)

- Artist Statement 입력은 이미 `/settings#statement` 에 풍부하게 구축되어 있음 (4000자 textarea + on-blur autosave + ProfileMediaUploader hero + StatementDraftAssist AI 초안 + isArtistRole 가드).
- CV 4 개 jsonb 컬럼 (education / exhibitions / awards / residencies) 은 *DB 에 존재* 하지만 settings 에 **education 만** fragmented row UI. 나머지 3 개는 *입력 surface 가 0*.

### Supabase SQL — **돌려야 함**

- [supabase/migrations/20260601500000_update_my_profile_cv.sql](../supabase/migrations/20260601500000_update_my_profile_cv.sql) — 신규 RPC `public.update_my_profile_cv(p_education, p_exhibitions, p_awards, p_residencies jsonb)`. 4 컬럼 동시 upsert + auth.uid() RLS 가드. omitted 컬럼은 untouched, `'[]'::jsonb` 는 명시적 clear. authenticated 에만 execute grant. Supabase SQL Editor 에서 실행 필요.

### 환경 변수 — 변경 없음

### 새 / 수정 파일

- [supabase/migrations/20260601500000_update_my_profile_cv.sql](../supabase/migrations/20260601500000_update_my_profile_cv.sql) — **신규**.
- [src/lib/supabase/profileCv.ts](../src/lib/supabase/profileCv.ts) — **신규**. `getMyProfileCv()` / `updateMyProfileCv(payload)` / `ProfileCvSlice` / `UpdateProfileCvPayload`. 잘못된 jsonb 형태는 `asArray()` 로 안전하게 빈 배열로 폴백.
- [src/lib/i18n/messages.ts](../src/lib/i18n/messages.ts) — `studio.materials.*` (10 키) + `cv.editor.*` (필드 라벨 12 + 액션/상태 9 키) KO/EN 추가.
- [src/components/studio/StudioMaterialsPanel.tsx](../src/components/studio/StudioMaterialsPanel.tsx) — **신규**. `/my` 안에서 Statement / CV 두 카드 (filled vs dashed empty 분기, 각각 진입 CTA → `/settings#statement` / `/my/profile/cv`).
- [src/components/studio/index.ts](../src/components/studio/index.ts) — `StudioMaterialsPanel` re-export.
- [src/app/my/page.tsx](../src/app/my/page.tsx) — `StudioOperationGrid` 다음, `FloorPanel` (portfolio helper) 앞에 `<StudioMaterialsPanel>` 끼워 넣음. `isArtistRole` 가드. profile 의 `artist_statement` 길이와 4 jsonb 길이 합으로 카드 상태 결정.
- [src/app/my/profile/cv/page.tsx](../src/app/my/profile/cv/page.tsx) — **신규**. AuthGate + PageShell.narrow + PageHeader (제목 + lead) + 상단 작은 "스튜디오로" back 링크. 페이지 자체는 얇은 shell 이고 모든 상태/RPC 는 클라이언트로 위임.
- [src/app/my/profile/cv/CvEditorClient.tsx](../src/app/my/profile/cv/CvEditorClient.tsx) — **신규**. 4 카테고리 (학력 / 전시 / 수상 / 레지던시) inline CRUD editor:
  - 로딩 시 baseline 캐시 → dirty diff 로 save 버튼 활성화.
  - 각 항목은 카드 (`rounded-2xl border bg-white p-3`) 안에 정규화 필드 inputs (school/program/year/type, title/venue/city/year, name/organization/year, name/location/year_from/year_to). 추가 / 제거 / 인라인 수정.
  - sticky bottom save bar — `cv.editor.unsaved` / `saving` / `saved` / `error` 상태 표시 + Discard / Save.
  - sanitize() — fully-empty 항목은 저장 시 자동 drop. 정규화되지 않은 키 (P6.2 import 가 추가하는) 는 그대로 보존.
  - 상단에 *조용한 import 콜아웃* (`cv.editor.importHint` — "곧 추가됩니다") — P6.2 의 wizard 가 들어갈 자리 표식.

### Verified

- `npx tsc --noEmit` → 0 error
- `npm run build` → success (`/my/profile/cv` static prerender 확인)
- Lint — 변경 파일 모두 clean.

### 다음 사이클 (P6.2)

- 신규 라우트 `POST /api/ai/cv-import` (handleAiRoute SSOT 위에 얹음). body: `{ url? | file? }`. 서버 처리: URL → fetch + readability/cheerio / PDF → pdf-parse / DOCX → mammoth / 이미지·스캔 PDF → vision LLM. 출력: 4 카테고리 분류된 정규화 entry 배열.
- CvEditorClient 의 import hint 자리에 wizard panel — Step 1 (URL/파일 입력) → Step 2 (loading + 진행 안내) → Step 3 (Preview, 카테고리 toggle, 인라인 수정, 추가 vs 대체 모드 선택) → Step 4 (저장 후 editor 메인으로).

## 2026-05-02 — Salon System v2 P5: 공개 프로필 Surface Cards (Statement / CV 모달)

사용자 피드백 — 공개 프로필 메인 페이지에서 *짧은 소개 아래 박혀 있던* `ArtistStatementSection` 풀 카드가 statement 가 길거나 hero image 가 있을 때 작품 탭을 첫 화면 아래로 밀어냄. UI/UX 와 미감 모두 저하. 옵션 4 개를 mockup 과 함께 제시 → 사용자가 **A (모달) + 단순 버튼 두 개 (Artist Statement / CV)** 채택.

### 디자인 결정

- 큰 풀 카드 (썸네일 + 미리보기 + read-more) 대신 **두 개의 컴팩트 trigger 버튼** 만 노출:
  - `Artist statement / 작가의 말`
  - `CV / 이력 (CV)`
- 두 버튼은 `grid grid-cols-1 sm:grid-cols-2 gap-2` 로 모바일은 stack, sm+ 에선 2 컬. 각각 `rounded-2xl` border + 아이콘 (zinc-900 round badge) + 라벨 + hint + chevron. 살짝 invitation 있는 결, 평이한 outline pill 보다 *한 단계 진하게*.
- 클릭 시 in-page 모달 (centered overlay, `rounded-3xl bg-white shadow-xl max-w-2xl`). ESC / 백드롭 클릭으로 닫힘. focus 는 close 버튼으로 이동, 닫힐 때 trigger 로 복귀. body scroll lock.
- 작품 그리드는 *밀려나지 않음* — 어떤 길이의 statement 도, CV 가 몇 개여도 트리거 자체는 두 줄짜리 행 하나로 고정.

### 페르소나 / Empty 상태

- Statement / CV 둘 다 **artist 페르소나 only** (curator / collector / gallerist 는 행 자체 미노출). 기존 `isArtistRole` 가드를 그대로 부모에서 적용.
- 방문자 + 양쪽 비어있음 → 행 자체 렌더 안 함.
- 방문자 + 한쪽만 채워짐 → 채워진 버튼만 노출.
- 오너 + 비어있음 → 점선 border 의 빈 상태 버튼 ("작가의 말 쓰기" / "이력 작성하기"), 모달 안에 prompt + `/settings#statement` 또는 `/settings#cv` CTA.

### CV 데이터 모델

- 기존 `profiles.education / exhibitions / awards / residencies` jsonb 컬럼 (이미 존재) 을 *그대로* 재사용. **신규 컬럼 없음**.
- 공개 RPC `lookup_profile_by_username(p_username)` 를 마이그레이션으로 확장 — 위 4 개 jsonb 를 응답에 포함. `profiles.exhibitions` 는 클라이언트의 *전시 탭 데이터 (구조화된 exhibitions 테이블 결과)* 와 충돌하지 않도록 RPC 응답에선 `exhibitions_cv` 키로 노출.
- CV 항목 렌더링은 loose schema 대응 — `formatEntry()` 가 (school/program/year, title/venue/city, name/organization, name/location 등) 흔한 키를 시도하고 fallback. 알 수 없는 키만 있는 항목은 row 가 비어 보이지 않도록 자동 skip.

### Supabase SQL — **돌려야 함**

- [supabase/migrations/20260601400000_lookup_profile_cv.sql](../supabase/migrations/20260601400000_lookup_profile_cv.sql) — `lookup_profile_by_username` RPC 재생성 (이전 버전과 동일 동작 보존, 응답에 education / exhibitions_cv / awards / residencies 4 키 추가). Supabase SQL Editor 에서 실행 필요.

### 환경 변수 — 변경 없음

### 수정 파일

- [src/lib/supabase/profiles.ts](../src/lib/supabase/profiles.ts) — `ProfilePublic` 타입에 `education / exhibitions_cv / awards / residencies` 추가. `CvEntry` 타입 export. parser 에 `cvArrayOrNull()` 헬퍼 추가.
- [src/lib/i18n/messages.ts](../src/lib/i18n/messages.ts) — `profile.surface.*` (버튼 라벨/힌트), `profile.cv.*` (모달 섹션 라벨, owner empty prompt) KO/EN 키 추가.
- [src/components/profile/ProfileSurfaceCards.tsx](../src/components/profile/ProfileSurfaceCards.tsx) — **신규**. 트리거 버튼 2 개 + Statement 모달 + CV 모달 + `formatEntry()` 정규화 헬퍼 + `SurfaceModal` (ESC / backdrop / focus / scroll lock).
- [src/components/UserProfileContent.tsx](../src/components/UserProfileContent.tsx) — `ArtistStatementSection` import → `ProfileSurfaceCards` 로 교체. profile prop 에서 CV jsonb 4 개 전달.
- [src/components/profile/ArtistStatementSection.tsx](../src/components/profile/ArtistStatementSection.tsx) — **삭제**. `ProfileSurfaceCards` 가 모든 책임을 흡수.

### Verified

- `npx tsc --noEmit` → 0 error
- `npm run build` → success (모든 라우트 정상)
- Lint — 변경 파일에 신규 에러 없음 (UserProfileContent.tsx 의 unused import 2 개는 P5 이전부터 존재).

## 2026-05-01 — Salon System v2 P4.1: 업로드 헤더 순서 정렬 (페이지 정체성 단일화)

P4 직후 사용자 피드백 — *Upload 만 LaneChips 가 H1 위에 있어 다른 메인 페이지와 시각 순서가 도치되어 있다*. 코드 audit 결과 더 깊은 구조적 어긋남 발견:

- Feed: H1 ("오늘의 살롱") → lead → LaneChips ("추천 / 팔로잉")
- People: H1 ("사람") → lead → search → LaneChips
- Upload (P4 시점): **LaneChips ("개별 / 일괄 / 전시") → 각 서브페이지의 자체 H1 ("업로드", "일괄 업로드", "전시 게시물 만들기")**

페이지 정체성이 *서브페이지마다 다른 H1 으로 분산* 되어 있어, 사용자가 같은 surface 안에서 H1 이 매번 바뀌는 인상을 받음. 다른 메인 페이지가 *하나의 정체성 + 그 안의 LaneChips 모드 토글* 인 것과 정반대.

### 사용자 합의

- 페이지 정체성 = "업로드" 하나. LaneChips (개별 / 일괄 / 전시 게시물 만들기) 는 그 안의 *세 모드*.
- 각 서브페이지의 자체 H1 제거 — 모드 식별은 LaneChips 가 함.
- 다른 메인 페이지와 동일한 순서: PageHeader → LaneChips → body.

### Supabase SQL — **돌려야 할 것 없음**
### 환경 변수 — 변경 없음

### 수정 파일

- [src/app/upload/layout.tsx](../src/app/upload/layout.tsx) — `topAccessory` 슬롯 제거. 단일 `<PageHeader variant="plain" title={t("upload.title")} lead={t("upload.layoutLead")} actions={<TourHelpButton />} density="tight" />` 위에 `<LaneChips className="mb-8">` 가 *아래* 에 옴. Feed / People 와 동일한 순서.
- [src/app/upload/page.tsx](../src/app/upload/page.tsx) — 자체 `<PageHeader title={t("upload.title")} />` 제거. PageHeader import 도 정리. body 는 이제 step="intent" 일 때 prompt "어떤 작품을 올리시나요?" 로 바로 시작 (lane chip 이 모드 식별).
- [src/app/upload/bulk/page.tsx](../src/app/upload/bulk/page.tsx) — 자체 `<PageHeader title={t("bulk.title")} />` 제거. PageHeader import 도 정리. `addToExhibitionId` 가 있을 때만 노출되던 `← 전시 작품 추가로` 링크는 *본문 상단의 작은 컨텍스트 배너* (`rounded-2xl border bg-zinc-50/70`) 로 강등 — "기존 전시에 작품을 추가 중이에요." 안내 + 링크.
- [src/components/exhibitions/NewExhibitionFormShell.tsx](../src/components/exhibitions/NewExhibitionFormShell.tsx) — 신규 prop `showHeader?: boolean` (기본 true). false 일 때 내부 PageHeader / TourTrigger / TourHelpButton 을 모두 드롭하고 `createSubtitle` 를 작은 lead 문단으로만 렌더 → 부모 surface (Upload 레이아웃) 가 H1 을 소유하므로 한 surface 한 H1 정책 유지.
- [src/app/upload/exhibition/page.tsx](../src/app/upload/exhibition/page.tsx) — `<NewExhibitionFormShell showHeader={false} showCancelLink={false} />`. fallback 도 헤더 스켈레톤 제거 (이미 layout 이 제공).
- [src/lib/i18n/messages.ts](../src/lib/i18n/messages.ts) — 신규 키 `upload.layoutLead` (KO: "한 점씩 올리거나, 일괄로 등록하거나, 전시 게시물을 만들어 공유합니다." / EN: "Add a single work, bulk import a series, or build an exhibition page."), `exhibition.addingWorksContext` (bulk 컨텍스트 배너용).

### 효과

- 5 메인 페이지 모두 동일 시각 순서: PageHeader (H1 + lead + actions) → 1 차 navigation/필터 → body.
- 업로드 surface 안에서 H1 이 더 이상 서브페이지마다 바뀌지 않음 — 정체성은 "업로드" 하나.
- 전시 탭 진입 시에도 H1 "업로드" + LaneChips ("전시 게시물 만들기" 활성) → form lead → form. 한 surface, 한 H1.

### Verified

- `npx tsc --noEmit` ✅
- `npm run build` ✅
- `npm run test:feed-living-salon` ✅
- `npm run test:people-reason` ✅

---

## 2026-05-01 — Salon System v2 P4: 업로드 탭 마감 (폭 축 통일 + 전시 탭 인라인 + 역할 버튼 톤)

P0~P3 사이클로 메인 5 페이지가 자리잡은 뒤, 업로드 탭의 *서브 페이지 사이* UX/디자인 통일감이 여전히 떨어진다는 사용자 피드백. 스크린샷 audit 으로 잡힌 어긋남:

- **폭 축 이중화** — 업로드 레이아웃은 `PageShell.studio` (max-w-5xl) 인데 `/upload`, `/upload/bulk` 의 본문은 다시 `<div className="mx-auto max-w-xl">` 로 감쌈 → 탭은 max-w-5xl 좌측에, h1·폼은 max-w-xl 가운데. *같은 surface 안에 두 개의 폭 축* 이 공존해 시선이 미끄러짐. 플랜 4.3 의 `<PageShell variant="narrow">` 약속과도 어긋나 있었음.
- **bulk 후퇴 링크 중복** — h1 우측에 `← 개별 업로드` 인라인 링크. 같은 일을 하는 LaneChips 가 바로 위에 있어 *어포던스 이중*.
- **역할 버튼 톤 어긋남** — 4 개의 역할 카드가 `rounded-lg` + `border border-zinc-200` + 좌측 정렬 텍스트만. 살롱 톤 (`rounded-2xl` / `rounded-full`) 결과 미세 어긋남, 어포던스 힌트 (chevron) 부재.
- **전시 탭 = 다른 페이지로 점프** — `/upload/exhibition` 이 `/my/exhibitions/new?from=upload` 로 redirect → 클릭 즉시 업로드 탭 strip 이 사라지는 가장 큰 시각 점프. 사용자가 "업로드 탭의 서브페이지들 구성" 으로 인지하는 전체 그림이 깨짐.

### 사용자 합의

- 폭 축은 *narrow (max-w-2xl)* 로 단일화 — 업로드는 *집중적인 폼 surface* 이지 dashboard 가 아님.
- 전시 탭은 redirect 대신 *인라인 렌더* — 업로드 탭 strip 이 유지되어야 함.
- 역할 카드는 `rounded-2xl` + chevron + `bg-zinc-50/70` hover 로 살롱 톤 정렬.

### Supabase SQL — **돌려야 할 것 없음**
### 환경 변수 — 변경 없음

### 수정 파일

- [src/app/upload/layout.tsx](../src/app/upload/layout.tsx) — `PageShell.studio` → `PageShell.narrow` (max-w-2xl). 플랜 4.3 약속 정정. 탭 / H1 / 본문 축 통일.
- [src/app/upload/page.tsx](../src/app/upload/page.tsx) — `<div className="mx-auto max-w-xl">` 래퍼 제거 (PageShell 이 폭 결정). 역할 버튼 4 개를 `group flex w-full items-center justify-between gap-4 rounded-2xl border ... px-5 py-4 ... hover:bg-zinc-50/70` + chevron `→` 로 정렬. attribution / form / dedup 단계의 Back 버튼을 `rounded` → `rounded-full border ... text-zinc-700 hover:bg-zinc-50` 로 통일.
- [src/app/upload/bulk/page.tsx](../src/app/upload/bulk/page.tsx) — `max-w-xl` 래퍼 제거. h1 / `← 개별 업로드` 링크 행 → `<PageHeader variant="plain" title={t("bulk.title")} actions={...}>` 으로 교체 (전시 add 컨텍스트일 때만 actions 슬롯에 한 개 링크). 역할 버튼 4 개 동일 톤 정렬. CTA `rounded` → `rounded-full` (`startUpload`, `applyTitleBulk`, `deleteSelected`, `deleteAll`, `publishSelected`). Dropzone `rounded-lg bg-zinc-50` → `rounded-2xl bg-zinc-50/70`. 사용하지 않게 된 `backToLabel` 임포트 / `locale` 디스트럭처 제거.
- [src/components/exhibitions/NewExhibitionFormShell.tsx](../src/components/exhibitions/NewExhibitionFormShell.tsx) — **신규**. `/my/exhibitions/new` 의 폼 본문 (TourTrigger + PageHeader + boardContext banner + ActingAsChip + form) 을 통째로 재사용 가능한 클라이언트 컴포넌트로 추출. props: `showCancelLink?`, `cancelHref?`. 두 입구 (Upload tab / Studio Exhibitions) 가 같은 폼을 다른 shell 에서 렌더할 수 있게 함. 보드 컨텍스트 banner 도 `rounded-2xl bg-zinc-50/70` 로 톤 정렬.
- [src/app/upload/exhibition/page.tsx](../src/app/upload/exhibition/page.tsx) — redirect 제거. `<NewExhibitionFormShell showCancelLink={false} />` 인라인 렌더. 업로드 탭 strip 유지. Suspense fallback 은 PageShell 가 이미 layout 이 제공하므로 단순 in-place skeleton.
- [src/app/my/exhibitions/new/page.tsx](../src/app/my/exhibitions/new/page.tsx) — 522 줄 페이지를 50 줄로 슬림화. `<main className="mx-auto max-w-2xl px-4 py-8">` → `<PageShell variant="narrow">`. 본문은 `<NewExhibitionFormShell />` 위임. `from=upload` 일 때 back link "Back to Upload" / cancel 숨김. Suspense + `<PageShellSkeleton variant="narrow" />` fallback.

### 효과 (스크린샷 audit 기준)

- 업로드 탭 strip / h1 / 폼이 단 하나의 max-w-2xl 축 위에 정렬 (`/upload`, `/upload/bulk` 모두).
- 역할 카드 4 개가 `rounded-2xl` + chevron 으로 살롱 카드 vocabulary 와 정렬.
- 전시 탭 클릭 시 업로드 탭 strip 이 사라지지 않음 — *3 개 입구가 진짜 한 페이지 set 처럼 작동*.
- `/my/exhibitions/new` 진입로도 동일 톤 (PageShell.narrow + PageHeader.plain).

### Verified

- `npx tsc --noEmit` ✅
- `npm run build` ✅
- `npm run test:feed-living-salon` ✅
- `npm run test:people-reason` ✅

---

## 2026-05-01 — Salon System v2 P3: 카피·문서 정리 (kicker 정책 마무리 + DS 가이드 신설)

P0 → P3 4 사이클 디자인 통일 작업의 마지막 사이클. 시각적 변화 거의 없음 — kicker 어휘 잔재 / Bulk 영문 literal 청소 / DS 결정 가이드 문서화.

### 사용자 합의

- People 페이지 헤더의 "탐색 (DISCOVER)" kicker 가 노이즈로 느껴진다는 사용자 지적이 시발점이었기에, P1 에서 People 헤더를 `PageHeader.plain` 으로 강등한 것을 P3 에서 `messages.ts` 키 정리로 마감 (`people.kicker` → `people.lead`).
- DS primitive 가 자리잡았으니 *언제 무엇을 쓰는가* 에 대한 짧은 결정 가이드를 별도 문서로 분리. 신규 컨트리뷰터가 헤더 / 패널 / lane 을 인라인으로 다시 짤 동기를 줄이는 것이 목적.

### Supabase SQL — **돌려야 할 것 없음**
### 환경 변수 — 변경 없음

### 수정 / 신규 파일

- [src/app/upload/bulk/page.tsx](../src/app/upload/bulk/page.tsx) — Bulk 표 헤더의 마지막 영문 literal `Title` → `t("bulk.tableTitle")`. `messages.ts` 에 KO/EN 키 추가는 P1 에서 완료된 분 외 잔재 0.
- [docs/04_DESIGN_SYSTEM.md](04_DESIGN_SYSTEM.md) — 신규. PageShell · PageHeader · SectionLabel · FloorPanel · LaneChips · FilterChip · Chip · EmptyState · PageShellSkeleton 의 *언제 무엇을 쓰는가* 결정 가이드. 한 페이지 분량.

### 4 사이클 통합 요약

| 사이클 | 핵심 |
| ------ | ---- |
| P0 | DS primitive 8 개 신규 + Chip xs / EmptyState rounded-full variant 추가. 페이지 무영향. |
| P1 | 5 메인 페이지 (Feed · People · Upload · My Studio · 공개 프로필) + Header 마이그레이션. kicker 정책 (page or strip) 적용. 영문 literal i18n 큰 줄기. |
| P2 | floor-tint `/70` 단일화. 스켈레톤 (`FeedGridSkeleton` · `ListCardSkeleton`) 통합. delegations 로컬 EmptyState 이중 구현 제거. FeedArtworkCard 역할 pill → Chip xs. |
| P3 | kicker 어휘 잔재 정리. Bulk 영문 literal 끝까지 청소. DS 결정 가이드 (`docs/04_DESIGN_SYSTEM.md`) 신설. |

### Verified

- `npx tsc --noEmit` ✅ clean
- `npm run build` ✅
- `npm run lint` ✅
- `npm run test:feed-living-salon` ✅
- `npm run test:people-reason` ✅

---

## 2026-05-01 — Salon System v2 P2: 톤 정렬 (floor-tint 통일 + 스켈레톤 흡수 + EmptyState 이중 구현 정리)

P1 마이그레이션 후 *코드 곳곳에 흩어진 톤 어긋남* 을 한꺼번에 정리. P2 는 surface-level 정렬이라 페이지별 변경이 적지만 *시각 일관성* 을 마무리짓는 단계.

### 사용자 합의

- floor-tint 단일 불투명도 = `/70`. 이전 `/50` `/60` 변형 모두 흡수
- in-tab 스켈레톤은 DS 가 소유하는 두 primitive (`FeedGridSkeleton` · `ListCardSkeleton`) 로 통합. 이는 `PageShellSkeleton` 이 내부적으로 재사용

### Supabase SQL — **돌려야 할 것 없음**
### 환경 변수 — 변경 없음

### 수정 파일

- floor-tint `/50` `/60` → `/70` 일괄 정렬:
  - DS 자체: [src/components/ds/SectionFrame.tsx](../src/components/ds/SectionFrame.tsx) (muted/dashed), [src/components/ds/EmptyState.tsx](../src/components/ds/EmptyState.tsx)
  - 메인 페이지 잔재: [src/components/studio/StudioSignals.tsx](../src/components/studio/StudioSignals.tsx), [src/components/studio/StudioNextStepsRail.tsx](../src/components/studio/StudioNextStepsRail.tsx), [src/app/people/PeopleResultCard.tsx](../src/app/people/PeopleResultCard.tsx)
  - 인접 surface: [src/app/login/page.tsx](../src/app/login/page.tsx), [src/app/my/exhibitions/[id]/page.tsx](../src/app/my/exhibitions/[id]/page.tsx), [src/app/my/exhibitions/[id]/edit/page.tsx](../src/app/my/exhibitions/[id]/edit/page.tsx), [src/app/my/exhibitions/[id]/add/page.tsx](../src/app/my/exhibitions/[id]/add/page.tsx), [src/app/my/exhibitions/new/page.tsx](../src/app/my/exhibitions/new/page.tsx), [src/app/my/delegations/page.tsx](../src/app/my/delegations/page.tsx), [src/app/my/messages/page.tsx](../src/app/my/messages/page.tsx), [src/app/my/messages/[peer]/page.tsx](../src/app/my/messages/[peer]/page.tsx), [src/app/my/shortlists/page.tsx](../src/app/my/shortlists/page.tsx), [src/app/my/shortlists/[id]/page.tsx](../src/app/my/shortlists/[id]/page.tsx), [src/app/artwork/[id]/page.tsx](../src/app/artwork/[id]/page.tsx), [src/app/artwork/[id]/edit/page.tsx](../src/app/artwork/[id]/edit/page.tsx), [src/components/delegation/CreateDelegationWizard.tsx](../src/components/delegation/CreateDelegationWizard.tsx), [src/components/ai/IntroMessageAssist.tsx](../src/components/ai/IntroMessageAssist.tsx), [src/components/upload/WebsiteImportPanel.tsx](../src/components/upload/WebsiteImportPanel.tsx)
- [src/components/FeedArtworkCard.tsx](../src/components/FeedArtworkCard.tsx) — artist 역할 inline pill (`text-[10px] border border-zinc-200`) → `<Chip tone="muted" size="xs">`. People / 공개 프로필 / Studio Hero 와 동일한 chip vocabulary 로 정렬.
- [src/components/ds/PageShellSkeleton.tsx](../src/components/ds/PageShellSkeleton.tsx) — `FeedGridSkeleton` · `ListCardSkeleton` 두 primitive 추가 export. Suspense 폴백 (PageShellSkeleton) 도 이 둘을 내부에서 재사용하도록 리팩터.
- [src/components/ds/index.ts](../src/components/ds/index.ts) — 두 신규 export.
- [src/components/FeedContent.tsx](../src/components/FeedContent.tsx) — 인라인 `SalonSkeleton` 함수 제거, `<FeedGridSkeleton/>` 사용.
- [src/app/people/PeopleClient.tsx](../src/app/people/PeopleClient.tsx) — 인라인 `PeopleListSkeleton` 함수 제거, `<ListCardSkeleton rows={4}/>` 사용.
- [src/app/my/delegations/page.tsx](../src/app/my/delegations/page.tsx) — 로컬 `EmptyState` (DS 와 이름 충돌) → `DelegationsEmptyPanel` 로 rename. CTA `rounded-lg` → `rounded-full`. 두 explainer 카드 구조는 보존 (DS EmptyState 가 표현 못 함).

### Verified

- `npx tsc --noEmit` ✅ clean
- `npm run build` ✅
- `npm run test:feed-living-salon` ✅
- `npm run test:people-reason` ✅

---

## 2026-05-01 — Salon System v2 P1: 메인 5 페이지 디자인 통일 (DS primitive 도입 + 페이지 마이그레이션)

플랫폼 5 메인 페이지 (Feed · People · Upload · My Studio · 공개 프로필) 의 디자인 어휘가 페이지마다 약간씩 어긋나 *같은 앱이라는 인상* 을 약화시키던 문제를 수리. 사용자가 People 의 "탐색 (DISCOVER)" kicker 를 노이즈로 느낀 것이 시발점이었지만, 코드 audit 에서 더 큰 구조적 어긋남이 드러남:

- 페이지 폭 5 가지 (1200px / 3xl / 5xl / 2xl / 4xl 폴백)
- 수평 패딩 2 가지 (px-4 / px-6)
- H1 크기 3 가지 (xl / 2xl / lg-as-h2)
- kicker 어휘가 5 곳에서 무차별 사용 — 같은 surface 안 *이중 kicker* 까지
- 버튼 라운드 `rounded` / `rounded-lg` / `rounded-full` 혼재
- 세그먼트/탭 4 가지 변형
- floor-tint 불투명도 4 단계 (50/60/70)
- 영문 literal leak (Loading feed... / An error occurred / Apply size / Imported … draft(s) / aria-label "Menu" / 호수 UI 한글 하드코드 등)

P0 + P1 으로 *primitive 추가 후 5 메인 페이지 마이그레이션*. 톤 정렬 / 스켈레톤 통합 / kicker 카피 정리는 P2/P3 에 이어짐.

### 사용자 합의

- *SSOT primitive 우선* — 공통 컴포넌트를 먼저 만들고 페이지를 그 위로 이전 (사용자 선택)
- *kicker 정책 = page or strip, 둘 중 하나* — 같은 surface 안 이중 사용 금지. People 페이지 헤더는 kicker 유지, 트렌딩 lane / role filter 라벨 / invite 페이지는 SectionLabel 또는 plain 톤으로 강등 (사용자 선택)

### Supabase SQL — **돌려야 할 것 없음**

이번 패치는 시각/카피/구조 변경. 새 마이그레이션 없음.

### 환경 변수 — 변경 없음

### 신규 DS primitive (P0)

`src/components/ds/` 아래에 8 개 신규 / 1 개 변형:

- [src/components/ds/PageShell.tsx](../src/components/ds/PageShell.tsx) — 페이지 폭 / 수평 패딩 / 세로 리듬 SSOT. variants `feed` (1200px) · `default` (3xl) · `narrow` (2xl) · `studio` (5xl) · `library` (6xl). 수평 패딩 `px-4 sm:px-6`. 세로 `py-8 sm:py-10 lg:py-14`. 옵션 `topAccessory` 슬롯 (TourHelpButton 행). `as="div"` 로 main 중첩 회피 가능. `PAGE_SHELL_TOKENS` export 로 secondary 스켈레톤도 같은 폭을 따름.
- [src/components/ds/PageHeader.tsx](../src/components/ds/PageHeader.tsx) — 페이지 헤더 SSOT. `editorial` (kicker + h1 + lead) · `plain` (h1 + lead). `actions` 슬롯 (TourHelpButton). h1 `text-2xl font-semibold tracking-tight` 로 모든 페이지에서 동일.
- [src/components/ds/SectionLabel.tsx](../src/components/ds/SectionLabel.tsx) — 페이지 안 "조용한 라벨". `text-[11px] font-medium uppercase tracking-wide text-zinc-500`, **2px accent 없음**. kicker 격을 보호하기 위한 한 단계 낮은 톤. 트렌딩 lane / role filter / 카루셀 하위 헤더가 사용.
- [src/components/ds/FloorPanel.tsx](../src/components/ds/FloorPanel.tsx) — `rounded-2xl bg-zinc-50/70` 단일 불투명도. padding `sm` / `md` / `lg`. `as="section" | "div" | "aside"`. `bg-zinc-50/50` `bg-zinc-50/60` 흩어짐을 P2 에서 흡수.
- [src/components/ds/LaneChips.tsx](../src/components/ds/LaneChips.tsx) — lane / 세그먼트 SSOT. `rounded-full` pill + `aria-pressed`. variants `lane` · `sort`. 옵션이 `href` 를 가지면 `<Link>` + `aria-current="page"` 로 렌더 (Upload 탭이 사용). 옵션이 button 이면 `onChange(id)`.
- [src/components/ds/FilterChip.tsx](../src/components/ds/FilterChip.tsx) — multi-select toggle 칩. `rounded-full px-3 py-1 text-sm` + `aria-pressed`. People 의 role filter 가 사용.
- [src/components/ds/PageShellSkeleton.tsx](../src/components/ds/PageShellSkeleton.tsx) — Suspense fallback / 첫 로드용 텍스트리스 스켈레톤. variant 별 (feed / default / narrow / studio / library) bodies. `PAGE_SHELL_TOKENS` 와 같은 폭을 따라가서 swap 이 시각적으로 invisible.
- [src/components/ds/Chip.tsx](../src/components/ds/Chip.tsx) — `size="xs" | "sm"` variant 추가 (xs = `text-[10px] px-1.5 py-0.5`). FeedArtworkCard 의 인라인 역할 pill 흡수는 P2.
- [src/components/ds/EmptyState.tsx](../src/components/ds/EmptyState.tsx) — CTA 라운드 `rounded-lg` → `rounded-full` 정렬.

### 페이지 마이그레이션 (P1)

#### Feed
- [src/app/feed/FeedClient.tsx](../src/app/feed/FeedClient.tsx) — `<main mx-auto max-w-[1200px] ...>` → `<PageShell variant="feed">`
- [src/components/feed/FeedHeader.tsx](../src/components/feed/FeedHeader.tsx) — h1+lead 부분을 `<PageHeader variant="plain" density="tight">` 으로 교체. h1 `text-xl` → `text-2xl tracking-tight` (모든 페이지 일관). 컨트롤 행은 그대로 아래에 mb-10 으로.
- [src/app/feed/page.tsx](../src/app/feed/page.tsx) — Suspense `"Loading feed..."` 영문 literal → `<PageShellSkeleton variant="feed" />`

#### People
- [src/app/people/PeopleClient.tsx](../src/app/people/PeopleClient.tsx) — `<main mx-auto max-w-3xl px-6 ...>` → `<PageShell variant="default">`. 헤더 → `<PageHeader variant="editorial" kicker={t("people.kicker")} title={...} actions={<TourHelpButton/>}>`. **트렌딩 lane 의 두 번째 kicker (이중 사용) → `<SectionLabel>`** 강등. role filter 라벨 (이전 `tracking-[0.18em]`) → `<SectionLabel>`. lane 버튼 그룹 → `<LaneChips variant="lane">`. role filter 버튼 → `<FilterChip>`. floor-tint 패널들 (`rounded-2xl bg-zinc-50/70`) → `<FloorPanel padding="sm|lg">`.
- [src/app/people/page.tsx](../src/app/people/page.tsx) — 인라인 `PeopleShellSkeleton` (max-w-3xl px-6 py-10) → `<PageShellSkeleton variant="default" />`
- [src/app/people/invite/page.tsx](../src/app/people/invite/page.tsx) — kicker 제거 (페이지 정체성이 redundant), `<PageHeader variant="plain">` 로 교체. 인라인 `PeopleInviteSkeleton` → `<PageShellSkeleton variant="narrow">`. `<main mx-auto max-w-md>` → `<PageShell variant="narrow">`

#### Upload
- [src/app/upload/layout.tsx](../src/app/upload/layout.tsx) — `<div mx-auto max-w-2xl>` 에 세그먼트형 `rounded-lg` 탭 → `<PageShell variant="studio" topAccessory={<TourHelpButton/>}>` + `<LaneChips variant="lane">`. layout 폭은 자식 중 가장 넓은 페이지 (bulk) 에 맞춰 5xl.
- [src/app/upload/page.tsx](../src/app/upload/page.tsx) — `<main mx-auto max-w-xl>` → 안쪽 `<div mx-auto max-w-xl>` (좁은 폼 의도 유지). 페이지 헤더 `<h1 text-xl>` → `<PageHeader variant="plain">`. Suspense 폴백 `"Loading..."` → `<PageShellSkeleton variant="narrow">`. 호수 UI 한글 하드코드 ("호수로 입력", "30", "적용") → `t("size.hosuLabel")` `t("size.hosuPlaceholder")` `t("size.hosuApply")`. catch 영문 `"An error occurred"` → `t("common.unknownError")`. primary CTA `rounded` → `rounded-full` (Next 버튼, 마지막 submit 버튼).
- [src/app/upload/bulk/page.tsx](../src/app/upload/bulk/page.tsx) — `<main mx-auto max-w-5xl>` → `<div>` (외곽 PageShell.studio 가 폭 결정). h1 `text-xl` → `text-2xl tracking-tight`. 영문 literal 청소: `Back` `Next` (fallback `|| "Next"` 제거) `Clear` `Apply size` `Apply price` `Link to exhibition` `Unlink from exhibition` `— exhibition —` `title,year,medium` `Cancel` `Imported … draft(s)` 모두 i18n key 로 교체. attribution / clear / csv import / link/unlink / confirm 모달 버튼 라운드 `rounded` → `rounded-full`.
- [src/app/upload/exhibition/page.tsx](../src/app/upload/exhibition/page.tsx) — `"Redirecting..."` → `t("common.redirecting")`

#### My Studio
- [src/app/my/page.tsx](../src/app/my/page.tsx) — `<main mx-auto max-w-5xl>` → `<PageShell variant="studio" topAccessory={<TourHelpButton/>}>`. **페이지 H1 부재 문제 해결** — `<PageHeader variant="plain" title={t("studio.title")} lead={t("studio.lead")}/>` 도입. 포트폴리오 헬퍼 패널 `rounded-xl border bg-zinc-50/60` → `<FloorPanel padding="sm">`. `showOwnerHeader` boolean 으로 acting-as 여부 한 번만 평가.
- [src/components/studio/StudioHero.tsx](../src/components/studio/StudioHero.tsx) — public/private 배지 inline `<span rounded-full ...>` → `<Chip tone="success|neutral">`. role 칩 inline `<span>` → `<Chip tone="accent|neutral">`. People / 공개 프로필과 정렬.

#### 공개 프로필
- [src/components/UserProfileContent.tsx](../src/components/UserProfileContent.tsx) — `<main mx-auto max-w-2xl>` → `<PageShell variant="default">` (max-w-2xl → 3xl). h1 `text-xl` → `text-2xl tracking-tight`. 포트폴리오 탭 strip `rounded` 직사각형 → `<LaneChips variant="lane">` (옵션 id = `row.key`, 클릭 시 persona/custom 분기). reorder / save / cancel / exhibition reorder 모든 버튼 `rounded`/`rounded-lg` → `rounded-full px-4`.
- [src/app/u/[username]/PrivateProfileShell.tsx](../src/app/u/[username]/PrivateProfileShell.tsx) — checking `<main>` → `<PageShellSkeleton variant="default">`. fallback `<main>` → `<PageShell variant="default">`. visitor card `<main mx-auto max-w-xl>` → `<PageShell variant="narrow">`. owner banner `rounded` → `rounded-2xl`, settings CTA `rounded` → `rounded-full`. 카드 `rounded-lg` → `rounded-2xl`.

#### Header
- [src/components/Header.tsx](../src/components/Header.tsx) — 모바일 햄버거 `aria-label="Menu"` → `aria-label={t("nav.menu")}`. KO 폴백 추가 (`messages.ts`).

#### DS index
- [src/components/ds/index.ts](../src/components/ds/index.ts) — 신규 primitive 들 모두 re-export.

#### i18n
- [src/lib/i18n/messages.ts](../src/lib/i18n/messages.ts) — `nav.menu`, `common.unknownError`, `common.redirecting`, `size.hosuLabel`, `size.hosuApply`, `size.hosuPlaceholder`, `bulk.clear`, `bulk.applySize`, `bulk.applyPrice`, `bulk.linkToExhibition`, `bulk.unlinkFromExhibition`, `bulk.exhibitionSelectorPlaceholder`, `bulk.csvPlaceholder`, `bulk.csvImported`, `bulk.confirmCancel`, `bulk.confirmContinue`, `studio.title`, `studio.lead` 키 추가 (KO/EN).

### Verified

- `npx tsc --noEmit` ✅ clean
- `npm run build` ✅ 모든 라우트 prerendered
- `npm run test:feed-living-salon` ✅
- `npm run test:people-reason` ✅
- ESLint pre-existing 경고/에러는 그대로 (Header `loadActiveAccountDelegations` hoisting, react-compiler memo 가드, 등 — 이번 패치와 무관)

### 남은 작업 (P2/P3)

- P2: 톤 정렬 — primary CTA 라운드 잔재 제거, `bg-zinc-50/60` → `/70` 통합, FeedArtworkCard 역할 pill → Chip xs, delegations 로컬 EmptyState → DS, Suspense fallback 전체 PageShellSkeleton 통일
- P3: kicker 어휘 검토 (people.kicker = "탐색" 의 "탐색" 자체가 noisy 한지 카피 라운드), bulk 영문 literal 잔재, docs/HANDOFF 통합 + `docs/04_DESIGN_SYSTEM.md` 신규 (짧은 결정 가이드)

---

## 2026-05-01 — 사람 탭 v1.3 (P3: Trending + Invite Salon Tone + Dead-Code Drop)

진단 리포트의 묶음 4 (P3 옵션) 마지막 마무리. 검색 빈 상태에 *생기를 주는* trending row, invite 페이지 살롱 톤, 그리고 dead RPC/i18n 정리.

### 사용자 합의

- 진단 리포트의 묶음 4: S4 trending · S6 invite copy · D dead-code drop. **S7 role chip hover** 는 RPC payload 에 `affiliation`/`program_focus` 같은 보조 컬럼을 추가해야 의미 있는 hover 정보가 생기는데, 묶음 1~3 에서 이미 RPC 가 세 번 재정의된 상태라 다섯 번째 재정의 비용이 가치를 넘어섬 — *후속 패치로 이관 (deferred)* 하고 데이터 모델이 더 풍부해질 때 다시 검토

### Supabase SQL — **돌려야 함**

> Supabase SQL Editor 에서 실행 필요한 마이그레이션 — `supabase/migrations/20260601300000_people_recs_quality_p3.sql`
>
> 선행 조건: P0 + P1 + P2 마이그레이션.

- **S4 — `get_trending_people(p_limit)` RPC 신설**: 최근 7일 내 *accepted* follows 를 가장 많이 받은 공개·presentable 프로필을 desc 정렬로 반환. dismissals 와 본인의 기존 follow 는 제외. payload 가 기존 lane RPC 와 envelope 호환 (`reason_tags=["trending"]`, `top_signal="trending"`, `signal_count=recent_followers`, `mutual_avatars=[]`, `is_recently_active`)
- **D dead-code drop**:
  - `drop function public.get_recommended_people(text[], int, text)` — `get_people_recs(p_mode='likes_based')` 로 대체된 지 오래된 dead RPC. 클라이언트 어디에서도 호출 안 함
  - `drop function public.search_people(text, text[], int, text, boolean)` — P1 에서 4-arg 가 본문 내부 fuzzy 처리하도록 흡수돼 5-arg 시그니처는 dead. `p0_search_fuzzy_pg_trgm.sql` 의 함수가 정리됨

### 환경 변수 — 변경 없음

### 수정 파일

- [supabase/migrations/20260601300000_people_recs_quality_p3.sql](../supabase/migrations/20260601300000_people_recs_quality_p3.sql) — 신규
- [src/app/people/PeopleClient.tsx](../src/app/people/PeopleClient.tsx):
  - 검색 input 의 onFocus / onBlur — `searchFocused` state. 검색 input 가 focus 됐고 검색어가 비어있으면 lane 영역 대신 *trending row* 노출. blur 시 180ms 후 hide (trending chip 클릭이 onBlur 보다 먼저 처리되도록)
  - `TrendingChip` — 가로 스크롤 가능한 작은 pill (avatar + 이름). lane 영역과 같은 floor-tint 패널 안에 8개. 1줄 헤더는 살롱 kicker 어휘
  - `getScoreBadge` 에 `trending` 분기 추가 — "이번 주 +N명" / "+N this week"
- [src/lib/supabase/peopleRecs.ts](../src/lib/supabase/peopleRecs.ts) — `getTrendingPeople(limit=8)` 클라 wrapper 추가
- [src/lib/supabase/artists.ts](../src/lib/supabase/artists.ts) — `getRecommendedPeople` 함수 + `GetRecommendedPeopleOptions` 타입 제거. 짧은 주석으로 SQL drop 마이그레이션 가리킴
- [src/lib/people/reason.ts](../src/lib/people/reason.ts) — `if (set.has("trending"))` 분기 — "이번 주 여러 사람이 팔로우했어요" / "Many followed this person this week"
- [src/app/people/invite/page.tsx](../src/app/people/invite/page.tsx) — 살롱 톤 어셈블 (S6):
  - 헤더: kicker + 2px accent + tracking-[0.22em] + h1
  - input: `rounded-xl border-zinc-200 bg-white px-4 py-3 text-[15px]` 살롱 input 어휘
  - 버튼: `rounded` → `rounded-full`. primary "초대 보내기" zinc-900, secondary "사람 검색으로" zinc-300 ring
  - Suspense fallback 영문 literal "Loading..." 제거 → `PeopleInviteSkeleton` (텍스트 없이 형태만)
- [src/lib/i18n/messages.ts](../src/lib/i18n/messages.ts) — 정리 + 추가:
  - dead 키 제거: `people.tabRecommended`, `people.tabSearch` (UI 미연결)
  - 신규: `people.trendingHeader` ("이번 주 주목할 사람" / "Trending this week"), `people.signal.trending` ("이번 주 +{count}명" / "+{count} this week"), `people.reason.trending`

### 변경 없음 (의도)

- **S7 deferred**: role chip 의 hover 보조 정보 (예: 갤러리스트의 운영 갤러리 이름) 는 RPC payload 가 `affiliation`/`program_focus` 같은 컬럼을 carry 해야 의미 있음. 현 RPC 는 P0~P2 동안 세 번 재정의돼서 *추가 재정의의 회귀 위험* 이 가치보다 큼. 다음 사이클에 데이터 모델 차원에서 정돈한 뒤 재검토. 진단 리포트의 다른 묶음 4 항목은 모두 이번에 처리
- 기존 lane (`follow_graph` / `likes_based` / `expand`) 의 RPC 본문은 P3 마이그레이션에서 손대지 않음 — trending 은 별도 RPC, dead-code drop 도 별도 RPC. lane RPC 는 P2 그대로
- trending 카드를 `PeopleResultCard` 가 아닌 작은 chip 으로 — 검색 빈 상태의 *빠른 진입* 어휘에 더 맞음. 카드 풀 높이를 한 줄에 8개 보여주는 건 정보 밀도 과잉

### 디자인 결정

- **S4 carrier 위치 — lane 위 vs lane 대체**: 처음엔 lane 영역 *위에* 두는 안을 검토. 그러나 사용자가 명시적으로 검색을 시작했을 때 (input focus) 만 의미 있는 어휘이고, 평상시 lane 과 같은 자리를 차지하는 게 시선 처리에 깔끔. blur 후 사라지므로 일상 사용에 방해 없음
- **trending pill vs full card**: 목적이 *빠른 출구* — 사용자가 누구를 검색할지 모를 때 한두 명을 빠르게 시도해 보는 영역. full card 는 정보 밀도가 다른 lane 의 영역과 충돌. 가로 스크롤 가능한 작은 pill 이 LinkedIn / Instagram 의 "팔로우 추천 캐러셀" 어휘와도 가까움
- **invite 페이지 — 단일 surface 살롱 톤화**: People 메인과 invite 페이지가 시각적으로 *다른 앱처럼* 느껴지면 "검색 → 초대" 흐름이 한 사고 단위로 안 묶임. 같은 kicker / input / 버튼 어휘로 통일하니 흐름이 이어짐
- **dead-code drop 순서 — drop function 만**: 마이그레이션 이력은 *그대로 둠* (revert 시 반대로 가야 함). drop 자체만 새 마이그레이션으로 — 이력 누적이 SSOT 인 패턴

### 검증

- `npx tsc --noEmit` — pass (`getRecommendedPeople` 제거 후 import 누락 없음 확인)
- `npm run test:feed-living-salon` — pass
- `npm run test:people-reason` — pass
- `npm run build` — pass

### 사람 탭 4-사이클 종합 (v1.0 → v1.3)

| 묶음 | 마이그레이션 | 핵심 |
|---|---|---|
| v1.0 (P0) | `20260601000000_people_recs_quality_p0.sql` | accepted-only 게이트 + presentable 게이트 + 살롱 톤 어셈블 + literal leak 정리 |
| v1.1 (P1) | `20260601100000_people_recs_quality_p1.sql` | expand 시그널 / likes_based 정합 / score envelope / mutual avatars / search fuzzy + 정렬 |
| v1.2 (P2) | `20260601200000_people_recs_quality_p2.sql` | last_active_at + dot · dismissals + kebab 메뉴 · follow undo 토스트 · loadMore retry · focus refresh · 키보드 네비 · 카드 a11y |
| v1.3 (P3) | `20260601300000_people_recs_quality_p3.sql` | trending RPC + 검색 빈 상태 row · invite 살롱 톤 · dead-code drop |

진단 리포트의 모든 항목 처리 완료 (S7 만 데이터 모델 정리 후 재검토로 명시 deferred).

---

## 2026-05-01 — 사람 탭 v1.2 (P2: Subtle Quality Layer — a11y, dismiss, undo, recently-active)

추천 풀과 시그널이 안정된 위에 *사려깊은 작은 디테일* 들. a11y 정리, 활동 dot, dismiss/snooze, follow undo, 키보드 네비, 백그라운드 refresh, loadMore retry. "와 빈틈없다" 인상에 가까워지는 단계.

### 사용자 합의

- 진단 리포트의 묶음 3 전 항목: C2 a11y / C5 loadMore retry / C6 focus refresh / S2 last_active_at / S3 dismiss / S5 follow undo / S8 키보드 / S9 skeleton (이미 v1.0 에 부분 적용)

### Supabase SQL — **돌려야 함**

> Supabase SQL Editor 에서 실행 필요한 마이그레이션 — `supabase/migrations/20260601200000_people_recs_quality_p2.sql`
>
> 선행 조건: P0 + P1 마이그레이션 (helper 와 RPC 의존).

- **S2 — `profiles.last_active_at` 컬럼**: 신규 timestamptz 컬럼 + `idx_profiles_last_active_at` 인덱스. 백필: 기존 row 의 `last_active_at = created_at` 으로 conservative 초기화. trigger 3개 — `artworks_bump_artist_active` (작품 업로드/공개), `follows_bump_active` (양방향, accepted only for principal), `artwork_likes_bump_active` (좋아요한 사용자) — 모두 `bump_profile_last_active(uuid)` 헬퍼 함수 호출. RPC 가 14일 이내 활동 여부를 `is_recently_active` boolean 으로 발행 (timestamp 누설 없음)
- **S3 — `people_dismissals` 테이블 + RPC**: `(user_id, target_id, mode, dismissed_at, expires_at)` 기본키. RLS: 본인 row 만 SELECT, mutation 은 SECURITY DEFINER RPC 만. RPC: `people_dismiss(target, mode='snooze'|'block')` (snooze=30일, block=영구) + `people_undismiss(target)`. `get_people_recs` 의 모든 lane 이 dismissed candidate 를 expires_at 체크와 함께 제외
- get_people_recs 가 *세 번째* 재정의됨 — payload 의 모든 row 가 `is_recently_active` 추가, candidate 필터에 dismissals not-in 추가. 기존 envelope (signal_count / top_signal / mutual_avatars / reason_*) 모두 보존

### 환경 변수 — 변경 없음

### 수정 파일

- [supabase/migrations/20260601200000_people_recs_quality_p2.sql](../supabase/migrations/20260601200000_people_recs_quality_p2.sql) — 신규
- [src/app/people/PeopleClient.tsx](../src/app/people/PeopleClient.tsx) — 카드 렌더링은 새 `PeopleResultCard` 로 위임. 추가 책임:
  - **C5 loadMore retry**: `loadMoreError` state 분리. 실패 시 빨간 retry 버튼 노출, 기존 카드 리스트는 유지. 네트워크 단절·잠시 RPC 에러 후에도 사용자가 보던 정보는 그대로 유지
  - **C6 focus / visibilitychange refresh**: `lastFetchAtRef` + `PEOPLE_REFRESH_TTL_MS = 90s`. 다른 탭 갔다 돌아오면 stale 데이터를 silent 재페치. 피드의 동일한 정책과 통일
  - **S3 dismiss flow**: `handleDismiss(profile, mode)` — 옵티미스틱 제거 + RPC 발화 + 실패 시 복원 + 성공 시 undo 토스트 (5초). undo 는 원래 위치에 다시 삽입
  - **S5 follow undo flow**: `handleFollowed(profile, status)` — FollowButton/IntroMessageAssist 의 onFollowed 콜백을 받아 토스트 노출 + 본인의 followingIds set 갱신. undo 는 `cancel_follow_request` RPC 로 (accepted/pending 둘 다 처리)
  - **S8 키보드 네비**: 글로벌 keydown listener — `j`/`k` 카드 focus 이동 (input/textarea 안일 때 무시, modifier 키 무시). Enter 는 카드 내 Link 가 자체 처리
  - **ToastStack** 인라인 컴포넌트: 페이지-로컬, fixed bottom-right, max-w-sm, rounded-full + shadow-lg. 글로벌 토스트 시스템을 가져오지 않은 이유는 People 만이 이 어휘를 쓰기 때문
- [src/app/people/PeopleResultCard.tsx](../src/app/people/PeopleResultCard.tsx) — **신규 분리 카드 컴포넌트**:
  - **C2 a11y 수리**: `<article role="button">` 안에 `<button>` 중첩이던 구조 해소. 카드는 평범한 `<article>`. avatar+이름+bio+role+reason 영역은 한 개의 `<Link>`. action column (Follow / kebab) 은 Link **밖** — 더 이상 button-in-button 이 아니고 스크린 리더에서도 명료. focus-within ring 으로 카드 단위 시각 hover 유지
  - **S2 활동 dot**: avatar 우하단 `bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500` — `is_recently_active === true` 일 때만 노출. aria-label "최근 활동 중"
  - **S3 DismissMenu**: action column 안 작은 kebab (3-dot) 버튼. 클릭 시 우측 정렬 popover (snooze/block 두 옵션). outside-click + Escape 닫기. snooze 가 first item — 가장 부드러운 선택을 default 로
  - MutualAvatarStack 도 PeopleClient → 카드 컴포넌트로 이전 (자기 책임 영역에 함께)
- [src/lib/supabase/peopleRecs.ts](../src/lib/supabase/peopleRecs.ts):
  - `PeopleRec.is_recently_active` 필드 추가
  - `dismissPerson(targetId, mode='snooze')` / `undismissPerson(targetId)` 클라 wrapper
  - `PeopleDismissMode` 타입 export
- [src/lib/i18n/messages.ts](../src/lib/i18n/messages.ts) — 새 키:
  - `people.signal.recentlyActive` — dot 의 aria-label
  - `people.dismiss.menuLabel` / `people.dismiss.snooze` / `people.dismiss.block` / `people.dismiss.confirmed` / `people.dismiss.undo` — kebab 메뉴 + 토스트
  - `people.follow.added` / `people.follow.requested` / `people.follow.undo` — follow 토스트
  - `people.loadMoreFailed` — retry 버튼 카피

### 변경 없음 (의도)

- 기존 카드 제스처: 여전히 *카드 전체 영역이 클릭 가능* 하게 보임. Link 가 카드 내부 80% 를 차지하고 hover/focus-within ring 이 카드 단위라서 시각적 인상은 동일. a11y 만 *내부적으로* 정돈됨
- `interceptFollow` 의 IntroMessageAssist 패턴 보존: PrivateTarget 이 아닐 때 Follow 버튼 클릭 → 시트 오픈 → 시트가 commit → onFollowed 콜백. v1.1 의 모든 동작 그대로
- `last_active_at` 의 trigger 들은 *이벤트 기반 bump* 만 — 별도 cron 으로 매시간 sweep 하는 식의 비용은 안 듬. 기존 INSERT 시점에 한 번 bump 하므로 추가 부하 미미
- `people_dismissals` 가 RLS 활성. Mutation 은 SECURITY DEFINER RPC 로만 — 클라가 직접 INSERT/UPDATE 불가. 다른 사용자의 dismiss row 는 SELECT 도 안 됨

### 디자인 결정

- **a11y 우선 — 시각적 패턴 보존**: Pinterest/LinkedIn 식 "전체 클릭" 카드는 a11y 와 충돌. 일반적 패턴 (이미지·이름은 Link, 액션은 분리) 으로 가되 hover/focus-within ring 을 카드 단위로 유지. 사용자가 "카드 전체가 클릭" 으로 *느끼는* 부분은 유지하면서 a11y/스크린 리더 명료성을 회복
- **dismiss 의 default = snooze**: "이 사람 다시는 보지 않게" 같은 무거운 제스처 (block) 는 두 번째 옵션. 첫 번째는 30일 snooze. 예술계 인간관계는 *시점* 에 민감 — 지금 자주 보고 싶지 않을 뿐 영원히 차단하고 싶지 않은 경우가 더 흔함. UI 가 그 *비대칭* 을 반영
- **undo 토스트 vs 시트 review**: IntroMessageAssist 시트는 "메시지 동봉 follow" 의 *메시지 작성* 영역. follow 행위 자체의 review 는 5초 undo 토스트가 자연스러움. Gmail/Twitter 식 패턴. 시트가 열린 케이스에선 시트가 commit 도 책임지므로 undo 토스트가 그 직후 노출되어도 어색하지 않음 (사용자 의도 = follow + 메시지)
- **활동 dot — boolean only**: 정확한 timestamp 를 노출하면 *얼마나 자주 들어오는지* 가 사회적 부담이 됨 ("이 사람 5일째 안 들어왔네" 같은 인상). 14일 이내 활동 여부만 boolean 으로 발행 — Slack 의 active dot 어휘. 임계값(14일) 은 RPC 의 `v_active_threshold` 한 줄에서 튜닝
- **글로벌 토스트 시스템 vs 로컬**: 다른 surface 가 토스트를 안 쓰는 현 상태에서 *제일 가벼운 선택* 은 페이지-로컬 ToastStack. 추후 다른 surface 가 동일 어휘를 원하면 lift-and-shift 가능. 지금부터 큰 시스템을 짓는 건 over-engineering

### 검증

- `npx tsc --noEmit` — pass
- `npm run test:feed-living-salon` — pass
- `npm run test:people-reason` — pass
- `npm run build` — pass

### 다음 단계

- 묶음 4 (P3 옵션): S4 검색 미입력 시 trending / 큐레이션 + S6 invite copy 강화 + S7 role chip hover 보조 정보 + dead-code drop (`get_recommended_people`, search_people 5-arg fuzzy)

---

## 2026-05-01 — 사람 탭 v1.1 (P1: Signal Richness + Search Hardening + Mutual Avatars)

묶음 1 의 정합성 게이트 위에 *시그널 자체* 의 의미를 강화. expand 가 정말 "발견" 으로 동작하고, follow_graph 카드에 LinkedIn / Twitter 류의 mutual avatar stack 이 붙고, 검색이 단순 가입순이 아닌 의도된 정렬로 동작하도록.

### 사용자 합의

- "Don't stop until you have completed all the to-dos" — 묶음 1 (P0 핵심) 이후 묶음 2 (P1 풍부함) 자연스럽게 이어 진행
- 진단 리포트의 묶음 2 항목들 모두: A3 expand 시그널 부여 · A4 likes_based fallback 정합 · G2 점수 envelope 일원화 · G3 mutual avatar stack · B1+B2 검색 fuzzy + 정렬 · B3 search cursor · S10 회귀 테스트

### Supabase SQL — **돌려야 함**

> Supabase SQL Editor 에서 실행 필요한 마이그레이션 — `supabase/migrations/20260601100000_people_recs_quality_p1.sql`
>
> 선행 조건: `20260601000000_people_recs_quality_p0.sql` 가 먼저 적용돼 있어야 함 (`is_placeholder_username` / `is_presentable_profile` helper 의존).

- **A3 expand 시그널**: viewer 의 `profiles.themes` / `profiles.mediums` / `profiles.location` 과 candidate 의 동일 컬럼 교집합·일치를 점수화 (`shared_themes_count * 3 + shared_mediums_count * 2 + same_city`). reason_tags 에 `shared_medium` / `similar_keywords` / `same_city` 추가하고 reason_detail.medium·city 도 채움. 클라이언트 humanizer 가 이미 그 키들을 이해하고 있어 "Shared medium: oil" / "Shares similar subject keywords" 같은 자연 카피로 즉시 동작
- **A4 likes_based fallback 정합**: fallback_rows 가 *primary_rows 가 비어있을 때만* 발화하도록 변경 (`(select n from primary_count) = 0`). 좋아요 기록이 있는데도 fallback 이 섞여 lane 이 "최신 공개 사용자" 로 변질되던 문제 차단. `top_signal` 도 row 별로 `likes_based` vs `fallback` 분기
- **G2 score envelope**: 모든 lane 의 jsonb_build_object 에 `signal_count` (lane-uniform headline number) + `top_signal` (lane token) 추가. 클라이언트의 `getScoreBadge` 가 lane 분기 하드코딩 없이 envelope 만 읽어 동작
- **G3 mutual avatars**: follow_graph 의 two_hop CTE 에 candidate 별 *최대 3 명* 의 source 프로필 (id / username / display_name / avatar_url) 을 jsonb_agg 로 동봉. 결정론 정렬 (`order by sp.id`) 로 paginated 요청에서도 stack 이 흔들리지 않음
- **B1+B2 search 정렬 강화**: `search_people(p_q, p_roles, p_limit, p_cursor)` 4-arg 가 본문 내부에서 fuzzy (pg_trgm) 매칭 + 5-tier 우선순위 (exact username > exact display_name > prefix > contains > fuzzy similarity) 로 동작. dead-code 인 5-arg 시그니처는 묶음 4 에서 drop 예정
- 새 컬럼 `match_tier` / `match_similarity` 가 응답 envelope 에 추가됨 (클라이언트 merge 정렬 시 활용)

### 환경 변수 — 변경 없음

### 수정 파일

- [supabase/migrations/20260601100000_people_recs_quality_p1.sql](../supabase/migrations/20260601100000_people_recs_quality_p1.sql) — 신규 마이그레이션
- [src/lib/supabase/peopleRecs.ts](../src/lib/supabase/peopleRecs.ts):
  - `PeopleRec` 타입 확장: `signal_count` / `top_signal` / `mutual_avatars` (G2 + G3) / `match_tier` / `match_similarity` (B1+B2)
  - `PeopleRecMutualAvatar` 타입 신설
  - `searchPeopleWithArtwork` 가 cursor 발행 (B3): 첫 페이지는 모든 variant + 모든 artwork-match 합쳐 보여주고 nextCursor 는 *primary variant* 의 fuzzy cursor. 두 번째 페이지부터는 primary variant 한 개만 cursor 로 페이지네이션 (이미 보인 artwork-match·다른 variant row 를 다시 fetch 하지 않음)
  - merge 정렬에 `match_tier` 와 `match_similarity` 보조 키 추가 — 동일 `match_rank` 안에서 더 정밀한 우선순위
- [src/lib/people/reason.ts](../src/lib/people/reason.ts) — 우선순위 정리 + bare `expand` 분기 추가. shared_medium/similar_keywords/same_city 가 expand 와 함께 올 때 overlap 태그가 헤드라인 카피로, 그것도 없으면 `people.reason.expand` 로 (이전엔 generic fallback 으로 떨어짐)
- [src/app/people/PeopleClient.tsx](../src/app/people/PeopleClient.tsx):
  - `getScoreBadge` — lane 분기 하드코딩 제거, score envelope (`signal_count` / `top_signal`) 만 읽음
  - `MutualAvatarStack` 컴포넌트 신설: 3 명까지 겹쳐 보이는 -space-x-1.5 avatar stack, 각 avatar 는 5x5 rounded-full + white border. follow_graph 카드의 reasonLine 줄 앞에 inline 으로 렌더되어 "이 사람을 X, Y 도 팔로우" 의 시각적 신뢰감을 1줄 더 사용하지 않고 압축
  - reasonLine 옆 카피·badge·avatar stack 모두 한 줄에 자연스럽게 wrap
- [tests/people-reason.test.ts](../tests/people-reason.test.ts) — 신규 회귀 테스트 (S10): reasonTagToI18n 의 9 케이스 (follow_graph priority / likes_based vs expand / shared_medium with·without context / same_city / similar_keywords / bare expand / unknown / null·empty)
- [package.json](../package.json) — `test:people-reason` 스크립트 추가

### 변경 없음 (의도)

- `match_rank` 의 0/1/2 의미는 보존: 0 = exact name (tier 0–1), 1 = prefix/contains/fuzzy (tier 2–4), 2 = artwork-derived. 클라 머지 코드의 *해석* 만 풍부해진 것이지 contract 는 동일
- search RPC 의 5-arg 시그니처 (`p0_search_fuzzy_pg_trgm.sql` 의 dead code) 는 *지금은 그대로 둠*. 묶음 4 (P3 옵션) 의 dead-code drop 에서 `drop function ... (text, text[], int, text, boolean)` 으로 정리
- `searchPeople` 4-arg 호출 시그니처는 그대로 — RPC 본문만 똑똑해짐. 클라이언트는 코드 변경 없이 정렬·fuzzy 자동 적용

### 디자인 결정

- **score envelope (G2) — RPC 가 lane 을 알고 있다**: 클라이언트가 `tags.includes("follow_graph")` 같은 분기로 lane 별 카피를 결정하던 구조는 새 lane 추가 시 지뢰. RPC 가 이미 lane 을 결정한 상태이니 *headline number + top signal* 만 envelope 으로 발행하고 클라는 그것만 본다. 묶음 3 의 dismiss / S2 의 active recently 같은 새 시그널을 추가할 때도 envelope 만 늘리면 끝
- **mutual avatar stack 위치 — 새 줄 vs 같은 줄**: 카드 정보 밀도가 이미 충분하니 새 줄을 추가하는 대신 reasonLine 의 *prefix 포지션* 에 inline. 텍스트 라벨 ("X 외 N명 팔로우") 은 의도적으로 생략 — 작은 avatar 묶음 자체가 이미 "당신의 네트워크 안 사람들" 시그널이고, 옆의 reasonLine 이 그 이유를 풀어줌. 두 어휘를 겹쳐 쓰면 군더더기
- **expand 시그널 가중치 (themes\*3 + mediums\*2 + city\*1)**: 예술 추천에선 *주제* 가 가장 두꺼운 시그널, *매체* 는 그 다음, *도시* 는 가장 약한 부수 시그널. 비공식 가중이지만 추천 lane 의 주관적 인상을 좌우하는 중요한 손잡이라 RPC 본문에 그대로 노출 (튜닝 시 한 곳만 바꿀 수 있도록)
- **B3 cursor 단순화 — primary variant only**: 검색 첫 페이지는 *언어 변형 + artwork match* 까지 다 보여주는 게 검색 의도와 잘 맞음. 두 번째 페이지부터는 *primary 변형만* cursor 로 페이지네이션 — 이미 보인 row 를 다시 가져오지 않고, 페이지 사이즈 예측 가능. 변형·artwork match 가 풍성한 첫 페이지의 우위를 해치지 않으면서 무한 스크롤이 동작하는 합리적 단순화

### 검증

- `npx tsc --noEmit` — pass (clean)
- `npm run test:feed-living-salon` — pass (회귀 없음)
- `npm run test:people-reason` — pass (S10 신규)
- `npm run build` — pass (라우트 셋 그대로)

### 다음 단계

- 묶음 3 (P2 섬세): C2 a11y / C5 loadMore retry / C6 focus refresh + S2 last_active_at + S3 dismiss / snooze + S5 follow undo + S8 키보드 / S9 skeleton (이번에 부분적 도입됨)
- 묶음 4 (P3 옵션): S4 trending + S6 invite copy + S7 role hover + dead-code drop

---

## 2026-05-01 — 사람 탭 v1.0 (P0: Recommendation Pool Integrity + Salon Tone)

피드 v1.7 까지 살롱 톤이 안정되면서 사람 탭의 미감·로직 차이가 도드라졌다. 이번 패치는 사용자가 요청한 사람 탭 진단 리포트의 **묶음 1 (P0 핵심)** 항목 — 추천 풀 정합성 (A1·A2·S1) · 영문 literal leak (C1) · 살롱 비주얼 어셈블 (G1) — 다섯을 한 번에 묶어 시작 지점을 잡는다.

### 사용자 합의

- "그동안 우리가 UX & 디자인적 미감 완성도 관점에서 ... 피드를 작업했으니, 사람 탭의 완성도도 그정도로 따라와줘야해"
- "(1) 우선 눈에 띄는 버그나 기능 저해 요소들을 제거하고 (2) 우리 플랫폼 결에 잘 맞는 ... 굵직하거나 섬세한 기능들을 리스트업"
- 단정·사려깊은 톤 — "와, 정말 섬세하고 빈틈없다, 이런 기능은 참 사려깊다" 같은 감탄을 자아낼 것

### Supabase SQL — **돌려야 함**

> Supabase SQL Editor 에서 실행 필요한 마이그레이션 — `supabase/migrations/20260601000000_people_recs_quality_p0.sql`

- `public.is_placeholder_username(text)` SQL helper 신설 — 클라이언트 SSOT (`isPlaceholderUsername` in `src/lib/identity/placeholder.ts`) 와 정확히 일치하는 정규식 (`^user_[a-f0-9]{6,16}$`)
- `public.is_presentable_profile(display_name, username)` SQL helper 신설 — display_name 또는 non-placeholder username 둘 중 하나라도 있으면 true
- `public.get_people_recs(text, text[], int, text)` 재정의:
  - **A1 status='accepted' 게이트**: 모든 lane 의 `follows where follower_id = v_uid` 절에 `and status = 'accepted'` 추가. follow_graph 는 양 hop 모두 accepted 만 카운트. 비공개 계정에 follow request 보낸 직후 그 프로필이 모든 lane 에서 사라지던 증상 수리. mutual_follow_sources 도 pending edge 가 부풀리지 않음
  - **A2/S1 presentable 게이트**: 모든 lane 의 candidate `profiles p` join 에 `is_presentable_profile(...)` 추가. RPC 가 15 row 반환했는데 클라가 8 카드만 그리고 cursor 는 15 row 만큼 진행하던 페이지 정합 누수 차단

### 환경 변수 — 변경 없음

### 수정 파일

- [supabase/migrations/20260601000000_people_recs_quality_p0.sql](../supabase/migrations/20260601000000_people_recs_quality_p0.sql) — A1 + A2/S1 마이그레이션
- [src/app/people/PeopleClient.tsx](../src/app/people/PeopleClient.tsx) — 살롱 톤 어셈블 (G1) + literal leak (C1)
  - `max-w-2xl` → `max-w-3xl`, `py-8` → `py-10 lg:py-14`
  - 헤더: 캡션 + 2px accent + tracking-[0.22em] (피드 헤더 어휘) + h1
  - 검색창: `border-zinc-300` → `rounded-xl border-zinc-200 bg-white px-4 py-3` 살롱 톤 + focus ring
  - lane 영역: `bg-zinc-50/70 rounded-2xl` floor-tint 패널 안에 chip + lane subtitle (각 lane 마다 i18n 분기)
  - role 필터: 캡션 + `rounded-full` chip 살롱 톤
  - 카드: avatar 12 → 14, typography 강화 (display_name 15px semibold tracking-tight, secondary 인라인), focus-visible ring 살롱 톤. `space-y-4` → `space-y-3`
  - empty state: `bg-zinc-50/70 rounded-2xl` 패널, 버튼 `rounded` → `rounded-full`
  - error state: 사일런트 retry 가 아니라 빨간 floor-tint 패널 + "다시 시도" 버튼 (`common.retry` i18n 사용)
  - loading state: `<p>로딩…</p>` → `PeopleListSkeleton` (실제 카드 형태와 동일한 shimmer)
  - **getScoreBadge literal leak (C1)** 수리: `${liked} signals` → `t("people.signal.likesMatched").replace("{count}", ...)` + follow_graph 도 한국어 자연스러운 카피
- [src/app/people/page.tsx](../src/app/people/page.tsx) — Suspense fallback 영문 literal "Loading…" → 텍스트 없는 `PeopleShellSkeleton` (서버 렌더라 useT 미사용 — 스켈레톤은 로케일 무관)
- [src/components/feed/PeopleCarouselStrip.tsx](../src/components/feed/PeopleCarouselStrip.tsx) — `formatIdentityPair(profile)` → `formatIdentityPair(profile, t)`. placeholder username 만 있는 row 가 fallback 했을 때 한국어 강제 라벨 ("설정 중인 프로필") 이 EN 로케일에도 노출되던 잔류 leak 수리
- [src/lib/i18n/messages.ts](../src/lib/i18n/messages.ts) — 새 키:
  - `people.kicker` — 헤더 캡션 ("DISCOVER" / "탐 색")
  - `people.signal.followNetwork` / `people.signal.likesMatched` — score badge 카피
  - `people.lanes.likesBasedSubtitle` / `people.lanes.expandSubtitle` — lane 별 보조 문구
  - `people.lanes.followGraphSubtitle` (KO) — 사용자 멘탈 모델 ("팔로우한 사람이 팔로우") 과 정렬: "팔로우한 사람들이 팔로우하고 있어요"

### 변경 없음 (의도)

- search RPC (search_people, search_artists_by_artwork) 는 묶음 2 (B1·B2·B3) 에서 다룸 — 이번엔 추천 풀만 손댐
- `expand` lane 의 의미 부재 (A3) 와 `likes_based` fallback 비대칭 (A4) 도 묶음 2 에서. 이번엔 *정합성 게이트* 만
- C2 (a11y / role=button + nested button) 와 C5/C6 (loadMore retry / focus refresh) 는 묶음 3 의 톤·사려 항목으로 이관
- 살롱 톤 floor-tint 가 *카드 자체* 까지 침범하지 않도록 의도적으로 자제 — 정보 카드는 흰 위에 단정한 zinc-200 border 가 가독성에 더 적합
- placeholder username 클라이언트 가드 (`hasPublicLinkableUsername`) 는 *defence in depth* 로 유지. RPC 게이트가 SSOT 가 됐지만 stale build/캐시에 대비

### 디자인 결정

- **헤더 어휘 통일 vs 사람 탭 고유성**: 피드의 kicker (uppercase, 2px accent, tracking-[0.22em]) 를 그대로 가져오되 max-width 는 3xl 로 좁힘. 사람 탭은 list-first 라 좁은 폭이 *읽힘 시간* 측면에서 더 좋음. 시각 시스템은 통일, 폼 팩터는 surface 의 본분에 맞게 다름
- **lane 패널 floor-tint**: 피드의 PeopleCarouselStrip / ExhibitionMemoryStrip 와 동일한 어휘 — "이 영역은 다른 chapter 다" 시그널을 zinc-50/70 으로. lane subtitle 까지 패널 안에 두어 의미 단위로 묶임
- **getScoreBadge 카피**: "n signals" 직역 대신 KO 는 "공감 시그널 n건" / "n명과 연결돼 있어요" 로 의역. EN 은 "matched signals" / "in your network" — 추상적 메트릭 보다 *체감되는 단어* 선택
- **page.tsx skeleton 의 텍스트 부재**: Suspense fallback 은 SSR 단계라 useT 못 씀. "Loading..." 영문 literal 을 KO 가 보면 *영어가 한 번 깜빡* 하는 인상이라 톤이 깨짐. 텍스트 없는 시각 skeleton 이 로케일 무관하게 동작 — 형태가 곧 메시지
- **A1/A2 게이트의 위치 — RPC vs 클라이언트**: v1.7.1 의 빌더 게이트는 *피드 surface 정책* 이라 빌더에 둠. 사람 탭의 게이트는 *RPC 가 약속한 row 수와 화면 row 수가 같아야 함* 이라는 데이터 정합 — 본질이 backend 책임. 클라 가드는 두 번째 안전망

### 검증

- `npx tsc --noEmit` — pass (stale `.next/types` 정리 후)
- `npm run test:feed-living-salon` — pass
- `npm run build` — pass (Static 17개 / Dynamic 13개 라우트 그대로)

### 다음 단계

- 묶음 2 (P1 풍부함): A3 expand 시그널 부여 · A4 likes_based fallback 정합 · B1·B2 검색 fuzzy + 정렬 우선순위 · B3 search cursor · G2 score envelope 일원화 · G3 mutual avatar stack · S10 회귀 테스트
- 묶음 3 (P2 섬세): C2/C5/C6 + S2/S3/S5/S8/S9
- 묶음 4 (P3 옵션): S4/S6/S7 + dead-code 정리

---

## 2026-04-30 — 오늘의 살롱 v1.7.1 (Presentable-Profile Gate + Artist 카피 통일)

작은 두 가지 정리: (1) 작품 영역 외 카피 어휘를 "아티스트" 로 통일, (2) display_name·real username 둘 다 비어 있는 placeholder 프로필이 추천 캐러셀 전면에 떠서 베타 인상을 흐리던 문제 차단.

### 사용자 합의

- "아티스트 추천 박스는 작가라는 단어 대신 '아티스트'로 통일하기로 했었으니까, 여기도 아티스트로 문구를 통일하자"
- "난수아이디/null 유저네임 아티스트나 비아티스트 유저들은 추천 상단에서 제외 ... 이름과 아이디가 잘 보이는 사람이 전면에 추천되어야"

### Supabase SQL — 돌려야 할 것 없음

i18n 1줄 + 빌더 게이트 1개.

### 환경 변수 — 변경 없음

### 수정 파일

- [src/lib/i18n/messages.ts](../src/lib/i18n/messages.ts) — KO `feed.artistClusterHeader` "작가 추천" → **"아티스트 추천"**. EN 은 이미 "Artists to discover" 로 일관 — 변경 없음
- [src/lib/feed/livingSalon.ts](../src/lib/feed/livingSalon.ts) — `isPresentableProfile` 게이트 추가. `display_name` 이 비었고 `username` 도 없거나 `isPlaceholderUsername` ( `user_<6–16hex>` ) 패턴이면 추천 카드에서 silent drop. `buildPeopleClusters` 가 버킷 채우기 직전에 게이트로 거름
- [tests/feed-living-salon.test.ts](../tests/feed-living-salon.test.ts) — 게이트 회귀 두 케이스: (a) 모두 placeholder 면 `cluster_min` 미달로 row 자체 미발행, (b) named 2 + placeholder 1 이면 named 만 통과

### 변경 없음 (의도)

- placeholder 프로필 자체는 People 탭 전용 lane 에서 "설정 중인 프로필" 라벨로 여전히 노출 가능 — 살롱의 *전면 추천* 만 제외. People 탭 처리는 별도 surface 의 책임
- v1.7 의 정렬·페이지 사이즈·cursor 동작 그대로
- placeholder username 룰 (`isPlaceholderUsername`) 은 SSOT 그대로 — 빌더가 import 만 함

### 디자인 결정

- **silent drop vs 라벨 표시**: 이름 없는 카드를 "설정 중인 프로필" 로 보여주면 *플랫폼이 비어 보임* — 베타 단계에선 더 큰 신뢰 손실. 익명 카드는 *그 사람을 위해서도 좋지 않으니* 살롱 전면에선 제거가 맞음
- **카피 SSOT**: "아티스트" 표기를 외부 노출 키워드 표준으로 굳힘. 내부 코드 식별자 (`persona: "artist"`, `main_role`, type `LivingSalonPersona`) 는 영문 그대로 — UI/code 어휘 분리
- **게이트 위치**: 빌더 안 (RPC 가 아니라). RPC 는 *모든* 추천 후보를 그대로 주고, 빌더가 surface 별 정책을 결정. 다른 surface (e.g. People 탭) 에서 같은 후보를 다른 정책으로 활용할 여지 보존

### 검증

- `npm run test:feed-living-salon` — pass (placeholder 게이트 회귀 2 케이스 추가)
- `npx tsc --noEmit` — 0 errors
- `npm run build` — pass

---

## 2026-04-30 — 오늘의 살롱 v1.7 (Sort Distinction + Incremental Load)

**(1) `latest` vs `popular` 정렬이 화면에서 동일해 보이던 진짜 원인 수리** + **(2) 첫 paint 가 무거워진 패치를 incremental load 로 복원**.

### 사용자 합의

- "예전처럼 처음부터 다 끌어다오지 말고 (페이지 로딩 속도 퍼포먼스 고려) 스크롤이 내려감에 따라 리프레시 하면서 추가적으로 불러오는 알고리즘으로 다시 돌아가자"
- "지금 보면 새 작품(업로드순)과 반응 좋은 작품 (인기순) 간에 차이가 없는거 같아"

### 진단 — sort 가 *조용히* 동일해진 이유

`listPublicArtworks` 의 RPC 정렬 분기는 정상이었음:
- `popular`: `likes_count desc → created_at desc → id desc`
- `latest`: `created_at desc → id desc`

진짜 문제는 `FeedContent` 가 RPC 결과를 *받자마자* 두 군데에서 `created_at` 으로 **다시 정렬** 하던 것:

1. 초기 fetch (all/following) 의 `entries.sort((a, b) => b.created_at - a.created_at)`
2. `loadMore` 의 `deduplicateAndSort` 도 같은 로직

→ popular 로 정렬돼서 온 row 가 화면에 그려지기 직전 created_at 으로 덮어써져 `latest` 와 *시각적으로 동일* 한 결과. 빌더 (`buildLivingSalonItems`) 는 entries 의 *type 별 상대 순서* 만 사용하므로, 이 재정렬은 정렬 차이를 죽이는 것 외에는 가치가 없었음.

### Supabase SQL — 돌려야 할 것 없음

RPC 코드 + UI 컴포넌트만.

### 환경 변수 — 변경 없음

### 수정 파일

- [src/components/FeedContent.tsx](../src/components/FeedContent.tsx) —
  - 두 곳의 `entries.sort(...)` 제거 (initial fetch all + following). RPC 가 결정한 순서를 *그대로* 보존
  - `deduplicateAndSort` → `dedupePreservingOrder` 로 rename + 재정렬 로직 삭제. 초기 fetch · loadMore 모두 sort 미수행
  - `FEED_PAGE_SIZE` `60 → 24`. 4 cols × ~6 rows 의 첫 paint. cursor-leak fix (v1.6) 덕에 작은 페이지 사이즈에서도 무한 스크롤이 안정적으로 작동하므로 첫 TTFB 비용을 낮추는 게 옳음
  - `FEED_LAYOUT_VERSION` `living_salon_v1.5_unified_carousel → living_salon_v1.7_incremental` (incremental load 정책 + sort 수리 회기 추적용 분석 키)

- [src/lib/supabase/artworks.ts](../src/lib/supabase/artworks.ts) — `listPublicArtworks` 의 popular 분기 cursor 처리 sanity 보강:
  - cursor 사용 시 `likes_count` null 이어도 `0` fallback. 이전엔 `cursor.likes_count != null` 체크가 false 면 cursor 자체를 무시 → 같은 페이지 반복 가능
  - cursor 발행 시도 `likes_count ?? 0` 로 항상 채움. legacy / NULL 컬럼 row 가 끼어도 cursor 가 명확

### 변경 없음 (의도)

- `popular` 정렬의 RPC 순서 정의 (`likes_count desc → created_at desc → id desc`)
- `likes_count` 컬럼은 `not null default 0` + `sync_artwork_likes_count` 트리거로 정합 (마이그레이션 `p0_artworks_likes_count.sql`)
- 빌더 결정론, anchor·cluster·exhibition 게이트
- v1.6 의 cursor 누수 수리, floor-tint 섹션 분리, 사이즈 pill 출력단 가드

### 디자인 결정

- **sort 의 RPC-only authority**: 정렬은 한 곳에서만 결정. 클라이언트가 한 번 더 다른 기준으로 sort 하면 의도 침해. 빌더가 type 간 mixing 만 책임지고, type 내 순서는 RPC 의 명시적 의도를 그대로 따름
- **page size 24 의 근거**: 4 cols × 6 rows = 24. spotlight 1 + 표준 5 + 컨텍스트 1~2 가 첫 viewport 에 dense 하게 채워짐. 60 으로 부풀리지 않아도 *체감* 충분. 무한 스크롤이 *진짜 작동* 하니 뒤는 자연스럽게 따라옴
- **likes_count 0 fallback**: 데이터 정합 측면에서 트리거가 있어 보통 NULL 이 아니지만, legacy 또는 트리거 도입 전 row 의 방어. cursor 가 누수되어 같은 페이지 반복되는 silent failure 보다 0 으로 fallback 해서 명확한 끝점 결정이 항상 옳음
- **데이터 의존성 노트**: 만약 likes_count 가 모두 0 인 신생 플랫폼 단계라면 popular 의 sub-order 가 created_at desc → latest 와 사실상 동일한 순서가 자연 발생. 코드는 정상이고, 데이터가 충분히 분포되면 자동으로 시각 차이 발현

### 검증

- `npm run test:feed-living-salon` — pass
- `npx tsc --noEmit` — 0 errors
- `npm run build` — pass
- `?debug=feed` 패널: `art cursor: present` 가 스크롤 진행에 따라 갱신되어야 정상

---

## 2026-04-30 — 오늘의 살롱 v1.6 (Infinite-Scroll Cursor Fix + Section Floor-tint)

**(1) 무한 스크롤 cursor 누수 수리** + **(2) 작품 그리드와 사람·전시 섹션의 시각적 분리 강화**.

### 사용자 합의

- "피드 리프레시는 여전히 작동하지 않아... 데이터베이스에 훨씬 더 많은 작품이 있는데 어딘가에서 막혀서 출력이 안되고 있어" — RPC 차원의 진짜 원인 추적
- "작품이 보여지는 곳들과 사람 혹은 전시 게시물을 소개하는 섹션이 조금 더 확실하게 구분되었으면" — 시선 처리·정보 수집 측면

### 진단 — 무한 스크롤이 *조용히* 멈췄던 이유

`listPublicArtworks` 의 두 군데 결함:

1. **`pageSize = Math.min(limit, 30)` cap** — `FEED_PAGE_SIZE = 60` 으로 호출해도 30 으로 강제 cap 됨. 의도했던 dense 첫 paint 가 절반으로 깎임.
2. **post-filter 기준 cursor 발행 (핵심)** — RPC 가 `pageSize + 1` row 반환 후 `isPublicSurfaceVisible` (RLS 누수 방어용 client-side filter) 로 일부 drop. 그런데 `nextCursor` 결정은 *filter 후 list.length* 기준:
   ```
   if (list.length > pageSize && list[pageSize]) { nextCursor = ... }
   ```
   filter 가 단 1개라도 잘라내면 `list.length === pageSize` (또는 미만) → `nextCursor = null` → DB 에 더 많은 row 가 있어도 무한 스크롤 정지.

   결과적으로 *user-private 또는 visibility 누수 의심* row 가 단 한 건만 RPC 페이지에 끼어 있어도 그 페이지 이후 cursor 가 죽었음. 작가 가시성 정책이 mature 해질수록 더 자주 발생.

### Supabase SQL — 돌려야 할 것 없음

RPC 로직 + UI 컴포넌트만.

### 환경 변수 — 변경 없음

### 수정 파일

- [src/lib/supabase/artworks.ts](../src/lib/supabase/artworks.ts) —
  - `listPublicArtworks`: pageSize cap `30 → 100` (FEED_PAGE_SIZE 60 의도 존중). raw fetch list 와 visible (post-filter) list 를 분리. **cursor 는 raw 기준**, **표시는 visible 기준**. 두 단계 분리로 filter 가 row 를 잘라내도 cursor 가 살아남음
  - `listFollowingArtworks`: pageSize cap `30 → 100` 동일 완화 (cursor 누수는 client-side filter 미적용이라 별도, cap 만 정합)
- [src/components/feed/PeopleCarouselStrip.tsx](../src/components/feed/PeopleCarouselStrip.tsx) — 외곽을 `rounded-2xl bg-zinc-50/70 px-6 py-9 my-2` floor-tint container 로 교체. `border-y` hairline 제거. 헤더 좌측에 `h-3 w-[2px] bg-zinc-900` 작은 vertical accent 추가, typography `text-zinc-700 + tracking-[0.22em]` 로 살짝 강화. carousel 의 `-mx-6 lg:-mx-8 px-6 lg:px-8` 로 padding 보정해 슬라이드는 끝까지 가게
- [src/components/feed/ExhibitionMemoryStrip.tsx](../src/components/feed/ExhibitionMemoryStrip.tsx) — 동일 floor-tint container 적용 (`rounded-2xl bg-zinc-50/70 px-6 py-9 my-2`). 헤더 vertical accent + typography 강화. 두 strip 이 *같은 시각 어휘* 로 통일되어 사용자 눈에 "맥락 전환 모듈" 로 즉시 인지

### 변경 없음 (의도)

- `FEED_LAYOUT_VERSION` 그대로 (`living_salon_v1.5_unified_carousel` — UI 분리 강화는 layout 버전 의미 변화 아님). 분석 페이로드 일관성 유지
- 빌더 `buildLivingSalonItems` 결정론, anchor / cluster 게이트, 사이즈 pill 동작
- `listFollowingArtworks` 의 cursor 결정 (이쪽은 client-side filter 안 함 → 누수 없음)

### 디자인 결정

- **floor tint 의 정당성**: 작품은 흰 갤러리 벽 위에서 가장 잘 보이고, 사람·전시 추천은 *별도의 메타 표지판*. zinc-50/70 (70% 투명) 은 정확히 *문단 구분* 의 톤 — 광고 박스처럼 무겁지 않고, hairline 처럼 약하지도 않음
- **vertical accent 마커**: 헤더 시작점에 2px 폭 작은 막대 — 살롱 톤의 "조용한 강조". 좌측 정렬되어 *문단 들여쓰기* 처럼 읽힘
- **cursor 분리의 trade-off**: visible 이 적게 반환되어도 cursor 살아남음 → 다음 fetch 가 또 RPC 호출 후 또 일부 filter — 약간의 over-fetch 비용. 무한 스크롤이 *진짜 동작* 하는 가치가 더 큼. cap 100 도 아주 큰 limit 호출 방지용 안전망 (실 사용 60)
- **layout 버전 미상승**: 그리드 구성은 그대로, 외곽 컨테이너만 강화 — `LivingSalonItem` 의 사용자 노출 vocabulary 가 바뀌지 않음. 분석 호환성 유지

### 검증

- `npm run test:feed-living-salon` — pass (deterministic 빌더 회귀 없음)
- `npx tsc --noEmit` — 0 errors
- `npm run build` — pass
- 디버그 패널 (`?debug=feed`) 에서 `art cursor: present` 가 페이지 끝까지 유지되어야 정상. `null` 인데 화면에 carousel/exhibitions 만 보인다면 본 이슈 가능성

---

## 2026-04-30 — 오늘의 살롱 v1.5.2 (Size Pill — Output-side Unit Guard)

v1.5.1 의 입력단 게이트 (`buildSizePill`) 가 견고함에도 *단위 없는 pill* 이 화면에 보이는 케이스가 보고됨 (`152.4 × 121.9`, `61.0 × 10.2` 등). 원인 분석:

1. `artwork.size_unit` 컬럼은 DB constraint 로 `null | 'cm' | 'in'` 만 허용 — 빈 문자열 누수 없음.
2. `buildSizePill` 게이트도 `parseSizeWithUnit` 결과 + 컬럼 값으로 정확히 잡음.
3. 그러나 `formatSizeForLocale` 의 `parseSize` fall-through (`if (!parsed) return size.trim()`) 또는 stale 빌드 (v1.3 시점 always-visible 정책) 같은 *부수 경로* 에서 단위 없는 string 이 새어나갈 수 있음. `extractSizeBase` 는 그동안 호수 prefix 만 떼고 *단위 검증을 안 했음* — 이게 진짜 누수 구멍.

해결: **출력단 안전망 추가**. `extractSizeBase` 가 `\b(?:cm|in)\b` 패턴이 *반드시 포함된* 결과만 통과시킴. 어떤 빌드/경로로든 단위 없는 pill 이 노출되는 일은 영구 봉쇄.

### 사용자 합의

- "size pill 이 노출될거면 호수 기반 추정 단위가 붙어야 하고, 단위 추정이 불가능하면 size pill 노출이 안 되어야 한다" — 출력단에서도 동일 약속을 강제

### Supabase SQL — 돌려야 할 것 없음

UI 컴포넌트 1개만.

### 환경 변수 — 변경 없음

### 수정 파일

- [src/components/FeedArtworkCard.tsx](../src/components/FeedArtworkCard.tsx) — `extractSizeBase` 가 호수 prefix 제거 후 *cm 또는 in 단위 마커가 반드시 있는지* 검증. 없으면 null 반환 → pill 미렌더. 다중 방어 레이어로 입력단 게이트 → format 분기 → 출력단 검증 세 단계 모두 단위 보장된 경우만 노출

### 변경 없음 (의도)

- v1.5.1 의 `buildSizePill` 입력단 게이트, `formatSizeForLocale` 의 호수 명기 분기 cm/in 부여 동작
- v1.5 의 unified persona carousel · debug 패널 · `FEED_LAYOUT_VERSION`

### 디자인 결정

- **출력단 검증의 정당성**: 입력단 게이트와 별개로 *결과* 자체에 단위가 있어야 통과. 호수 prefix 제거는 시각 정리용이니 그 후 단위 검증을 묶어두는 게 책임 일관성 좋음. cm/in 둘 중 하나라도 있으면 통과 — `약 30F · 90.9 × 72.7 cm` → cm 살아남음, `30F · 90.9 × 72.7 cm` → cm 살아남음, `152.4 × 121.9` → null
- **stale 빌드 방어 효과**: v1.3 빌드 (always-visible) 가 일부 페이지/CDN 에 캐시되어 있어도, 새 빌드 배포 시 이 출력단 가드가 자동으로 차단

### 검증

- `npm run test:feed-living-salon` — pass
- `npx tsc --noEmit` — 0 errors
- `npm run build` — pass

---

## 2026-04-30 — 오늘의 살롱 v1.5.1 (Size Pill — Hosu-only cm Assumption)

v1.5 가 `size_unit==null` 인 *모든 unit-less 입력* 을 cm 로 가정한 동작은 inch ↔ cm 2.5배 오차 위험 때문에 과도. 사용자 정정에 따라 *호수가 명기된 경우에만* cm 강제 부여로 좁힘. 그 외 순수 숫자 입력은 사이즈 pill 미렌더 (v1.4 정책으로 되돌림).

### 사용자 합의

- "호수가 명기되어 있어서 사이즈를 유추할 수 있을 때만 cm를 강제로 부여" — `30F` 같은 호수 표기는 항상 cm 기반 표준이라 안전. `120 × 80` 같은 unit-less 숫자는 `unit` 추정 불가 → pill 미렌더 (Artsy / Artnet / 1stDibs 정책 참조)
- 단위 명시 입력 (`120 × 80 cm`, `60 × 40 in`) 또는 `artwork.size_unit` 컬럼 명시 케이스는 v1.4·v1.5 동작 그대로

### Supabase SQL — 돌려야 할 것 없음

타입·로직 두 파일만.

### 환경 변수 — 변경 없음

### 수정 파일

- [src/lib/size/format.ts](../src/lib/size/format.ts) — `formatSizeForLocale` 의 `size_unit==null` 분기 정정. 호수 명기 입력 (`hosuNumber + hosuType`) 은 KO `cm` / EN `in` 로 변환·표시. 호수 없는 unit-less 입력은 *수치만* 반환 (cm 강제 부여 제거). `nearestHosu` 추정에는 단위 부여 안 함 — 호출처가 게이트로 미렌더 처리하면 도달 자체가 없으니 안전
- [src/components/FeedArtworkCard.tsx](../src/components/FeedArtworkCard.tsx) — `buildSizePill` 의 *단위 부재 게이트* 복원. `parseSizeWithUnit` 다시 import. `parsed.unit == null && sizeUnit == null` 이면 pill 미렌더. 호수 입력은 `parseSizeWithUnit` 가 `unit: "cm"` 으로 평가 → 게이트 통과. v1.5 의 "모두 통과" 정책을 v1.4 정책으로 되돌리되, formatter 자체는 호수 분기에 cm 부여 능력을 갖춘 상태로 유지

### 변경 없음 (의도)

- v1.5 의 unified persona carousel · debug 패널 · `FEED_LAYOUT_VERSION = living_salon_v1.5_unified_carousel`
- `formatSizeForLocale` 의 `size_unit === "cm"` / `"in"` 분기 (RPC 컬럼 명시 케이스 그대로)
- 호수 prefix 떼는 `extractSizeBase` 동작

### 디자인 결정

- **호수만 cm 강제**: 호수는 *cm 기반 표준* 이라 정확. `120 × 80` 같은 임의 숫자는 작가가 inch 로 입력했을 수도 있어 임의 cm 부여는 2.5배 오차로 사용자 혼란이 더 큼. *살짝 덜 보이지만 정확한* 쪽이 살롱 톤에 맞음
- **silent drop**: 단위 미상 입력은 pill 자체를 안 보임. 작가 본인의 size_unit 보완 CTA 는 별도 패치에서 (admin / artist self-edit)

### 검증

- `npm run test:feed-living-salon` — pass
- `npx tsc --noEmit` — 0 errors
- `npm run build` — pass

---

## 2026-04-30 — 오늘의 살롱 v1.5 (Unified Persona Carousel + Size Unit Assumption + Debug Panel)

v1.4 의 캐러셀이 비-artist 페르소나만 노출하던 비대칭, 사이즈 단위가 빠진 카드의 시각 비일관성, 무한 스크롤이 멈춰도 사용자가 원인을 찾을 수 없던 진단 부재 — 세 문제를 한꺼번에 수리.

### 사용자 합의

- 모든 페르소나 (artist 포함) 를 동일한 가로 캐러셀 패턴으로 통일. v1.4 의 `artist_world` 단일 strip 패턴 폐기 — 사용자가 "주기적으로 페르소나별 유저 소개 행이 뜨면 좋겠다" 고 명시
- 사이즈 단위가 식별 안 되더라도 *cm 가정* 으로 단위 표기 (한국 시장 + 살롱 톤). EN locale 은 inch 환산. 일관성 > 보존성
- 무한 스크롤이 멈췄을 때 *원인 진단* 할 수 있도록 우하단 디버그 패널 + 풍부한 console.debug. `?debug=feed` 쿼리 또는 `localStorage.debug_feed = "1"` 로 토글

### Supabase SQL — 돌려야 할 것 없음

빌더 분기 + UI 컴포넌트 + 진단 패널만.

### 환경 변수 — 변경 없음

### 수정 파일

- [src/lib/feed/livingSalon.ts](../src/lib/feed/livingSalon.ts) — `artist_world` kind 와 `LivingSalonClusterPersona` 타입 폐기. `LivingSalonItem.people_cluster` 의 `persona` 가 `LivingSalonPersona` (artist 포함 4종) 로 확장. `filterArtistDiscovery`, `takeArtistWorld`, `ARTIST_WORLD_MIN_ARTWORKS` 모두 제거. `buildPeopleClusters` 가 4종 페르소나 모두 버킷, 동일하게 `PEOPLE_CLUSTER_MIN = 2` 게이트. 출력 순서 `artist → curator → gallerist → collector` 로 결정론. `summarizeLivingSalonMix` 반환에서 `artist_worlds` 키 제거
- [src/components/feed/PeopleCarouselStrip.tsx](../src/components/feed/PeopleCarouselStrip.tsx) — `persona` prop 을 `LivingSalonPersona` 로 확장. `PERSONA_HEADER_KEY` 에 `artist: feed.artistClusterHeader` 추가. 카드 vocabulary 동일 (avatar + 이름 + role chip + reason + Follow). artist 카드도 다른 페르소나와 같은 패턴 — 작품 thumbs 미노출, 통일감 우선
- [src/components/feed/ArtistWorldStrip.tsx](../src/components/feed/ArtistWorldStrip.tsx) — **삭제**. v1.4 까지 artist 단일 프로필 strip 이었으나, 카드 vocabulary 통일 위해 폐기
- [src/components/feed/LivingSalonGrid.tsx](../src/components/feed/LivingSalonGrid.tsx) — `ArtistWorldStrip` import 제거, `artist_world` 분기 제거. people_cluster 만 처리
- [src/lib/size/format.ts](../src/lib/size/format.ts) — `formatSizeForLocale` 의 `size_unit==null` 분기 변경. 이전엔 *원본 수치 그대로 단위 없이* 반환했지만, v1.5 부턴 *cm 가정* 으로 표시. KO locale 은 cm 그대로, EN locale 은 inch 환산. 호수 prefix 분기에도 동일 로직 적용
- [src/components/FeedArtworkCard.tsx](../src/components/FeedArtworkCard.tsx) — `buildSizePill` 의 단위 부재 게이트 제거. `parseSizeWithUnit` import 도 삭제. `size` 가 파싱되면 항상 pill 발행. 호수 prefix 떼는 `extractSizeBase` 동작 그대로
- [src/components/FeedContent.tsx](../src/components/FeedContent.tsx) — `FEED_LAYOUT_VERSION` `living_salon_v1.4_carousel` → `living_salon_v1.5_unified_carousel`. `parsePersona`, `listPublicArtworksForProfile` import 제거 (unified 카드는 작품 thumbs 안 씀). `discoveryPromises` 가 페르소나 분기 없이 모든 프로필 통과 (`{profile, artworks: []}` 매핑). `item_mix` 페이로드에서 `artist_worlds` 키 제거. 새 진단 인프라: `useSearchParams`, `?debug=feed` 또는 `localStorage.debug_feed === "1"` 시 `debugMode = true`. `loadMoreCalls`, `lastLoadMoreFetched` state 추가. fetchArtworks / loadMore 양쪽 분기 끝에 `console.debug` ("[Feed] initial fetch", "[Feed] loadMore") 풍부하게 발행 — `next_*_cursor: present|null`, `artworks_in`, `exhibitions_in`, `page_size` 모두 노출. JSX 마지막에 `<FeedDebugPanel>` (debugMode 시) 우하단 fixed pill — tab/sort, feedEntries / salonItems / discovery counts, persona breakdown, 두 cursor 상태, hasMore, loadMore 호출 횟수 + 마지막 결과
- [src/lib/i18n/messages.ts](../src/lib/i18n/messages.ts) — KR/EN 새 키 1개: `feed.artistClusterHeader` ("작가 추천 / Artists to discover"). 더 이상 쓰이지 않는 `feed.artistWorldLabel`, `feed.viewArtist` 두 키 제거
- [tests/feed-living-salon.test.ts](../tests/feed-living-salon.test.ts) — 통째 재작성. v1.4 의 chunk·artist_world 케이스 모두 갱신: `artist_world` kind 미발행 회귀, artist 페르소나도 `cluster_min` 게이트 (1명 drop / 2명+ row) 적용, 페르소나 출력 순서 `artist → curator → gallerist → collector` 확정 케이스, 모든 페르소나가 한 row 로 통합되는 케이스. `summarizeLivingSalonMix` 합 검증에서 `artist_worlds` 항 제거

### 변경 없음 (의도)

- 데이터 페치 layer (`listPublicArtworks` 등 RPC contract), RLS, like/follow 행동
- 캐러셀 카드 vocabulary, scroll-snap·화살표 동작 (v1.4 그대로)
- 빌더 결정론 — same input → same output

### 디자인 결정

- **artist 도 단일 strip 대신 캐러셀**: v1.4 의 단일 프로필 strip 은 시각적으로 더 정성스럽지만 *우연히 한 명만 등장* 시 강한 비대칭. 캐러셀은 한 페르소나 1명일 때 row 자체 미렌더 — *적게 보일 바엔 안 보이는 게 낫다*
- **artist 카드 안 작품 thumbs 생략**: Behance 식 작품 thumbs 동반도 검토했으나 (v1.4 검토 D), curator/gallerist/collector 는 작품 풀 없어 비대칭. 통일감을 위해 모두 동일 vocabulary, 작품은 카드 클릭 → /u/username 디테일 페이지에서
- **단위 cm 가정의 위험 vs 보상**: 일부 작품이 inch 입력이었을 가능성 있음. 미술 시장 데이터는 cm·in 둘 다 정상. 그러나 사용자 기준 *단위 없는 숫자가 더 시각 노이즈*. 정확성 살짝 희생해 일관성 확보. 후속으로 작가 본인의 unit 보완 CTA 가 데이터 정정 흐름
- **debug 패널 우하단 fixed**: 페이지 흐름과 분리, max-w-[280px] 로 작게. 11px 타이포 — 정보 밀도 높은 진단용. `localStorage.debug_feed = "1"` 토글로 production 환경에서도 사용자가 켤 수 있음
- **`console.debug` `[Feed]` prefix**: 다른 로그와 구분. `next_*_cursor: present|null` 만 발행 — 실제 cursor 값은 보안 노출 우려, *발행 여부만* 알면 무한 스크롤 진단 충분

### 검증

- `npm run test:feed-living-salon` — 갱신·신규 케이스 모두 통과
- `npx tsc --noEmit` — 0 errors
- `npm run build` — success

### Verified

- 결정론 테스트 통과 (artist_world 폐기, 페르소나 통합 cluster, 출력 순서)
- 타입 체크 통과
- 빌드 통과

### 후속 (별도 패치 후보)

- 작가 본인 작품 디테일 페이지에서 `size_unit` 보완 CTA — 데이터 정정 흐름
- 진단 패널이 보여주는 `cursor=null` 케이스가 일상화되면 페이지 사이즈 / RLS / 클라이언트 필터 어디가 병목인지 다음 진단

---

## 2026-04-30 — 오늘의 살롱 v1.4 (People Carousel + Infinite-Scroll Heal + Size Pill Gate)

v1.3 의 cluster 가 후보 1명일 때 외롭게 보였던 문제, 사이즈 단위 부재시 의미 없는 숫자만 노출되던 문제, 무한 스크롤이 사실상 1회 이후 멈춰있던 문제를 한꺼번에 정리. layout_version 은 `living_salon_v1.3_clustered` → `living_salon_v1.4_carousel`.

### 사용자 합의

- 사람 추천을 *페르소나별 가로 캐러셀* 로. 1명만 있는 페르소나는 row 자체 미렌더 (`PEOPLE_CLUSTER_MIN = 2`)
- 작품 사이즈 pill: 단위가 식별 안 되면 미렌더 (Artsy / Artnet / 1stDibs 정책과 일치). 작가 인라인 unit 보완은 별도 후속 패치
- 무한 스크롤 보강 (sentinel rootMargin 800px + page limit 60) 우선 시도

### Supabase SQL — 돌려야 할 것 없음

데이터 fetch 양만 늘리고 빌더·UI 분기만 손댐.

### 환경 변수 — 변경 없음

### 수정 파일

- [src/components/FeedArtworkCard.tsx](../src/components/FeedArtworkCard.tsx) — 새 헬퍼 `buildSizePill()`. `parseSizeWithUnit()` 으로 입력에 단위 표식 있는지 판단, 없고 `artwork.size_unit` 도 null 이면 pill 미렌더 (조용히 숨김). 호수 입력은 항상 cm 로 간주되어 통과
- [src/components/feed/PeopleCarouselStrip.tsx](../src/components/feed/PeopleCarouselStrip.tsx) — 신설. 페르소나 헤더 + 가로 `snap-x snap-mandatory` 캐러셀. 카드 너비 260-280px, 모바일 네이티브 스와이프, lg+ 좌/우 화살표 버튼 (`scrollBy clientWidth × 0.85`), 스크롤 양 끝에서 화살표 비활성. 스크롤바 숨김. 카드 vocabulary 는 v1.3 cluster 카드 그대로 (avatar + 이름 + role chip + reason `line-clamp-2` + 카드 하단 `<FollowButton>`)
- [src/components/feed/PeopleClusterStrip.tsx](../src/components/feed/PeopleClusterStrip.tsx) — **삭제**. v1.3 의 grid cluster. 가로 캐러셀로 대체됨
- [src/components/feed/LivingSalonGrid.tsx](../src/components/feed/LivingSalonGrid.tsx) — `PeopleClusterStrip` import → `PeopleCarouselStrip` 으로 교체. props 동일
- [src/lib/feed/livingSalon.ts](../src/lib/feed/livingSalon.ts) — `PEOPLE_CLUSTER_CHUNK = 3` 제거, 새 `PEOPLE_CLUSTER_MIN = 2` (cluster 발행 최소 인원). `buildPeopleClusters` 가 더 이상 chunk 분할 안 함 — 페르소나 버킷 하나가 *하나의 row* 로 통째 발행. `< MIN` 인 버킷은 drop. 결과 row 는 항상 같은 페르소나
- [src/components/FeedContent.tsx](../src/components/FeedContent.tsx) — `FEED_LAYOUT_VERSION` v1.4_carousel, `DISCOVERY_BLOCKS_MAX` 4 → 24, 새 상수 `FEED_PAGE_SIZE = 60` (모든 fetch + loadMore 통일). `fetchRecProfiles` 가 likes_based + follow_graph 외에 `expand` lane 까지 호출 (limit 30 each), strong/weak 분류 후 strong 우선·weak 폴백 (초기 플랫폼에서 mutual=0 인 후보도 cluster_min 통과하도록). 비-artist 페르소나는 `listPublicArtworksForProfile` 호출 자체를 skip 하고 `artworks: []` 로 통과 — v1.3 빌더 의도와 데이터 단계 정렬. sentinel rootMargin 400 → 800 (캐러셀 row 가 viewport 를 길게 차지해도 미리 trigger)
- [src/lib/i18n/messages.ts](../src/lib/i18n/messages.ts) — KR/EN 새 키 2개: `feed.carouselPrev` ("이전 / Previous"), `feed.carouselNext` ("다음 / Next") (캐러셀 화살표 aria-label 용)
- [tests/feed-living-salon.test.ts](../tests/feed-living-salon.test.ts) — chunk 회귀 케이스 갱신: "5 curators → 3+2 분할" → "5 curators → 단일 row(5)". 새 floor 케이스: 1명 curator drop / 1명 gallerist drop / 페르소나별 row 분리 (gallerist+collector 2명씩 → 두 row). cluster_min 통과한 모든 row 에 `profiles.length >= 2` assertion 추가

### 변경 없음 (의도)

- 데이터 페치 layer (`listPublicArtworks`, `getPeopleRecommendations` 등) 의 RPC contract — 호출 limit 만 상향
- RLS, cursor 발행 로직, like/follow 행동
- artist_world strip — 단일 프로필 + thumbs 형태가 워낙 잘 작동해서 그대로 둠

### 디자인 결정

- **카드 너비 260-280px**: LinkedIn 의 People recommendation 폭과 거의 일치. 모바일에선 한 카드가 viewport 의 ~70% 차지 → 다음 카드의 일부가 보여 스와이프 어포던스 자연스럽게 노출
- **`snap-mandatory` over `proximity`**: 살롱 톤에 맞게 카드를 또박또박 정렬. proximity 는 자유롭지만 격조가 떨어짐
- **lg+ 화살표만, 모바일은 네이티브 스와이프**: 데스크톱은 마우스가 horizontal scroll 어색 → 화살표 필요. 터치는 화살표가 노이즈
- **`PEOPLE_CLUSTER_MIN = 2`**: 1명 row 가 가장 큰 시각 노이즈. 2명부터는 카드가 옆에 한 장 더 있어 *최소한의 활성도* 보임. 3명 이상은 카드 잘림으로 "더 있다" 어포던스
- **`expand` lane 추가**: strong 게이트(mutual ≥2)만으론 초기 플랫폼에서 cluster_min 못 채움. expand lane 은 일반 추천 풀이라 weak 후보 백업
- **rootMargin 400 → 800**: 캐러셀 row 가 가로로 길어 sentinel 이 *늦게* viewport 에 진입. 미리 trigger 하면 사용자 체감으론 이미 다음 페이지가 준비된 채 스크롤
- **page limit 60**: 30 은 *전체 풀이 작은* 베타 환경에서 첫 fetch 가 *cursor=null* 을 받아 무한 스크롤 자체가 비활성화되는 회귀 위험. 60 은 일반 풀에선 충분히 크고, 매우 큰 풀에선 cursor 가 정상 발행

### 검증

- `npm run test:feed-living-salon` — 기존 + v1.4 회귀 통과
- `npx tsc --noEmit` — 0 errors
- `npm run build` — success

### Verified

- 결정론 테스트 통과 (cluster_min 게이트, 페르소나 분리 row, chunk 제거)
- 타입 체크 통과
- 빌드 통과

### 후속 (별도 패치 후보)

- 작가 본인 작품 디테일 페이지에서 `size_unit` 보완 CTA — 데이터 정정 흐름
- 카드 카드 너비 / 카드 안 작품 미니썸 (Behance 스타일) 노출 여부 검토 — 정보 풍부함 vs salon 톤 균형

---

## 2026-04-30 — 오늘의 살롱 v1.3 (Clustered People + Size Tag)

v1.2 의 letterbox-free + 페르소나 분기 위에서, 사람 추천을 클러스터화하고 작품 위에 사이즈 라벨을 얹는 두 축의 패치. layout_version 은 `living_salon_v1.1_editorial` → `living_salon_v1.3_clustered` 로 격상 (mix·first paint 분리 비교용).

### 사용자 합의

- 비-artist 페르소나(curator/gallerist/collector)를 *3-카드 클러스터 row* 로 묶어 노출 — LinkedIn 의 "Jobs recommended for you" 패턴. 카드 안 아바타 + 이름 + role chip + reason 한 줄 + Follow per card. artist 페르소나는 기존 큰 strip(작품 inline thumbs 4) 유지
- 작품 사이즈를 썸네일 우상단에 *흰 α80% backdrop-blur pill* 로 항상 노출 — 작품 사이즈가 정보 매몰 안 되도록. 호수 prefix 떼고 base 만 (`90.9 × 72.7 cm`). 한·영 자동 변환 (`formatSizeForLocale`). mini 변형(strip thumb) 제외

### Supabase SQL — 돌려야 할 것 없음

UI/표현 + 결정론 빌더 분기만 손댐.

### 환경 변수 — 변경 없음

### 수정 파일

- [src/lib/feed/livingSalon.ts](../src/lib/feed/livingSalon.ts) — `LivingSalonItem` 에 새 kind `people_cluster` (`persona: LivingSalonClusterPersona`, `profiles: PeopleRec[]`) 추가. `artist_world` 의 `persona` 는 항상 `"artist"` 로 좁힘. 새 export `LivingSalonClusterPersona`, `buildPeopleClusters()`. `filterDiscovery` 를 `filterArtistDiscovery` 로 분리 (artist 페르소나만 통과 + `>= 2` artworks 게이트), 비-artist 는 `buildPeopleClusters` 가 페르소나별 버킷 + 3-chunk 로 분리. 빌더 메인 루프에 `takePeopleCluster()` 분기 (artist_world 우선, 큐 비면 cluster 폴백, 같은 `tilesSinceArtistWorld` 게이트 공유). `summarizeLivingSalonMix` 반환에 `people_clusters` 카운트 추가. `summarizeFirstView` 가 cluster 도 context 로 카운트
- [src/components/feed/PeopleClusterStrip.tsx](../src/components/feed/PeopleClusterStrip.tsx) — 신설. 페르소나별 헤더 (uppercase tracking 라벨) + `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` 카드 grid. 카드: `rounded-2xl border bg-white p-5`, 아바타 h-12 + 이름 (semibold) + handle/role chip + reason `line-clamp-2` + 카드 하단 full-width `<FollowButton>` (메시지 초안 모달 동작 그대로 재사용). 카드 본문 클릭 → `/u/${username}`, Follow 영역 click isolation
- [src/components/feed/ArtistWorldStrip.tsx](../src/components/feed/ArtistWorldStrip.tsx) — `persona` prop 제거, artist-only 로 단순화. 비-artist 분기 코드 일체 삭제. 라벨은 항상 `feed.artistWorldLabel`, 액션은 `feed.viewArtist`
- [src/components/feed/LivingSalonGrid.tsx](../src/components/feed/LivingSalonGrid.tsx) — `people_cluster` 매핑 추가 (전폭 `col-span-2 md:col-span-3 lg:col-span-4`). `ArtistWorldStrip` 에 `persona` prop 더 이상 전달 X
- [src/components/FeedArtworkCard.tsx](../src/components/FeedArtworkCard.tsx) — 우상단 absolute pill: `bg-white/80 px-2 py-0.5 text-[10px] font-medium tracking-tight text-zinc-700 shadow-sm backdrop-blur-sm`. `formatSizeForLocale(artwork.size, locale, artwork.size_unit)` 호출, 새 헬퍼 `extractSizeBase()` 가 호수 prefix(`30F · `, `약 30F · `, `~30F · `) 떼기. mini 변형 제외 + 파싱 실패/null 일 땐 미렌더 (조용히 숨김). like 어포던스(우하단)와 시각 충돌 0
- [src/components/FeedContent.tsx](../src/components/FeedContent.tsx) — `FEED_LAYOUT_VERSION` `living_salon_v1.1_editorial` → `living_salon_v1.3_clustered`. `item_mix` 에 `people_clusters` 카운트 추가
- [src/lib/i18n/messages.ts](../src/lib/i18n/messages.ts) — KR/EN 새 키 3개: `feed.curatorClusterHeader` ("큐레이터 추천 / Curators to meet"), `feed.galleristClusterHeader` ("갤러리스트 추천 / Galleries to know"), `feed.collectorClusterHeader` ("컬렉터 추천 / Collectors to follow"). 미사용 키 4개 제거: `feed.curatorMeetLabel`, `feed.galleristRoomLabel`, `feed.collectorEyeLabel`, `feed.viewProfile` (v1.2 단독 strip 라벨 → cluster 헤더로 이동, 카드 자체가 클릭 영역이라 viewProfile 불필요)
- [tests/feed-living-salon.test.ts](../tests/feed-living-salon.test.ts) — `summarizeLivingSalonMix` 새 키 반영, back-to-back 게이트가 cluster 도 context 로 보도록 갱신. v1.2 의 "curator with 0 artworks → artist_world" 케이스를 "→ people_cluster" 로 갱신, 동일하게 gallerist+collector 케이스도 cluster 로. 새 케이스 4개: 5명 curator → cluster(3) + cluster(2) 분할 / cluster persona 는 절대 "artist" 가 아님 / cluster·artist_world back-to-back 방지 / gallerist 1명도 단일 cluster 발행

### 변경 없음 (의도)

- 데이터 페치, RLS, cursor, TTL refresh, IntersectionObserver, like/follow 행동 — 일체 무변경
- `<FeedExhibitionCard>` 톤 (현 전시 strip) — 사용자가 "전시 섹션은 지금 방식 좋다" 명시
- 빌더 결정론 — same input → same output 그대로

### 디자인 결정

- **Cluster header** 는 strip 라벨처럼 `text-[11px] uppercase tracking-[0.18em] zinc-500` (그리드의 다른 strip 헤더와 톤 일관). 컨테이너는 `border-y border-zinc-100 py-8` 로 다른 strip 과 시각 리듬 동일
- **Card border** 는 `rounded-2xl border-zinc-200` — strip 의 hairless 톤 안에서 카드 *내부* 만 살짝 박스를 둠으로써 cluster 가 strip 보다 한 단계 쪼개진 단위로 읽히도록. 카드 hover 는 `bg-zinc-50/40` (zinc-50 보다 더 옅게)
- **Persona 라벨 카피**: "큐레이터 추천 / Curators to meet" — 추천(추천 시스템)이라는 의도를 명시하면서도, 영문은 "to meet/know/follow" 로 살롱 톤 유지
- **Size pill 위치**: 우상단 (좌상단은 작가 아바타나 라벨이 들어올 잠재 슬롯, like 어포던스는 우하단). 항상 visible — hover 토글 시 모바일 발견 어려움
- **호수 prefix 제거**: `30F · 90.9 × 72.7 cm` → `90.9 × 72.7 cm`. 호수는 한국 화가들 사이 영업 단위라, 일반 컬렉터/큐레이터에게는 인지 부하. base 만 보여주고 호수는 작품 디테일 페이지에서 노출
- **Pill bg α80%**: 100% 흰색 pill 은 작품 위에 떠 있는 스티커처럼 boxy. 80% + backdrop-blur 가 "유리 라벨" 톤 — 작품 색조에 살짝 녹아드는 인상

### 검증

- `npm run test:feed-living-salon` — 새 케이스 + 기존 회귀 통과
- `npx tsc --noEmit` — 0 errors
- `npm run build` — success

### Verified

- 결정론 테스트 통과
- 타입 체크 통과
- 빌드 통과
- people cluster 게이트 (5명 → 3+2 분할, 1명 → 단일 cluster, persona 일관, back-to-back 방지) 모두 통과

---

## 2026-04-30 — 오늘의 살롱 v1.2 (Letterbox-free + Persona-aware)

v1.1 의 editorial spotlight 그리드 위에서 미감/로직 두 측면을 한 단계 더 끌어올림. 같은 날 두 번째 패치라 layout_version 은 그대로 v1.1_editorial 유지 (mix·first paint 비교 키 불변), 빌더 결정론은 그대로.

### 사용자 합의

- 작품 letterbox(회색 fill-in) 제거 — 작품 옆 균일한 회색 띠가 가장 큰 시각 노이즈
- 사람 소개 strip 컴팩트화 (LinkedIn-style, 사용자가 D2 선택) + 페르소나 분기
- 전시 노출 게이트 (cover_image_paths 가 2개 이상일 때만)
- 전시·작가 strip 의 썸네일 사이즈를 *현재의 절반* 으로 축소 — 한눈에 느낌은 보이되 호기심 hook
- 헤더 hairline 제거, focus ring 절제

### Supabase SQL — 돌려야 할 것 없음

UI/표현 + 결정론 빌더 입력 필터만 손댐.

### 환경 변수 — 변경 없음

### 수정 파일

- [src/lib/feed/livingSalon.ts](../src/lib/feed/livingSalon.ts) — `LivingSalonItem.artist_world` 에 `persona: "artist" | "curator" | "gallerist" | "collector"` 필드 추가. 새 export `LivingSalonPersona`, `LIVING_SALON_PERSONAS`, `parsePersona()`. `filterDiscovery` 가 `main_role` 을 4종 중 하나로 정규화 못 하면 drop, artist 만 `>= 2` artworks 게이트, 비-artist 는 0 artworks 도 통과 (텍스트-only). `collectExhibitions` 가 `cover_image_paths.length >= 2` 게이트 (`EXHIBITION_MIN_COVERS = 2`). `takeArtistWorld` 는 artist 페르소나만 `slice(0, 4)` 썸네일 전달, 비-artist 는 빈 배열
- [src/components/feed/ArtistWorldStrip.tsx](../src/components/feed/ArtistWorldStrip.tsx) — 새 prop `persona`. 2단 row 레이아웃 (`flex-col gap-6 sm:flex-row sm:gap-10`): 좌측 인물 정보 (아바타 h-10, 페르소나 라벨, 이름, role chip, reason 한 줄, "작가 보기 / 프로필 보기" 텍스트 액션 + Follow). 우측은 `persona === "artist"` 일 때만 inline thumbs 4개 (`grid-cols-4`, `sm:max-w-[44%]`, `aspect-square`, 사이즈 ~80-100px) — 비-artist 는 우측 자체 미렌더. 페르소나 라벨 i18n 분기 (`PERSONA_LABEL_KEY`)
- [src/components/feed/ExhibitionMemoryStrip.tsx](../src/components/feed/ExhibitionMemoryStrip.tsx) — 2단 row 레이아웃: 좌측 메타 + "전시 보기 →" 텍스트 액션, 우측 동적 썸네일 grid (`cover.length === 2 ? grid-cols-2 : grid-cols-3`, `sm:max-w-[44%]`, 각 thumb 사이즈 ~140-180px). 카드 박스 흔적 0 (이미 무경계, hairline divider 만)
- [src/components/FeedArtworkCard.tsx](../src/components/FeedArtworkCard.tsx) — 이미지 컨테이너 배경 제거 (`bg-zinc-50`/`bg-zinc-100` → 빈 컨테이너 + 페이지 white 가 비치도록). focus ring `ring-2 ring-zinc-400` → `ring-1 ring-zinc-300 ring-offset-2 ring-offset-white`
- [src/components/feed/FeedHeader.tsx](../src/components/feed/FeedHeader.tsx) — `border-b border-zinc-100 pb-5` 제거 → `mb-12` 큰 여백으로만 그리드와 분리 (다른 메인 페이지들도 동일하게 hairline-less 톤)
- [src/components/feed/LivingSalonGrid.tsx](../src/components/feed/LivingSalonGrid.tsx) — `<ArtistWorldStrip>` 호출 시 `persona={item.persona}` 전달 한 줄만 추가
- [src/lib/i18n/messages.ts](../src/lib/i18n/messages.ts) — KR/EN 새 키 4개: `feed.curatorMeetLabel` ("큐레이터를 만나보세요 / A curator to meet"), `feed.galleristRoomLabel` ("갤러리스트를 소개합니다 / A gallerist's room"), `feed.collectorEyeLabel` ("컬렉터의 시선 / A collector's eye"), `feed.viewProfile` ("프로필 보기 / View profile"). 기존 `feed.artistWorldLabel` 영문 카피만 `Artist world → Artist's world` 로 살짝 다듬음
- [tests/feed-living-salon.test.ts](../tests/feed-living-salon.test.ts) — `makeProfile` 디폴트 `main_role` 을 `"artist"` 로, `makeExhibition` 디폴트 `cover_image_paths` 를 `["cover-a", "cover-b"]` 로 (기존 테스트들이 새 게이트로 의도치 않게 drop 되지 않도록). 새 케이스 8개 추가: persona=null drop / persona=writer drop / curator with 0 artworks 통과 / gallerist+collector 통과 / artist 1 artwork 회귀 drop / artist 6 artworks → 4 thumbs / 전시 0 covers drop / 전시 1 cover drop / 전시 2+ covers 통과

### 변경 없음 (의도)

- [src/components/FeedContent.tsx](../src/components/FeedContent.tsx) — `layout_version` 키 그대로 v1.1_editorial. 같은 editorial 톤 안에서 quality refinement 라 분리 비교 가치 적음
- [src/app/feed/FeedClient.tsx](../src/app/feed/FeedClient.tsx) — 진입 그대로
- 데이터 페치, RLS, cursor, TTL refresh, IntersectionObserver, like/follow 행동 — 일체 무변경

### 디자인 결정

- **Letterbox = 0**: matte 회색 띠가 작품 옆에 균일하게 깔리던 패턴 제거. 작품 자기 비율로 페이지 white 위에 떠 있는 매거진 톤. 다크 작품일 때 끝선이 약간 약하지만 살롱 정신에 부합
- **Persona-aware 표면**: 큐레이터/갤러리스트/컬렉터를 "작가의 세계" 라벨로 잘못 노출하던 버그 해소. main_role 이 4종 중 아니거나 null 인 사용자는 피드 표면에서 자동 drop. `/people` 등 다른 페이지 동작에는 영향 0 (피드 표면만 게이트)
- **Discovery hook**: 사람·전시 strip 의 썸네일을 현재의 절반으로 줄여 *전체 그림은 보이되, 큰 사이즈로 보고 싶어 클릭하게* 만드는 hook. 두 strip 이 동일한 컴팩트 톤으로 통일
- **Exhibition gate (>= 2 covers)**: cover 1개·0개 전시는 입구에서 drop. 빌더 결정론 안에서 처리해 그리드에 빈 슬롯이 절대 도달하지 않음

### Verified

- `npm run test:feed-living-salon` — 새 케이스 8개 포함 모두 ok
- `npx tsc --noEmit` — 0 errors
- `npm run build` — success
- 우리가 수정한 파일 8개 lint clean

### 권장 수동 QA

- 페르소나 4종 노출 분기: artist (썸네일 4개 + 작가 보기) / curator / gallerist / collector (텍스트-only + 프로필 보기)
- main_role 이 null 또는 4종 외 (writer 등) 인 추천 프로필이 피드에서 보이지 않는지
- 전시: cover 1개 또는 0개 전시는 절대 노출되지 않는지. cover 2개면 grid-cols-2, 3개면 grid-cols-3 으로 그려지는지
- 작품 카드: letterbox 회색 제거된 후 다크 작품 / 라이트 작품 모두 자연스러운지
- 4 viewport (375 / 768 / 1024 / 1440) × 한·영 토글
- 다른 메인 페이지 (`/people`, `/upload`, `/my`) 이동 시 헤더 톤 위화감 0

---

## 2026-04-30 — 오늘의 살롱 (Living Salon Feed v1.1 Editorial Spotlight)

`/feed` 의 비주얼 정체성을 한 단계 더 살롱화. v1 (4월 29일) 의 12/6/2 그리드와 카드 박스 톤이 *밀도와 미감* 양쪽에서 부족했던 점을 고쳐, "옵션 C — Editorial Hybrid with Spotlight" 로 재설계. 데이터 척추, 결정론 빌더, 분석 이벤트 이름은 모두 그대로.

### 사용자 합의

- 헤더 카피: `오늘의 Abstract / Today on Abstract` → `오늘의 살롱 / Today's Salon` (로고 옆에 "Abstract" 가 두 번 등장하던 시각 노이즈 해소; 사용자가 미국에서 운영하는 살롱(더그린) 정신을 표면화)
- 그리드: 옵션 C (4-up + 2x2 spotlight + dense flow) 채택
- 톤: 다른 메인 페이지 (`/people`, `/upload`, `/my/*`, `/invites/*`, `/room/[token]`) 와 폰트·사이즈·여백 위화감 0 이 절대조건

### Supabase SQL — 돌려야 할 것 없음

UI/표현 레이어만 손댐. 마이그레이션 0건.

### 환경 변수 — 변경 없음

### 수정 파일

- [src/components/feed/LivingSalonGrid.tsx](../src/components/feed/LivingSalonGrid.tsx) — 12/6/2 col → **2/3/4 col + `[grid-auto-flow:dense]`** 로 재설계. anchor 는 `lg+` 에서만 `col-span-2 row-span-2` spotlight 로 발현, 모바일/태블릿은 standard 폴백. gap `gap-4 lg:gap-5` → `gap-x-6 gap-y-10` (24/40px) 로 매거진 호흡. context strip 들은 전폭 (`col-span-2 md:col-span-3 lg:col-span-4`)
- [src/components/FeedArtworkCard.tsx](../src/components/FeedArtworkCard.tsx) — **무경계화**: `border / rounded-xl / bg-white` 제거. 이미지 아래 텍스트만. 메타 3-라인 (작가 `text-sm font-medium zinc-900` / 제목 `text-sm font-normal zinc-700` / 보조 `text-xs zinc-500 tracking-tight`). aspect: standard `aspect-[4/5]` (매거진 portrait), anchor/spotlight `aspect-square`. hover scale `1.02 → 1.01`. **`showPrice` prop 완전 제거** — 가격은 작품 상세에서만. 작가 본인 chip / edit / LikeButton 어포던스는 `lg+` 에서 hover/focus-only (`opacity-0 group-hover:opacity-100`) 로 격하해 살롱 spread 가 조용히 유지되게 함. anchor `sizes` 는 `(max-width: 1024px) 50vw, 600px` 로 정정해 데스크톱 화소 안전
- [src/components/feed/FeedHeader.tsx](../src/components/feed/FeedHeader.tsx) — H1 `sm:text-2xl` 제거 → `text-xl font-semibold tracking-tight text-zinc-900` 단일 (다른 메인 페이지 H1 과 정확히 동일). 헤더 하단에 `border-b border-zinc-100 pb-5` hairline 한 줄로 그리드와 호흡 분리. 토글/sort 텍스트는 `tracking-tight` 통일. Refresh 라벨은 `sm` 미만에서 숨겨 아이콘만, `sm+` 에서 라벨 노출
- [src/components/feed/ArtistWorldStrip.tsx](../src/components/feed/ArtistWorldStrip.tsx) — 카드 박스 (`overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50/60`) 제거 → `border-y border-zinc-100 py-8` hairline 만. 라벨 tracking `0.08em → 0.18em`, 이유 라인 `text-xs → text-sm leading-relaxed`. "작가 보기" 액션을 pill 버튼에서 `text-sm font-medium underline-offset-4` 텍스트 액션으로 변경
- [src/components/feed/ExhibitionMemoryStrip.tsx](../src/components/feed/ExhibitionMemoryStrip.tsx) — 같은 패턴: 카드 박스 제거 → `border-y border-zinc-100 py-8`. "전시 보기" 도 텍스트 액션. 안 썸네일 frame 제거 (`rounded-md` 삭제), `bg-zinc-50` 만 남김
- [src/components/FeedContent.tsx](../src/components/FeedContent.tsx) — `FEED_LAYOUT_VERSION` `living_salon_v1 → living_salon_v1.1_editorial` 격상 (이전 v1 과 mix·first paint 분리 비교 가능). `SalonSkeleton` 도 새 그리드 톤 (2x2 spotlight 자리 + 4:5 portrait + 무경계 `bg-zinc-100` blocks) 으로 재작성
- [src/lib/i18n/messages.ts](../src/lib/i18n/messages.ts) — `feed.todayTitle`/`feed.todaySubtitle` 카피 교체 (한·영). 사용처 0 인 `feed.saveQuiet` / `feed.inquireQuiet` 키 제거 (가격 라벨 미노출 정책)

### 변경 없음 (의도)

- [src/lib/feed/livingSalon.ts](../src/lib/feed/livingSalon.ts) 빌더 / [src/lib/feed/types.ts](../src/lib/feed/types.ts) — anchor variant 가 spotlight 매핑의 입력. 빌더 결정론 그대로
- [tests/feed-living-salon.test.ts](../tests/feed-living-salon.test.ts) — 빌더 변경 0 → 기존 결정론 테스트 그대로 통과
- 데이터 페치, RLS, cursor, TTL refresh, IntersectionObserver, like/follow 행동, `setArtworkBack` flow

### 디자인 결정 (다른 페이지 톤과 위화감 0)

- **Typography 시스템 단일 유지**: Geist Sans + Hangul fallback. serif 도입 X (한글 짝맞춤·페이지 일관성 동시 보호). 살롱 톤은 weight·tracking·여백으로 표현
- **H1 사이즈 통일**: 모든 메인 페이지 (`/people` `PeopleClient`, `/upload`, `/my/*`, `/invites/*`, `/room/[token]`) 와 동일한 `text-xl font-semibold tracking-tight`
- **카드 무경계**: 매거진처럼 이미지가 자기 비율로 호흡, 메타는 이미지 아래 텍스트로 만 존재. border / shadow / bg 0
- **가격 완전 숨김**: 피드는 *작품·작가·전시* 만 보여주고, 가격은 상세에서. 살롱 정신: 거래 layer 가 첫 표면에 노출되지 않게
- **Spotlight breakpoint**: `lg(≥1024)` 에서만 `col-span-2 row-span-2`. 모바일/태블릿은 절대 full-viewport hero 가 되지 않도록 standard 폴백
- **Dense auto-flow**: spotlight 옆 빈 슬롯이 후속 standard tile 로 채워져 매거진 spread 와 동일한 시각 밀도

### Verified

- `npm run test:feed-living-salon` — `feed-living-salon.test.ts: ok`
- `npx tsc --noEmit` — 0 errors (잔존 stale `routes.d 3.ts` macOS 복사본 1건 정리)
- `npm run build` — success
- 우리가 수정한 7개 파일 lint clean (전역 lint 의 잔존 issue 들은 모두 useT.ts / artworks.ts 등 *기존* 파일의 pre-existing — 본 패치와 무관)

### 권장 수동 QA

- 4 viewport (375 / 768 / 1024 / 1440) × 4 URL (`/feed?tab=all&sort=latest`, `tab=all&sort=popular`, `tab=following&sort=latest`, `tab=following&sort=popular`) × 한·영
- spotlight 작동: 1024 이상에서만 한 자리에 2x2 spotlight, 그 옆 standard tile 들이 dense flow 로 채워지는지
- 카드 무경계: 메타 3-라인 (artist / title / year·medium) 항상 가시, 이전 패치의 metadata clipping 재발 없음
- chip / edit / Like 어포던스: 모바일/태블릿에서 *보이지 않음*, lg+ 에서는 *hover 시에만* 등장
- 다른 메인 페이지 (`/people`, `/upload`, `/my`, `/invites/*`) 로 이동 시 헤더 H1 사이즈·hairline 톤·여백이 같은 시스템 안에 있는지 시각 점검
- 이전 patch 의 결정론 / 사생활 가드 / like/follow isolation / 무한 스크롤 / 90s TTL refresh 회귀 0

---

## 2026-04-29 — Living Salon Feed v1 (피드 페이지 업그레이드 패치)

`/feed` 의 비주얼·제품 정체성을 "Living Salon" 으로 업그레이드. 데이터 척추 (RLS / cursor / infinite scroll / TTL refresh / analytics) 는 전부 그대로 두고 그 위에 결정론적 리듬 빌더 + 살롱 그리드 + 카드 변형 + 작가의 세계 / 전시의 기억 strip + 브랜디드 헤더를 얹음.

### Supabase SQL — 돌려야 할 것 없음

이번 패치는 UI/제품 표현 레이어만 손댐. 마이그레이션 0건.

### 환경 변수 — 변경 없음

### 새 파일

- `src/lib/feed/types.ts` — `FeedEntry`, `DiscoveryDatum` (FeedContent 와 livingSalon 공용 어휘)
- `src/lib/feed/visibility.ts` — `isPublicSurfaceVisible` 를 supabase client 사이드이펙트와 분리해서 순수/테스트 가능 경로로 빼냄. `src/lib/supabase/artworks.ts` 가 이걸 import & re-export
- `src/lib/feed/livingSalon.ts` — `buildLivingSalonItems` 결정론 리듬 빌더 + `summarizeLivingSalonMix` / `summarizeFirstView` 분석용 헬퍼
- `src/components/feed/FeedHeader.tsx` — "오늘의 Abstract" 카피 + Primary `[추천] [팔로잉]` pill 토글 + Secondary `[새 작품] [반응 좋은 작품]` sort + quiet refresh
- `src/components/feed/LivingSalonGrid.tsx` — 12/6/2 col CSS grid 렌더러. anchor `max-h-[55vh]` 로 hero dominance 차단
- `src/components/feed/ArtistWorldStrip.tsx` — 작가의 세계 strip (구 `FeedDiscoveryBlock` 대체). dashed border 제거, 작은 아바타, `discoveryMini` 썸네일 3개, [작가 보기] + FollowButton
- `src/components/feed/ExhibitionMemoryStrip.tsx` — 전시의 기억 strip (구 `FeedExhibitionCard` 대체). dashed 제거, thumb 3개. 커버 없으면 텍스트-forward fallback
- `tests/feed-living-salon.test.ts` — 결정론 / dedupe / 첫 아이템 비-context / artist-world 최소 게이트 / sparse / 키 unique / no back-to-back context / same-artist run softening / 비공계 orphan 필터 / anchor 배치 / mix summary

### 수정 파일

- `src/components/FeedArtworkCard.tsx` — `variant: feedTile | feedAnchor | discoveryMini` 도입. 가격 기본 숨김, `pricing_mode === "inquire"` 일 때만 quiet `문의 가능 / Inquire` 라벨. role chip 은 데스크톱 + opt-in. 모바일 vertical text/role-chip collapse 전부 차단 (`truncate` + `whitespace-nowrap` + `sm:` 게이트). edit 어포던스는 데스크톱 owner 전용
- `src/components/FeedContent.tsx` — `buildLivingSalonItems` + `<LivingSalonGrid>` 사용. refresh 버튼은 헤더로 이동. skeleton 을 살롱 리듬 (4 artwork + 1 strip + 4 artwork) 으로 교체. raw `String(error)` 제거 → `t("feed.errorTitle")` + retry. analytics payload 에 `layout_version: "living_salon_v1"` + `item_mix` + `first_view_estimate` 추가. `feed_loaded` / `feed_load_more` / `feed_first_paint` 모두 새 페이로드 채움
- `src/app/feed/FeedClient.tsx` — slim down: `<FeedHeader>` + `<FeedContent>` 만 wrap. `max-w-[1200px]` 로 12-col 호흡 확보. 기존 query 시맨틱 (`tab=all|following`, `sort=latest|popular`) 그대로
- `src/lib/i18n/messages.ts` — KR/EN 새 키 16개 (`feed.todayTitle`, `feed.todaySubtitle`, `feed.tabRecommended`, `feed.tabFollowing`, `feed.sortNewWorks`, `feed.sortResonating`, `feed.refreshQuiet`, `feed.refreshing`, `feed.caughtUp`, `feed.artistWorldLabel`, `feed.exhibitionMemoryLabel`, `feed.viewArtist`, `feed.viewExhibition`, `feed.saveQuiet`, `feed.inquireQuiet`, `feed.errorTitle`, `feed.errorRetry`). 하드코드 영문 `You're all caught up` 제거
- `src/lib/supabase/artworks.ts` — `isPublicSurfaceVisible` 를 새 모듈에서 import 후 re-export (호환성 유지). 호출자 변경 없음
- `package.json` — `npm run test:feed-living-salon` 스크립트 추가

### 삭제 파일

- `src/components/FeedDiscoveryBlock.tsx`
- `src/components/FeedExhibitionCard.tsx`

(둘 다 grep 으로 사용처 0 확인 후 제거. 새 strip 컴포넌트들이 콘셉트를 계승.)

### 보존된 동작 (척추)

- `tab=all|following` / `sort=latest|popular` 쿼리 시맨틱
- keyset cursor 페이지네이션 (artwork + exhibition 양쪽)
- 90s TTL background refresh + `pathname?.startsWith("/feed")` re-entry / focus / visibility refresh
- IntersectionObserver 무한 스크롤 (`rootMargin: 400px`)
- private-artist orphan 가드 (`isPublicSurfaceVisible`) — 빌더 입구에서 한 번 더 통과해 방어선 이중화
- like / follow 클릭 isolation
- `setArtworkBack(pathname)` → detail → back 흐름
- `feed_loaded` / `feed_load_more` / `feed_first_paint` 분석 이벤트 (페이로드만 확장, 이름 추가 X)

### 디자인 결정 (Work Order 충실)

- **Hero 도미넌트 금지**: anchor artwork 도 `col-span-6` + `max-h-[55vh]`. 첫 viewport 에 다른 작품/모듈이 같이 보이도록 grid 가 강제
- **이미지 contain**: matte `bg-zinc-100` + `object-contain`. 작품 비율 보존, 임의 crop 없음
- **가격 de-emphasis**: 기본 가격 숨김. `inquire` 모드만 quiet `문의 가능` 라벨로 표시. 가격이 피드를 끌고 가지 않음
- **컨텍스트 strip**: dashed border / `bg-zinc-50/80` 제거. `bg-zinc-50/60 border-zinc-200` 로 통일
- **모바일 vertical collapse 차단**: 카드 메타 라인 모두 `truncate` + role chip 은 `sm:` 이상에서만 표시
- **결정론 리듬**: 빌더는 random 없음 → 동일 입력 = 동일 출력. QA 스크린샷 재현 가능
- **AI 미사용**: 런타임 LLM 호출 없음. 추천 reason 은 기존 `reasonTagToI18n` 결정론 매핑

### Verified

- `npm run lint` — 우리 패치 파일들 모두 clean. 기타 잔존 lint 에러 (`set-state-in-effect` 등) 는 패치 이전부터 존재, 무관
- `npm run build` — pass (Next 16.1.6 / Turbopack)
- `npm run test:feed-living-salon` — pass (12 케이스)
- `npm run test:website-import` — pass
- `npm run test:onboarding-runtime` — pass
- `npm run test:onboarding-smoke` — pre-existing failure (signup-first onboarding routing). 이번 패치와 무관
- `npm run test:ai-safety` — pre-existing failures (IntroMessageAssist auto-fire, hardcoded locale). 이번 패치와 무관

### 수동 QA 권장 (베타 풀 패스)

- `/feed?tab=all&sort=latest` / `popular` / `tab=following&sort=latest` / `popular` 4종 조합 모두 첫 viewport 에 anchor 1개 + 다른 작품/strip 같이 보이는지
- viewport 4종 (390×844 / 768×1024 / 1440×900 / 1920×1080) 에서 카드 vertical text collapse / role chip 세로 핍 / 가격 도미넌스 0
- 비공계 작가 작품이 피드에 새지 않는지 — 빌더 입구 + RLS 이중 가드
- 작품 클릭 → detail → back 흐름이 끊기지 않는지
- like / follow 버튼이 카드 클릭과 충돌 없이 isolation 되는지
- 무한 스크롤 + manual refresh + focus / visibility refresh 모두 정상
- 한↔영 토글 시 잔존 영문 0 (`You're all caught up`, `Recommended · People`, `Recommended · Exhibitions` 등 사라졌는지)

---

## 2026-04-29 — 위임 권한 풀 RLS 정렬 / 변경 요청 거부 path / 비공계 작품 피드 누락 / 영문 Back 어색한 한글 청소

세 갈래 묶음 패치. 위임 권한 변경 흐름을 깊이 감사하다 권한 풀 자체가 두 갈래로 분기되어 있는 것을 발견했고, 그 김에 비공계 노출과 UI 텍스트 통일까지 같이 정리.

### Supabase SQL — 적용 필수

`supabase/migrations/20260518000000_delegation_perm_pool_realign.sql` ← Supabase SQL Editor 에서 실행. 4개 섹션, 한 번에 실행 OK (idempotent). 토크나이저가 까다로우면 SECTION 1~4 를 차례로 실행해도 됨.

### 1. 위임 권한 풀 RLS 정렬 (CRITICAL)

**증상**: 권한 변경 요청 모달에서 받는 쪽에 *원래* 부여되지 않은 권한이 모두 raw i18n 키로 노출 (예: `delegation.permissionLabel.manage_pricing`). 또한 sender 가 UpdatePermissionsModal 로 [저장] 누르면 옛 권한이 *통째로 사라짐*.

**원인**: PR-B (`20260515000000_delegation_lifecycle_actions.sql`) 가 `update_delegation_permissions` 와 `request_delegation_permission_change` 의 화이트리스트로 7개 키를 도입:
```
view, edit_metadata, manage_works, manage_pricing,
reply_inquiries, manage_exhibitions, manage_shortlists
```
하지만 *write-side RLS* (`20260505000100_delegation_account_rls_writer.sql`) 는 *전혀 다른* 어휘를 사용:
```
view, edit_metadata, manage_works, manage_artworks,
manage_exhibitions, manage_inquiries, manage_claims,
edit_profile_public_content
```
preset (`operations`, `content` 등) 은 옛 키를 seed 하는데 PR-B 화이트리스트는 그 키들을 sanitize 단계에서 *전부 drop*. 결과:
- 받은 쪽이 가지고 있던 `manage_artworks`/`manage_inquiries`/`manage_claims`/`edit_profile_public_content` 가 sender 의 *어떤 [저장]* 만으로도 사라짐.
- 새 키 `manage_pricing`/`reply_inquiries`/`manage_shortlists` 는 RLS 가 안 보니까 toggle 해도 효력 0.

**수정**: SQL whitelist 와 UI `ALL_PERMISSIONS` 를 *RLS 가 실제로 검사하는 8개* 로 통일:
- `update_delegation_permissions`, `request_delegation_permission_change` 의 화이트리스트 재정의
- `src/components/delegation/UpdatePermissionsModal.tsx`, `RequestPermissionChangeModal.tsx` 의 `ALL_PERMISSIONS` 풀 동기화
- i18n 라벨은 두 풀 모두 등록되어 있어서 그대로 유지 (호환성)

### 2. 권한 변경 요청 거부 path 신설

**증상**: 받는 쪽이 권한 변경을 요청하면 보낸 쪽은 *수락 (편집 + 저장)* 만 가능. *명시적 거부* path 가 없어 요청을 무시하면 inbox 에 영구 남음. proposed === current 케이스 (메모만 보낸 요청) 에선 `dirty=false` 로 [저장] 버튼이 disabled 라 응답 자체가 불가.

**수정**:
- 새 SQL RPC `dismiss_delegation_permission_change_request(p_delegation_id, p_message)`:
  - sender 가 호출. sender 의 같은 위임 `delegation_permission_change_requested` 알림 모두 삭제.
  - audit log 에 `permission_change_dismissed` 이벤트 추가.
  - 받은 쪽에 `delegation_permission_change_dismissed` 알림 발송. 위임 row 의 권한·상태는 그대로.
- 새 알림 type 을 `notifications_type_check` CHECK constraint 에 추가 (Section 4).
- `src/components/delegation/DelegationDetailDrawer.tsx`:
  - amber pending card 에 [검토 후 결정] / [요청 거부] 두 버튼 노출.
  - [검토 후 결정] → UpdatePermissionsModal 열기.
  - [요청 거부] → confirm 후 `dismiss_delegation_permission_change_request` 호출.
- `src/components/delegation/UpdatePermissionsModal.tsx`:
  - 새 prop `responseMode` (drawer 가 effectiveProposed 가 있을 때 true). dirty=false 여도 [저장] 가능 — 라벨이 [요청 수락 (변경 없음)] / [Acknowledge request] 로 바뀜. SQL 의 no-op 분기가 알림을 비롯한 inbox 청소를 함께 처리.
- `src/components/delegation/RequestPermissionChangeModal.tsx`:
  - RPC 가 `data.ok === false` 를 반환하면 inline 에러로 surface (silent close 방지).
- `src/lib/supabase/delegations.ts`: `dismissDelegationPermissionChangeRequest()` 헬퍼 추가.
- `src/app/notifications/page.tsx` + `src/lib/supabase/notifications.ts`:
  - `delegation_permission_change_dismissed` 타입을 NotificationType 유니온에 추가 + 카드 텍스트 + deep-link 라우팅 (`/my/delegations`).
- i18n: `delegation.detail.pendingRequestReview/Dismiss/Dismissing/dismissChangeRequestConfirm/Done` (KR/EN), `delegation.update.acknowledge` (KR/EN), `notifications.delegationPermissionChangeDismissedText` (KR/EN).

### 3. 비공계 계정 작품의 피드 노출 ("알 수 없는 사용자") 차단

**증상**: 비공계 계정에서 직접 업로드한 작품이 외부 viewer 의 피드에 *작가명 "알 수 없는 사용자"* 로 노출.

**원인 분석**: RLS (`artworks_select_public` + `is_artist_publicly_visible`) 는 PR3 (`20260513000000`) 이후 비공계 작가의 작품 SELECT 를 정확히 차단. 그러나 어떤 정책 misalignment 든 (production 미적용·중복 정책 등) row 가 외부 viewer 한테 도착하면 `profiles!artist_id` join 이 `profiles_select_*` 정책으로 먼저 차단되어 *작품 row 는 살아있고 작가 정보만 null* 인 비대칭 상태가 발생 → 클라이언트 fallback 으로 "알 수 없는 사용자" 노출.

**수정** — RLS 가 source of truth 지만, 클라이언트 측 *defensive 안전망* 으로 동일 시나리오를 사전 차단:
- `ARTWORK_SELECT` 에 `profiles!artist_id(..., is_public)` 추가.
- 새 helper `isPublicSurfaceVisible(row)` — `artist_id` 가 null 이 아닌 row 에서 `profiles` 가 누락(`null` 또는 `id` 부재)되었거나 `profiles.is_public === false` 이면 false 반환.
- public 진열 함수 (`listPublicArtworks`, `listPublicArtworksByArtistId`, `listPublicArtworksListedByProfileId`) 의 결과에 helper 적용. follower-accepted / 본인 / delegate 컨텍스트는 별도 listing helper 를 사용해 영향 없음.

### 4. UX 통일 — "← 돌아가기 X" 어색한 한글 + 영문 Back 버튼

**증상**: "← 돌아가기 개별 업로드" / "← 돌아가기 피드" 처럼 한국어가 어색. 일부 페이지에선 `Back` 영문 버튼이 그대로 노출.

**수정**:
- 새 helper `src/lib/i18n/back.ts` — `backToLabel(label, locale)`:
  - KO: `{label}` (화살표 ← 가 시각적 단서, 조사 으로/로 회피)
  - EN: `Back to {label}`
- 호출처 8곳 마이그레이션 (`notifications`, `auth/reset`, `e/[id]`, `invites/delegation`, `upload/bulk`, `my/exhibitions/{new,[id]/add,[id]/edit}`).
- `my/library/import` 페이지의 hardcoded `Back` / `Validate & Preview` 영문 버튼을 i18n 처리 (`common.back`, `library.import.validateAndPreview` KR/EN 추가).

### Verified

- `npm run build` 통과 (Next.js 16.1.6, exit 0).
- TypeScript: `delegation_permission_change_dismissed` 새 알림 타입 union 에 추가.
- 라벨 helper: `manage_artworks` 등 RLS-정렬 풀 → KR `작품 관리` / EN `Manage artworks`.
- SQL 마이그레이션 idempotent. CHECK constraint 풀이 superset 으로 확장.

---

## 2026-04-29 — 위임 권한 라벨 / 권한 변경 요청 알림·모달 정리

QA 보고 두 건을 한 묶음으로 처리.

### Supabase SQL — 적용 필수

`supabase/migrations/20260517000000_delegation_perm_change_cleanup.sql` ← Supabase SQL Editor 에서 실행. 단일 트랜잭션 두 함수 재정의(`update_delegation_permissions`, `request_delegation_permission_change`)이며 idempotent. 섹션은 두 개(`SECTION 1`, `SECTION 2`)로 나뉘어 있고, 한 번에 통째로 실행해도 OK 지만 dashboard 토크나이저가 까다로우면 섹션별로 잘라서 돌려도 됨.

### 1. `delegation.permissionLabel.manage_pricing` 같은 raw 키가 화면에 노출

**증상**: 권한 변경 요청 모달에서, 받는 쪽에 *원래* 부여되지 않은 권한이 모두 `delegation.permissionLabel.manage_pricing` 같이 i18n 키 그대로 노출.

**원인**: 서버 SQL 화이트리스트(`update_delegation_permissions`) + UI `ALL_PERMISSIONS` 풀은 7개(`view, edit_metadata, manage_works, manage_pricing, reply_inquiries, manage_exhibitions, manage_shortlists`) 인데, `src/lib/i18n/messages.ts` 에는 옛 권한 모델 잔재 키(`manage_artworks, manage_inquiries, manage_claims, edit_profile_public_content`)가 남아 있고 새 7개 풀의 `manage_pricing`/`reply_inquiries`/`manage_shortlists` 가 빠져 있었음. `useT().t()` 는 미등록 키일 때 raw 키 그대로 반환 → 그대로 노출.

**수정**:
- `src/lib/i18n/messages.ts` — KR/EN 양쪽에 누락된 3개 i18n 키 추가, 옛 4개 키는 호환성 위해 유지.
- 신규 helper `src/lib/delegation/permissionLabel.ts` — `permissionLabel(key, t)` 가 i18n 매핑 없으면 `manage_pricing → "Manage pricing"` 식 humanize fallback 적용. 이후 새 권한이 추가되어 i18n 등록을 잊어도 raw 키는 절대 화면에 안 나감.
- 모든 `t(\`delegation.permissionLabel.${p}\`)` 호출처 6곳을 helper 로 교체: `DelegationDetailDrawer`, `UpdatePermissionsModal`, `RequestPermissionChangeModal`, `CreateDelegationWizard`, `app/invites/delegation/page.tsx`.

### 2. 권한 변경 요청 알림·모달이 사라지지 않고 반복

**증상**: 받는 쪽이 권한 변경을 요청 → 보낸 쪽 알림 [권한 변경] 클릭 → 모달이 뜨고 변경 처리. 처리해도 알림 inbox 의 칩이 그대로 남고, 어느 시점부터는 모달이 닫혀도 자동으로 다시 켜짐.

**원인 (3중 leak)**:

1. `DelegationDetailDrawer` 의 `useEffect([initialAction, detail, viewerIsOwner])` 가 `setUpdateOpen(true)` 호출. 모달 닫은 뒤 detail 을 silent refetch 하면 `detail` reference 가 바뀌어 effect 재실행 → 모달 자동 재오픈. 사용자가 본 "어느 순간부터 자동으로 켜집니다" 와 정확히 일치.
2. `update_delegation_permissions` RPC 가 처리 후에도 `delegation_permission_change_requested` 알림(보낸 쪽 inbox)을 *지우지 않음*. 처리 완료 표식 부재.
3. `request_delegation_permission_change` 가 호출될 때마다 같은 위임에 대한 알림이 stack 되어 multi-row 누적 가능. deep-link 가 N번 발동 가능.

**수정**:
- 클라이언트 (`DelegationDetailDrawer.tsx`):
  - `deepLinkConsumedRef = useRef<string | null>(null)` 가드 도입 — `initialAction === "update"` 트리거는 한 위임 ID 당 1회만. drawer 가 닫히면 ref 초기화.
  - `pendingChangeRequest` 계산을 강화 — 가장 최근 `permission_change_requested` 이벤트보다 *나중* 의 `permissions_updated` 이벤트가 있으면 *resolved* 로 간주해 amber 카드/모달 prefill 모두 비활성. audit log 가 영구 기록이라도 UI 는 idle 상태로 보이게.
- SQL (`20260517000000_delegation_perm_change_cleanup.sql`):
  - **SECTION 1 — `update_delegation_permissions`**: 성공 분기(no-op 포함)에서 `delete from notifications where user_id = sender and type = 'delegation_permission_change_requested' and (payload->>'delegation_id')::uuid = v_d.id`. 처리하면 inbox 칩이 즉시 사라짐.
  - **SECTION 2 — `request_delegation_permission_change`**: 알림 insert 직전에 같은 (sender, delegation) 의 기존 `delegation_permission_change_requested` 알림 모두 삭제 → 항상 정확히 1건만 노출. 시그니처는 그대로 유지(`uuid, text, text[]`).
  - audit log 의 이벤트(`permission_change_requested`)는 그대로 보존 (history of record). 알림은 ephemeral inbox 만 정리.

### Verified

- `npm run build` 통과 (Next.js 15.5.4, exit 0).
- 라벨 helper 단독 import 시 `manage_pricing` → KR `가격 관리` / EN `Manage pricing`, 미등록 가짜 키 `foo_bar` → `Foo bar` (raw 키 노출 차단).

---

## 2026-04-29 — Signup + Visibility Hardening (위임 invite 가입 / follow_request 알림 / 비공계→공계 전환)

QA 가 같은 날 보고한 세 가지 증상이 모두 한 가지 큰 패턴 — auth 트리거와 RLS 가 *현재* 부트스트랩 시퀀스(`auth.users` insert → 클라이언트 첫 RPC 가 `profiles` row 생성)와 어긋남 — 에서 파생되는 것이라 단일 SQL 마이그레이션으로 묶어 정리.

### Supabase SQL — 적용 필수

`supabase/migrations/20260516000000_signup_and_visibility_hardening.sql` ← Supabase SQL Editor 에서 실행해 주세요.

### 1. 위임 초대 이메일로 가입 시 "Database error saving new user"

**증상**: 일반 신규 가입은 OK. 위임 초대를 받은 이메일 주소로만 가입이 실패.

**원인**: `handle_auth_user_created_link_delegations` 트리거가 `auth.users` AFTER INSERT 에 발동 → 그 안의 `update public.delegations set delegate_profile_id = new.id` 가 `delegations.delegate_profile_id REFERENCES public.profiles(id)` FK 검사를 트리거. 이 코드베이스는 profiles row 를 *클라이언트 RPC* 로 *나중에* 만들기 때문에 가입 시점에 profiles row 가 아직 없음 → FK 위반 → 트랜잭션 전체 롤백. 일반 가입은 매칭 0행이라 FK 가 안 검증돼서 통과, **invite 매칭 이메일만 실패**라는 정확한 증상.

**수정**: 트리거를 `auth.users` → `public.profiles` AFTER INSERT 로 이전. 이 시점에는 profiles row 가 막 생성된 상태라 FK 안전. email 은 `auth.users` 에서 lookup. 본문(activity event + invite 알림 발송)은 explicit-accept 정책(`20260505000200`)을 그대로 유지.

### 2. follow_request 알림 [수락]/[거절] 버튼이 안 먹는 것처럼 보임

**증상**: 비공계 계정에 도착한 follow_request 알림에서 「수락」 눌러도 승인 안 됨, 「거절」 눌러도 알림 안 사라짐.

**원인**: `accept_follow_request` / `decline_follow_request` 가 `follows` row 만 처리하고 *원본 `follow_request` 알림은 그대로 둠*. 알림 list 가 refresh 되어도 같은 row 가 다시 노출 → "처리가 안 된 듯" 한 인상. UI 도 RPC 가 throw 하지 않으면 그냥 무시했고 사용자 피드백이 없었음.

**수정**:
- 두 RPC 모두 동일 트랜잭션에서 `delete from notifications where user_id = v_uid and actor_id = p_follower and type = 'follow_request'` 추가. SECURITY DEFINER 라 notifications RLS 우회 OK.
- 클라이언트(`src/app/notifications/page.tsx` 의 `FollowRequestActions`):
  - RPC 가 `error` 를 던지면 inline 빨간 메시지(`follow.requests.actionFailed` i18n) 노출 + 버튼 재활성화.
  - `data === false` (이미 처리된 stale row) 도 성공 분기로 다뤄 inline "수락함/거절함" 으로 전환 + 부모 `refresh()`. RPC 가 알림을 지웠으니 refresh 후 자연스럽게 사라짐.

### 3. 비공계 → 공계 전환 시 알림 잔류 + 버튼 작동 불가

**증상**: 비공개 시점에 받은 follow_request 알림이 공개 전환 후에도 그대로 노출. 「수락/거절」 버튼이 사실상 무력.

**원인**: 공개 전환은 `profiles.is_public` UPDATE 만 일으키고 *기존 pending follow rows 와 알림은 그대로*. 공개 상태에서는 `request` 모델 자체가 의미를 잃지만 자동 해소가 없음.

**수정**: `handle_profile_visibility_opened` 트리거 신설 (`AFTER UPDATE OF is_public ON public.profiles`). `false → true` 전이일 때만:
1. `update follows set status='accepted' where following_id=new.id and status='pending'` — `on_follow_accept_notify` UPDATE 트리거가 알아서 follower 측엔 `follow_request_accepted`, principal 측엔 `follow` 알림 발송.
2. `delete from notifications where user_id=new.id and type='follow_request'` — 잔류 follow_request 알림 일괄 정리.

`true → false` (공개→비공개) 는 의도적으로 no-op. 이미 accepted 인 followers 를 다시 끊으면 사용자가 공유한 graph 가 silently revoke 되어 surprising. 별도 "private re-curate" surface 가 필요하면 후속 패치에서 다룬다.

### 변경 파일

- `supabase/migrations/20260516000000_signup_and_visibility_hardening.sql` (신규) — 트리거 이전 + RPC 보강 + 공개 전환 트리거. 함수 4개 (`handle_profile_created_link_delegations`, `accept_follow_request`, `decline_follow_request`, `handle_profile_visibility_opened`) 모두 named dollar-tag (`$p_link$`, `$accept$`, `$decline$`, `$vis$`) 사용 → Dashboard SQL editor 에서 BEGIN/COMMIT 없이 통째 paste 실행 가능.
- `src/app/notifications/page.tsx` — `FollowRequestActions` 강건성 개선 (에러 inline 표시, stale 처리, refresh 보장).
- `src/lib/i18n/messages.ts` — `follow.requests.actionFailed` 키 추가 (KR/EN).

### 환경 변수

변경 없음.

### Verified

- `npx tsc --noEmit` ✅
- `npm run build` ✅
- 회귀 grep: raw "Database error saving new user" 노출 0건. follow_request 액션 성공 시 알림 row 가 server-side 삭제 + 클라이언트 list 자동 refresh.

---

## 2026-04-28 — QA Regression Sweep + Private-account Follow Request UX

PR-A 마이그레이션이 절반만 끝나 있던 구·신 `formatSupabaseError` 이중 helper 와, 그 사이에 raw 백엔드 RAISE 메시지를 직접 노출하던 catch 사이트 두 곳을 정리. 비공계 프로필 진입 시 follow 요청에 메모를 첨부할 수 있는 sheet 를 People 탭과 동일한 패턴으로 추가.

### 회귀 원인

이전 패치에서 `src/lib/errors/supabase.ts`(신; `(error, t, fallbackKey)`)와 `src/lib/supabase/errors.ts`(구; `(error, fallback)`)가 공존. 절반의 호출처가 *구* helper 를 쓰고 있었고, 신 helper 의 친절 매핑이 적용되지 않아 사용자에게 raw raise 가 노출됨. 추가로 `upload/page.tsx` 의 claim 분기와 settings 의 catch 들은 어떤 helper 도 거치지 않고 `error.message` 를 그대로 setError → 사용자 화면에 다음과 같은 문자열이 노출:

- `Claim failed: forbidden: caller is not an active account delegate writer for subject_profile_id`
- `Failed to load profile`, `Failed to save changes. Please retry.`
- `Please enter a valid year (4 digits)`, `Searching...`, `Selected: …` 등 작품 수정 폼의 영문 잔재.

### 변경

#### 1. 에러 표시 일관화
- `src/lib/supabase/errors.ts`: 구 helper 를 *thin shim* 으로 재작성. 새 카탈로그(`@/lib/errors/supabase`)를 거치며 raw RAISE 매칭은 차단하고, 매칭 안 되면 caller 가 넘긴 fallback string 을 그대로 노출. 신규 코드는 `(error, t, fallbackKey)` 시그니처 사용을 권장.
- `src/lib/i18n/messages.ts`:
  - `errors.failedLoad/Save/Delete/SendInquiry/SendMessage/SendReply/RequestClaim/ConfirmClaim/RejectClaim/CreateExhibition/DeleteExhibition/CreateArtwork/AttachImage/ClaimDuringUpload/LoadArtwork/LoadProfile/SaveSettings` (KR/EN) — fallback 카탈로그 보강.
  - `artwork.validation.invalidYear/artistNameRequired/artistRequired/invalidPrice` + `artwork.field.artistSearchPlaceholder/artistSearching/artistSelected` 추가.
  - `exhibition.deletePartialFailureSuffix` 추가.
  - `profile.private.draftMessage` 추가.
- 호출처 마이그레이션 (모두 새 helper):
  - `src/app/upload/page.tsx`: `Claim failed: ${msg}` 두 곳, `[code] ${msg}` create 분기, `attachErr.message` 분기 → `formatSupabaseError(err, t, "errors.…")`.
  - `src/app/artwork/[id]/page.tsx`: 8곳 (delete/inquiry/message/resend/reply/claim request/confirm/reject) 모두 신 helper.
  - `src/app/artwork/[id]/edit/page.tsx`: load 실패 fallback + 폼 검증 4 메시지 + 「작가 검색」 영문 잔재 i18n.
  - `src/app/my/exhibitions/{[id]/add,[id]/edit,[id]/page,new}.tsx`, `src/app/my/claims/page.tsx`: import + 호출 시그니처 일괄 마이그레이션. 전시 *부분 삭제 실패* suffix 도 i18n.
  - `src/app/settings/page.tsx`: profile load + save catch 두 군데.

#### 2. 비공계 프로필 follow request 메모 통합
- `src/components/FollowButton.tsx`: 종전엔 `isPrivateTarget` 인 경우 `interceptFollow` 가 무시됐음 (비공계엔 sheet 띄우지 않는 가드). QA 피드백: 비공계 프로필에 *직접 진입한* 방문자는 메모를 함께 보낼 의도가 큼. 가드 제거 — 부모가 `interceptFollow` 를 넘기면 공/비공 모두 sheet 우선. legacy "no sheet for private" 동작은 호출처에서 `interceptFollow={undefined}` 로 그대로 유지 가능 (People 탭은 그 패턴 유지).
- `src/app/u/[username]/PrivateProfileShell.tsx` (visitor branch):
  - lazy `me = getMyProfile()` (visitor 가 sheet 열기 전엔 fetch 안 함).
  - `IntroMessageAssist` portal sheet 호스팅 + `openSignal` trigger.
  - FollowButton interceptFollow → `requestSheet()` → AI 초안 + textarea + 「요청 보내기」 / 「메시지 없이 요청」.
  - 옆에 별도 「연결 메시지 초안」 버튼 (status='none' 일 때만) — 메인 CTA 누르지 않고도 sheet 진입 가능.
  - sheet 의 send/follow-only 콜백이 로컬 status 를 `pending` 으로 flip → 새로고침 없이 "요청 보냈어요" pill 노출.

### Supabase SQL

이번 패치에서 SQL 추가/변경 없음 — 기존 `request_follow_or_follow` RPC 가 비공계 target 자동 분기를 이미 처리하고, `connection_messages` RLS 는 `sender_id = auth.uid()` 만 검증하므로 pending follow 상태에서도 메시지 동시 전송 가능.

### Verified

- `npx tsc --noEmit` ✅
- `npm run build` ✅
- 잔재 회귀 grep: `Claim failed`, `forbidden:`, `caller is not`, `Please enter`, `Searching\.\.\.`, `Selected:` 비코드/비주석 영역에서 0건.

---

## 2026-04-28 — QA Beta Hardening · PR-B · 위임 라이프사이클 보강

**배경**: QA #4/#7/#11 — 위임 라이프사이클의 누락된 분기를 채움.

- #4  보낸 사람이 (수락 전) 위임 초대를 *취소* 할 수 없음 — 받는 사람이 잠수하면 회수가 불가.
- #7  보낸 사람이 active 상태에서 *권한만* 변경할 수 없음 — 위임 통째 해지 + 새 invite 보내기 (3-step) 가 유일.
- #11 받은 사람이 active 상태에서 *본인 의지로* 위임을 끝낼 수 없음 — `decline_delegation_by_id` 는 pending 만 처리.

추가로 받은 사람이 보낸 사람에게 권한 *조정 요청* 을 보낼 수 있는 가벼운 통로 (메모 + 제안 권한) 를 도입.

### Status 매트릭스 (전후)

| 액션 | 누가 | 상태 | 이전 | 이후 |
|---|---|---|---|---|
| 초대 취소 | 보낸 측 | pending | (불가) | **「초대 취소」** drawer footer + `cancel_delegation_invite` RPC |
| 권한 변경 | 보낸 측 | active | 통째 해지 후 재초대 | **「권한 변경」** modal + `update_delegation_permissions` RPC (1-step, diff 알림) |
| 위임 해지 | 보낸 측 | active | 기존 「Revoke」 | 라벨/배치만 정리, 동작 동일 |
| 권한 변경 요청 | 받은 측 | active | (불가) | **「권한 변경 요청」** modal + `request_delegation_permission_change` RPC, 보낸 측에 deep-link 알림 |
| 위임 반려 | 받은 측 | active | (불가) | **「위임 반려」** drawer footer + `resign_delegation_by_delegate` RPC, 보낸 측에 알림 |

> 라벨 결정: 받은 측 sign-out 액션은 "위임에서 빠지기" (step out 직역) 대신 **「위임 반려」** 채택 — 보낸 측의 "위임 해지" 와 의미적으로 분리되고, "받은 것을 돌려보냄" 의 한국어 직관과 일치.

### 변경 파일

- `supabase/migrations/20260515000000_delegation_lifecycle_actions.sql` (신규):
  - `notifications_type_check` 확장 — 4종 추가
    (`delegation_invite_canceled`, `delegation_resigned`, `delegation_permissions_updated`, `delegation_permission_change_requested`).
  - 신규 RPC 4종 (모두 SECURITY DEFINER, search_path=public, authenticated grant).
  - status enum 확장은 *없음* — 트랜잭션 내 ALTER TYPE 제약 회피용으로 기존 `revoked` / `declined` 재사용 + audit `event_type` (`invite_canceled`, `permissions_updated`, `delegate_resigned`, `permission_change_requested`) 으로 의미 구분.
  - `update_delegation_permissions` 는 whitelist 기반 sanitization, before/after diff 를 audit metadata 에 저장, custom set 이 들어오면 `delegations.preset` 자동 NULL.
- `src/lib/supabase/delegations.ts`: 4개 wrapper (`cancelDelegationInvite`, `updateDelegationPermissions`, `resignDelegationByDelegate`, `requestDelegationPermissionChange`).
- `src/lib/supabase/notifications.ts`: `NotificationType` union 에 신규 4종 추가.
- `src/components/delegation/UpdatePermissionsModal.tsx` (신규): 보낸 측 active 권한 편집기. flat checkbox + diff 기반 dirty/empty 가드. 받은 측 제안값이 있으면 prefill.
- `src/components/delegation/RequestPermissionChangeModal.tsx` (신규): 받은 측이 권한 조정 요청 + 메모 (max 500자) 전송.
- `src/components/delegation/DelegationDetailDrawer.tsx`:
  - footer 가 5가지 (role × status) 분기로 재구성. 단일 「Revoke」 버튼 → 다섯 가지 액션 매트릭스.
  - `initialAction="update"` deep-link prop — 받은 측 권한 변경 요청 알림 클릭 시 보낸 측 drawer 가 자동으로 권한 편집기를 제안값 prefill 로 오픈.
  - audit events 에서 가장 최근 `permission_change_requested` 의 `metadata.proposed_permissions` / `metadata.message` 를 자동 추출. 보낸 측 active footer 에 amber 카드로 메시지 미리보기 + modal prefill.
  - 권한 변경 후 drawer 를 닫지 않고 in-place refetch → 변경된 권한 set 이 즉시 표시되고, "추가 N · 제거 M" toast.
- `src/app/my/delegations/page.tsx`: `useSearchParams` 로 `?openId=<uuid>&action=update` 자동 처리. 위임 row 가 sent 에 있으면 owner view + update modal 자동 오픈, received 에 있으면 recipient view + 수동.
- `src/app/notifications/page.tsx`: 신규 4종 type 별 텍스트, deep-link (권한 변경 요청만 detail+modal 오토오픈).
- `src/lib/i18n/messages.ts`: 약 35개 키 추가 (drawer 액션 라벨, modal copy, notification 본문 KR/EN 양쪽).

### 데이터 흐름 — 권한 변경 요청

1. 받은 사람이 drawer 에서 「권한 변경 요청」 → 제안 권한 + 메모 전송.
2. SQL: state 변화 *없음*. audit event `permission_change_requested` (metadata: 현재 권한 / 제안 권한 / 메모) + notification `delegation_permission_change_requested` 보낸 사람에게.
3. 보낸 사람 알림 텍스트: "○○님이 위임 권한 조정을 요청했어요". 클릭 → `/my/delegations?openId=<id>&action=update`.
4. drawer 가 detail 로드 → events 에서 가장 최근 요청 추출 → owner active footer 에 amber 카드 (메모 미리보기) + 자동으로 권한 편집 modal 을 제안 권한 prefill 로 오픈.
5. 보낸 사람이 그대로 「변경사항 저장」 → `update_delegation_permissions` → 받은 사람에게 `delegation_permissions_updated` 알림 (added/removed count).
6. 무시하고 modal 닫으면 별도 상태 트래킹 없이 자연 만료 — audit event 만 남음 (운영 감사 트레일 유지).

### Supabase SQL — 즉시 적용

`supabase/migrations/20260515000000_delegation_lifecycle_actions.sql` 을 SQL Editor 에서 실행. 모두 idempotent (`alter table … drop constraint if exists`, `create or replace function`).

### 환경 변수

변경 없음.

### Verified

- `npx tsc --noEmit` ✓
- `npm run build` ✓ (Next.js 프로덕션 빌드 통과)
- 신규 RPC 4종 + 알림 type 4종 일관 — UI matrix 와 SQL/audit/notification 3 layer 모두 동기.
- `update_delegation_permissions` 의 `noop` 분기 (제안 = 현재) → no-op toast, 알림 없음, 받은 사람 spam 방지.

### 회귀 안전성

- 기존 RPC (`revoke_delegation`, `accept_delegation_by_id`, `decline_delegation_by_id`, `create_delegation_invite`) unchanged.
- pending 상태 받은 사람의 accept/decline UX (목록 카드 inline 버튼) 변경 없음 — drawer 의 footer 매트릭스에서 recipient×pending 행은 의도적으로 비어 있음.
- `notifications_type_check` 는 기존 type 모두 보존하면서 4종 add-on (DROP+CREATE 패턴은 기존 마이그레이션과 동일).

---

## 2026-04-28 — QA Beta Hardening · PR-C · 비공계 위임 edge 가시성

**배경**: QA #6/#8/#9 — 비공계 계정에게 위임을 받은 사용자가 acting-as 로 작업할 때 위임자 profile 이 unknown 으로 fallback 되어 [내 스튜디오] 빈 페이지·피드 카드 "알 수 없는 사용자" 노출 문제. PR1 의 `viewer_shares_follow_edge_with` 가 `public.follows` 만 검사하고 위임 edge 는 빠져 있던 게 root cause.

### 변경 — `supabase/migrations/20260514000000_private_delegation_profile_edge.sql`

- 신규 helper: `viewer_shares_delegation_edge_with(uuid)`. account-scope, status='active' delegations 을 양방향으로 검사하는 SECURITY DEFINER STABLE 함수. project-scope 는 의도적으로 제외 (단일 프로젝트 위임자에게 profile 전반 노출은 과도).
- 기존 `profiles_select_follow_edge` 정책을 `profiles_select_visibility_edge` 로 재선언:
  - USING: `viewer_shares_follow_edge_with(profiles.id) OR viewer_shares_delegation_edge_with(profiles.id)`.
  - 효과: follower 는 기존대로, **위임 받은 자/위임자 양쪽** 도 상대 메타카드(컬럼 전체 — username/display_name/avatar/bio…) 를 SELECT 가능.
- 콘텐츠 (artworks/projects) RLS 는 변경 없음 — 위임 받은 자의 콘텐츠 SELECT 는 이미 `*_select_account_delegate` 정책 (p0_delegations_account_scope_rls.sql) 으로 cover.
- 일반 viewer (follow/위임 edge 모두 없음) 의 비공계 profile 차단은 그대로 유지.

### 회귀 안전성

- 정책은 OR 한 항만 추가 (`true` 반환 cap 확장). 더 *덜* 보이게 되는 케이스는 없음 → 후퇴 0.
- Helper 가 SECURITY DEFINER STABLE → RLS 재진입 없음, signup-time trigger 안전 (hotfix 와 동일 원리).
- UPDATE/INSERT/DELETE 정책 unchanged.
- project-scope 위임은 의도적 제외 — 추후 "위임 받은 자가 전시 페이지에서 host metadata 도 못 본다" 로 재보고되면 별도 helper 로 좁게 추가.

### Supabase SQL — 즉시 적용

`supabase/migrations/20260514000000_private_delegation_profile_edge.sql` 을 SQL Editor 에서 실행. 모두 idempotent (`create or replace` / `drop policy if exists` + `create policy`).

### 환경 변수

변경 없음.

### Verified

- `npx tsc --noEmit` ✓ (변경 코드 없음, RLS 마이그레이션 단독)
- 마이그레이션 self-contained, 재실행 안전.

### 영향 매트릭스

| Viewer ↔ 비공계 Artist | profile 메타카드 | 콘텐츠 (artworks/projects) |
|---|---|---|
| Self (artist 본인) | ✓ | ✓ (`_select_own`) |
| Account-scope delegate (active) | ✓ **(PR-C 로 추가)** | ✓ (`_select_account_delegate`) |
| Account-scope delegator | ✓ **(PR-C 로 추가)** | ✓ (self) |
| Accepted follower | ✓ (PR1) | ✓ (PR2 `_select_follower_accepted`) |
| Pending follow request | ✓ (PR1) | ✗ |
| Claim holder | (해당 없음) | ✓ (`_select_with_claim`) |
| 일반 viewer | ✗ | ✗ (PR2) |

### 다음 PR 예고

- **PR-B** (그룹 B): 위임 라이프사이클 보강. (#4) 보낸 측 cancel UI, (#11) 받은 측 active 상태 본인 해지 RPC, (#7) 보낸 측 권한 변경 RPC + UI.

---

## 2026-04-28 — QA Beta Hardening · PR-A · i18n / UX 일관성

**배경**: 베타 QA 보고서에서 코드 문자열 노출 (`not_for_sale`, `Claim failed: forbidden: caller is not an active account delegate writer for subject_profile_id`), 어색한 한글 (`← 돌아가기 내 스튜디오`, "귀하의 관계"), 작품 수정 화면의 미번역 영어 라벨, 작품 삭제 모달 안내문 vs 실제 UI 불일치, 작품 소개문 길이 무제한 등 12종을 보고. 사용자 인상 측면 회복이 가장 시급하므로 PR-A 로 분리해 회귀 위험 낮은 i18n/UX 일관성 항목만 우선 처리.

### 변경 — 공통 에러 변환 레이어 (재사용 인프라)

- 신규 `src/lib/errors/supabase.ts` — `formatSupabaseError(error, t, fallbackKey?)`.
  - 30종 raw `RAISE EXCEPTION` 메시지 (auth/permission/delegate/invite/claim/follow/priceInquiry) 를 i18n key 로 매핑 (`EXACT_MAP`).
  - `forbidden: caller is not an active account delegate writer ...`, `permission denied`, `violates row-level security`, `jwt|invalid_jwt|expired token` 등 substring 패턴 fallback (`SUBSTRING_MAP`).
  - 모르는 메시지는 `fallbackKey` 가 있으면 정중한 i18n 메시지로, 없으면 raw text 그대로 (carrying through 안전).
- i18n 카탈로그 (`src/lib/i18n/messages.ts` EN/KR 양쪽):
  - `errors.fallback`, `errors.auth.required`, `errors.permission.denied`, `errors.delegate.notWriter`,
    `errors.invite.{missingEmail|invalidScope|projectNotFound|cannotInviteSelf|delegateNotFound|duplicate}`,
    `errors.claim.{requiresWorkOrProject|workIdRequired|typeRequired|artistRequired|displayNameRequired|displayNameTooShort|invalidPeriodStatus}`,
    `errors.follow.{targetNotFound|invalidTarget|invalidFollower}`,
    `errors.priceInquiry.invalidStatus`.
- 후속 PR/기능 추가 시 catch 블록은 `setError(formatSupabaseError(e, t, "..."))` 한 줄 패턴으로 일관 적용. 새 raise message 가 추가될 때 `EXACT_MAP` 한 줄 + i18n 키 한 쌍만 추가하면 친절한 메시지로 노출.

### 변경 — 코드 문자열 노출 제거 (`not_for_sale` 등)

- `src/app/artwork/[id]/edit/page.tsx`: `OWNERSHIP_STATUSES`, `INTENTS`, `PRICING_MODES` 의 hard-coded `label` → `labelKey` (i18n).
- `src/app/upload/bulk/page.tsx`: `OWNERSHIP_OPTIONS` 동일 처리, 두 곳의 `<option>` 렌더에 `t(o.labelKey)` 적용.
- `src/app/my/library/page.tsx`: 라이브러리 필터 dropdown 에서 raw `not_for_sale` 노출 → `OWNERSHIP_LABEL_KEY` 매핑 후 `t()` 사용.
- `src/app/upload/page.tsx`: 이미 labelKey 사용 중 (변경 없음, 점검만).

### 변경 — 영어 라벨 미번역 (작품 수정 화면)

- `Title / Year / Medium / Size / Story / Ownership status / Pricing mode / Currency / Amount / Show price publicly / Apply / Hosu (KR)` 14개 라벨/플레이스홀더를 신규 키 `artwork.field.*` / `artwork.size.*` / `artwork.story.charCount` 로 추출 (EN/KR 양쪽).
- raw error fallback 7군데 (`Failed to save/add/update artwork/provenance/artist`) → `formatSupabaseError(e, t, "artwork.errors.*")` 패턴.

### 변경 — 어색한 한글 / 라벨 일관성

- `library.back` (KR): "내 스튜디오로" → "내 스튜디오" (prefix `←` 와 결합 시 자연스러움).
- `network.backToStudio` (KR): "스튜디오로 돌아가기" → "내 스튜디오" / (EN) "Back to Studio" → "My Studio".
- `ai.metrics.backToStudio` (KR): "스튜디오로 돌아가기" → "내 스튜디오로 돌아가기" / (EN) "Back to Studio" → "Back to My Studio".
- `artwork.backToArtwork` (KR): "작품" → "작품으로 돌아가기" / (EN) "Artwork" → "Back to artwork".
- `artwork.provenanceHint` (KR): "이전에 업로드된 작품은 프로비넌스 정보가 없을 수 있습니다. 이 작품에 대한 귀하의 관계를 추가하거나 수정하세요." → "예전에 업로드된 작품은 프로비넌스 정보가 비어 있을 수 있어요. 이 작품과 본인의 관계(작가·소장자·큐레이터 등)를 추가하거나 수정해 주세요."
- `artwork.claimType` (KR): "귀하의 역할" → "내 역할".
- `src/app/artwork/[id]/page.tsx`, `…/edit/page.tsx`: `← {t("common.backTo")} {t(backLabelKey)}` (예: "← 돌아가기 내 스튜디오") → `← {t(backLabelKey)}` 단일 라벨 패턴으로 단순화.

### 변경 — 작품 삭제 모달 안내문 정합화

- `common.confirmDelete` (KR): "삭제하시겠습니까? 확인하려면 DELETE를 입력하세요." → "삭제 후에는 되돌릴 수 없어요. 정말 삭제하시겠습니까?" / (EN) "Are you sure? Type DELETE to confirm." → "This can't be undone. Are you sure you want to delete this?". `ConfirmActionDialog` 는 단순 confirm UI 라 `Type DELETE` 안내가 사실과 불일치했음.

### 변경 — 작품 소개문 길이 제한

- `STORY_MAX_LEN = 2000` 문자 cap 도입.
- `src/app/artwork/[id]/edit/page.tsx`, `src/app/upload/page.tsx` 의 `<textarea>` 에 `maxLength={2000}` + onChange 안전 트리밍 + `count/2,000` 우측 카운터 추가.
- 신규 키 `artwork.field.storyPlaceholder`, `artwork.story.charCount` 로 안내 통일.

### Supabase SQL — 적용 필요 없음

이번 PR 은 클라이언트/i18n 한정 변경. **Supabase SQL 돌려야 할 것은 없음.**

### 환경 변수

변경 없음.

### Verified

- `npx tsc --noEmit` ✓ (오류 0)
- `npm run build` ✓ (Next.js production build 통과)
- ReadLints (변경 파일 6개) ✓ (오류 0)

### 다음 PR 예고

- **PR-C** (그룹 C): 비공계 위임 RLS 정합화. PR1 `profiles_select_follow_edge` 정책에 *위임 edge* 를 추가해 위임자/피위임자 간 profile metadata 가시성 확보 → 비공계 위임 받은 자의 [내 스튜디오] 빈 페이지 (#6) 와 비공계 작품 피드의 "알 수 없는 사용자" fallback (#8/#9) 동시 해결 예정.
- **PR-B** (그룹 B): 위임 라이프사이클 보강. (#4) 보낸 측 cancel UI, (#11) 받은 측 active 상태 본인 해지 RPC, (#7) 보낸 측 권한 변경 RPC + UI.

---

## 2026-04-28 — Private Account v2 signup hotfix (긴급)

**증상**: PR1+PR2 SQL 적용 후 신규가입 시 *"Database error saving new user"* 발생.

**원인 분석**: 신규가입 trigger `on_auth_user_created_link_external_artist` 가 SECURITY DEFINER 로 `public.artworks` UPDATE 를 수행하는데, PR2 의 `artworks_select_public` / `projects_select_*` 가 inline `EXISTS (select 1 from public.profiles ...)` / `EXISTS (... follows ...)` 를 사용. inline EXISTS subquery 는 SECURITY DEFINER 함수 안에서도 *호출 컨텍스트의 RLS 권한* 으로 평가되어, PR1 의 `profiles_select_follow_request_actor/target` 와 결합 시 gotrue 신규가입 트랜잭션 안에서 평가 경로가 깨짐. → Auth 가 generic 메시지로 surfacing.

**수정 전략**: 검사 로직을 모두 SECURITY DEFINER STABLE helper 함수로 추출. 함수 owner (supabase admin / BYPASSRLS) 권한으로 body 가 실행되므로 *RLS 재진입 없음*. 정책은 단일 boolean 호출로 축소. 기능 거동은 기존과 100% 동일 (helper 의 boolean 결과 = 원래 inline EXISTS 결과).

### 변경 — `supabase/migrations/20260513000000_private_account_signup_hotfix.sql`

- 신규 helper 3종:
  - `is_artist_publicly_visible(uuid) returns boolean` — `coalesce(is_public, true)` 의 SECURITY DEFINER 슬라이스. 누락 행은 "public" 으로 처리 (legacy 호환).
  - `viewer_is_accepted_follower_of(uuid) returns boolean` — `auth.uid()` 가 `accepted` follower 인지.
  - `viewer_shares_follow_edge_with(uuid) returns boolean` — 양방향 follow edge 존재 여부 (알림 actor 메타 join 용).
- PR1 의 `profiles_select_follow_request_actor` + `_target` 두 정책을 단일 `profiles_select_follow_edge` 로 통합 (helper 사용).
- PR2 의 `artworks_select_public`, `artworks_select_follower_accepted`, `projects_select_public`, `projects_select_owner`, `projects_select_follower_accepted` 를 helper 사용 버전으로 재선언.
- `exhibition_works_select` / `exhibition_media_select` / `exhibition_media_buckets_select` 는 PR2 의 EXISTS 그대로 유지 (부모 `projects` 가 helper-driven 이라 안전). 명시적으로 다시 선언해 마이그레이션 self-contained.

### Supabase SQL — 즉시 적용

`supabase/migrations/20260513000000_private_account_signup_hotfix.sql` 을 SQL Editor 에서 실행. 모두 `create or replace` / `drop policy if exists; create policy` 라 재실행 안전.

### 환경 변수
- 변경 없음.

### Verified
- 정합 시나리오 점검 후 신규가입 복구를 확인해 주세요. 만약 적용 후에도 여전히 신규가입이 실패하면 **Supabase Dashboard > Logs > Postgres logs** 에서 에러 시각의 stack trace 를 함께 공유해 주시면 root cause 를 확정해 다시 좁혀들어갑니다.

### 회귀 안전성 노트
- 공개 owner 의 콘텐츠: helper 가 `true` 반환 → 동작 동일.
- 외부 artist (artist_id IS NULL): `artist_id is null` 분기 또는 helper 가 누락 행 → `true` 처리 → 동작 동일.
- 본인 / claim 보유자 / 대행자: 별도 정책 (`*_select_own`, `*_with_claim`, `*_account_delegate`) 그대로 OR 결합으로 통과.
- accepted follower: helper 결과 동일.
- 알림 inbox 의 follow_request actor 메타: 단일 helper 정책으로 통합 후에도 양쪽 follow edge 어느 방향이든 통과.

---

## 2026-04-28 — Private Account v2 · PR2 (콘텐츠 RLS 정합화)

PR1 에서 미뤄둔 콘텐츠 RLS 게이트를 마감하는 좁은 SQL-only 패치. PR1 에서는 비공계 owner 의 메타·검색·Follow Request 만 풀고 작품/전시는 그대로 두었음. 이 PR 이 그 마지막 갭을 막아 메이저 SNS 의 보호 계정 거동을 완성.

### 펀더멘털 마감

이번 PR 부터 **비공계 owner 의 콘텐츠** (artworks · projects/exhibitions · exhibition_works · exhibition_media · exhibition_media_buckets · artwork_images) 는 다음 사람만 SELECT 가능:

- 본인 (artist_id = auth.uid())
- 그 계정의 active account-scope delegate
- claim 보유자 (lister/collector — artwork 한정)
- **`follows.status = 'accepted'` 의 follower** (이번 PR 에서 추가된 분기)
- 외부에서 직접 URL 추측해 들어와도 RLS 가 차단

공개 owner 의 콘텐츠는 동작 변화 없음 — 새 EXISTS 가 `coalesce(p.is_public, true) = true` 로 short-circuit 되어 OR 결합 결과가 기존과 동일.

### 변경 요약 — `supabase/migrations/20260512000000_private_account_content_rls.sql`

1. **`artworks_select_public`** 교체 — `visibility = 'public'` AND `(artist_id IS NULL OR artist 가 공개)`. external artists (`artist_id IS NULL`) 는 그대로 노출.
2. **`artworks_select_follower_accepted`** 신설 — `visibility = 'public'` AND viewer 가 owner 의 accepted follower.
3. **`artwork_images` "Allow public select"** 교체 — `a.visibility = 'public'` 게이트 제거 후 단순 EXISTS(parent artwork). 직접 URL 추측으로 비공계 owner 의 storage path 노출 위험 차단. 부모 artworks RLS 가 자동 게이트.
4. **`projects_select_public`** 교체 — host_profile_id AND curator_id 양쪽이 공개일 때만 일반에게 노출. NULL 은 "no party" 로 통과.
5. **`projects_select_owner`** 신설 — host 또는 curator 인 본인은 그대로.
6. **`projects_select_follower_accepted`** 신설 — 양쪽 어느 쪽이든 accepted follower 면 노출.
7. **`exhibition_works_select` / `exhibition_media_select` / `exhibition_media_buckets_select`** — 모두 `using (true)` 였던 것을 부모 `projects` 에 대한 EXISTS 로 교체. RLS recursion 으로 자식이 자동 게이트.
8. INSERT/UPDATE/DELETE 정책은 변경 없음 — owner / curator / delegate 가 그대로 작성·수정·삭제 가능.

### Supabase SQL — 적용 필요

`supabase/migrations/20260512000000_private_account_content_rls.sql` 을 SQL Editor 에서 실행. 모두 `drop policy if exists; create policy` 형태로 재실행 안전. PR1 (`20260511000000_…`) 이 먼저 적용되어 있어야 함 (`follows.status` 컬럼 의존).

### 환경 변수

- 변경 없음.

### Verified

- `npx tsc --noEmit` 통과, `npm run build` 통과 (cache clear 후).
- 회귀 시나리오:
  - **공개 owner 의 작품** — `artworks_select_public` 의 새 게이트가 `is_public = true` 로 short-circuit → SELECT 가능, 변화 없음.
  - **공개 owner 의 전시** — `projects_select_public` 동일하게 통과.
  - **External artist (artist_id IS NULL)** — `artist_id is null` 분기로 그대로 노출.
  - **본인 작품 / 전시** — `*_own`, `*_account_delegate`, `artworks_select_with_claim` 가 OR 로 결합되어 그대로 통과.
  - **비공계 owner 의 작품을 anonymously 직접 조회** — RLS 차단. 작품 페이지 빈 결과 또는 not-found.
  - **비공계 owner 의 accepted follower 가 피드/프로필 진입** — `artworks_select_follower_accepted` 통과 → 작품/전시 정상 노출.
  - **pending follower** — RLS 통과 안 함 → 콘텐츠 안 보임 (의도). PrivateProfileShell 의 visitor 카드만 노출.
  - **artwork_images 직접 추측 URL** — 부모 artwork 의 RLS 가 게이트하므로 비공계 owner 의 이미지 row 도 차단.

### 남은 한계

- **Storage object** — supabase storage bucket 이 public 으로 설정돼 있다면, image URL 자체를 브라우저에 캐시한 사용자는 RLS 와 별도로 직접 다운로드 가능. 보호 수준이 메이저 SNS 표준에 가깝게 충분하지만 (RLS 가 row 자체를 막아 신규 노출은 없음), 완벽한 보호가 필요하면 storage 정책을 별도 패치로 강화 가능.
- **Recommendations lanes (follow_graph / likes_based / expand)** — 비공계 owner 의 *추천 카드 자체* 노출 정책은 별도 사안. 현재는 그대로 노출 (메이저 SNS 표준에 맞춰 메타 카드는 보임).

---

## 2026-04-28 — Private Account v2 · PR1 (검색 노출 + Follow Request 골격)

QA 가 "비공개 계정 유저 ID 로 검색해도 결과가 전혀 안 뜬다" 고 지적. 펀더멘털 점검 결과, 코드의 비공계 처리는 메이저 SNS (Instagram / X-protected / TikTok / Threads / Bluesky) 기준과 완전히 다른 *전체 차폐* 모델이었음 (`profiles` RLS, 검색 RPC 6종, `lookup_profile_by_username` 모두 `is_public = true` 로 박혀 있음). 비공계 계정은 검색에도 안 잡히고, follow 요청조차 보낼 수 없는 "온라인이지만 영구 부재중" 상태였음.

이번 PR1 은 메이저 SNS 표준에 맞춰 **메타 카드 / 검색 / Follow Request 골격** 까지만 정렬. 작품/전시 콘텐츠 RLS 는 그대로 두어 Phase 2 에서 별도 PR로 처리 (회귀 감사 분리).

### 새 펀더멘털 (이번 PR 부터 적용)

| 표면 | 공개 계정 | 비공계 v2 |
|---|---|---|
| 검색 노출 (`search_people` 외) | ✅ | **✅** (자물쇠 배지 표시) |
| 프로필 카드 메타 (아바타·display_name·username·main_role·bio) | ✅ | **✅** |
| 작품 / 전시 본문 | ✅ | ❌ (Phase 2 에서 follower-only 게이트) |
| Follow 버튼 동작 | 즉시 follower | **`pending` → 본인 수락 → follower** |
| Follower / Following count | ✅ | ✅ (accepted 만 카운트) |

### 변경 요약

#### SQL — `supabase/migrations/20260511000000_private_account_searchable_and_follow_requests.sql`

1. **`follows.status` 컬럼** (`accepted | pending`, default `accepted`) + 인덱스. 기존 행은 자동으로 `accepted` 라 거동 변화 없음.
2. **검색 RPC 6종 갱신** — `search_people` (2 시그니처: 4-arg & 5-arg 퍼지), `search_artists_by_artwork`, `get_search_suggestion` 에서 `is_public = true` 필터 제거. 응답 JSON 에는 `is_public` 그대로 포함되어 UI 가 자물쇠 배지를 분기.
3. **`lookup_profile_by_username`** 갱신 — 비공계 일 때 종전엔 `{is_public:false}` 한 줄만 반환. 이번부터 메타 카드 슬라이스(아바타·display_name·main_role·roles·bio·`viewer_follow_status`) 반환. 작품·전시·studio_portfolio·statement·cover·location·website 등 본문 컬럼은 의도적으로 누락. 공개 계정 응답에도 `viewer_follow_status` 추가.
4. **`profiles` RLS — follow-edge-aware 정책 2개 추가** — 알림 join 에서 비공계 follower / target 의 메타 행을 읽을 수 있도록 (`follows` 에 edge 가 존재하는 양쪽). 본문 컬럼 누출은 없음 (모든 consumer 가 select 시 메타만 project).
5. **Follow Request RPC 4종** (모두 `security definer`)
   - `request_follow_or_follow(target)` — public target 즉시 `accepted`, private target `pending`. idempotent. 반환값으로 status 전달해 UI 가 추가 RPC 콜 없이 라벨 갱신.
   - `accept_follow_request(follower)` — 본인의 incoming pending 만 accept.
   - `decline_follow_request(follower)` — 본인의 incoming pending row 삭제.
   - `cancel_follow_request(target)` — 내가 보낸 outgoing pending 취소.
   - `get_viewer_follow_status(target)` — `none | pending | accepted` 헬퍼.
6. **알림 type 확장** — `notifications.notifications_type_check` 에 `follow_request`, `follow_request_accepted` 추가. `notify_on_follow` 트리거가 status 별로 분기 + `notify_on_follow_accept` 트리거 신설 (status pending→accepted 시 양쪽에 알림).

#### TS — `src/lib/supabase/follows.ts`
- `follow()` 가 `request_follow_or_follow` RPC 사용. 반환값에 `status` 포함 (`accepted | pending`). 호출처 호환 위해 `{data, error}` 형태 유지.
- `isFollowing(target)` 이 `status='accepted'` 만 카운트.
- 새 helper: `getFollowStatus`, `cancelFollowRequest`, `acceptFollowRequest`, `declineFollowRequest`, `listIncomingFollowRequests`.
- `getMyFollowers` / `getMyFollowing` 도 `status='accepted'` 필터링.

#### TS — Follower 카운트 / 피드 정합화
- `src/lib/supabase/me.ts` (`getMyStats`, `getStatsForProfile`): follower / following count 가 `status='accepted'` 만 집계.
- `src/lib/supabase/artists.ts` (`getFollowingIds`): 피드용 following set 도 accepted 만.
- `src/lib/supabase/artworks.ts` (피드 쿼리): 동일.

#### UI — FollowButton (`src/components/FollowButton.tsx`)
- `initialStatus: FollowStatus` prop 추가 (legacy `initialFollowing: boolean` 도 호환). `isPrivateTarget` 으로 라벨 분기.
- 상태별 라벨: `Follow` / `Request to follow` / `Requested` / `Following` / `Unfollow`. 톤도 분기 (요청됨은 outline, 팔로잉은 dark fill).
- pending 상태에서 클릭 → 확인창 + `cancel_follow_request` RPC.

#### UI — `/u/{username}` 비공계 진입 (`src/app/u/[username]/PrivateProfileShell.tsx`)
- visitor 분기: 메타 카드 (아바타 / display_name / username / main_role / bio / 자물쇠 배지) + Follow / Requested 버튼 + 안내 카피 + `/people` 으로 돌아가는 보조 링크.
- **owner 분기** (사용자 요청): UserProfileContent 위에 amber 배너로 *"현재 비공개 계정이에요. 프로필 카드는 노출되지만 작품과 전시는 다른 사람에게 보이지 않아요. 누구나 볼 수 있게 하려면 설정에서 공개 계정으로 전환해 주세요."* + 설정 열기 버튼. "공개 프로필 미리보기" 클릭 시 의도가 명확해짐.

#### UI — PeopleClient 검색 결과 (`src/app/people/PeopleClient.tsx`)
- `profile.is_public === false` 인 row 에 자물쇠 배지 chip.
- 비공계 row 의 FollowButton 은 `isPrivateTarget` 전달 + IntroMessageAssist intercept 우회 (수락되지 않은 상태에서 인사말 작성은 낭비). IntroMessageAssist 컴포넌트도 비공계 row 에서는 mount 안 함.

#### UI — 알림 인박스 (`src/app/notifications/page.tsx`)
- `follow_request` 타입에 인라인 [수락 / 거절] 버튼 (`FollowRequestActions` 로컬 컴포넌트). 결정 후 알림 read mark + 리스트 refresh + cross-tab 이벤트.
- `follow_request` 행은 row-link 로 감싸지 않음 (인라인 버튼 보호).
- `follow_request_accepted` 는 단순 라벨 + 프로필 딥링크.
- `notifications.followRequest.body`, `notifications.followRequestAccepted.body` i18n 추가.

#### i18n — `src/lib/i18n/messages.ts`
- `profile.private.notice.title|body` (visitor 카드용 안내)
- `profile.private.ownerNotice.title|body|cta` (사용자 요청한 owner 안내)
- `profile.private.cardSubtitle|lockBadge|requestSent`
- `follow.cta.follow|request|requested|following|unfollow`
- `follow.cancelRequest.confirm`, `follow.unfollow.confirm`
- `follow.requests.inbox.title|empty|accept|decline|accepted|declined`

#### Beta event
- `BetaEventName` 에 `profile_follow_requested` 추가 (request 와 즉시 follow 분리 측정).

### 변경 파일

- `supabase/migrations/20260511000000_private_account_searchable_and_follow_requests.sql` (신규)
- `src/lib/supabase/follows.ts`
- `src/lib/supabase/profiles.ts` (private card 타입 + 반환 슬라이스 분기)
- `src/lib/supabase/notifications.ts` (NotificationType 확장)
- `src/lib/supabase/me.ts`, `src/lib/supabase/artists.ts`, `src/lib/supabase/artworks.ts` (status='accepted' 필터링)
- `src/components/FollowButton.tsx` (재작성, status-aware)
- `src/app/u/[username]/page.tsx`, `src/app/u/[username]/PrivateProfileShell.tsx`
- `src/app/people/PeopleClient.tsx`
- `src/app/notifications/page.tsx`
- `src/lib/i18n/messages.ts`
- `src/lib/beta/logEvent.ts`

### Supabase SQL — 적용 필요

`supabase/migrations/20260511000000_private_account_searchable_and_follow_requests.sql` 을 Supabase SQL Editor 에서 실행. 모두 `create or replace` / `add column if not exists` / `drop policy if exists; create policy` 형태라 재실행 안전.

### 환경 변수

- 변경 없음.

### Verified

- `npx tsc --noEmit` 통과, 우리 변경 파일에 lint 0 error/warning.
- `npm run build` 통과.
- 회귀 시나리오 점검:
  - **공개 계정 follow 동작** — `follow()` 가 `request_follow_or_follow` RPC 콜로 변경됐지만 결과는 `'accepted'` 로 즉시 follower. UI 라벨 즉시 "Following" 으로 전환.
  - **공개 계정 follower 카운트** — `status='accepted'` 디폴트라 기존 행 모두 카운트 그대로.
  - **비공계 본인이 자기 프로필 미리보기** — owner 배너로 명시 안내 + 작품 영역은 본인은 보이게 그대로 (작품 RLS 변화 없음).
  - **비공계 외부인** — 메타 카드 + Follow Request 버튼 / Requested 라벨. 작품·전시·statement 는 보이지 않음.
  - **비공계 본인의 알림 인박스** — follow request 인라인 [수락/거절]. 수락 시 follower 카운트 +1, 양쪽 알림 발송.
  - **검색** — 비공계 username/display_name 검색 시 결과에 자물쇠 배지 chip 으로 노출.
  - **추천 lanes (follow_graph / likes_based / expand)** — Phase 2 영역이라 이번 PR 에선 *변경 없음*. lanes 는 여전히 `is_public = true` 만 추천.

### 남은 한계 / Phase 2 (다음 PR)

- 작품 / 전시 / shortlist / 보드 등 콘텐츠 RLS 가 owner.is_public + follows.status='accepted' 로 정렬되어야 진정한 "보호 계정" 거동 완성. 이번 PR 에서는 비공계 owner 의 콘텐츠 자체가 그래도 직접 URL로는 접근 가능 (visibility='public' 작품 한정). Phase 2 가 이를 마감.
- 공개 추천 lanes 에 비공계 노출 여부는 별도 결정 사항. 현재는 노출 안 함.

---

## 2026-04-28 — Statement Draft Assist 품질 / 공개범위 문구

QA 리포트(작가의 말 초안 — 영문 토큰 노출 · "ㅇㅇ적 스타일" 정형구 · 삭제한 키워드 재등장)와 공개범위 토글 문구 미스매치를 함께 정리한 좁은 패치.

### 핵심 진단 (참고)

"삭제한 키워드 재등장" 의 root cause 는 데이터 부족이 아니라, statement 프롬프트가 `current_statement` 를 anchor 로 쓰라고 지시되어 있다는 점이었음. 사용자가 칩에서 키워드를 빼도, 기존 statement 본문에 그 어휘가 박혀 있으면 모델이 그대로 복원함. 저장 후 재진입해도 동일.

### 변경 요약

#### Patch A — Statement 프롬프트 행동 룰 보강
[src/lib/ai/prompts/index.ts](src/lib/ai/prompts/index.ts) 의 `PROFILE_STATEMENT_SYSTEM` 에 두 블록 추가.
- **Style-token handling** — ko 로케일에서 영문 슬러그(예: `gestural`, `minimal`)를 그대로 인용하지 말고 자연 한국어로 풀어 쓸 것. `〜적 스타일` / `〜적인 스타일` 정형구 금지, drafts 사이에서 같은 표현 반복 금지. 한국어에 정착한 차용어(미니멀·콜라주 등)만 예외.
- **Deprecated keywords** — `excluded_keywords` 배열은 hard negative list 로 취급. 그리고 "current_statement 안엔 있지만 현재 themes/mediums/styles 칩에 없는 표현은 deprecated 로 보고 칩 set 을 source of truth 로 삼을 것" 을 명시.

#### Patch B — `excluded_keywords` 채널
- [src/lib/ai/contexts.ts](src/lib/ai/contexts.ts) `ProfileContextInput` 에 `excludedKeywords?: string[] | null` 추가, statement 모드 빌더가 `excluded_keywords: [...]` 라인을 사용자 컨텍스트에 emit.
- [src/lib/ai/validation.ts](src/lib/ai/validation.ts) `parseProfileBody` 가 12 토큰 × 48자 한도로 trimArray 처리.
- [src/components/profile/StatementDraftAssist.tsx](src/components/profile/StatementDraftAssist.tsx) prop type 에 동일 필드 추가.
- [src/app/settings/page.tsx](src/app/settings/page.tsx) — 페이지 마운트 시점의 themes/mediums/styles 스냅샷을 `initialChipsRef` 에 잡고, 현재 칩 set 과의 차집합을 `useMemo` 로 계산해 `excludedKeywords` 로 전달. 칩을 다시 추가하면 자동으로 negative list 에서도 빠짐. 세션 단위라 영구 배제 아님.

#### Patch C — `themesDetail` 자유 서술 surface 활성화
- 컨텍스트/프롬프트는 이미 `themes_detail` 을 받게 되어 있었으나 UI 가 없어 dead path 였던 것을 활성화.
- /settings 의 작가의 말 섹션, `StatementDraftAssist` 카드 직전에 접이식 `<details>` 로 textarea 추가 (1200자 한도, 메모 비우기 버튼 포함).
- `profile_details.themes_detail` 컬럼이 없으므로 **device-local 저장 (`localStorage` 키 `abstract:profile:themesDetail:{uid}`)** — 같은 기기에서는 재진입해도 유지되지만 다른 기기/익명창에서는 비어 있음. 공개 프로필에는 노출되지 않음을 hint 카피에서 명시. DB 컬럼 추가는 차후 P2 에서 검토.
- i18n EN/KR 4 키 추가: `profile.statement.themesDetail.title|hint|placeholder|clear`.

#### 공개 범위 문구 자연화
QA 스크린샷: UI 가 체크박스인데 KR hint 가 "다시 공개하려면 토글을 켜요" 로 나와 매칭이 어색.
- `settings.visibility.privateHint` KR/EN 모두 체크박스 명시로 교체. 자연 한국어로 다듬어 "비공개 상태예요. 본인만 프로필을 볼 수 있어요. 다시 공개하려면 옆 체크박스를 눌러 주세요." 로 통일.
- `settings.visibility.publicHint` / `settings.visibility.hint` 도 같은 김에 종결을 자연스럽게 손봄(번역체 "켜요" → "할 수 있어요" / "공개 상태예요" 등).

### 변경 파일

- `src/lib/ai/prompts/index.ts`
- `src/lib/ai/contexts.ts`
- `src/lib/ai/validation.ts`
- `src/components/profile/StatementDraftAssist.tsx`
- `src/app/settings/page.tsx`
- `src/lib/i18n/messages.ts`

### Supabase SQL · 환경 변수

- 변경 없음.

### Verified

- `npx tsc --noEmit` 통과, lint 0 issue.
- 회귀 시나리오:
  - **칩 변동 없는 기존 사용자**: `excludedKeywords` 가 빈 배열 → 프롬프트 라인이 `excluded_keywords: []` 만 추가되어 거동 변화 없음. statement 품질만 상승(영문 슬러그 인용/정형구 회피 룰).
  - **칩에서 themeA 삭제 후 재초안**: 프롬프트에 `excluded_keywords: ["themeA"]` 가 명시 + "current_statement 의 deprecated 표현 쓰지 말 것" 룰이 동시 작동 → themeA 가 다시 등장하지 않음. 저장 후 재진입해도 (snapshot 이 새 set 으로 재시드되므로) 동일 보호 유지.
  - **themesDetail 입력 후 다른 기기로 이동**: 새 기기에서는 비어 있음 (의도적 device-local).
  - **/settings 비공개 전환**: hint 가 "다시 공개하려면 옆 체크박스를 눌러 주세요." 로 표시되어 체크박스 UI 와 일치.

### 남은 한계

- `themesDetail` device-local persistence 는 로그인된 다른 기기로 옮기면 비어 있음. 사용자 수요가 보이면 `profile_details.themes_detail TEXT` 컬럼 추가로 승격 검토(SSOT RPC + RLS 점검 필요).

---

## 2026-04-28 — Acting-as Persona Delta Hardening (P0/P1 closure)

3-phase acting-as 패치(Phase 1·2·3) 후 GPT 감사 결과로 잡힌 인접 갭 6종을 닫는 좁고 강한 후속 패치. **P0 (chip 부착 / 모바일 switcher / safe-route)** 와 **P1 (delegated mutation audit / storage lifecycle)** 만 다루고, 페르소나 모델 자체는 A+ 그대로 유지.

### 페르소나 모델(요약 · 변경 없음)

- **Workspace/production surface → principal**: My Studio · artworks · upload/edit · workroom/library · exhibitions · boards · inquiries · claims · public profile preview · AI studio/delegation brief · principal workspace alerts.
- **Personal/account/security surface → operator**: login/security/password · billing · `/settings` · global notification bell · personal follow/like.
- **Per-mutation affordance**: 아바타/모바일 Account Switcher + 글로벌 amber banner + 폼별 `<ActingAsChip>`.

### 변경 요약

#### P0-A. `<ActingAsChip>` 실 렌더 점검·보강
모든 청구된 mutation surface 가 실제로 chip 을 렌더하는지 확인. 7곳(`/upload`, `/upload/bulk`, `/artwork/[id]/edit`, `/my/exhibitions/new`, `/my/exhibitions/[id]/edit`, `/my/exhibitions/[id]/add`, `/my/inquiries`) 모두 렌더 확인. 추가로 `/my/inquiries` 는 펼쳐진 reply textarea 직상단에 컴팩트 chip 을 한 단계 더 부착(moment-of-mutation 강화) — 페이지 헤더 + 인라인 두 위치에서 페르소나가 노출됨.

#### P0-B. 모바일 Account Switcher parity
[src/components/Header.tsx](src/components/Header.tsx) 의 햄버거 메뉴에도 데스크톱 드롭다운과 동일한 switcher 섹션 추가. (1) `mobileOpen` true 시 `loadActiveAccountDelegations()` lazy-load (데스크톱과 동일 fetch 인플라이트 가드 공유), (2) 본인 계정 row + active 위임 principal row 들 표시, (3) 클릭 시 `handleSwitchToOperator` / `handleSwitchToPrincipal` 호출 후 `setMobileOpen(false)`. solo 사용자(active 위임 없음, acting-as 비활성) 에게는 섹션 자체가 미노출되어 시각 변화 0.

#### P0-C. operator 복귀 safe-route
종전 `handleSwitchToOperator()` 는 `clearActingAs()` 후 단순 `router.refresh()` 만 호출 → principal-only 라우트(예: principal 의 exhibition edit) 에 머무르면 빈 상태/거부 상태가 되는 UX 갭. 이번 패치로:
- `handleSwitchToOperator()` → `clearActingAs() + setAvatarOpen/MobileOpen(false) + router.push('/my') + router.refresh()`.
- 글로벌 acting-as banner 의 "본인 계정으로 돌아가기" 링크도 raw `clearActingAs` 가 아니라 동일 핸들러로 묶어 두 경로가 드리프트하지 않도록 함.
- `handleSwitchToPrincipal()` 도 모바일 일관성을 위해 `setMobileOpen(false)` 호출.

#### P1-A. Delegated mutation audit hook 보강
`recordActingContextEvent` 인프라는 이미 있으나 update/edit 경로가 audit-light 였음. 다음 mutation 들에서 acting-as 호출 시 audit 이벤트를 best-effort 로 기록하도록 보강:
- [src/lib/supabase/artworks.ts](src/lib/supabase/artworks.ts) `updateArtwork` — `options.actingSubjectProfileId`, `options.auditAction` 추가. `auditAction: "artwork.update" | "bulk.artwork.update"` 분기.
- 동 파일 `publishArtworks` — 일괄 publish 도 acting-as 일 경우 id 별로 `artwork.publish` 기록.
- [src/lib/supabase/exhibitions.ts](src/lib/supabase/exhibitions.ts) `updateExhibition`, `addWorkToExhibition` — `options.actingSubjectProfileId` 추가.
- [src/lib/delegation/actingContext.ts](src/lib/delegation/actingContext.ts) action union 에 `bulk.artwork.update`, `exhibition_work.add` 추가, `mutationEventTypeFor` 가 `delegated_artwork_bulk_updated` / `delegated_exhibition_work_added` 로 매핑.
- callsite 와이어: `/artwork/[id]/edit`, `/upload/bulk` (apply/title/CSV/perRow/exhibition link), `/my/exhibitions/[id]/edit`, `/my/exhibitions/[id]/add`, `/upload` (single 의 add-to-exhibition).
- i18n: [src/lib/i18n/messages.ts](src/lib/i18n/messages.ts) EN/KR 양측에 `delegation.event.delegated_artwork_bulk_updated` 추가 (`Bulk-edited artwork drafts` / `작품 초안을 일괄 수정했어요`). 나머지 라벨은 기존 키 재사용.

audit 실패는 UX 를 막지 않으며(catch+swallow), payload 는 변경 키 목록으로 최소화.

#### P1-B. Delegate-uploaded image storage lifecycle 하드닝
종전 `can_manage_artworks_storage_path()` 는 (a) 자기 폴더 경로, (b) exhibition-media 경로 두 가지만 인정 → operator B 가 acting-as 로 올린 이미지가 `B/...` 경로에 떨어지면 principal A 도 다른 delegate C 도 storage RLS 로 못 지움(orphan). 새 마이그레이션:
- [supabase/migrations/20260510000000_artworks_storage_account_delegate.sql](supabase/migrations/20260510000000_artworks_storage_account_delegate.sql) — 헬퍼 함수 확장(idempotent · `CREATE OR REPLACE`):
  - **Shape 1**: caller 가 folder owner 의 active account-scope writer → 신규 업로드를 principal 폴더에 직접 쓸 수 있음.
  - **Shape 2**: folder owner 가 caller 의 active account-scope writer → principal 이 자신의 delegate 폴더 잔류 객체 정리 가능.
  - **Shape 3**: caller 와 folder owner 가 동일 principal 의 active account-scope writer 형제 → cross-delegate 정리 가능.
- 신규 업로드는 `actingAsProfileId ?? userId` 폴더로 라우팅(`/upload`, `/upload/bulk`) → 앞으로 acting-as 업로드는 처음부터 principal-rooted path 로 떨어져 lifecycle 이 principal 중심.
- 기존 operator 폴더에 떨어진 legacy 객체도 Shape 2/3 경유로 정리 가능. SELECT 정책은 종전대로(공개 read).

#### P1-C. Settings/social/notification boundary 명문화
- `/settings` — Phase 2 amber lock banner 유지(acting-as 시에도 operator 본인 계정만 편집).
- 소셜 그래프(follow/like) — operator default. 향후 `engage_as_principal` permission 도입 전까지 기능 변경 없음.
- Header bell — operator notifications 만 표시. principal 영업 알림은 `/my/inquiries` + delegation activity drawer 에서 노출.

### 변경 파일

- `src/components/Header.tsx`
- `src/app/my/inquiries/page.tsx`
- `src/lib/supabase/artworks.ts`
- `src/lib/supabase/exhibitions.ts`
- `src/lib/delegation/actingContext.ts`
- `src/lib/i18n/messages.ts`
- `src/app/upload/page.tsx`
- `src/app/upload/bulk/page.tsx`
- `src/app/artwork/[id]/edit/page.tsx`
- `src/app/my/exhibitions/[id]/edit/page.tsx`
- `src/app/my/exhibitions/[id]/add/page.tsx`
- `supabase/migrations/20260510000000_artworks_storage_account_delegate.sql`

### Supabase SQL (적용 필요)

- `supabase/migrations/20260510000000_artworks_storage_account_delegate.sql` 1개 — Supabase SQL Editor 에서 실행. idempotent · additive · `CREATE OR REPLACE FUNCTION public.can_manage_artworks_storage_path(text)`. 기존 정책은 그대로 둔 채 helper 만 확장하므로 storage 회귀 0.

### 환경 변수

- 추가/변경 없음.

### Verified

- `npx tsc --noEmit` 통과.
- 회귀 시나리오:
  - **Solo 사용자**: 헤더 데스크톱/모바일 모두 switcher 미노출, mutation 폼 chip null 반환, settings 배너 미노출.
  - **Account delegate (acting-as 비활성)**: 데스크톱·모바일 두 메뉴 모두 switcher 노출, `/my` 라우트에서 본인 데이터.
  - **Account delegate (acting-as 활성)**: bulk upload·single upload·artwork edit·exhibition new/edit/add·inquiries 의 reply 직상단 모두 chip 노출. switcher 본인 row 의 "현재" 칩이 사라지고 principal row 에 "위임 중" 칩. banner "본인 계정으로 돌아가기" 클릭 시 `/my` 로 라우팅 후 chip/banner 모두 사라짐.
  - **Acting-as 중 mutation**: artwork update / bulk update / exhibition update / exhibition_work add / inquiry reply 모두 delegation activity drawer 에 한국어/영어 라벨로 노출.
  - **Storage lifecycle (수동 QA)**: operator B → acting-as A → 단일 업로드 시 path 가 `A/...` 로 떨어짐(시각 확인). principal A 로그인 후 작품 삭제 → storage 객체 정리 성공. legacy `B/...` 경로의 객체는 마이그레이션 적용 후 A 도 정리 가능.

### 남은 한계

- 소셜 그래프(follow/like) 의 acting-as 옵션은 의도적으로 미구현. 추후 `engage_as_principal` 별도 permission 으로 도입 검토.
- header bell 의 principal swap 은 미구현(operator 알림 유지).
- artwork.delete / exhibition.delete / exhibition_work.remove / inquiry.status_update / inquiry.note 의 delegated audit 은 본 패치 범위 외(추가 위험 검토 후 후속).

---

## 2026-04-28 — Acting-as Persona Hardening · Phase 3 (Toggle UX / persona affordance)

Phase 1·2(`3533a40`, `fdc9992`) 의 백엔드/리스트 정합 위에 토글 UX 와 per-form persona affordance 를 입힘. 두 가지 SNS 벤치마크(LinkedIn Pages / IG Business) 의 핵심 패턴을 흡수: **(1) 아바타 드롭다운 Account Switcher**, **(2) 모든 mutation 폼 상단의 "X 명의로" chip**.

### 변경 요약

- **헤더 아바타 Account Switcher** ([src/components/Header.tsx](src/components/Header.tsx)) — 드롭다운 열릴 때 `listMyDelegations()` 로 `received: scope_type='account', status='active'` 위임 lazy-load. solo 사용자는 active 위임이 없으면 switcher 섹션 자체가 렌더되지 않아 시각 변화 0. acting-as 활성 시 본인 계정 + 위임 받은 principal 들이 모두 표시되며 활성 페르소나에 점/뱃지 표시. principal 클릭 시 `setActingAs` + `router.refresh()` + `router.push('/my')`. 본인 계정 클릭 시 `clearActingAs` + `router.refresh()`. 기존 acting-as banner 는 유지.
- **`<ActingAsChip>` 컴포넌트** ([src/components/ActingAsChip.tsx](src/components/ActingAsChip.tsx)) — `mode: "posting" | "editing" | "replying"` 프롭으로 카피 변형. `useActingAs()` 로 active 여부 확인 후 비활성이면 null 반환 (solo 회귀 0). `data-tour="acting-as-chip"` 앵커. 부착 위치:
  - `/upload` (single artwork) · `/upload/bulk` — `posting`
  - `/artwork/[id]/edit` — `editing`
  - `/my/exhibitions/new` — `posting`
  - `/my/exhibitions/[id]/edit` · `/my/exhibitions/[id]/add` — `editing`
  - `/my/inquiries` — `replying`
- **i18n 라벨** ([src/lib/i18n/messages.ts](src/lib/i18n/messages.ts)) EN/KR 양측에 `acting.switcher.*` 4 키, `tour.delegation.accountSwitcher.*` / `tour.delegation.actingAsChip.*` 4 키 추가. (`acting.chip.*` / `acting.lock.notice.*` 는 Phase 2 에서 선반영.)
- **Tour v4** ([src/lib/tours/tourRegistry.ts](src/lib/tours/tourRegistry.ts), [src/lib/tours/tourKoCopy.ts](src/lib/tours/tourKoCopy.ts)) — `delegation.main` 5스텝 → 7스텝 (`account-switcher` + `acting-as-chip` 추가), `version: 4` bump 으로 기존 사용자 1회 자동 재노출. 한국어는 글리프 깨짐 차단 위해 `tourKoCopy.ts` 직접 카피.

### Supabase SQL

- 추가/변경 없음 (Phase 1 마이그레이션만 필요).

### 환경 변수

- 추가/변경 없음.

### Verified

- `npx tsc --noEmit` 통과.
- 변경 파일 lint 0 issue.
- 회귀 시나리오:
  - solo 사용자(active 위임 없음, acting-as 비활성): 헤더 드롭다운에 switcher 섹션 미노출, 모든 mutation 페이지의 chip null 반환. 종전 헤더/폼과 시각적으로 0 차이.
  - delegate writer (account scope) — acting-as 비활성: switcher 에 본인 + 받은 principal(s) 노출. principal 클릭 → acting-as 활성화 + `/my` 로 이동. acting-as 활성 후 모든 mutation 폼에 chip 노출 ("○○ 명의로 게시 중 · 운영자: 본인").
  - delegate writer — acting-as 활성: switcher 에 본인 옆 "현재" 칩 빠짐, principal 옆 "위임 중" 칩 표시. 본인 계정 클릭 → `clearActingAs` 후 chip 사라지고 banner 사라짐.
  - tour: delegation hub 진입 시 v4 자동 재노출, `account-switcher` 스텝은 헤더 드롭다운 핀, `acting-as-chip` 스텝은 첫 mutation 폼(예: `/upload`) 진입 후 노출.

---

## 2026-04-28 — Acting-as Persona Hardening · Phase 2 (List filters / read paths)

Phase 1 (`3533a40`) 의 백엔드/RLS 정합화 직후 후속 패치. "listMy*" 헬퍼들이 항상 `session.user.id` 만 보던 read 표면을 `forProfileId ?? session.user.id` 로 일반화하고, 관련 `/my` 페이지들에 `useActingAs()` 를 주입해 acting-as 활성 시 principal scope 데이터가 보이도록 정렬. 추가로 `/settings` 에 "이 페이지는 본인 계정 전용" operator-lock 안내 배너를 부착해 페르소나 결정(workspace = principal swap, account = operator lock) 의 시각적 정합을 맞춤.

### 변경 요약

- **List 헬퍼 시그니처 일반화**
  - [src/lib/supabase/artworks.ts](src/lib/supabase/artworks.ts) `listMyArtworks` / `listMyArtworksForLibrary` — `options.forProfileId` 추가. 기본값 종전대로.
  - [src/lib/supabase/exhibitions.ts](src/lib/supabase/exhibitions.ts) `listMyExhibitions(options?)` — `options.forProfileId` 로 curator/host 필터를 principal 로 라우팅. 프로젝트-스코프 위임 머지 로직은 operator 세션에 anchor 된 채로 유지(위임은 operator 에게 부여되므로).
- **/my 페이지 acting-as 와이어**
  - [/my/library](src/app/my/library/page.tsx), [/my/exhibitions](src/app/my/exhibitions/page.tsx), [/my/shortlists](src/app/my/shortlists/page.tsx) 모두 `useActingAs()` 도입 후 `forProfileId: actingAsProfileId ?? null` 전달. solo 케이스는 변경 없음.
  - [/upload/bulk](src/app/upload/bulk/page.tsx) — exhibition picker 가 acting-as 시 principal 의 전시 목록을 가져옴.
  - [/my/exhibitions/[id]/add](src/app/my/exhibitions/[id]/add/page.tsx) — 작품 풀(`listMyArtworks`) + listed-by 보강(`listPublicArtworksListedByProfileId`) 모두 principal scope. `getMyProfile()` 도 acting-as 시 `getProfileById(actingAsProfileId)` 로 우선 조회.
  - [SaveToShortlistModal](src/components/SaveToShortlistModal.tsx) — `listMyShortlists` / `getShortlistIdsForX` / `createShortlist` 가 모두 principal scope 으로 호출. 보드 saving 토글이 일관되게 principal 의 보드 컬렉션에 적용.
- **/settings operator-lock 안내** ([src/app/settings/page.tsx](src/app/settings/page.tsx)) — `useActingAs()` 도입, acting-as 활성 시 페이지 상단에 amber 안내 배너 노출 ("계정 설정은 언제나 본인 계정 기준입니다"). 저장 흐름은 종전대로 operator session uid 기준.
- **i18n 라벨 추가** ([src/lib/i18n/messages.ts](src/lib/i18n/messages.ts)) — `acting.chip.posting/editing/replying/principalFallback/operatorFallback` (Phase 3 chip 컴포넌트용) + `acting.lock.notice.title/body/fallbackName` (Phase 2 settings 배너용). EN/KR 모두.

### Supabase SQL

- 추가/변경 없음 (Phase 1 마이그레이션만 필요).

### 환경 변수

- 추가/변경 없음.

### Verified

- `npx tsc --noEmit` 통과.
- 변경 파일 lint 0 issue.
- 회귀 시나리오:
  - solo 사용자: 모든 헬퍼의 `forProfileId` 미전달 시 종전대로 `session.user.id` 사용. /settings 배너 미노출.
  - delegate writer (account scope): `/my/library`, `/my/exhibitions`, `/my/shortlists`, `/upload/bulk` 의 picker, `/my/exhibitions/[id]/add` 모두 principal 의 데이터 표시. `SaveToShortlistModal` 토글이 principal 보드 기준 동작.
  - delegate writer 가 `/settings` 진입 시 operator-lock 배너 노출, 저장은 본인 프로필에 적용 (regardless of acting-as).
  - 아바타 드롭다운 / 헤더 메뉴 변경 없음 (Phase 3 에서 account switcher 추가 예정).

---

## 2026-04-28 — Acting-as Persona Hardening · Phase 1 (Backend / Data layer)

QA(2026-04-28) 보고서 5건 수습 패치(`f809f5b`) 직후 진행한 acting-as 표면 전수 감사 결과, QA3 와 동일 패턴(`session.user.id` 만 신뢰)이 다른 mutation/edit/RLS 표면에도 잠재되어 있음을 확인. 회귀 위험을 최소화하는 3-phase 분할의 첫 번째: 백엔드/RLS 정합화. 페르소나 결정 (workspace = principal swap, account/security = operator lock) 은 Phase 2/3 와 함께 단계적으로 적용.

### 변경 요약

- **canEditArtwork / canDeleteArtwork / getMyClaim 시그니처 일반화** ([src/lib/supabase/artworks.ts](src/lib/supabase/artworks.ts)) — 단일 `userId: string | null` 에서 `UserIdLike = string | string[] | null` 로 확장. 배열을 받아 effective IDs 중 하나라도 매치하면 권한 인정. `getMyClaim` 은 첫 매치 우선 (caller 가 principal 을 array 첫 번째로 두면 principal claim 우선 hydrate). solo 호출자는 단일 string 그대로 전달 → 0 회귀.
- **작품 상세/편집 acting-as 정합** ([src/app/artwork/[id]/page.tsx](src/app/artwork/[id]/page.tsx), [src/app/artwork/[id]/edit/page.tsx](src/app/artwork/[id]/edit/page.tsx)) — `useActingAs()` 도입, `effectiveIds = [actingAsProfileId, userId]` 로 권한 체크. 편집 화면은 추가로 (a) CREATED 분기의 `artist_id` 가 `actingAsProfileId ?? userId`, (b) claim 생성 RPC 호출에 `subjectProfileId: actingAsProfileId ?? undefined`. delegate writer 가 principal 작품을 편집하려고 들어가도 더 이상 `/artwork/[id]` 로 리다이렉트되지 않고, 저장 시 모든 row 가 principal 명의로 정합되게 흐름.
- **createClaimRequest RPC 화 + subjectProfileId** ([src/lib/provenance/rpc.ts](src/lib/provenance/rpc.ts)) — 직접 `claims` INSERT (`subject_profile_id = session.user.id` 고정) 였던 viewer claim 요청 흐름을 신규 SECURITY DEFINER RPC `create_claim_request` 로 전환. 옵셔널 `p_subject_profile_id` 가 caller 와 다르면 `is_active_account_delegate_writer(subject)` 검증 후 통과. 공개 작품 페이지에서 delegate 가 "이 작품 우리가 소장중" 같은 클레임을 걸어도 principal 의 pending claim 으로 attach.
- **shortlists (보드) RLS + 헬퍼 인자** ([src/lib/supabase/shortlists.ts](src/lib/supabase/shortlists.ts)) — `createShortlist`, `listMyShortlists`, `getShortlistIdsForArtwork`, `getShortlistIdsForExhibition` 모두 `options.forProfileId` 추가. 기본값은 종전대로 `session.user.id`. RLS 측에서는 `shortlists / shortlist_items / shortlist_collaborators / shortlist_views` 에 `is_active_account_delegate_writer(owner_id)` 기반 additive permissive 정책을 추가 (기존 `shortlists_owner_all` 등은 untouched). 다중 정책 OR 평가이므로 solo owner 권한은 보존.

### Supabase SQL (적용 필요)

- `supabase/migrations/20260509000000_delegate_claim_request_and_shortlist.sql` — (idempotent · `create or replace function` + `drop policy if exists … create policy …`)
  - 신규 RPC `create_claim_request(uuid, text, uuid, text, uuid)` (security definer, delegate writer 가드)
  - 신규 헬퍼 `is_shortlist_owned_by_account_delegate(uuid)` (security definer, 재귀 RLS 회피용 — 기존 `is_shortlist_owner` 와 동일 패턴)
  - shortlists / shortlist_items / shortlist_collaborators / shortlist_views 4 테이블에 `*_account_delegate` permissive 정책 추가

### 환경 변수

- 추가/변경 없음.

### Verified

- `npx tsc --noEmit` 통과.
- 변경 파일 lint 0 issue.
- 회귀 시나리오:
  - solo 사용자: `canEditArtwork(artwork, userId)` 의 `userId` 단일 문자열 호출 그대로 동작. shortlist 헬퍼들 0-arg 호출 보존. RLS 기존 owner 정책 untouched.
  - delegate writer (account scope, manage_artworks/manage_claims 보유): principal 작품 edit 페이지 진입 가능, 저장 시 artist_id/claim subject 모두 principal. 보드 생성/조회 시 `forProfileId` 전달하면 principal owner 로 row 생성. forProfileId 미전달 시 종전대로 operator owner.
  - delegate without manage_*: 신규 RPC `create_claim_request` 가 `forbidden` 예외로 차단 (security definer 가드).
  - non-writer (예: account_review): RPC 가드 차단, RLS additive 정책도 `is_active_account_delegate_writer` 가 false 라 통과 안됨.

---

## 2026-04-28 — QA Stabilization (Profile / Acting-as / Inbox)

QA(2026-04-28) 보고서 5건을 수습한 안정화 패치. UX 흠집 2건 + 기능 회귀 3건을 인접 잘 작동하던 표면(파라미터/RLS/기존 RPC)을 건드리지 않고 정합화했습니다.

### 변경 요약

- **QA1 — 공개 프로필 웹사이트 직링 (제안)** — `UserProfileContent` 가 website 를 plain text 로만 노출했던 부분을 `<a>` 로 승격. scheme 이 빠진 값도 표시 시 정리하고 href 에는 `https://` 를 안전하게 붙임. `target="_blank" rel="noopener noreferrer nofollow"` 적용으로 referrer/탭 누수 차단.
- **QA2 — `https://` 없이도 등록 (오류)** — `normalizeUrl` 이 `new URL()` 만으로 검증하던 동작을 보강해 `www.example.com` / `example.com` / `example.com/path` 같은 베어 도메인을 자동으로 `https://` prefix 후 검증하도록 변경. 공백 포함·점 없는 단어·잘못된 scheme 은 여전히 거부. `/settings` 의 input 은 `type="url"` → `type="text" inputMode="url"` 로 바꿔 브라우저 native "Please enter a url" 검증을 비활성화 (서버 정규화가 SSOT).
- **QA3 — 위임 acting-as 업로드가 본인 프로필로 가는 버그 (CRITICAL · 오류)** — 단일 업로드(`/upload`) 흐름에서 acting-as 가 활성화되어 있어도 (a) `intent === "CREATED"` 시 claim 의 `artist_profile_id` 가 operator 로, (b) 모든 claim 의 `subject_profile_id` 가 RPC `auth.uid()` 즉 operator 로 박혀 있어 **artwork.artist_id 만 principal 이고 claim 은 operator 인 채로 두 프로필에 동시에 보이거나 operator 쪽으로 흐르는** 회귀가 있었습니다. 수정:
  1. `create_claim_for_existing_artist` / `create_external_artist_and_claim` RPC 에 옵션 `p_subject_profile_id` 추가. 호출자와 다르면 `is_active_account_delegate_writer(subject)` 통과 시에만 허용 (그 외 forbidden 예외).
  2. 클라이언트 헬퍼(`createClaimForExistingArtist`, `createExternalArtistAndClaim`) 에 `subjectProfileId` 인자 추가.
  3. `/upload/page.tsx` 가 acting-as 시 (a) CREATED intent 의 `artistProfileId = actingAsProfileId ?? userId`, (b) claim 호출 양쪽에 `subjectProfileId: actingAsProfileId`, (c) 업로드 완료 후 redirect 도 principal username 으로 라우팅.
  4. `/upload/bulk/page.tsx` 의 `publishArtworks(ids, { forProfileId })` / `publishArtworksWithProvenance(ids, { onBehalfOfProfileId })` 도 acting-as 컨텍스트를 그대로 전달 (드래프트의 `artist_id` 가 principal 이므로 prior `.eq("artist_id", session.user.id)` filter 가 0행을 업데이트하던 침묵 실패도 동시 해소).
- **QA4 — 학력 삭제 불가 / 빈 값 저장 후 복구 (오류)** — 두 단계의 회귀가 있었음:
  1. `removeEducation()` 이 `prev.length > 1` 가드로 마지막 행 삭제를 거부 → 사용자 입력 자체가 사라지지 않았음. 마지막 행도 삭제 가능하게 풀고, 빈 placeholder 1줄로 폴딩.
  2. `normalizeProfileBase` 가 비워진 education 을 `null` 로 반환했고, `compactPatch` 가 null/empty array 를 모두 strip → RPC 까지 도달하지 못해 DB 미반영 → 새로고침 시 옛 값으로 복구.
  - `NormalizedBasePayload.education` 을 `EducationEntryNormalized[]` (절대 null 아님) 으로 강제. 빈 배열은 의미 있는 "비움" 상태.
  - `profileSaveUnified.compactPatch` 에 `CLEARABLE_ARRAY_BASE_KEYS` 셋을 신설하고 `education` 만 빈 배열을 RPC 까지 forward 하도록 허용. NOT NULL 위반(23502) 위험 없는 키만 화이트리스트 함.
- **QA5 — 답변 완료 문의의 빨간 (1) 배지 잔존 (제안)** — `getMyPriceInquiryCount` 가 모든 inquiry 를 세고 있어 replied/closed 상태도 빨간 배지로 떠 있었음. `inquiry_status IN ('new','open') OR inquiry_status IS NULL` 조건을 추가해 사용자 주의가 필요한 항목만 카운트. 목록 페이지(`/my/inquiries`) 의 전체 카운트/리스트는 영향 없음.

### Supabase SQL (적용 필요)

- `supabase/migrations/20260508000000_claims_subject_for_delegate.sql` — `create_claim_for_existing_artist` 와 `create_external_artist_and_claim` 의 옵셔널 `p_subject_profile_id` 인자 + `is_active_account_delegate_writer` 가드. 기존 6/9-arg 시그니처를 drop 후 7/10-arg 로 교체. **idempotent**: drop 절은 `pg_proc` 존재 검사 후 실행.

### 환경 변수

- 추가/변경 없음.

### Verified

- `npx tsc --noEmit` 통과.
- 변경 파일 lint 0 issue (전역 75 사전 lint 는 모두 사전부터 존재).
- 회귀 시나리오:
  - 비-위임 사용자 단일 업로드: artistProfileId 분기 보존, RPC 옵션 인자 미전달 → 기존 behaviour 그대로.
  - acting-as principal 업로드 (CREATED): artwork.artist_id, claim.subject/artist 모두 principal. operator 프로필에는 노출 안 됨.
  - acting-as principal 업로드 (CURATED with selectedArtist): claim.artist=selectedArtist, claim.subject=principal. artwork.artist_id 도 selectedArtist (publishArtworksWithProvenance 의 update 로직 동일).
  - 학력 비우기: 빈 배열이 RPC 까지 흘러 `profiles.education = '[]'::jsonb` 로 저장. 새로고침 시 복구되지 않음.
  - 답변한 inquiry 1건 + 미답변 0건: studio inbox 카운트 0. 답변 후 새로고침 시 빨간 (1) 사라짐.

---

## 2026-04-27 — Beta Guidance Audit + Feedback Loop Upgrade

`Abstract_Beta_Guidance_Audit_Feedback_Upgrade_2026-04-27.md` 대응. 최근 추가된 AI 파트너/컨시어지·Board Pitch Pack·Exhibition Review·Delegation 위임/Acting-as·Website Import·Profile Identity 흐름이 기존 가이드 투어에 반영되지 않아 가이드와 실제 UI 간 정합성이 깨져 있던 문제를 정합화하고, 베타 단계 피드백 루프를 신규로 도입했습니다. **기존 tour provider/registry/persistence/overlay 시스템은 일체 중복 구현하지 않고**, 기존 인프라를 그대로 재사용·확장했습니다.

### 변경 요약

- **Tour coverage 감사** — `studio.main`, `upload.main` 의 누락 단계 보강 + `board.detail`, `exhibition.detail`, `profile.identity` 신규 등록.
  - `studio.main` v8: AI helpers 카드(`data-tour="studio-ai-helpers"`)를 새 step 으로 추가. 기존 사용자에 대해 1회 자동 재노출.
  - `upload.main` v3: Website Import 패널을 새 step 으로 추가 (`data-tour="upload-website-import"`).
  - `board.detail` 신규: header → share → pitch pack → items 4 step.
  - `exhibition.detail` 신규: header → review → media 3 step.
  - `profile.identity` 신규: avatar → cover → statement → bio 4 step.
- **앵커 추가** — 위 신규 투어가 가리킬 `data-tour` 앵커를 해당 페이지/컴포넌트(`StudioIntelligenceSurface`, `WebsiteImportPanel`, `BoardPitchPackPanel`, `ExhibitionReviewPanel`, `ProfileMediaUploader`, `StatementDraftAssist`, bio 필드)에 부착.
- **TourTrigger / TourHelpButton 마운트** — board detail, exhibition detail, settings 페이지에 `우상단 가이드 보기` 버튼 + 자동 1회 트리거 마운트.
- **Skip / completed / version 하드닝**
  - `TourProvider` 가 missing anchor 를 dev 콘솔에 경고로만 노출 (production 은 silent skip → 투어 깨짐 차단).
  - 기존 persistence (`user_tour_state` + localStorage) 의 status/version 가드 그대로 사용. 버전 bump 로 1회만 재노출, 그 이후 자동 재발동 없음.
  - 한국어 카피는 글리프 문제 차단 위해 계속 `tourKoCopy.ts` 하드 카피 우선.
- **Beta feedback 루프 (신규)**
  - `beta_feedback_events` 테이블 신설 (RLS: 인증 사용자 본인 row 만 insert, read 는 service role 한정).
  - `submitBetaFeedback` 헬퍼는 best-effort/non-throwing + sessionStorage throttling (페이지급은 1 세션 1회 한도).
  - `BetaFeedbackPrompt` 페이지급 컴포넌트 → My Studio, Bulk upload, Board detail, Exhibition detail, Delegation hub 5개 페이지에 마운트.
  - `AiFeedbackChips` 마이크로 피드백 (도움이 됐어요 / 조금 어색해요 / 다시 다듬어야 해요) → Board Pitch Pack, Exhibition Review, Delegation Brief 3개 AI 출력 결과 하단에 통합.
- **Non-goals (브리프 §6 명시 준수)** — Art Care Passport, Service Cards, Local Art Circuit 등 전략 백로그 항목은 본 패치에서 일체 손대지 않음.

### Supabase SQL (적용 필요)

- `supabase/migrations/20260507000000_beta_feedback_events.sql` — Supabase SQL Editor 에서 1회 실행 필요. idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 안 쓰지만 `IF NOT EXISTS`/policy 가드 적용).

### 환경 변수

- 추가/변경 없음.

### Verified

- `npx tsc --noEmit` 통과.
- `npm run lint` — 신규/수정 파일은 0 issue (사전부터 존재하는 pre-existing warnings/errors 만 잔존, 본 패치 책임 아님).
- 한국어 가이드 투어 카피는 `tourKoCopy.ts` 하드 카피로 글리프 깨짐 차단 (영문은 `messages.ts`).
- missing anchor regression: dev 빌드에서 콘솔 경고만 출력되고 투어가 silent fallback 되는지 `TourProvider.enterTour` 로직 회귀 점검 완료.

---

## 2026-04-27 — AI Layer UX Completion NextPatch (existing surfaces migration + Exhibition Review mounting)

`Abstract_AI_Layer_UX_Completion_NextPatch_2026-04-27.md` 대응. 직전 통일 패치에서 회귀 위험 때문에 보류했던 **기존 8개 AI surface** 를 공용 primitives 시스템으로 점진 이전하고, 누락되어 있던 `ExhibitionReviewPanel` 의 페이지 마운팅을 보완했습니다. 데이터 플로우/AI 라우트/외부 API 시그니처는 일체 손대지 않은, **외피·상태·copy·텔레메트리** 정렬 패치입니다.

### P0 — `ExhibitionReviewPanel` 마운팅 (브리프 §3)

전 패치에서 컴포넌트는 만들었지만 페이지에 import 되지 않아 사실상 invisible 했던 문제 해결.

- `src/app/my/exhibitions/[id]/page.tsx` — 헤더(편집/추가/위임 매니저 초대) 액션 줄 직후, 대표 썸네일 섹션 직전에 마운트.
- `AiSurfaceFrame` 의 `defaultOpen=false` 덕분에 페이지가 무겁게 느껴지지 않음 (collapsed CTA).
- 한 가지 주의: 패널 내부에서 권한·exhibition fetch 를 자체 처리하므로 부모 페이지의 fetch 와 충돌 없음.

### 마이그레이션 — 기존 4개 Studio Intelligence 카드 (`/my`)

전략: **`SectionFrame` 외피는 유지** (My Studio 그리드는 always-open 가정으로 짜여 있어 fold-default 인 `AiSurfaceFrame` 으로 바꾸면 정보 노출도가 떨어지는 UX 회귀 발생). 내부 동작·문구만 primitives 로 정렬.

| 카드 | 변경 | 보존 |
|---|---|---|
| `ProfileCopilotCard` | error → `AiStateBlock`, 모든 copy 버튼 → `AiCopyButton(feature="profile_copilot")`, 하단 `AiDisclosureNote` | completeness 게이지, suggestion 그룹, viewer notes, bio/headline drafts, openSettings 링크 |
| `PortfolioCopilotCard` | error → `AiStateBlock`, 모든 copy 버튼 → `AiCopyButton(feature="portfolio_copilot")`, kind chip → `AiStatusChip`, 하단 `AiDisclosureNote` | ordering rationale, 그룹화, metadata gaps, mark reviewed, `titleForChip` 휴먼 라벨 (UUID 노출 없음 재확인) |
| `WeeklyDigestCard` | error → `AiStateBlock`, 하단 `AiDisclosureNote`, 로딩 라벨 통일 | headline / changes / nextActions 링크 |
| `MatchmakerCard` | error → `AiStateBlock` (degradedReason → AiDegradation shape), role chip → `AiStatusChip`, 하단 `AiDisclosureNote` | peer 리스트, IntroMessageAssist autoOpen, follow/intro_note/exhibition_share/save_for_later 액션 |

UUID 폴백 점검: `PortfolioCopilotCard.titleForChip` 는 `artworkTitles[id]` 없을 시 `t("ai.portfolio.unnamedSlot").replace("{n}", String(slotIndex+1))` 휴먼 폴백 사용. raw `id.slice(0,8)` 노출 없음 확인.

### 마이그레이션 — Draft Assists

- `AiDraftPanel` 은 canonical 로 유지 (브리프 §10.2 "Use AiDraftPanel if it remains canonical"). 두 시스템 중복 회피.
- `AiDraftPanel` 내부 로딩 라벨 `ai.state.loading` → `ai.common.loading` 정렬.
- `BioDraftAssist` — 로딩 라벨 정렬. 데이터 플로우/tone 선택/apply UX 그대로.
- `StatementDraftAssist` — 로딩 라벨 정렬, 인라인 copy 버튼 → `AiCopyButton`, error → `AiStateBlock`.
- `ExhibitionDraftAssist` — `AiDraftPanel` 이 이미 정렬되어 있어 추가 변경 없음 (kind 토글 + 4종 출력 그대로).
- `IntroMessageAssist` — sheet/portal/팔로우+발송 흐름은 user-trust-sensitive 라 외형 변경 없음. `errorKey` 도출만 양쪽(InlineDraftView/IntroSheet) 모두 `aiErrorKey()` 로 통일 (이전: 인라인 reason switch).

### 마이그레이션 — `InquiryReplyAssist`

- 트리아주 chip → `AiStatusChip` (intent: neutral, priority: warn / ok / neutral).
- 로딩 라벨 통일.
- 중요한 send-after-edit 흐름·`onApply(text, aiEventId)` 시그니처·via:"send" 정책 그대로.

### 변경 / 변경 없음 요약

**변경된 surface (10개):**
- `ProfileCopilotCard`
- `PortfolioCopilotCard`
- `WeeklyDigestCard`
- `MatchmakerCard`
- `InquiryReplyAssist`
- `StatementDraftAssist`
- `BioDraftAssist` (라벨만)
- `IntroMessageAssist` (errorKey 통일만)
- `AiDraftPanel` (라벨만)
- `src/app/my/exhibitions/[id]/page.tsx` (mount)

**변경 없는 surface:**
- `ExhibitionDraftAssist` (이미 `AiDraftPanel` 통해 정렬됨)
- `BoardPitchPackPanel` / `ExhibitionReviewPanel` / `DelegationBriefPanel` (직전 패치에서 이미 primitives 정렬 완료)

### 안 한 것 / 의도적 보류

- 4개 Studio Intelligence 카드의 `SectionFrame → AiSurfaceFrame` 외피 교체는 회귀 위험 큼 (My Studio 그리드 always-open 패턴이 fold-default 와 충돌). 카드별 chrome 은 유지하고 내부 동작만 정렬.
- `IntroMessageAssist` sheet 내부 DraftItem 의 자체 copy chip 은 selectable/editable 모드와 강결합되어 있어 그대로 유지. `markAiAccepted(via:"copy")` 는 이미 호출됨.
- 추가 prop 확장 없음 (브리프 §11.1 "current primitives.tsx is intentionally small. Keep it that way").

### 검증

- `npx tsc --noEmit` — 0 errors.
- `npx eslint <changed files>` — 0 errors (기존 react-hooks/exhaustive-deps 경고 2건은 pre-existing, 본 패치 무관).
- `npx next build` — production build 성공.
- 수동 QA 체크리스트 (브리프 §16):
  - [ ] My Studio 진입 → 4 카드 전 시각적 일관성, 로딩 시 "초안을 정리하는 중…" 표시, copy 버튼 1.5s "복사됨" 토스트.
  - [ ] Profile Copilot — 미완 프로필에서 suggestion 그룹·bio drafts 표시, 컴플리트 프로필에서 calm empty.
  - [ ] Portfolio Copilot — 작품 1개 미만 disabled 메시지, 다수일 때 ordering + grouped suggestions, 무제 작품에서 raw UUID 안 보임.
  - [ ] Weekly Digest — 활동 0 / 활동 있음 양쪽.
  - [ ] Matchmaker — 다양한 액션 (follow/intro/exhibition_share/save_for_later) 정상.
  - [ ] Exhibition detail (`/my/exhibitions/[id]`) — Review 패널 헤더 직후 collapsed 상태로 표시, 클릭 → 생성 → checklist + alternative copies + AiCopyButton.
  - [ ] Inquiry reply 화면 — triage chip 색감 (warn/ok/neutral) 일치.
  - [ ] Settings → Statement assist — error 시 amber, copy 버튼 정상.
  - [ ] Bio assist — auto-apply 모드 그대로, applied 시 markAiAccepted via:"apply".

### 워크스페이스 룰 체크

1. **Supabase SQL**: 추가/변경 없음.
2. **Git push**: `release: ai layer ux completion (mount exhibition review · migrate 4 studio cards · primitives polish)` 메인 푸시 완료.
3. **HANDOFF.md**: 본 섹션이 그 결과.
4. **환경 변수**: 추가/변경 없음.

---

## 2026-04-27 — AI Layer UX/Design Unification (shared primitives + new-panel migration)

`Abstract_AI_Layer_UX_Design_Unification_2026-04-27.md` 대응. 11개 AI surface 가 한 시스템처럼 보이도록 **공용 primitives** 를 도입하고, 가장 새 surface 3개(Board Pitch Pack / Exhibition Review / Delegation Brief) 를 그 primitives 로 정렬했습니다. 기존 surface 8개의 광범위 리팩터는 회귀 위험을 고려해 의도적으로 보류 (브리프 §14 권고).

### 새로 도입한 공용 primitives — `src/components/ai/primitives.tsx` (단일 파일)

| 컴포넌트 | 역할 |
|---|---|
| `AiSurfaceFrame` | 모든 AI 패널의 공통 collapsible 프레임. Eyebrow / title / subtitle / chevron / 내부 spacing. `defaultOpen=false` 로 fold-default. |
| `AiStateBlock` | loading / degraded / empty 상태를 통일 카피로 렌더. 내부적으로 `aiErrorKey` 를 사용해 11개 reason → i18n 매핑. |
| `AiCopyButton` | clipboard 복사 + `markAiAccepted({ feature, via: "copy", ...meta })` best-effort. 1.5s "복사됨" 토스트 inline. |
| `AiResultSection` | 패널 내부 sub-section 의 라벨/`tone="warn"`/optional collapsible. |
| `AiDisclosureNote` | 한 줄 humble 디스클로저 (`ai.common.disclosure`). |
| `AiStatusChip` | severity / kind / draft 라벨용 chip. tone: neutral/suggest/warn/ok/draft. |

설계 원칙:
- 단일 파일로 응집 — 7개 파일로 쪼개지 않음 (브리프 §4 "If fewer files are cleaner, combine them").
- props 표면 작게 유지 — 패널이 특수 마크업 필요하면 frame 안에서 직접 렌더하라 (no over-abstraction).
- `aiCardState.aiErrorKey` 가 canonical reason→i18n 매퍼. primitives 가 그걸 re-export 만.

### `ai.common.*` i18n family 신설 (EN + KO)

`messages.ts` 에 11개 키 추가 — 모든 AI primitives 가 참조:
- `ai.common.loading` / `ai.common.regenerate` / `ai.common.dismiss`
- `ai.common.copy` / `ai.common.copied`
- `ai.common.empty` / `ai.common.disclosure` / `ai.common.degradedFallback`
- `ai.common.unauthorized` / `ai.common.noAutoApply`

기존 `ai.error.*` / `ai.action.*` / `ai.state.*` 은 이미 11개 reason 모두 커버하고 있어 그대로 둠. `ai.common.*` 은 primitives 의 기본값이고, 패널별 카피(예: `boards.pitchPack.cta`)는 그대로 살림.

### 신규 3개 패널 → primitives 로 migration

| 파일 | 변경 |
|---|---|
| `src/components/board/BoardPitchPackPanel.tsx` | `AiSurfaceFrame` + `AiStateBlock` + `AiResultSection` + `AiStatusChip(draft)` + `AiCopyButton` + `AiDisclosureNote`. `itemCount` 0/1 helper 그대로 유지. perWork 섹션은 5개 초과 시 collapsible. |
| `src/components/exhibition/ExhibitionReviewPanel.tsx` | 동일 primitives 적용. severity → `AiStatusChip` tone 매핑(`info→neutral`, `suggest→suggest`, `warn→warn`). 코드(예: `missing_title`) 노출 제거 — 사용자에게 raw 식별자가 보이지 않도록. |
| `src/components/delegation/DelegationBriefPanel.tsx` | 동일 primitives 적용. calm-state 카드 유지(`delegation.brief.calmTitle/Detail`). watchItems 는 `tone="warn"` 결과 섹션. |

세 패널 모두:
- `AiSurfaceFrame` 의 collapse-by-default 로 above-the-fold density 압박 없음 (브리프 §3.1).
- CTA 라벨이 idle ↔ regenerate 로 자연스럽게 토글 (`ai.common.regenerate`).
- copy / dismiss 만 가능 — auto publish/send/edit 절대 없음 (§2.2).

### 의도적으로 건드리지 않은 영역 (회귀 위험 관리)

브리프 §14: "Do not refactor every AI component so aggressively that the patch becomes unstable."

| Surface | 현 상태 | 결정 |
|---|---|---|
| `ProfileCopilotCard` | grouped suggestions / viewer notes / 카피 버튼 / 채택 추적 모두 함수적. SectionFrame 사용. | 보류 |
| `PortfolioCopilotCard` | `id.slice(0,8)` raw UUID 갭은 이미 `ai.portfolio.unnamedSlot` ("Untitled work {n}") 친화 폴백으로 닫혀 있음 (감사 결과). | 추가 작업 불필요 |
| `WeeklyDigestCard`, `MatchmakerCard` | 자체 SectionFrame 사용 + `aiErrorKey` 통합. tone humble. | 보류 |
| `ExhibitionDraftAssist`, `InquiryReplyAssist`, `BioDraftAssist`, `IntroMessageAssist` | 모두 `AiDraftPanel` 사용 — copy/apply UX 와 reason 매핑이 이미 일관됨. | 보류 |

이 8개 surface 는 다음 패치에서 점진적으로 primitives 로 옮길 수 있도록 primitives API 가 호환적입니다. 한 번에 묶어 옮기지 않은 이유는 (a) `AiDraftPanel` 의 apply/replace/append 모드가 풍부해 1대1 대체가 비자명, (b) Profile/Portfolio Copilot 의 grouped suggestions UI 가 단순 frame 으로 매핑되지 않음, (c) 대량 surface 변경은 회귀 risk가 큼.

### 보안 / 권한 / 텔레메트리 — 변동 없음

- 컨텍스트 빌드와 권한 가드는 라우트 측에 그대로 (`board-pitch-pack` / `exhibition-review` / `delegation-brief`).
- `markAiAccepted({ feature, via: "copy", meta })` 는 primitives `AiCopyButton` 안에서 best-effort 호출. 텔레메트리 실패가 UX 를 차단하지 않음 (§5.4).
- 클라이언트가 모델로 보내는 데이터: 라우트 입력은 모두 ID + locale 만. body 내 비밀 텍스트 없음 (§10.1 그대로).

### Manual QA matrix (수동 점검 권장)

#### Board Pitch Pack (`/my/shortlists/[id]`)
1. 빈 보드 → 패널 펼치면 `boards.pitchPack.emptyHelper` 만 렌더, CTA 노출 안 됨.
2. 1개 보드 → CTA + `singleItemHint` 함께 노출.
3. 2개 이상 → `초안 만들기` 클릭 → summary / throughline / drafts(chip="요약/콜드 메일/월 텍스트") + 각 항목 옆 복사버튼.
4. 키 부재 (degraded `no_key`) → `ai.common.degradedFallback` 류 amber 안내 + deterministic missingInfo 검출 작동.
5. 키 있음 → 정상 모델 응답.
6. 모바일 너비 → frame chevron / chip 모두 wrap 정상.

#### Exhibition Review (`/my/exhibitions/[id]/edit`)
1. 비어 있는 전시 → 검토하기 → readiness 낮음 + warn/suggest issues 표시.
2. 잘 채워진 전시 → readiness 100% 또는 가까움.
3. issue 의 suggestion 옆 복사버튼이 1.5s "복사됨" 토스트 표시 + telemetry 호출.
4. degraded → amber 안내 + deterministic 7-check 결과.

#### Delegation Brief (`/my` 에서 acting-as 활성 시)
1. 우선순위 / watch items 모두 0 → calm 카드 표시 (`delegation.brief.calmTitle`).
2. 미답변 inquiries 등 → priorities 카드 + open 링크 (자체 라우트).
3. draftMessage 있을 때 복사 → telemetry 호출 + 토스트.

### 회귀 점검 (Regression checklist 기준)

`npx tsc --noEmit` ✅ / `npx eslint` (수정 파일 4개) ✅. 다음 surface 수동 sanity:
- My Studio 로드 (Profile/Portfolio/Digest/Matchmaker) — 변경 없음.
- 보드 / 전시 편집 — 변경 없음.
- 알림 / 위임 acting-as / inquiry reply — 변경 없음.

### Non-goals (브리프 §15 — 본 패치에서 미구현, 향후 archived)

Art Care Passport, Service Cards, Local Art Circuit, Fair Match, Collective Signal, venue/provider profiles, PDF export, automatic email send, automatic exhibition edits, global AI chat, billing/paywall changes, mobile push.

### Files changed
- `src/components/ai/primitives.tsx` (신규)
- `src/components/board/BoardPitchPackPanel.tsx` (rewrite, props 동일)
- `src/components/exhibition/ExhibitionReviewPanel.tsx` (rewrite, props 동일)
- `src/components/delegation/DelegationBriefPanel.tsx` (rewrite, props 동일)
- `src/lib/i18n/messages.ts` (`ai.common.*` 11개 키 EN + KO)
- `docs/HANDOFF.md` (이 섹션)

### 워크스페이스 룰 체크
1. **Supabase SQL**: 추가/수정된 `.sql` 없음 → "Supabase SQL 돌려야 할 것은 없음".
2. **Git push**: `release: AI layer UX/design unification (primitives + new-panel migration)` 메인 직커밋.
3. **HANDOFF.md**: 본 섹션이 최상단에 추가됨.
4. **환경 변수**: 추가/변경 없음.

---

## 2026-04-27 — P1 AI Workflow Surface Integration (deterministic fallback + helper/calm states)

`Abstract_P1_AI_Workflow_Surface_Integration_2026-04-27.md` 작업지시서 대응. 인프라(라우트·타입·프롬프트·feature/usage keys·메터·permission guards)는 이전 패치로 **이미 모두 wired** 되어 있었음. 이번 패치는 surface integration / polish 만:

### Audit 결과 — 이미 정상이라 건드리지 않은 영역
| 영역 | 상태 |
|---|---|
| `POST /api/ai/board-pitch-pack` | shortlists RLS 위에 owner/collaborator 만 컨텍스트 빌드. 이미 안전. |
| `POST /api/ai/exhibition-review` | curator/host 또는 active account/inventory/project-scope delegate 가드. 이미 안전. |
| `POST /api/ai/delegation-brief` | `userMayActAs(manage_works, account|inventory)` 가드 + 모든 카운트가 `actingAsProfileId` 로만 조회 (operator 본인 데이터 누출 없음). 이미 안전. |
| Feature keys (`ai.board_pitch_pack`/`ai.exhibition_review`/`ai.delegation_brief`) | `featureKeys.ts` + `planMatrix.ts` 에 모든 플랜 free 포함 등록. 베타 paywall 0. |
| Usage keys (`ai.*.generated`) + `AI_FEATURE_TO_METER_KEY` | 이미 등록. 라우트가 자동 미터링. |
| Accept tracking | 세 패널 모두 `markAiAccepted({ feature, via: "copy" })` 가 wired. |
| Mounting | `/my/shortlists/[id]` (Board), `/my/exhibitions/[id]/edit` (Exhibition), `/my` 의 acting-as 시 (Delegation) — 모두 이미 마운트. |
| Humble copy / no autopilot | i18n 카피가 "초안", "제안", "확인이 필요해요" 등 humble 톤. 자동 발송/적용 없음. |

### 닫은 갭 (Polish)

#### 1. 결정론적 fallback (브리프 §3.4 / §5.10)
**문제**: 세 라우트 모두 `fallback: () => ({ ... 빈 배열 })` 을 반환. OpenAI 키 부재(`no_key`)나 모델 실패 시 사용자가 빈 패널만 보게 됨 → 브리프가 명시한 "AI fails: still show deterministic checklist from actual fields. Do not show fake prose." 위반.

**해결**: 세 라우트의 `fallback()` 이 *서버 측에서 이미 빌드한 ctx* 를 그대로 사용해 결정론적 result 를 생성. 모델이 죽어도 사용자는 실제 작품/전시/카운트 기반의 체크리스트와 요약을 받음.

- **`src/app/api/ai/board-pitch-pack/route.ts` `buildBoardPitchPackFallback()`**
  - `summary`: `이 보드는 작품 N점, 전시 M점을 묶고 있어요.` (보드 제목/카운트만 사용)
  - `missingInfo`: 보드 설명 비어있는지, 작품 메타데이터 누락 점수, 항목 < 2 인지를 점검해서 한국어/영어 카피로 출력.
  - `drafts: []`, `throughline: ""` — 가짜 prose 절대 생성 안 함.

- **`src/app/api/ai/exhibition-review/route.ts` `buildExhibitionReviewFallback()`**
  - 7개 결정론적 체크 (title / dates / venue / curator-or-host / cover / works-linked / few-works) 를 `ctx` 의 실제 필드값으로 평가.
  - `readiness` = passed/total 비율로 계산 (gentle bar 그대로 유지, 브리프 §5.8 의 "No numeric score unless already designed very gently" 충족).
  - `description` 체크는 의도적으로 제외 — `projects` 테이블에 `description` 컬럼이 없음 (P0 schema). 데이터가 들어오면 추후 추가.

- **`src/app/api/ai/delegation-brief/route.ts` `buildDelegationBriefFallback()`**
  - 미답변 inquiry / 미공개 작품 / 전시 cover gap / profile readiness < 70% 4개 조건을 카운트로 평가, 최대 4개 priorities 와 최대 3개 watchItems 생성.
  - 모든 priority 가 실제 라우트로 deep-link (`/my/inquiries`, `/my`, `/my/exhibitions`, `/profile/edit`).
  - `oldestUnansweredInquiryDays >= 7` 이면 watchItem 으로 추가 노출.
  - `profileIsPublic === false` 면 watchItem 으로 추가.

#### 2. Board Pitch Pack 0/1 items helper (브리프 §4.3)
**문제**: 빈 보드에서도 CTA 가 그대로 노출되어 클릭 시 의미 없는 호출 발생.

**해결**: `BoardPitchPackPanel` 에 optional `itemCount` prop 추가, `/my/shortlists/[id]/page.tsx` 가 `items.length` 를 전달.
- 0 items → CTA 가 helper line 으로 대체 (`작품이나 전시를 2개 이상 담으면 보드 초안을 만들 수 있어요.`).
- 1 item → CTA 는 노출하되 그 아래 `항목이 2개 이상일 때 더 풍부한 초안이 만들어져요.` 힌트.
- 2+ items → 기존 동작 그대로.

#### 3. Delegation Brief calm state (브리프 §6.6)
**문제**: AI 가 정상 응답했지만 priorities/watchItems 가 모두 비어있을 때 (= 작가 계정이 깨끗할 때) 패널이 그냥 침묵.

**해결**: `DelegationBriefPanel` 에 결과가 있고 errorKey 가 없을 때 priorities/watchItems 모두 비어있으면 calm state 카드 (`지금 급한 작업은 많지 않습니다. / 프로필·작품·문의가 정돈되어 있어요. ...`) 노출. 자동 발송/실행 절대 없음.

### 추가/변경 i18n 키 (en + ko 양쪽)
- `boards.pitchPack.emptyHelper`, `boards.pitchPack.singleItemHint`
- `delegation.brief.calmTitle`, `delegation.brief.calmDetail`

### 의도적 미구현 (브리프 §15 의 non-goals 와 일치)
- Mode selector tabs (curator_memo / collector_note / gallery_internal / email_pitch) — 현재 prompt schema 가 `summary | outreach | wall_text` 3종 kind 로 충분히 커버. 새 mode 도입은 prompt 재설계가 필요해 다음 사이클로 보류.
- `completenessChecks[]` shape 마이그레이션 — 현재 `issues[].severity` 가 동일한 의미 (info / suggest / warn ↔ complete / could_improve / missing) 를 이미 표현. UI 변경 없이 운영. 추후 데이터 모델이 풍부해지면 전환 검토.
- `headline` / `priority: time_sensitive | high_value` 메타 — 현재 패널이 carousel/severity-tier 없이도 충분히 읽힘. 데이터 시그널이 더 쌓이면 추가.
- Exhibition `description` 체크 — 컬럼 부재로 deterministic check 에서 제외. P2 에서 schema 추가 시 함께 enable.

### 수정 파일
- `src/app/api/ai/board-pitch-pack/route.ts` — `buildBoardPitchPackFallback()` 추가, `fallback` wired.
- `src/app/api/ai/exhibition-review/route.ts` — `buildExhibitionReviewFallback()` 추가, `fallback` wired.
- `src/app/api/ai/delegation-brief/route.ts` — `buildDelegationBriefFallback()` 추가, `fallback` wired.
- `src/components/board/BoardPitchPackPanel.tsx` — `itemCount` prop, 0/1 items helper.
- `src/components/delegation/DelegationBriefPanel.tsx` — calm state 카드.
- `src/app/my/shortlists/[id]/page.tsx` — `itemCount={items.length}` 전달.
- `src/lib/i18n/messages.ts` — 4개 키 (en + ko).

### Verified
- `npx tsc --noEmit` clean.
- `npx eslint` clean (touched files).
- Supabase SQL 변경 없음. 환경 변수 변경 없음.

### Manual QA 메모
| 케이스 | 기대 동작 |
|---|---|
| 0-item 보드에서 패널 열기 | helper line 만 노출, CTA 없음 |
| 1-item 보드 | CTA + 단일항목 힌트 |
| 2+ item 보드 | 기존 동작 (CTA → 결과) |
| `OPENAI_API_KEY` 미설정으로 보드 호출 | `degraded.reason="no_key"` + `summary="이 보드는 작품 N점..."` + missingInfo 체크리스트 |
| 동일 조건으로 전시 review | `degraded.reason="no_key"` + 7개 체크 기반 `readiness%` + 미통과 항목 issues |
| 동일 조건으로 delegation brief | `degraded.reason="no_key"` + 4개 카운트 기반 priorities + watchItems |
| 작가 계정이 깨끗한 채 acting-as → AI 정상 응답 | calm state 카드 노출 |

---

## 2026-04-27 — Delegation Handoff-Parity Hardening (감사·랜딩·드로어 라벨 정리)

GPT 감사 결과로 내려온 parity hardening 작업지시서 (`Abstract_Delegation_Handoff_Parity_Hardening_2026-04-27.md`) 대응. **DB 측 explicit-accept 트리거가 이미 정확하다는 verdict** 가 나왔으므로 이 패치는 트리거를 다시 건드리지 않고, 그 위에서 발생한 **app-side parity 갭** 만 정확히 닫음.

### 1. 감사 결과 — 이미 잘 되어 있어 손대지 않은 영역

| 영역 | 상태 |
|---|---|
| 알림 유니온 4종 (`delegation_invite_received`/`accepted`/`declined`/`revoked`) | `src/lib/supabase/notifications.ts` 에 이미 등록됨. 누락 없음. |
| 알림 라벨 (영·한, 계정/프로젝트 분기) | `src/app/notifications/page.tsx` + `messages.ts` 에 이미 정의. 누락 없음. |
| 알림 라우팅 (모두 `/my/delegations` 으로 수렴) | 이미 보수적으로 통일. 누락 없음. |
| ActingAsContext stale probe | PR-B 에서 mount/focus/visibility 시점 RPC 검증 + 10s rate-limit + Header rose-tinted 배너 완비. |
| account preset RLS (`account_review` 가 write 못함) | PR-A 의 `has_active_account_delegate_perm` 헬퍼와 `*_writer` RLS 마이그레이션이 artworks/artwork_images/projects/exhibition_works/claims/can_reply_to_price_inquiry 모두 커버. |
| project manage destination 리졸버 | PR-B 의 `resolveManageDestination` 이 `project_co_edit→/edit`, `project_works_only→/add`, `project_review→stay+notice` 로 라우팅. (스펙은 `project_review→/my/exhibitions/[id]` 였지만 해당 페이지는 풀 편집 surface 라 리뷰-only 가 들어가도 의미가 없음. 공개 exhibition 라우트가 별도로 존재하지 않으므로 inline notice 가 가장 정직한 UX 라고 판단. 의도적 deviation.) |
| 이메일 실패 fallback (copy-link) | PR-C 의 fallback 패널 완비. |
| Feature key entitlements (`delegation.account/project/permission_presets/activity_log`) | `featureKeys.ts` + `planMatrix.ts` + 시드 마이그레이션 모두 정상. 베타에서 paywall 0. |

### 2. 실제 닫은 갭 (P0)

#### 2-1. `get_delegation_by_token` 가 `status = 'pending'` 필터로 dead-code 만들고 있던 그레이스풀 분기 (P0-B)

**문제**: PR-A 가 `/invites/delegation` 페이지에 `info.status === 'active' | 'declined' | 'revoked' | 'expired'` 분기를 추가했는데, 정작 RPC 가 pending 만 반환해서 그 분기가 한 번도 실행되지 않음. 모든 non-pending 토큰은 "invalid or expired" 로 떨어졌음.

**해결**: 신규 SQL `supabase/migrations/20260506000000_get_delegation_by_token_full.sql` — `status` 필터 제거 + `preset` 필드 추가. 보안 검토: 토큰 보유자는 이미 랜딩 페이지에 접근 가능하므로 scope/preset/owner profile 같은 공개 가능한 메타만 추가로 노출되며, 이메일 매칭/audit metadata 등은 여전히 노출 안 함.

#### 2-2. `/invites/delegation` 가 preset/permissions/denials 표시 안 함 (P0-B §4.3)

**문제**: 랜딩 페이지가 inviter 와 scope 만 표시. 사용자가 "내가 무엇을 수락하는지" 모른 채 클릭하게 됨.

**해결**: `src/app/invites/delegation/page.tsx` 전체 리라이트.
- preset 카드 (예: "운영 파트너", "검토 / 열람") 표시.
- "할 수 있는 일" 리스트 — `PRESET_PERMISSIONS[preset]` 로 i18n 라벨 출력.
- "공유되지 않는 것" denials 4종 (로그인 비밀번호, 결제, 계정 삭제, 새 위임 생성) 고정 노출.
- 거절 버튼이 더 이상 단순히 hub 로 라우팅하지 않고 `declineDelegationById` RPC 를 실제 호출. RPC 가 `not_found_or_not_pending` 반환 시 (= 트리거가 아직 link 못 했거나 중간에 다른 탭에서 처리됨) 조용히 hub 로 라우팅 (destructive 한 토스트 노출 안 함).
- 수락 RPC 가 `already_used` 코드를 반환하면 `load()` 다시 호출 → 정확한 already-active/declined/revoked 화면으로 자동 전환 (race 처리).

#### 2-3. 이메일 본문이 explicit-accept 의도를 흐리게 표현 (P0-B §4.4)

**문제**: 기존 카피 ("To accept, log in or sign up..." / "수락하려면 이 이메일로 로그인하거나 가입한 뒤") 가 가입 자체로 활성화된다고 오해할 여지.

**해결**: `src/app/api/delegation-invite-email/route.ts`
- EN 본문: "After signing in or creating an account with this email, you can review the delegation scope and accept or decline." + "Signing up alone does not activate access — you'll explicitly review and accept on the next screen."
- KR 본문: "이 이메일 주소로 가입하거나 로그인하면 위임 내용을 확인하고 수락할 수 있어요." + "가입만으로는 권한이 활성화되지 않아요. 다음 화면에서 직접 확인 후 수락해야 활성화됩니다."
- 버튼 라벨도 "Accept invitation / 초대 수락하기" → "Review the invitation / 초대 내용 확인하기" 로 변경 (수락은 랜딩 페이지에서 명시적으로 한다는 의미를 강화).
- 메일 제목도 "invited you to review a delegation" / "위임 내용을 보내셨어요 — 확인 후 수락해 주세요" 로 다듬음.

#### 2-4. `DelegationDetailDrawer` 가 알 수 없는 event_type 을 raw i18n key 로 표시 (P0-D §6.5)

**문제**: PR-A 트리거가 추가한 `invite_linked_at_signup` 과 PR-C RPC 트윈이 emit 하는 `delegated_artwork_*`/`delegated_exhibition_*`/`delegated_inquiry_replied` 가 i18n 라벨이 없어서 사용자에게 `delegation.event.delegated_artwork_published` 같은 raw 문자열로 노출됨.

**해결**:
- `src/lib/i18n/messages.ts`: 13 종 새 이벤트 라벨 (영·한). lifecycle 4종 + signup-link 1종 + delegated mutation 11종 + `unknown` fallback 1종 = 총 17 키 × 2 언어 = 34 항목.
- `src/components/delegation/DelegationDetailDrawer.tsx`: `eventLabel()` 헬퍼 추가. `t()` 가 raw key 를 그대로 반환하면 (i18n miss) `delegation.event.unknown` 로 폴백. 어떤 event_type 도 raw 문자열로 노출되지 않음.

### 3. P0-D 부분 연결 vs deferral 결정

스펙 §6.2 의 Option A 는 artwork create/update/publish/delete + exhibition update + works add/remove/reorder + inquiry reply 모두 연결 권장.

**현재 연결된 surface**:
- `artwork.create_draft` (acting-as 전용 forProfileId 진입점) → `delegated_artwork_created`
- `exhibition.create` (acting-as 전용 forProfileId 진입점) → `delegated_exhibition_created`
- `inquiry.reply` (artist 가 본인이 아니면 acting-as) → `delegated_inquiry_replied`

**아직 연결되지 않은 surface (deferred)**:
- artwork update / publish / delete: 함수 시그니처에 `forProfileId` 가 없고 RLS 가 `artist_id` 매칭으로 가드. 시그니처 확장은 본 패치의 trust hardening 범위를 넘어가는 변경이라 deferral.
- exhibition update / works add/remove/reorder: 동일하게 시그니처 확장 + 호출자리 다수 변경 필요.

**오해 방지 조치**: detail drawer copy 가 이미 `delegation.detail.recentActivity` ("최근 위임 활동" / "Recent activity") 로 되어 있어 "모든 활동 기록" 같은 misleading copy 는 없음. 추가로 unknown fallback 이 들어왔으므로, 향후 surface 연결 시 라벨을 messages.ts 에 추가만 하면 자동으로 정상 표시됨.

### 4. 변경 파일 요약

| 영역 | 파일 |
|---|---|
| SQL | `supabase/migrations/20260506000000_get_delegation_by_token_full.sql` (idempotent · additive) |
| UI | `src/app/invites/delegation/page.tsx` (리라이트: preset/denials/explicit decline/race 처리) |
| UI | `src/components/delegation/DelegationDetailDrawer.tsx` (event label fallback) |
| Lib | `src/lib/supabase/delegations.ts` (`GetDelegationByTokenResult.preset` 추가) |
| API | `src/app/api/delegation-invite-email/route.ts` (EN·KR explicit-accept 카피) |
| i18n | `src/lib/i18n/messages.ts` (13 새 event 라벨 × 2 언어) |

### 5. Supabase SQL — 실행

```
20260506000000_get_delegation_by_token_full.sql
```

idempotent · additive (기존 `get_delegation_by_token` 을 CREATE OR REPLACE 로 덮어쓰며, 인터페이스는 forward-compatible — 클라이언트가 `preset` 을 모르면 무시할 뿐 깨지지 않음).

### 6. 환경 변수

추가/변경 없음.

### 7. QA 체크리스트

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | 이메일 invite 토큰 클릭 → 미인증 상태 | 로그인/가입 CTA + 시나리오·inviter·scope 표시 (preset 은 인증 후 노출). |
| 2 | 1 후 가입 → 트리거가 link → 자동 redirect → 랜딩 인증 상태 | preset 카드 + "할 수 있는 일" + "공유되지 않는 것" 4종 + accept/decline 버튼 모두 노출. |
| 3 | 2 에서 accept | `delegations.status = active` 로 전환, `/my/delegations` 로 이동, A 가 알림 수신. |
| 4 | 2 에서 decline | `delegations.status = declined`, `/my/delegations` 로 이동, A 가 알림 수신. |
| 5 | 이미 active 인 토큰 다시 열기 | "이 위임은 이미 활성 상태입니다" + "위임 페이지 열기" CTA. |
| 6 | revoked / declined / expired 인 토큰 다시 열기 | 각 상태별 정확한 메시지 노출. RPC 가 더 이상 `{found:false}` 로 떨어지지 않음. |
| 7 | 두 탭에서 동시에 accept → 한쪽이 먼저 성공 | 두 번째 탭은 `already_used` 응답을 받아 `load()` 재호출 → already-active 화면으로 자연스럽게 전환. |
| 8 | A 가 B 에게 위임 → B 가 acting-as 로 작품 생성 → A 의 detail drawer 열기 | "Recent activity" 섹션에 `작품을 등록했어요 / Created an artwork` 표시. raw key 노출 없음. |
| 9 | DB 가 향후 새 event_type 을 추가 (i18n 미정의) → drawer 열기 | `위임 활동이 기록되었어요 / Delegation activity was recorded` 으로 graceful 표시. |
| 10 | 이메일 발송 직후 SendGrid 미리보기 | EN/KR 본문 모두 "review the delegation scope and accept or decline" / "위임 내용을 확인하고 수락할 수 있어요" 카피로 explicit-accept 의도가 분명하게 보여야 함. |

### 8. 보안 노트

- `get_delegation_by_token` 의 status 필터를 풀었지만, 새로 노출되는 필드는 `status` 와 `preset` 뿐. `delegator_profile_id` / `delegate_profile_id` / `permissions` 배열 / 이메일 / 토큰 / audit metadata 는 여전히 미노출. 토큰 보유자는 이미 랜딩 페이지에 진입할 수 있으므로 escalation 경로 없음.
- `declineDelegationById` 는 `delegate_profile_id = auth.uid()` 가드로 다른 사용자가 임의 거절할 수 없음. 트리거가 link 하지 못한 (= delegate_profile_id 가 NULL 인) 경우 `not_found_or_not_pending` 반환 → 클라이언트는 silent 하게 hub 로 라우팅.
- `acceptDelegationByToken` 의 race 처리는 정보 누설 없음 — `already_used` 만 반환하고 client 가 재조회.
- 이메일 본문에 토큰 URL 만 노출. SMTP 실패 시 PR-C fallback 패널이 동일 URL 을 노출하지만, 양쪽 모두 동일 신뢰 모델 (sender 가 이미 토큰 보유).

---

## 2026-04-27 — Delegation Final Hardening · PR-C (이메일 실패 fallback + delegated mutation 감사 로그)

P1 trust 마무리. 새 SQL 1 개 (best-effort audit hook RPC) + 클라이언트 변경 2 곳.

### 1. P1 — 이메일 초대 실패 fallback (copy-link)

**문제**: `CreateDelegationWizard` 의 이메일 탭에서 `/api/delegation-invite-email` 호출이 실패해도 invite row 자체는 이미 생성된 상태인데, 사용자는 그저 토스트만 보고 위자드가 닫혀 → 초대 링크가 어디에도 노출되지 않음 → 사용자는 "보냈는지 안 보냈는지" 모르는 채 다시 시도하거나 아예 포기.

**해결**:
- `src/components/delegation/CreateDelegationWizard.tsx`:
  - 이메일 발송 실패 시 위자드를 닫지 않고 `emailFailedResult` state 에 `{ id, invite_token, scope, recipientEmail }` 캡처.
  - 전용 fallback 패널을 본문 영역에 렌더 (StepDots 와 step UI 는 숨김):
    - 제목/본문 (이메일이 발송되지 않았다는 점, 직접 링크를 전달해도 동일하게 동작한다는 점 안내)
    - 초대 링크 (`{origin}/invites/delegation?token={invite_token}`) 가 박스 안에 readable 하게 표시.
    - "링크 복사" 버튼 — `navigator.clipboard` 우선, 실패 시 `document.execCommand("copy")` fallback. 복사 직후 2 초간 "복사됨" 라벨로 토글.
    - "완료" 버튼 — 이 버튼을 눌러야만 `onCreated` 콜백이 호출되고 위자드가 닫힘. 즉 "발송 실패는 사용자가 인지 후 dismiss" 로 강제.
  - 프라이버시 노트 1 줄: 토큰은 양방향 (sender·recipient) 만 사용 가능, 함부로 공유 금지.
- 새 i18n 키 (영·한): `delegation.fallback.title`, `delegation.fallback.body`, `delegation.fallback.linkLabel`, `delegation.fallback.copyLink`, `delegation.fallback.copied`, `delegation.fallback.done`, `delegation.fallback.privacyNote`.

### 2. P1 — delegated mutation activity logs (제한적 범위)

**문제**: `delegation_activity_events` 가 lifecycle (invite/accept/decline/revoke/expire) 만 보유. delegator 가 detail drawer 에서 보기에 "위임 동안 무슨 일이 일어났는지" 가 거의 빈 칸. 반대로 `acting_context_events` 는 client-side log 라 (a) 변조 가능, (b) delegator UI 가 읽을 수 없음.

**해결**:
- 신규 SQL `supabase/migrations/20260505000400_delegation_mutation_log.sql`:
  - `record_delegated_mutation(p_owner_profile_id, p_event_type, p_target_type?, p_target_id?, p_summary?, p_metadata?)` — security definer.
  - `auth.uid()` 기준으로 `p_owner_profile_id` 와의 가장 최근 active 위임을 찾아 한 줄을 `delegation_activity_events` 에 insert. active 위임 없으면 silent no-op (RLS 회피용 escalation 차단).
  - `auth.uid() = p_owner_profile_id` (= 본인 self-edit) 면 no-op. event_type 비어있으면 no-op.
- `src/lib/delegation/actingContext.ts`:
  - `mutationEventTypeFor(action)` — high-level action → canonical event_type 매핑 테이블:
    - `artwork.create_draft` → `delegated_artwork_created`
    - `artwork.update`        → `delegated_artwork_updated`
    - `artwork.publish`       → `delegated_artwork_published`
    - `exhibition.create`     → `delegated_exhibition_created`
    - `exhibition.update`     → `delegated_exhibition_updated`
    - `exhibition.publish`    → `delegated_exhibition_published`
    - `inquiry.reply`         → `delegated_inquiry_replied`
    - 그 외 (board.*, connection.*) → null (delegator 화면에 노출하지 않음)
  - `recordActingContextEvent` 본문에서 client log insert 직후, `evt` 가 non-null 이면 `record_delegated_mutation` RPC 도 best-effort 로 호출. 모든 에러는 swallow (mutation 자체를 절대 막지 않음).
- 클라이언트 호출자리 (artworks/exhibitions/priceInquiries) 는 변경 없음 — 기존에 이미 `recordActingContextEvent` 를 부르고 있어서 매핑만 추가하면 자동으로 audit-trail 도 기록됨.

### 3. 변경 파일 요약 (PR-C)

| 영역 | 파일 |
|---|---|
| SQL | `20260505000400_delegation_mutation_log.sql` |
| 라이브러리 | `src/lib/delegation/actingContext.ts` (mutation event mapping + RPC twin) |
| UI | `src/components/delegation/CreateDelegationWizard.tsx` (email fallback panel) |
| i18n | `src/lib/i18n/messages.ts` (영·한 7 키) |

### 4. Supabase SQL — 실행 (PR-C)

```
20260505000400_delegation_mutation_log.sql
```

Idempotent · additive. PR-A·B 마이그레이션 이후에 실행.

### 5. 환경 변수

추가/변경 없음.

### 6. QA 체크리스트

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | 이메일 탭에서 임의 invalid 도메인 (`foo@example.invalid` 등) 으로 초대 발송 → SendGrid bounce / 401 등 | 위자드 닫히지 않고 fallback 패널 노출. invite row 는 이미 생성됨. 링크 복사 가능. "완료" 누르면 위자드 닫히고 보낸 목록에 row 1 개 추가 보임. |
| 2 | 1 의 fallback 에서 "링크 복사" → 다른 사용자 (수신자) 에게 직접 전달 → 수신자가 링크 클릭 | 정상적으로 `/invites/delegation?token=...` 페이지가 로드되어 수락 가능. (PR-A 의 그레이스풀 처리도 그대로 적용.) |
| 3 | 정상 이메일 발송 (성공) | 기존 흐름 그대로: 위자드 닫히고 보낸 목록 갱신. fallback 패널 안 뜸. |
| 4 | 사용자 A 가 B 에게 active 위임 → B 가 acting-as 로 A 의 작품 1 개 발행 | A 의 위임 detail drawer 에 `delegated_artwork_published` 이벤트 1 개 노출. |
| 5 | 4 와 동일하지만, 위임을 회수한 직후 (PR-B stale probe 가 클리어) 시도 | acting-as 가 이미 클리어되어 있어 RPC 가 호출되어도 active 위임 없음 → no-op. detail drawer 깨끗. |
| 6 | B 가 자기 본인 작품 발행 (acting-as 아님) | `record_delegated_mutation` 이 호출되어도 `auth.uid() = p_owner_profile_id` 라 no-op. 다른 사용자 detail drawer 에 누수 없음. |
| 7 | RPC 실패 (네트워크 장애 등) | mutation 자체는 성공. detail drawer 에 그 1 건 누락만 발생 (best-effort 로 의도된 동작). 콘솔 warn 만. |

### 7. 보안 노트

- `record_delegated_mutation` 은 security definer 지만 auth.uid() 와 active 위임 join 으로 self-validation 한다. 임의 owner-id 를 넘겨도 active 위임이 없으면 row 가 들어가지 않음 → privilege escalation 경로 없음.
- `metadata` 는 `payload` 그대로 전달하므로 PII 가 들어갈 가능성이 있는 path 는 호출자에서 적절히 redact 해야 함. 현재 호출자 (artworks/exhibitions/priceInquiries) 의 payload 는 ID·간단 메타뿐.
- fallback 패널의 invite link 는 token 을 평문으로 보유하므로 사용자가 신뢰할 수 있는 채널로만 전달하도록 패널 하단에 1 줄 노트 표기.

---

## 2026-04-27 — Delegation Final Hardening · PR-B (project preset destination 매퍼 + acting-as stale 검증 훅)

P0 클라이언트 신뢰 갭 마무리. 새 SQL 1 개 (read-only probe RPC) + 클라이언트 변경.

### 1. P0-E — project preset → manage destination 매퍼

**문제**: 위임 허브에서 "관리하기" 버튼이 모든 project-scope 위임을 무조건 `/my/exhibitions/{id}/add` 로 보냄. 두 가지 잘못:
- `project_review` (보기 전용) 사용자도 `/add` 화면으로 떨어져 → 작품 추가 시도 → RLS 거절 토스트 → 사용자 혼란.
- `project_co_edit` 는 메타데이터 편집까지 허용되는데도 좁은 `/add` 화면으로 떨어짐.

**해결**:
- `src/lib/delegation/manageDestination.ts` (신규): `resolveManageDestination(d)` 가 preset 별 destination 결정.
  - `project_review` → `{ kind: "stay", messageKey: "delegation.manage.reviewOnly" }` (acting-as 활성화 안 함)
  - `project_works_only` → `/my/exhibitions/{id}/add` (acting-as on)
  - `project_co_edit` → `/my/exhibitions/{id}/edit` (acting-as on)
  - `account_review` → stay + 동일 안내
  - `account_operations`/`account_content` → `/my` (acting-as on)
  - 레거시/null preset → 안전 fallback (편집 화면 + acting-as on; RLS 가 잡음)
- `/my/delegations` 페이지의 `handleManage` 가 위 헬퍼 사용. stay 인 경우 새 inline 배너 (`manageNotice`) 로 사용자에게 친절히 안내, acting-as 는 활성화하지 않음.
- 새 i18n 키 (영·한): `delegation.manage.reviewOnly`, `delegation.manage.missingProject`, `common.dismiss`.

### 2. P0-F — acting-as stale validation hook

**문제**: `actingAsProfileId` 가 `localStorage` 에만 저장되어, delegator 가 위임을 회수해도 사용자 세션의 "관리 중" 배너는 그대로 남음. 그 상태에서 mutation 시도하면 RLS 거절 → 이상한 토스트 → 사용자 신뢰도 하락.

**해결**:
- 신규 SQL `supabase/migrations/20260505000300_delegation_acting_as_probe.sql`:
  - `is_active_delegate_of(p_owner_profile_id) returns boolean` — auth.uid() 기준, scope 무관, status='active' 만 매치. 가벼운 read-only 프로브.
- `src/lib/supabase/delegations.ts`: `isActiveDelegateOf(ownerId)` 래퍼 추가.
- `src/context/ActingAsContext.tsx`:
  - 새 effect: 마운트, `window focus`, `document visibilitychange="visible"` 시점에 프로브 호출.
  - **rate-limit**: 최근 검증 결과를 ref 에 저장, 같은 target 에 대해 10초 이내 중복 호출 차단. 라우트 전환마다는 호출 안 함 (오버헤드 회피).
  - 프로브 결과 `false` 면 조용히 state 클리어 + `staleCleared` 플래그 set.
  - 새로 set 된 직후 (`setActingAs` 직후) 는 trusted window 로 두어 race 방지.
  - 에러 시 절대 클리어 안 함 (네트워크 일시 장애에 banner 가 잘못 닫히지 않도록).
- `src/components/Header.tsx`:
  - `staleCleared` 플래그 시 한 줄 rose-tinted notice 노출. 6 초 후 자동 dismiss + 사용자가 직접 닫을 수도 있음.
  - 새 i18n 키 (영·한): `delegation.banner.staleCleared`.

### 3. 변경 파일 요약 (PR-B)

| 영역 | 파일 |
|---|---|
| SQL | `20260505000300_delegation_acting_as_probe.sql` |
| 라이브러리 | `src/lib/delegation/manageDestination.ts` (신규) |
| | `src/lib/supabase/delegations.ts` (`isActiveDelegateOf`) |
| 컨텍스트 | `src/context/ActingAsContext.tsx` (probe effect, staleCleared) |
| UI | `src/components/Header.tsx` (stale notice strip) |
| | `src/app/my/delegations/page.tsx` (resolveManageDestination, manageNotice) |
| i18n | `src/lib/i18n/messages.ts` (영·한 5 키) |

### 4. Supabase SQL — 실행 (PR-B)

```
20260505000300_delegation_acting_as_probe.sql
```

Idempotent · additive. PR-A 마이그레이션 이후에 실행.

### 5. 환경 변수

추가/변경 없음.

### 6. QA 체크리스트

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | A 가 B 에게 `project_review` 위임 → B 의 위임 허브에서 "관리하기" | 페이지 위쪽에 노란 inline 배너 ("보기 전용 위임"). acting-as 비활성. URL 그대로. |
| 2 | A 가 B 에게 `project_co_edit` 위임 → "관리하기" | acting-as 활성, `/my/exhibitions/{id}/edit` 로 이동. |
| 3 | A 가 B 에게 `project_works_only` 위임 → "관리하기" | acting-as 활성, `/my/exhibitions/{id}/add` 로 이동. |
| 4 | A 가 B 에게 `account_operations` 위임 → "관리하기" | acting-as 활성, `/my` 로 이동. (변동 없음) |
| 5 | A 가 B 에게 `account_review` 위임 → "관리하기" | inline 배너만. acting-as 비활성. |
| 6 | B 가 acting-as 로 A 의 계정 관리 중 → A 가 다른 탭에서 위임 회수 → B 가 페이지로 돌아옴 (focus) | 1-2 초 안에 acting-as 자동 클리어 + 핑크 stale 배너 표시. 6 초 후 자동 사라짐. |
| 7 | 6 의 흐름 후 B 가 다시 mutation 시도 | 본인 계정 컨텍스트에서 시도되며, 본인 권한대로 작동. |
| 8 | 네트워크 장애 시 RPC 실패 | acting-as 그대로 유지. 사용자가 모르는 사이에 banner 사라지지 않음. |

### 7. 미구현 (PR-C 예정)

- 이메일 발송 실패 시 fallback (초대 링크 복사) UI.
- 위임 mutation 활동 로그 (artworks/exhibitions/inquiries 의 변경을 `delegation_activity_events` 에 기록).

---

## 2026-04-27 — Delegation Final Hardening · PR-A (account-scope 권한 강제 + explicit-accept 이메일 정책)

위임 P0 보안·신뢰 갭 첫 라운드. 두 가지 핵심: (1) account-scope 위임이 프리셋 권한과 무관하게 모든 쓰기를 허용하던 RLS 헬퍼 폭(broad)을 좁힘. (2) 이메일 초대를 받은 사용자가 가입만으로 자동 활성화되던 흐름을 **explicit accept** 로 통일.

### 1. P0-D — account-scope RLS 가 preset permission 을 강제

**문제**: `is_account_delegate_of(owner)` 가 status=active 만 보고 permissions[] 를 보지 않아서, `account_review` (`view` 만 보유) 프리셋 위임자도 artworks/projects/exhibition_works/claims 의 INSERT/UPDATE/DELETE 가 실제로는 허용되었음. 프리셋이 "view only" 라는 사용자 약속과 백엔드가 어긋난 상태.

**해결**: 새 마이그레이션 2 개로 헬퍼 추가 + write 정책 교체. SELECT 정책은 의도적으로 그대로 유지 (review 도 보기 권한 필요).

| 파일 | 내용 |
|---|---|
| `supabase/migrations/20260505000000_delegation_account_perm_helpers.sql` | 새 SQL helper 2 종: `has_active_account_delegate_perm(owner, perm)`, `is_active_account_delegate_writer(owner)`. 둘 다 `auth.uid()` 앵커, security definer, status='active' 만 매치. RLS 본문에서 짧게 호출 가능. |
| `supabase/migrations/20260505000100_delegation_account_rls_writer.sql` | 8 개 정책 drop+recreate (이름 보존). 매핑: `manage_artworks` → artworks/artwork_images, `manage_works`/`edit_metadata` → projects, `manage_works` → exhibition_works, `manage_claims` → claims update/delete. `can_reply_to_price_inquiry` 함수도 account-delegate 분기에 `manage_inquiries` 체크 추가. |

**프리셋 → 권한 → 효과 매트릭스**:

| 프리셋 | 보유 permission | 작품 CRUD | 전시 CRUD | exhibition_works | claims 처리 | 문의 답변 | 작품/전시/문의 보기 |
|---|---|---|---|---|---|---|---|
| `account_operations` | view, edit_metadata, manage_works, manage_artworks, manage_inquiries, manage_claims | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `account_content` | view, edit_metadata, manage_works, manage_artworks | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| `account_review` | view | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

**회귀 안전성**:
- 정책 이름 보존 → 다른 마이그레이션에서 backref 없음.
- owner-side 정책 (`*_owner_*`) 와 project-scope 위임 정책 모두 미수정.
- SELECT 정책 미수정 → review 프리셋 사용자의 보기 경험 그대로.
- `is_account_delegate_of(owner)` 함수 자체는 그대로 둠 — 다른 곳에서 단순 "active account delegate 인지" 만 묻는 read-only 분기 (예: profiles_select_account_delegate) 에서 계속 사용. write 자리에서만 새 헬퍼로 교체.
- Project-scope 위임 (curator/host) 의 RLS 는 이전 PR에서 이미 permission-aware 였음.

### 2. P0-C — 이메일 초대 = explicit accept 통일

**문제**: 이메일 초대 본문(영·한)과 `/invites/delegation` 랜딩 페이지는 "가입 또는 로그인 후 수락 버튼을 눌러야 한다" 고 말하지만, `handle_auth_user_created_link_delegations` 트리거는 가입 시점에 자동으로 status='active' + accepted_at 설정 → 사용자가 의식하지 못한 사이에 활성 위임자가 되어 있음. 신뢰 갭.

**해결**:
- `supabase/migrations/20260505000200_delegation_explicit_accept.sql`: 트리거 함수 재정의. 이제 가입 시점엔 **`delegate_profile_id` 만 채움**. status=pending 유지, accepted_at NULL. activity event 도 `invite_accepted` → `invite_linked_at_signup` 으로 분리해 감사 추적이 흐려지지 않게.
- 가입자 본인에게 in-app `delegation_invite_received` 알림 발사 → 이메일 링크를 다시 안 열어도 알림센터에서 확인 가능.

**가입 → 온보딩 → 위임 스페이스 흐름 (매끄러운 진입)**:

```
이메일 초대 메일 → /invites/delegation?token=XYZ
  └ 비로그인 → /onboarding?next=/invites/delegation?token=XYZ
        └ 가입 → 즉시 세션 모드 → /onboarding/identity?next=…
              └ identity 완료 → routeByAuthState → /invites/delegation?token=XYZ (수락 화면)
        └ 가입 → 이메일 확인 모드 → 메일 링크 클릭 → /auth/callback?next=…
              └ session 생성 → routeByAuthState → /onboarding/identity?next=…
                    └ identity 완료 → /invites/delegation?token=XYZ (수락 화면)
```

기존 결함이었던 "이메일 확인 모드에서 next 파라미터 손실" 도 같이 보강:
- `signUpWithPassword(email, password, metadata?, nextPath?)` 에 `nextPath` 인자 추가.
- `/onboarding/page.tsx` 가 가입 시 nextPath 를 `emailRedirectTo` 로 함께 인코딩.

**`/invites/delegation` 페이지 그레이스풀 처리**:

토큰이 이미 사용된 경우 (active/declined/revoked/expired) 의 메시지가 모두 "유효하지 않거나 만료" 하나로 뭉쳐 있던 것을 상태별로 분기 + 위임 허브로 보내는 단일 CTA 추가. 새 i18n 키 5 개 (영·한): `delegation.alreadyActive`, `alreadyDeclined`, `alreadyRevoked`, `alreadyExpired`, `openHub`. 또한 accept 성공 후 라우팅을 단순화 — 항상 `/my/delegations` 로 (preset 별 destination 매핑은 PR-B 작업).

**백필 정책**: 기존 자동활성화된 행을 회수 (`status='active'` → pending) 하지 **않음**. 이미 활성 위임을 보고 있던 사용자에게 갑자기 "수락 대기" 상태로 돌리면 더 큰 혼란. 새 트리거는 **새 가입자**만 영향.

### 3. 변경 파일 요약

| 영역 | 파일 |
|---|---|
| SQL (Supabase 적용 필요) | `20260505000000_delegation_account_perm_helpers.sql` (helpers) |
| | `20260505000100_delegation_account_rls_writer.sql` (write policies) |
| | `20260505000200_delegation_explicit_accept.sql` (signup trigger) |
| 클라이언트 | `src/app/invites/delegation/page.tsx` (status별 분기, accept 후 라우팅 단순화) |
| | `src/app/onboarding/page.tsx` (signUpWithPassword 에 nextPath 전달) |
| 라이브러리 | `src/lib/supabase/auth.ts` (signUpWithPassword 에 옵셔널 nextPath 인자) |
| i18n | `src/lib/i18n/messages.ts` (영·한 5 키) |

### 4. Supabase SQL — 실행 순서 (PR-A)

```
20260505000000_delegation_account_perm_helpers.sql
20260505000100_delegation_account_rls_writer.sql
20260505000200_delegation_explicit_accept.sql
```

세 파일 모두 idempotent (`create or replace`, `drop policy if exists`). 순서대로 실행. **PR-A 의 순수 SQL 변경분만이며**, 이전 PR1-4 의 마이그레이션이 모두 적용된 상태에서만 실행 가능 (특히 `delegations`, `delegation_activity_events` 테이블, `_record_delegation_notification` 함수).

### 5. 환경 변수

추가/변경 없음.

### 6. QA 체크리스트

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | 새 사용자 A 에게 `account_review` 프리셋 위임 → A 로 acting-as → 작품 업로드 시도 | RLS 거절 (403/no insert). 작품/전시/문의는 보기는 가능. |
| 2 | A 에게 `account_content` 위임 → 작품·전시 편집 가능, claims/문의 답변 불가 | manage_artworks/manage_works O, manage_claims/manage_inquiries X. |
| 3 | A 에게 `account_operations` 위임 → 모든 작업 가능 | 회귀 없이 기존과 동일. |
| 4 | 비온보딩 사용자에게 이메일 초대 발송 → 링크 클릭 → 가입 → identity 완료 | `/invites/delegation?token=…` 수락 화면 자동 도착. status=pending. |
| 5 | 4) 후 수락 클릭 | active 전환 + delegator 에게 `delegation_accepted` 알림. |
| 6 | 4) 의 가입자가 수락 안 하고 로그인 | 알림센터에 `delegation_invite_received` 떠 있음. 클릭 시 위임 허브로. |
| 7 | 이미 active 인 토큰 링크 재방문 | "이미 활성 상태" 메시지 + 위임 허브 CTA. |
| 8 | declined/revoked 토큰 링크 방문 | 각각의 친절 메시지 표시. |
| 9 | 이메일 확인 모드(자동 sign-in OFF) 가입 → 메일 링크 클릭 | `/auth/callback?next=…` 통과해 위임 페이지 정착. |

### 7. 미구현 (다음 PR 에서 처리)

- **PR-B**: project preset 별 manage destination 매퍼, acting-as stale validation hook.
- **PR-C**: 이메일 발송 실패 fallback (초대 링크 복사), 위임 mutation activity logs.

---

## 2026-04-27 — Delegation Upgrade Phase 5 (My Studio 메인 승격 · 펜딩 도트 배지)

위임 진입점을 우상단 아바타 드롭다운에서 **My Studio 좌상단 액션 트라이어드**로 승격. "프로필 편집 / 공개 프로필 미리보기 / 위임" 세 secondary 버튼이 같은 시각 무게로 모여 **소유자-관리 클러스터**를 형성. 글로벌 탭 (피드/사람/업로드) 추가 안 — IA tier mismatch 회피.

### 결정 근거 (요약)

(1) 글로벌 탭 승격 vs (2) My Studio 액션 행 vs (3) Hybrid 검토 결과 **(2) 채택 + 도트 배지 보강**:

- **Tier mismatch**: 글로벌 탭은 *daily primary loops* (소비/발견/창작) 자리. 위임은 *administrative surface* — Notion/Linear/Slack/GitHub 모두 admin 자리에 배치.
- **Attention budget**: 10–20% 사용자가 가끔 쓰는 기능에 100% 사용자의 시야를 영구 점유시키는 비대칭 비용 회피.
- **Empty-state misfire**: 글로벌 탭 = "클릭=즉시 가치" 계약. 위임 빈 화면은 그 약속을 위반.
- **Mental model 보존**: "피드/사람/업로드" 콘텐츠 동사 3 종 분류 학습 보호.
- **다른 진입점 충분**: PR2-4 에서 종 알림 라우팅, acting-as strip "권한 보기", 전시 in-context CTA, 아바타 드롭다운 escape hatch 모두 작동 중.

### 변경

| 영역 | 파일 | 변경 |
|---|---|---|
| **My Studio 메인 진입점** | `src/components/studio/StudioHero.tsx` | 액션 행에 secondary 버튼 1 개 추가 (`/my/delegations`). "프로필 편집 / 공개 프로필 미리보기 / 위임" 트라이어드 완성. `data-tour="studio-delegations"` 앵커도 같이 (향후 투어 v8 에서 활용 가능). |
| **펜딩 인바운드 도트 배지** | `src/components/studio/StudioHero.tsx` | 새 prop `pendingInboundDelegations`. `> 0` 일 때 버튼 우상단에 `bg-rose-500 h-2 w-2` 도트 1 개 (ring-2 ring-white). 숫자 뱃지는 의도적으로 회피 — 카운트는 허브 안쪽에서 보여줌. aria-label 로 스크린리더에도 신호. |
| **카운트 fetch** | `src/app/my/page.tsx` | 기존 5 개 병렬 fetch 군에 `listMyDelegations()` 추가 (총 6 개로). 클라이언트에서 `received.filter(d => d.status === "pending").length` 로 카운트 산정. 새 SQL/RPC 추가 없음. **acting-as 컨텍스트에선 fetch 스킵** (대리 활동 중엔 본인 위임 도트 노출하지 않음). |
| **i18n** | `src/lib/i18n/messages.ts` | `studio.hero.delegations` (한: "위임", 영: "Delegations"), `studio.hero.delegationsPendingDot` (한·영) 추가. "권한 위임" 같은 어드민 톤 회피. |

### 진입점 매트릭스 (이번 패치 후)

| 진입점 | 의도 | 상태 |
|---|---|---|
| **My Studio 액션 버튼 "위임"** | 발신 거점 — 내가 위임을 시작할 단일 자리 | ✅ 신규 (이번 PR) |
| 전시 페이지 "전시 권한 공유" CTA | 스코프 단위 in-context 단축 | ✅ PR3 |
| 헤더 acting-as strip "권한 보기" | 대리 활동 중 컨텍스트 진입 | ✅ PR2 |
| 헤더 종 → 위임 알림 클릭 | 수신/응답 진입 | ✅ PR4 |
| 우상단 아바타 드롭다운 | escape hatch · power-user 단축 | ✅ 유지 |
| ~~글로벌 탭~~ | — | ❌ 채택 안 |

### 회귀 방지 / QA 체크리스트

- 본인 계정으로 `/my` 진입 → "프로필 편집 / 공개 프로필 미리보기 / 위임" 3 버튼이 같은 톤으로 노출.
- 위임 버튼 클릭 → `/my/delegations` 이동.
- 받은 pending 위임이 있을 때 → 버튼 우상단에 작은 점, aria-label 보강.
- 받은 pending 0 → 점 미표시.
- acting-as 모드 진입 (다른 계정 대리) → 위임 버튼은 그대로 표시되되 도트는 표시되지 않음 (RPC 호출 자체를 스킵).
- 모바일 너비에서 액션 행 자연 줄바꿈 (flex-wrap).
- 다른 위임 진입점 4 종 (전시 CTA, acting-as strip, 종 알림, 아바타 드롭다운) 변동 없음.

### Supabase SQL 적용 필요

**없음**. 이번 패치는 클라이언트 전용. 새 RPC/스키마/RLS 변경 없음.

### 환경 변수

추가/변경 없음.

### 검증

`npx tsc --noEmit` 통과. lint 0 issue (변경 파일 기준).

---

## 2026-04-27 — Delegation Upgrade Phase 4 (in-app 알림 · 위자드 SMTP 회복)

PR3 직후 검수 중 발견된 두 가지 갭을 닫는다. (1) 위임 라이프사이클이 `public.notifications` 행을 만들지 않아 온보딩된 위임 대상자에게 인앱 알림이 전혀 도달하지 않던 문제, (2) 새 `CreateDelegationWizard` 의 email 탭이 RPC 만 호출하고 `/api/delegation-invite-email` SMTP 엔드포인트를 누락해 외부 초대 메일이 실제로 발송되지 않던 문제. 인앱 알림은 1차 채널, 이메일은 비온보딩 사용자만을 위한 보조 채널이라는 정책을 코드와 일치시킨다.

### 변경

| 영역 | 파일 | 변경 |
|---|---|---|
| **DB · 알림 타입 확장** | `supabase/migrations/20260504000000_delegation_notification_types.sql` | `notifications_type_check` 에 4종 추가: `delegation_invite_received / delegation_accepted / delegation_declined / delegation_revoked`. 기존 11종은 그대로. 트랜잭션 안에서 `drop constraint if exists` → `add constraint` 로 재정의해 idempotent. |
| **DB · 라이프사이클 RPC 알림 INSERT** | `supabase/migrations/20260504000100_delegation_notification_inserts.sql` | 6개 라이프사이클 RPC 와 auth-signup 트리거를 `create or replace` 로 재정의해 마지막에 `_record_delegation_notification(...)` 한 줄을 추가. 모든 status 전환·activity event 로직은 그대로 보존. payload 에는 `delegation_id, scope_type, project_id, project_title, preset` 을 담아 알림 페이지에서 추가 조회 없이 렌더 가능. `create_delegation_invite`(이메일 기반) 는 초대 이메일이 이미 가입된 `auth.users` 에 매칭될 때만 즉시 인앱 알림을 만들고, 아닌 경우엔 가입 트리거 시점에 `delegation_accepted` 알림이 보내짐(자동 수락 경로). `revoke_delegation` 은 `delegate_profile_id` 가 있을 때만 인앱 알림(이메일만 가진 pending 초대는 in-app 받을 사람이 없음). |
| **TS · 알림 타입** | `src/lib/supabase/notifications.ts` | `NotificationType` 유니언에 4종 추가. 기존 select/normalize 경로는 변경 없음. |
| **알림 페이지 렌더러** | `src/app/notifications/page.tsx` | `notificationLabel` 에 4 케이스 추가(scope 별 분기 포함). `notificationLink` 는 4종 모두 `/my/delegations` 로 라우팅. PR3 에서 미리 추가해둔 `notifications.delegation*Text` i18n 키를 그대로 사용. |
| **위자드 · SMTP 호출 회복** | `src/components/delegation/CreateDelegationWizard.tsx` | 위자드 오픈 시 `getMyProfile()` 로 `myDisplayName` 조회 → submit() 의 email 분기에서 RPC 성공 후 `fetch("/api/delegation-invite-email", { toEmail, inviterName, scopeType, projectTitle, inviteToken })` 발송. 메일 실패는 **non-blocking**: 위임 행은 이미 만들어졌으므로 `onCreated` 는 그대로 호출하되 `delegation.error.email_send_failed` 카피로 사용자에게 안내(허브에서 토큰 링크 재공유 가능). 가입 유저(person.kind === "user") 분기는 영향 없음 — 인앱 알림이 1차 채널. |

### 알림 라우팅 정책 요약

- **수신자가 이미 온보딩 멤버**: 인앱 알림 즉시 발송 + 종 카운트 증가. SMTP 미발송. 위임 허브 (`/my/delegations`) 로 클릭 라우팅.
- **수신자가 비온보딩(이메일만)**: 위자드 email 탭 → 1) RPC 가 token 포함 행 생성 → 2) SMTP 발송 → 3) 가입/로그인 후 `handle_auth_user_created_link_delegations` 트리거가 자동 수락 + delegator 에게 `delegation_accepted` 인앱 알림. 즉 비온보딩 → 온보딩 전환 시점부터는 동일한 인앱 채널로 통합.

### 이메일 템플릿 수정 위치 (운영자 안내)

위임 초대 메일의 모양/카피를 바꾸려면 **`src/app/api/delegation-invite-email/route.ts`** 한 곳만 보면 된다.

- `buildHtml(payload, acceptUrl)` — 영문 본문 (line 11–38)
- `buildHtmlKo(payload, acceptUrl)` — 한국어 본문 (line 40–67). 한 메일에 두 본문이 `<hr/>` 로 결합되어 발송된다(`html = buildHtml + "<hr/>" + buildHtmlKo`).
- 제목: `subjectEn` / `subjectKo` (line 126–127). SendGrid `personalizations.subject` 에 `${subjectEn} / ${subjectKo}` 로 합쳐 발송.
- 발신자 (`From`): `INVITE_FROM_EMAIL` 환경 변수. `"Brand <noreply@domain>"` 또는 단일 이메일 형식 모두 허용.
- 수신 링크 도메인: `getAppBase()` 가 `NEXT_PUBLIC_APP_URL` → `VERCEL_URL` → `FALLBACK_APP_BASE` 순으로 결정. vercel.com 차단·https 강제 가드 포함.
- SendGrid API 키: `SENDGRID_API_KEY`.
- 페이로드 시그니처(클라이언트→API): `{ toEmail, inviterName?, scopeType: "account"|"project"|"inventory", projectTitle?, inviteToken }` — 위자드가 그대로 보냄.

수정 후에는 dev 또는 staging 에서 본인 이메일로 한 번 발송해 시각 검수를 권장한다(SendGrid 활동 로그도 같이 확인).

### 회귀 방지 / QA 체크리스트

- 가입 유저에게 `account` 위임 보내기 → 수신자 종 알림 1, `/notifications` 에서 “…님이 계정 운영을 함께 맡아달라고 위임을 보내셨어요” 표시, 클릭 시 `/my/delegations` 이동.
- 가입 유저에게 `project` 위임 보내기 → 수신자 알림 본문에 전시 제목이 들어가 표시(`/my/exhibitions/[id]/edit` 의 “전시 권한 공유” 진입 경로도 동일 결과).
- 가입 유저가 수락 → delegator 에게 `delegation_accepted` 알림.
- 가입 유저가 거절 → delegator 에게 `delegation_declined` 알림.
- delegator 가 active 위임 해제 → delegate 에게 `delegation_revoked` 알림.
- 비온보딩 이메일로 보낼 때:
  - SendGrid 환경 변수 정상 → 메일 도착, 위자드는 정상 종료, `/my/delegations` 의 sent 목록에 pending 행 표시.
  - SendGrid 키 누락/실패 → 위자드 마지막 페이지에 `delegation.error.email_send_failed` 안내, 행은 이미 생성되어 있어 sent 목록에 노출. 허브에서 토큰 재발송 경로(추가 작업 영역)로 이어질 수 있음.
- 비온보딩 → 가입 시 `handle_auth_user_created_link_delegations` 트리거가 자동 수락 + delegator 인앱 알림. 새 가입자는 위임이 이미 active 인 상태로 허브에 진입.
- 알림 종 unread count 는 4종 모두 자동 반영(`getUnreadCount` 가 type-agnostic).

### Supabase SQL 적용 필요 (이번 패치)

- `supabase/migrations/20260504000000_delegation_notification_types.sql` — `notifications_type_check` 확장 (idempotent, 데이터 이동 없음)
- `supabase/migrations/20260504000100_delegation_notification_inserts.sql` — 6 RPC + 1 trigger 재정의 (`create or replace`, idempotent). 의존: 20260503 시리즈 4개가 먼저 적용되어 있어야 함.

### 환경 변수

추가/변경 없음. 메일 발송에 이미 사용 중인 `SENDGRID_API_KEY`, `INVITE_FROM_EMAIL`, `NEXT_PUBLIC_APP_URL` 그대로 사용.

### 검증

`npx tsc --noEmit` 통과. lint 0 issue.

---

## 2026-04-27 — Delegation Upgrade Phase 3 (전시 in-context CTA · 엔타이틀먼트 · 투어 v3 · 알림 카피 · 종합 정리)

PR1(백엔드 토대)·PR2(프론트 IA·위자드·드로어·acting-as 단일화) 위에 **사용자 진입점**을 마무리하고, **엔타이틀먼트 키 / 투어 / 알림 / 문서**까지 묶어 위임 업그레이드 시리즈를 닫는다.

### 변경

| 영역 | 파일 | 변경 |
|---|---|---|
| **전시 in-context CTA** | `src/app/my/exhibitions/[id]/edit/page.tsx`, `src/app/my/exhibitions/[id]/add/page.tsx` | 기존 인라인 *Invite manager* 폼(이메일 + 가입 유저 검색 드롭다운, 약 130줄 × 2 페이지) 제거. 같은 자리에 secondary 버튼 `전시 권한 공유 / Share exhibition access` 1개로 단일화. 클릭 시 `CreateDelegationWizard` 가 `initialScope=project`, `initialProjectId=id`, `initialPreset=project_co_edit` 로 프리필되어 Step 1·2 (스코프 / 전시 선택) 가 자동 단축. 위임 보안 단일 출처는 PR1 의 `delegation_preset_permissions` 가 그대로 유지. 폼 제거에 따라 `searchPeople / createDelegationInvite / createDelegationInviteForProfile / classifyDelegationInviteError / PublicProfile / getArtworkImageUrl` import 와 `delegateEmail / inviteSending / inviteToast / delegateSearchQ / delegateSearchResults / inviteByProfile* / handleInviteManagerByProfile / doDelegateSearch` 등 약 40개 state·헬퍼가 함께 정리됨. |
| **엔타이틀먼트 4종** | `src/lib/entitlements/featureKeys.ts`, `src/lib/entitlements/planMatrix.ts`, `supabase/migrations/20260503000400_delegation_feature_keys.sql` | `delegation.account / delegation.project / delegation.permission_presets / delegation.activity_log` 네 키 추가. 베타에선 모든 플랜(free 포함)에 열어두어 **가시 페이월 없음**. `plan_quota_matrix` 항목은 의도적으로 미설정(브리프 §13.3 "설계만, 노출 금지"). DB 시드는 idempotent `on conflict do nothing`. |
| **투어 v3** | `src/lib/tours/tourRegistry.ts`, `src/lib/tours/tourKoCopy.ts`, `src/lib/i18n/messages.ts` | `delegation.main` 투어를 4스텝 → **5스텝**으로 갱신(`delegation-header → delegation-wizard-cta → delegation-received → delegation-sent → acting-as-banner`). version 2 → 3 으로 bump 해 기존 사용자에게도 1회 자동 재노출. 한국어는 `tourKoCopy.ts` 에 하드 카피로 박아 넣어 글리프 깨짐 방지(P1 회귀 케이스 그대로 보존). 영어는 `tour.delegation.*` i18n. `Header` 의 acting-as strip 에 `data-tour="acting-as-banner"` 앵커 추가. |
| **알림 카피** | `src/lib/i18n/messages.ts` | `notifications.delegationInviteReceivedText / delegationInviteReceivedProjectText / delegationAcceptedText / delegationDeclinedText / delegationRevokedText` 5종(EN·KR) 추가. 알림 라우팅 인프라 자체는 변경 없음(키만 선반영). |
| **CTA 카피** | `src/lib/i18n/messages.ts` | `delegation.shareExhibitionAccess / shareExhibitionAccessHint / shareExhibitionAccessCta` 3종(EN·KR) 추가. 기존 `delegation.inviteManager*` 키는 다른 화면(투어·이메일 본문 등)에서 참조될 수 있어 **삭제하지 않고 보존**. |

### DelegationScope · 프리셋 단일 출처

| 스코프 | 프리셋 | 권한 묶음 (`delegation_preset_permissions(p)`) |
|---|---|---|
| account | `operations` | `view, edit_metadata, manage_works, manage_artworks, manage_inquiries, manage_claims` |
| account | `content` | `view, edit_metadata, manage_works, manage_artworks` |
| account | `review` | `view` |
| project | `project_co_edit` | `view, edit_metadata, manage_works` |
| project | `project_works_only` | `view, manage_works` |
| project | `project_review` | `view` |
| (예약) | `inventory` | UI 노출 보류 — enum/RLS는 보존, 위자드/허브에서 비노출 |

클라이언트가 위자드에서 `permissions[]` 를 직접 보내도 RPC 가 `preset` 이 있으면 **서버측에서 이 맵으로 덮어쓴다** → 권한 단일 출처는 항상 SQL 함수.

### 에러 코드 → i18n 매핑

| RPC 에러 코드 | i18n 키 |
|---|---|
| `cannot_invite_self` | `delegation.error.cannotInviteSelf` |
| `duplicate_pending_invite` | `delegation.error.duplicatePendingInvite` |
| `already_active` | `delegation.error.alreadyActive` |
| `delegate_not_found` | `delegation.error.delegateNotFound` |
| `project_not_found` | `delegation.error.projectNotFound` |
| `permission_denied` | `delegation.error.permissionDenied` |
| `invalid_scope` | `delegation.error.invalidScope` |
| `missing_email` | `delegation.error.missingEmail` |
| `email_send_failed` | `delegation.error.emailSendFailed` |
| `unknown` | `delegation.error.unknown` |

### 보안 체크리스트 (브리프 §15)

- [x] 권한 단일 출처: `delegation_preset_permissions(p)` SQL 함수. 클라이언트 `permissions[]` 는 preset이 주어지면 서버가 덮어씀.
- [x] 정체성 영역(로그인·결제·계정 삭제·다른 위임) 은 어떤 프리셋에도 포함되지 않음. 위자드 검토 단계에서 `delegation.deniesShared.*` 4종으로 명시.
- [x] `record_delegation_event` 는 `SECURITY DEFINER` 만 호출, 일반 INSERT 차단(RLS).
- [x] `delegation_activity_events` 읽기는 양측 참여자만(RLS `select` 정책).
- [x] `decline_delegation_by_id` 가 별도 `declined` 상태로 기록 → 과거 거절(`revoked` 폴백) 과 구분 가능.
- [x] `revoke_delegation` 은 `revoked_at` + `revoked_by = auth.uid()` 기록.
- [x] 기존 RLS 정책 본문·정책 이름 변경 없음. 새 헬퍼 함수는 병행 운영.
- [x] 인벤토리 스코프는 enum/RLS 보존, UI 비노출(악의적 직접 RPC 호출 시에도 RLS는 그대로 적용).

### 수동 QA 절차

**계정 위임 (account)**

1. /my/delegations → `새 위임 만들기` → Step 1 `계정 운영 함께 관리` 선택 → Step 2 가입 유저 검색 → Step 3 `operations` 프리셋 → Step 4 메모 작성 → 전송. 카드가 Sent 에 즉시 등장하는지.
2. 본인 검색해서 self-invite 시도 → 에러 (`delegation.error.cannotInviteSelf`) 표시 + 드롭다운 닫힘.
3. 같은 사람 두 번 초대 → `duplicatePendingInvite` 에러.
4. 수신자 계정으로 로그인 → Pending 탭 → `권한 보기` 로 드로어 열림 → `수락` → Active 탭 이동.
5. 위임자 계정에서 `권한 보기` → 타임라인에 `invited_at / accepted_at` 노출 → `위임 해제` → Closed 탭 이동.
6. 수신자 계정에서 acting-as strip 노출 확인 → `내 계정으로 돌아가기` 동작.

**전시 위임 (project)**

1. `/my/exhibitions/[id]/edit` 또는 `/add` → 새 `전시 권한 공유` 버튼 클릭 → 위자드가 Step 3(프리셋) 부터 시작되는지(스코프/프로젝트 프리필 확인).
2. `project_co_edit` 으로 전송 → 수신자가 수락 → 수신자 계정에서 해당 전시의 작품 추가/메타 편집이 가능한지.
3. `project_review` 로 변경 시 작품 추가가 막히고 보기만 되는지(브리프 §3.2 권한 표).
4. 위임 해제 즉시 acting-as strip 사라지고 더 이상 해당 전시에 쓸 수 없는지.

**투어 (v3)**

1. /my/delegations 첫 진입 시 5스텝 투어 자동 노출. 우상단 `가이드 보기` 로 재실행.
2. KR/EN 모두 글리프 깨짐 없음(한국어는 `tourKoCopy.ts` 하드 카피).

### 회귀 방지 결과

- 인접 페이지 폼 저장 로직 변경 없음(전시 메타·삭제·작품 추가 모두 분리되어 있음). 단일화는 위임 영역 한정.
- 기존 `delegation.inviteManager*` i18n 키는 보존(다른 화면이 참조할 수 있음).
- 투어 version bump 외에 사용자 onboarding 진입점/스튜디오/업로드 투어 변경 없음.
- `useActingAs` 컨슈머(/my, exhibitions/new, [id]/edit, upload/bulk, inquiries, claims, useFeatureAccess) 시그니처/동작 변경 없음.

### 검증

- `npx tsc --noEmit` 통과.
- 인접 파일 lint 0 issue.

### Supabase SQL 적용 필요

**예 — 1개 마이그레이션을 SQL Editor 에서 실행:**

1. `20260503000400_delegation_feature_keys.sql` (idempotent, 추가만, 회귀 위험 없음)

PR1 마이그레이션 4개(스키마·RPC·헬퍼·activity log)는 이미 적용되어 있어야 한다.

### 환경 변수

추가/변경 없음.

### 미구현 / 보류

- 이메일 발송 인프라(예: 거절·해제 알림 발송)는 기존 인프라 유지. 알림 i18n 키만 선반영.
- `inventory` 스코프는 UI 비노출 유지. 향후 별도 결정 시 위자드에 카드 추가만으로 활성화 가능.
- `plan_quota_matrix` 의 위임 4종 쿼터는 의도적으로 비워둠(베타 가시화 금지).

---

## 2026-04-27 — Delegation Upgrade Phase 2 (Hub IA · 위자드 · 상세 드로어 · acting-as 단일화)

PR1 의 백엔드(스키마·구조화 에러·헬퍼·Activity Log) 위에서 프론트 IA 와 신뢰 카피를 갈아끼움.

### 변경 (프론트)

- `src/app/my/delegations/page.tsx` — Hub 재구성. Trust note + 신뢰 자리 잡힌 헤더, **단일 primary CTA (`새 위임 만들기`)** 가 위자드를 호출, Received 는 `Pending / Active / Closed` 탭(자동 우선 탭 선택), 각 카드에 아바타·범위·**프리셋 라벨**·일자·`수락 / 거절 / 관리하기 / 권한 보기`. Sent 카드는 통일된 상태 칩·`권한 보기`. Empty state 는 두 카드(`계정 운영 함께 관리` / `전시 게시물 공동 관리`)로 가이드. 영문 하드코드 `No invitations sent.` / `(pending)` / `Manage` 모두 i18n 키화. 사용하지 않게 된 인라인 초대 폼·검색 드롭다운 코드 일체 제거 → 위자드로 단일화.
- `src/components/delegation/CreateDelegationWizard.tsx` — 4단계 위자드(`Scope → (Exhibition pick) → Person → Preset → Review`). Step 1.5 분기는 project 스코프 + 프로젝트 미선택일 때만 자동 노출. Step 2 는 가입 유저 검색(드롭다운, 선택 후 미리보기 카드, 변경 버튼) + 이메일 초대 탭. Step 3 는 스코프에 맞는 프리셋 카드(`PRESET_PERMISSIONS` 단일 출처에서 가져온 권한 미리보기 + 세부 권한 토글 accordion). Step 4 는 정보 요약 + 신뢰 문구 + 280자 메모 + `공유되지 않는 정보` 4종 재확인. 에러는 PR1 의 코드 키워드(`cannot_invite_self / duplicate_pending_invite / ...`) 를 i18n 매핑(`delegation.error.*`) 으로 표시.
- `src/components/delegation/DelegationDetailDrawer.tsx` — Right-side drawer. `get_delegation_detail` RPC(PR1) 결과로 양측 프로필·범위·프리셋·`할 수 있는 일`·`공유되지 않는 정보`·상태 타임라인(invited / accepted / declined / revoked + 일자)·최근 5개 activity event·active 위임이고 owner 일 때 `위임 해제` CTA(확인 다이얼로그). 위임 해제 후 hub 자동 재로드.
- `src/components/Header.tsx` — Acting-as strip 정비. 좌측: 작은 도트 + `{name}님 계정 관리 중`(절단 가능한 트렁케이트). 우측: `권한 보기`(허브 deep-link), `내 계정으로 돌아가기`. 모바일 한 줄 컴팩트.
- `src/components/ActingAsBanner.tsx` 제거 + `src/app/layout.tsx` 마운트 해제 → strip 1개로 단일화. `useActingAs` 컨슈머 동작 변경 없음(시그니처 보존).
- `src/lib/i18n/messages.ts` — 약 90개 신규 키(EN/KR): trust note, 탭 라벨, 프리셋 라벨/요약, `delegation.permissionLabel.*` 8종, `delegation.deniesShared.*` 4종, 상세 드로어, 위자드 4 step + 부속 카피, empty state 카드, sent 빈상태/배지, banner 라벨/액션, `delegation.error.*` 10종(코드 키워드 i18n).

### 회귀 방지 결과

- 현행 `useActingAs` 컨슈머(/my, exhibitions/new, [id]/edit, upload/bulk, inquiries, claims, useFeatureAccess, listMyExhibitions 등) 모두 시그니처/동작 변경 없음.
- `acting-as-banner` 투어 타깃은 PR3 에서 `delegation-banner` 로 갱신 예정. 이번 phase 에선 셀렉터만 보존(현 카피는 그대로 작동).
- 기존 RPC 호출자(이메일 초대·프로필 초대·revoke·accept-by-id·decline-by-id) 모두 PR1 가 호환 시그니처를 유지해 변경 없이 동작.

### 검증

- `npx tsc --noEmit` 통과.
- 인접 파일 lint 0 issue.

### Supabase SQL 적용 필요

PR1 마이그레이션이 이미 적용되어 있어야 한다(특히 `delegation_status_type` 의 `declined` 값). 추가 SQL 없음.

### 환경 변수

추가/변경 없음.

---

## 2026-04-27 — Delegation Upgrade Phase 1 (백엔드 토대: 스키마·구조화 에러·헬퍼·Activity Log)

### 동기

위임(Delegation)은 단순 초대 폼이 아니라 *"계정 운영 함께 관리·전시 게시물 공동 관리"* 를 안전하게 공유할 수 있는 **유료 등급 핵심 기능 후보**다. 이를 위해 (a) 스키마에 라이프사이클 필드와 `declined`/`expired` 상태가 빠져 있고, (b) RPC 가 영문 문장으로만 에러를 던져 클라이언트가 텍스트 매칭으로 분기하던 구조를 정리. (c) `acting_context_events` 외 위임 라이프사이클을 기록할 감사 로그가 부재했다.

이번 phase 는 **백엔드만** 손봤고, 프론트는 동작 호환을 유지(추후 phase 2 에서 IA / wizard / drawer 적용 예정).

### 변경 (백엔드)

| 영역 | 파일 | 변경 |
|---|---|---|
| **스키마** | `supabase/migrations/20260503000000_delegations_phase1_schema.sql` | `delegation_status_type` 에 `declined`·`expired` 추가(additive). `delegation_preset_type` enum 신설(`operations / content / review / project_co_edit / project_works_only / project_review`). `delegations` 에 `invited_at / accepted_at / declined_at / revoked_at / expires_at / invited_by / revoked_by / note / preset` 컬럼 추가 후 `invited_at = created_at` 백필. `delegation_preset_permissions(p)` SQL 함수가 권한의 단일 출처. `delegation_preset_is_valid_for_scope(preset, scope)` 헬퍼. |
| **RPC 재작성** | `supabase/migrations/20260503000100_delegations_phase1_rpcs.sql` | `create_delegation_invite` / `_for_profile` 에 `p_preset` / `p_note` (default null) 옵션 추가. preset 이 있으면 `permissions[]` 를 서버측에서 맵으로 덮어써 클라이언트가 임의 권한을 주입할 수 없음(보안 단일 출처). 모든 RPC 의 `raise exception` 메시지가 안정 lowercase 코드 키워드(`cannot_invite_self / duplicate_pending_invite / project_not_found / permission_denied / invalid_scope / missing_email / delegate_not_found`)로 정리. `accept_*` 는 `accepted_at` 기록, `decline_delegation_by_id` 는 **상태를 `declined` 로** 기록(이전엔 `revoked` 로 폴백되었음). `revoke_delegation` 은 `revoked_at` + `revoked_by` 기록. `list_my_delegations` 는 라이프사이클 일자·preset·note 까지 반환. |
| **권한 헬퍼** | `supabase/migrations/20260503000200_delegation_permission_helpers.sql` | `is_active_account_delegate(owner, delegate)`, `is_active_project_delegate(project, delegate)`, `has_account_delegate_permission(owner, delegate, perm)`, `has_project_delegate_permission(project, delegate, perm)` 4종을 SECURITY DEFINER 로 추가. 기존 정책의 인라인 EXISTS 본문은 변경 없음(병행 운영). |
| **Activity log** | `supabase/migrations/20260503000300_delegation_activity_events.sql` | `delegation_activity_events` 테이블 + RLS(참여자만 읽기, 직접 INSERT 차단). `record_delegation_event(...)` SECURITY DEFINER 헬퍼. 라이프사이클 RPC(create / accept-by-id / accept-by-token / decline / revoke / 트리거 자동 수락) 가 본인 트랜잭션 안에서 이벤트 1건 append. `get_delegation_detail(id)` RPC: 위임 + 양측 프로필 + 프로젝트 + 최근 25건 이벤트를 묶어 드로어용 페이로드 반환. |
| **TS 클라이언트 호환** | `src/lib/supabase/delegations.ts` | `DelegationStatus` 에 `declined / expired` 추가. `DelegationPreset` / `ACCOUNT_PRESETS` / `PROJECT_PRESETS` / `PRESET_PERMISSIONS` export. `createDelegationInvite*` 시그니처에 `preset` / `note` 옵션. `getDelegationDetail` 신규. 라이프사이클 일자 필드 매핑. |
| **에러 분류 호환** | `src/lib/delegation/inviteErrors.ts` | 새 코드 키워드(`cannot_invite_self / duplicate_pending_invite / ...`) 우선 매칭, 영문 레거시 문장은 fallback. i18n 매핑은 phase 2 에서 `delegation.error.<code>` 키로 확장 예정. |

### 회귀 방지

- 정책 본문 / 정책 이름 변경 없음 (`projects_update_curator_or_delegate` 등 그대로).
- 기존 RPC 호출자(`createDelegationInviteForProfile`, `acceptDelegationById`, `declineDelegationById`, `revokeDelegation`, `listMyDelegations`) 시그니처는 모두 호환 유지(추가 파라미터는 default null).
- 프론트 텍스트 매칭(`classifyDelegationInviteError`)은 신규 코드 + 레거시 영문 문장 둘 다 인식하도록 양방향 호환.
- `delegations` 의 기존 `'revoked'` 행(과거 거절 포함)은 그대로 보존(읽기 전용).

### 검증

- `npx tsc --noEmit` 통과.
- 마이그레이션은 모두 `if not exists / create or replace` 패턴, idempotent.

### Supabase SQL 적용 필요

**예** — 다음 4개 마이그레이션을 SQL Editor 에서 순서대로 실행:

1. `20260503000000_delegations_phase1_schema.sql`
2. `20260503000100_delegations_phase1_rpcs.sql`
3. `20260503000200_delegation_permission_helpers.sql`
4. `20260503000300_delegation_activity_events.sql`

`ALTER TYPE ... ADD VALUE` 가 포함되어 있어 phase 2 마이그레이션 적용 전에 1번이 반드시 commit 되어 있어야 한다(Postgres 는 같은 트랜잭션 안에서 새 enum 값을 사용할 수 없음).

### 환경 변수

추가/변경 없음.

---

## 2026-04-27 — QA Stabilization P0.5 (프로필 저장·온보딩 루프·비공개 미리보기·위임)

### 동기

QA 팀이 제출한 *Profile / Onboarding / Delegation* 안정화 감사(`Abstract_QA_Stabilization_Profile_Onboarding_Delegation_2026-04-27.md`, rows 24–39) 의 16건을 한 패치로 처리. 특정 기능 회귀가 아닌 "조용히 작동하지 않는" 상태들 — 저장이 무시되거나, 라우팅 루프가 생기거나, 클릭이 사라지는 — 이 대부분이라 사용자 신뢰도에 직접 영향이 컸다.

### 변경

| 영역 | 파일 | 변경 |
|---|---|---|
| **P0.5-A 프로필 저장 통합** (rows 26–29, 32) | `src/lib/supabase/profileSaveUnified.ts` | `NULLABLE_BASE_KEYS` 에 `bio` / `location` / `website` 추가. 직전엔 `compactPatch` 가 빈 문자열 / `null` 을 RPC 도달 전에 잘라버려 (a) 입력란을 비워도 DB 가 갱신되지 않거나 (b) "저장할 변경 사항이 없습니다" 로 빠지는 경우가 있었음. RPC 의 `upsert_my_profile` 은 이 키들에 대해 `nullif(trim(...), '')` 로 안전히 NULL 처리하므로 `23502` 위험 없음. |
| | `src/app/settings/page.tsx` | `artist_statement` 를 메인 폼 diff baseline (`initialBaseRef`) / `baseSnap` / 저장-후 ref 갱신 / blur 자동저장 baseline (`statementInitialRef`) 모두에 통합. 직전엔 `onBlur` 자동저장 경로에서만 추적되어, 사용자가 [작가의 말] 만 수정하고 곧장 [저장] 을 누르면 변경분이 누락되어 "저장할 변경 사항이 없습니다" 가 떴음. |
| **P0.5-B Statement AI에 styles 포함** (row 24) | `src/lib/ai/contexts.ts` / `src/lib/ai/validation.ts` / `src/lib/ai/prompts/index.ts` / `src/components/profile/StatementDraftAssist.tsx` / `src/app/settings/page.tsx` | `ProfileContextInput` / `parseProfileBody` / 시스템 프롬프트에 `styles` 추가. /settings 의 스타일 칩이 statement 초안에 자연스럽게 반영되도록 했고, 프롬프트는 styles를 themes 와 혼용하지 않도록 형식·시각적 접근 차원으로 명시. |
| **P0.5-C 비밀번호 prompt 조건화** (row 25) | `src/app/settings/page.tsx` / `src/lib/i18n/messages.ts` | `getMyAuthState().has_password` 로 라벨/힌트를 분기. 이미 비밀번호가 있는 사용자에게는 "비밀번호 변경" + "필요할 때 언제든 변경할 수 있어요" 가 노출되도록 함. |
| **P0.5-D 온보딩 → /my 루프 fix** (rows 30, 35) | `src/components/AuthGate.tsx` / `src/app/onboarding/identity/page.tsx` | `get_my_auth_state` RPC 가 어쩌다 `needs_identity_setup=true` 로 잠시 stale 하게 응답해도, **실제 profiles 행** 을 즉시 더 읽어 username·display_name·roles·main_role 이 모두 채워져 있으면 identity gate 를 통과시키는 방어 분기 추가. /my → /onboarding/identity → /feed → /my 무한 튕김 차단. |
| **P0.5-E 비공개 프로필 owner 미리보기 + 진입 경로** (rows 31, 33, 34) | `src/app/u/[username]/page.tsx` / `src/app/u/[username]/PrivateProfileShell.tsx` (신규) / `src/app/settings/page.tsx` / `src/lib/i18n/messages.ts` | (1) RSC 안에서 client-side Supabase 세션을 못 보는 한계로 owner 가 자신의 비공개 프로필을 미리보지 못하던 문제 — 비공개 분기를 client shell 로 분리해 owner 일 때만 데이터를 추가로 fetch 하고 `UserProfileContent` 로 위임. 비-owner 에게는 동일한 "비공개" 메시지 + "내 스튜디오로 돌아가기" 링크. (2) /settings 의 공개 토글을 별도 "공개 범위" 섹션으로 끌어올려 *"한 번 비공개로 바꾼 뒤엔 다시 공개로 돌릴 곳이 없다"* 는 오해를 차단(rows 31). |
| **P0.5-F 위임 검색/초대 신뢰성** (rows 37, 38) | `src/lib/delegation/inviteErrors.ts` (신규) / `src/app/my/delegations/page.tsx` / `src/app/my/exhibitions/[id]/edit/page.tsx` / `src/app/my/exhibitions/[id]/add/page.tsx` / `src/lib/i18n/messages.ts` | RPC 의 명시적 사유(self / duplicate / no email / not allowed) 를 i18n 키로 매핑하는 `classifyDelegationInviteError` 헬퍼 추가. 검색 드롭다운은 **모든** 클릭 후 항상 닫히도록 변경(직전엔 실패 시에도 열려 있어 *"클릭 자체가 무시된 것 같다"* 는 오해 발생). 일반 "초대를 보내지 못했어요." 대신 *본인에게 보낼 수 없음 / 이미 진행 중인 초대 / 등록 이메일 없음 / 권한 없음* 등이 표시됨. |
| **P0.5-G 메시지 알림 카피** (row 36) | `src/lib/i18n/messages.ts` | `notifications.connectionMessageText` 를 *"…님이 소개 메시지를 보냈어요" → "…님이 메시지를 보냈어요"*. 일반 메시지 채널 출시 이후 의미가 좁았음. |
| **P0.5-H 위임 back link + 카피 폴리시** (row 39) | `src/lib/i18n/messages.ts` / `src/app/my/delegations/page.tsx` 외 9개 (`my/inquiries`, `my/messages`, `my/ops`, `my/exhibitions/[id]`, `my/claims`, `my/alerts`, `my/followers`, `my/following`, `my/exhibitions`) | `← {common.backTo} {nav.myProfile}` = "← 돌아가기 내 스튜디오" 의 어색한 문장을 단일 키 `profile.privateBackToMy` ("내 스튜디오로 돌아가기" / "Back to My Studio") 로 통일. |

### 검증

- `npx tsc --noEmit` 통과.
- `npm run build` 통과.
- `npm run lint` 회귀 없음(76 problems 동일 — 모두 사전부터 존재).

### Supabase SQL 적용 필요

없음 — 이번 패치는 RPC / 마이그레이션 변경 없이 클라이언트 가드 + 컴팩트 정책 + 에러 분류로만 처리.

### 환경 변수

추가/변경 없음.

---

## 2026-04-27 — Reorder 튕김·Supabase 에러 표기·"작가 → 아티스트" 통일 핫픽스

### 동기

직전 패치에서 도입한 공개 프로필 reorder 흐름에서 두 가지 회귀 + 한국어 카피 비일관성 한 가지가 동시에 보고됨.

### 변경

| 파일 | 변경 |
|---|---|
| `src/components/UserProfileContent.tsx` | (1) `?mode=reorder` 딥링크용 자동 reorder 활성화 effect 를 `useRef` 로 **일회성** 처리. 직전엔 deps 에 `artworks` / `exhibitions` 가 들어 있어 저장 직후 `router.refresh()` 가 새 배열 레퍼런스를 내려줄 때마다 effect 가 재발동 → reorder 모드로 *"튕김"*. 이제 마운트 후 한 번만 활성화. (2) 작품/전시 reorder save·clear 의 에러 표기를 `formatErrorMessage()` 로 교체 — 직전엔 Supabase `PostgrestError` 가 `Error` 인스턴스가 아니라 `String(error)` 가 `"[object Object]"` 가 되어 실제 사유(권한·테이블 누락·RLS)가 가려졌음. |
| `src/lib/errors/format.ts` | 신규. `PostgrestError` 의 `message / details / hint / code` 와 일반 `Error` / 문자열을 통일된 사람-친화 문자열로 풀어주는 헬퍼. 다른 reorder 위치에서도 재사용 가능. |
| `src/lib/i18n/messages.ts` | 한국어 `role.artist` `"작가" → "아티스트"`, `artwork.artistFallback` `"작가" → "아티스트"`, `exhibition.stepArtists` `"작가" → "아티스트"`, `app.description` 의 `"작가·콜렉터" → "아티스트·콜렉터"`. People 페이지에서 이미 "아티스트"로 보였던 것과 통일. 영문 카피·*"작가의 말 / 작가에게 메시지"* 같은 문장형 사용은 그대로 유지(role chip 만 정리). |

### 검증

- 작품 reorder 저장 → 토스트 후 reorder 종료 상태 유지(튕김 없음).
- 전시 reorder 저장 → 마이그레이션 미적용/RLS 거부 시 실제 사유가 메시지에 노출.
- 공개 프로필 chip / 피드 by-line / 전시 step 1 모두 "아티스트"로 표기.
- `npx tsc --noEmit` 통과.

### Supabase SQL

- 이번 핫픽스는 SQL 변경 없음 — *단 직전 패치의* `supabase/migrations/p0_profile_exhibition_orders.sql` *을 아직 실행하지 않았다면 지금 실행해야 전시 reorder 가 정상 작동합니다.* 미적용 상태에서는 새 에러 헬퍼가 *"relation … does not exist"* 같은 정확한 사유를 보여줍니다.

### 환경 변수

- 변경 없음.

---

## 2026-04-27 — 전시 정렬 토글(A) + 직접 정렬 저장(B) + 공개 프로필 미리보기 가이드 투어

### 동기

작품 reorder 는 공개 프로필이 단일 기준점 — 그러나 전시(`exhibition`)는 정렬 옵션도, 직접 정렬 저장도 없었음. 동시에 사용자가 *"탭 관리는 어디서 하고, 작품 순서는 어디서 바꾸지?"* 의 경계를 시각적으로 알 수 없었던 문제도 함께 해결.

세 갈래로 정리 — A) 정렬 토글 / B) 직접 정렬 저장 / C) 가이드 투어로 경계 명시.

### 변경

| 파일 | 변경 |
|---|---|
| `supabase/migrations/p0_profile_exhibition_orders.sql` | **신규 테이블** `profile_exhibition_orders(profile_id, exhibition_id, sort_order, updated_at)` + RLS(읽기 공개 / 쓰기 본인). `profile_artwork_orders` 와 동일한 형태·정책. |
| `src/lib/exhibitions/sort.ts` | 신규. `ExhibitionSortMode = manual / registered_desc / start_date_desc / start_date_asc`. `sortExhibitions()` 와 `defaultExhibitionSortMode()` 가 공개 프로필과 `/my` 양쪽에서 같은 결과를 보장. |
| `src/lib/supabase/exhibitions.ts` | `getProfileExhibitionOrders` / `applyProfileExhibitionOrdering` / `updateMyProfileExhibitionOrder` / `clearMyProfileExhibitionOrder` 추가. `updateMyArtworkOrder` 와 동일하게 wipe + insert. |
| `src/components/exhibitions/ExhibitionSortDropdown.tsx` | 양쪽 페이지가 공유하는 컴팩트 `<select>`. manual 옵션은 저장된 직접 정렬이 있을 때만 표시. |
| `src/components/SortableExhibitionRow.tsx` | dnd-kit 기반 reorder 행 — 그립 핸들만 인터랙티브, 카드 내비게이션 무력화(작품 reorder 와 동일 패턴). |
| `src/app/u/[username]/page.tsx` | 서버에서 `getProfileExhibitionOrders` 한 번 더 가져와 `exhibitionOrderEntries` 로 클라이언트에 직렬화 전달. |
| `src/components/UserProfileContent.tsx` | 전시 탭에 정렬 토글 + (오너) 순서 변경 버튼/드래그 영역/저장·취소·초기화 추가. `?mode=reorder&tab=exhibitions` 딥링크 진입 시 자동 reorder 모드. **공개 프로필 가이드 투어 트리거 + 도움말 버튼** + "내 스튜디오에서 탭 관리" 백링크 — 모두 `isOwner` 가드. `data-tour` 앵커 4종 추가(`public-profile-tab-strip` / `-reorder-button` / `-exhibitions-controls` / `-back-to-studio`). |
| `src/components/studio/StudioPortfolioPanel.tsx` | 전시 탭 헤더에 동일 정렬 토글과 `studio.portfolio.reorderOnPublic` 딥링크(이전엔 작품 탭에만) 추가. mount 시 `getProfileExhibitionOrders` 로 manual 옵션 가시성 판단. |
| `src/lib/tours/tourRegistry.ts` | 신규 `TOUR_IDS.publicProfile` (`profile.public`) — 4 step(tabs / reorder-artworks / exhibitions / studio-link). `TOUR_IDS.studio` 의 `portfolio-tabs` 카피 갱신, `version 6 → 7`. |
| `src/lib/tours/tourKoCopy.ts` | `profile.public:*` 한국어 카피 4종 + studio.portfolioTabs 한국어 카피 갱신(탭 관리 vs 작품 reorder 경계 명시). |
| `src/lib/i18n/messages.ts` | EN/KO 신규: `exhibition.sort.*`, `exhibition.reorder.*`, `studio.portfolio.backToStudio`, `tour.publicProfile.*`. `tour.studio.portfolioTabs.body` 갱신. |

### 사용 흐름

1. **정렬 토글**: 양쪽 페이지의 전시 헤더에 등록순/시작일순(최신·오래된) — 즉시 적용. 저장된 직접 정렬이 있으면 `직접 정렬` 옵션이 자동으로 노출되고 기본값.
2. **직접 정렬 저장**: 공개 프로필 미리보기에서 "순서 변경" → 드래그 → "순서 저장". `/my` 의 같은 토글에서 `직접 정렬` 옵션이 켜지고, `/u/{username}` 방문자도 같은 순서로 보게 됨.
3. **`/my` → 공개 프로필 미리보기 딥링크**: 전시 탭 헤더의 `공개 프로필에서 순서 변경 →` 버튼은 `?mode=reorder&tab=exhibitions` 로 직행 → 진입 즉시 reorder 모드.
4. **가이드 투어**:
   - `/my` 의 portfolio-tabs 스텝 카피가 *"탭 관리는 여기, 작품 순서는 공개 프로필 미리보기에서"* 로 갱신(version bump 로 기존 사용자에게도 한 번 다시 보임).
   - 공개 프로필 미리보기의 오너 뷰에 신규 투어(자동 + 우상단 도움말 버튼) — tabs / artwork reorder / exhibitions sort+reorder / 스튜디오 백링크 4 step.

### Supabase SQL 적용 필요

- **`supabase/migrations/p0_profile_exhibition_orders.sql` 를 SQL Editor 에서 한 번 실행해주세요.** 테이블·인덱스·4종 RLS 정책이 생성됩니다(`profile_artwork_orders` 와 동일 형식).

### 환경 변수 변경

- 없음.

### Verified

- `npx tsc --noEmit` 통과, 변경 파일 `eslint` 통과(기존 사전 경고 외 신규 0).
- 정렬 모드 전환 시 같은 데이터로 `/my` ↔ `/u/{username}` 결과 일치.
- `?mode=reorder&tab=exhibitions` 딥링크 → 즉시 전시 reorder 모드 진입(오너 + 전시 ≥ 2 조건 만족 시).
- 공개 프로필 가이드 투어는 `isOwner` 일 때만 자동 발동 / 도움말 버튼도 오너에게만 노출.

---

## 2026-04-27 — Profile media uploader UX (즉시 피드백 + 라이브 커버 크롭 미리보기)

### 동기

42804 핫픽스로 RPC는 정상 동작 — 그러나 직접 사용해보니 업로더 UX가 모호해 다음 두 문제가 남아 있었음:

- 사진을 골라도 *"진짜 등록됐나?"* 가 시각적으로 확인되지 않음. 하단 "저장"을 누르면 *"저장할 변경 사항이 없습니다"* 가 떠서 오히려 사용자에게 *실패한 것 같다*는 오해를 줌.
- 커버 이미지의 세로 포커스 슬라이더를 움직여도, 공개 프로필에서 어느 부분이 잘려 보일지 즉각적으로 직관적으로 확인할 방법이 없음.

### 변경

| 파일 | 변경 |
|---|---|
| `src/components/profile/ProfileMediaUploader.tsx` | 업로드/제거 직후 종류별 인라인 성공 배지(`프로필 사진이 저장되었어요` / `커버 이미지가 저장되었어요` / `작가의 말 이미지가 저장되었어요`) 표시(2.5초). 실패 시 빨간 배지로 메시지 노출. **`onChange` 계약을 "실패 시 throw" 로 명문화** — 부모가 RPC 에러를 throw 하면 업로더가 catch 해서 자체 에러 UI 로 분기. 새 prop `objectPositionY?: number` 로 wide 미리보기에 `object-position: center {y}%` 적용 → 슬라이더와 동일 데이터로 라이브 크롭 반영. 새 prop `previewCaption?: string` 로 미리보기 아래 보조 문구 노출. |
| `src/app/settings/page.tsx` | `persistIdentityField` 가 RPC 에러 시 `throw` 하도록 변경(예전 `return false` API 는 업로더에 에러 전달 불가). `handleAvatarChange` / `handleCoverChange` / `handleStatementHeroChange` 단순화. `handleCoverPositionCommit` / `handleStatementBlur` 는 try/catch 로 감싸 unhandled rejection 방지(에러는 섹션 하단 `identityErr` 로 그대로 노출). 커버 업로더에 `objectPositionY={coverPositionY}` 와 `previewCaption` 전달 → 슬라이더 드래그 시 미리보기가 **공개 프로필 크롭과 100% 동일한 비율(`aspect-[3/1]`)** 로 즉시 갱신. |
| `src/lib/i18n/messages.ts` | EN/KO 신규 키: `profile.media.savedAvatar` · `savedCover` · `savedStatement` · `removedAvatar` · `removedCover` · `removedStatement` · `settings.identity.coverPreviewCaption`. |

### Supabase SQL 적용 필요

- 없음.

### 환경 변수 변경

- 없음.

### Verified

- `npx tsc --noEmit` 통과, 린트 깨끗.
- 공개 프로필 `<ProfileCoverBand>` 가 `aspect-[3/1]` + `object-position: center {focal}%` 라서 settings 의 wide 미리보기(`aspect-[3/1] w-full max-w-md`)와 같은 좌표계를 공유 — 미리보기가 곧 게시 결과.

---

## 2026-04-27 — Hotfix: 프로필 사진/커버 업로드 42804, Statement 비-아티스트 가시성

### 증상

- 프로필 편집 페이지에서 프로필 사진 / 커버 이미지를 고르면 화면 하단에 빨간 글씨로 `CASE types main_role and text cannot be matched` 가 뜨고 저장이 안 됨.
- 이어서 하단 "저장" 버튼을 누르면 *"저장할 변경 사항이 없습니다"* (UI 상의 변경 없음으로 인지) — 실제로는 위 RPC 실패 때문에 `coverImagePath` / `avatarUrl` 상태가 서버 반영되지 않은 상태.
- 비-아티스트(큐레이터·컬렉터·갤러리스트) 유저에게도 "작가의 말 / Statement" 편집란이 노출되어 의미 없음.

### 원인

1. `supabase/migrations/20260430000100_upsert_my_profile_identity.sql` 가 P1-0 새 컬럼을 위해 `upsert_my_profile()` 을 `create or replace` 했는데, **2025년 핫픽스 `p0_fix_main_role_case_cast.sql` 의 `main_role text → public.main_role enum cast` 패치를 같이 가져오지 않음**.
   - 결과적으로 `main_role` 라인이 `case ... then text else enum end` 형태가 되어 PostgreSQL 42804 (CASE types main_role and text cannot be matched)를 던짐.
   - 이 RPC는 `saveProfileUnified` 단일 SSOT라서 base 패치 한 줄을 보내는 모든 호출(아바타·커버·statement hero auto-save 포함)이 일괄 실패.
2. Settings 페이지가 `main_role` 무관하게 Statement 텍스트 영역 / Statement 초안 도움 / Statement Hero 업로더를 노출. 공개 프로필 (`UserProfileContent`) 도 동일.

### 패치

| 파일 | 변경 |
|---|---|
| `supabase/migrations/20260430000100_upsert_my_profile_identity.sql` | `v_main_role text` 변수 + `v_main_role::public.main_role` 캐스팅 패턴을 `p0_fix_main_role_case_cast.sql` 에서 가져와 P1-0 컬럼 분기와 합침. 향후 이 RPC 재생성 시 enum cast 보존하라는 코멘트 추가. |
| `src/lib/identity/roles.ts` | `isArtistRole({ main_role, roles })` 헬퍼 신설 — `main_role === "artist"` 또는 `roles[]` 에 `"artist"` 포함 (= 하이브리드 포함). |
| `src/app/settings/page.tsx` | Statement textarea + length hint + saving badge + `<StatementDraftAssist>` + Statement Hero 업로더 묶음을 `isArtistRole({ main_role: mainRole, roles })` 로 가드. 아바타·커버는 그대로 노출. |
| `src/components/UserProfileContent.tsx` | 공개 프로필의 `<ArtistStatementSection>` 도 `isArtistRole(...)` 로 가드. 비-아티스트 프로필에서는 read view 와 owner write-prompt 모두 미노출. |

### Supabase SQL 적용 필요

- `supabase/migrations/20260430000100_upsert_my_profile_identity.sql` **재실행 필수** (`create or replace function` 이라 재실행 안전, 그러나 이미 한 번 적용된 잘못된 정의를 덮어써야 42804 가 사라짐).
- 다른 신규/수정 SQL은 없음.

### Verified

- `npx tsc --noEmit` 통과.
- 기존 `getMyProfile()` 의 `main_role` / `roles` 컬럼 셀렉트는 그대로라 추가 컬럼·인덱스 변경 없음.
- 환경 변수 변경 없음.

---

## 2026-04-26 — P1 Profile Identity + AI Workflows

### 요약

작업지시서 *Abstract_P1_Profile_Identity_AI_Workflows_2026-04-24.md* 에 정의된 두 레이어를 **6개 논리적 PR로 분할**해 `main`에 직접 푸시.

- **Layer 1 (P1-0) — Profile Identity Surface**
  - 프로필 사진 / 커버 이미지 / Artist Statement(+ optional hero image) 신규 컬럼·RPC·Storage·UI.
  - Settings 업로더, Public Profile 커버 밴드, 탭 위 `ArtistStatementSection` section-card 추가.
- **Layer 2 — AI Workflow Assistants 3종 (PR4–PR6)**
  - **Statement 초안 도움** (Profile Copilot 확장, `mode=statement`).
  - **Board Pitch Pack Assistant** (`/api/ai/board-pitch-pack`).
  - **Exhibition Review Assistant** (`/api/ai/exhibition-review`).
  - **Delegation Brief Assistant** (`/api/ai/delegation-brief`).

#### Audit-driven 결정 사항

| 결정 | 이유 |
|---|---|
| Statement은 **`UserProfileContent` 탭 위 section-card**, 별도 탭 X | `buildStudioStripTabs` / `parseStudioPortfolio`의 persona·custom·ordering 로직이 얽혀 있어 신규 탭 회귀 위험이 큼 |
| Storage 경로는 기존 `artworks` 버킷의 `{userId}/profile/{kind}/{uuid}-{name}` | 기존 `can_manage_artworks_storage_path()` RLS와 직매치 — 신규 RLS 마이그레이션 불필요 |
| AI feature key 3종 신설 + `plan_feature_matrix` 시드는 **모든 plan 허용** | 베타 동안 visible paywall 미노출. quota는 추후 `plan_quota_matrix`로 추가 |
| Delegation Brief는 `userMayActAs(manage_works)` 가드 재사용 | website-import 라우트와 동일 패턴, cross-profile leak 방지 |

### Supabase SQL 적용 필요

순서대로 SQL Editor 에서 실행:

1. `supabase/migrations/20260430000000_profile_identity_columns.sql` — 5개 nullable 컬럼 추가 (`cover_image_url`, `cover_image_position_y`, `artist_statement`, `artist_statement_hero_image_url`, `artist_statement_updated_at`).
2. `supabase/migrations/20260430000100_upsert_my_profile_identity.sql` — `upsert_my_profile` RPC 5개 컬럼 분기만 추가, 기존 분기 0 변경.
3. `supabase/migrations/20260430000200_lookup_profile_identity.sql` — `lookup_profile_by_username` RPC 신규 컬럼 5개를 `jsonb_build_object`에 추가, `is_public=false` short-circuit·`studio_portfolio` 노출 그대로 유지.
4. `supabase/migrations/20260501000000_p1_ai_feature_keys.sql` — `ai.board_pitch_pack` plan_matrix 시드 (모든 plan).
5. `supabase/migrations/20260502000000_p1_ai_keys_extra.sql` — `ai.exhibition_review` + `ai.delegation_brief` plan_matrix 시드.

모두 `on conflict do nothing` / additive — 재실행 안전.

### 변경 위치

#### PR1 — DB / RPC / selector / surface foundations
- `supabase/migrations/20260430000000_profile_identity_columns.sql` (신규)
- `supabase/migrations/20260430000100_upsert_my_profile_identity.sql` (신규)
- `supabase/migrations/20260430000200_lookup_profile_identity.sql` (신규)
- `src/lib/supabase/profiles.ts`: `Profile`, `ProfilePublic`, `BASE_PROFILE_KEYS`, `UpdateProfileBaseParams`, `lookupPublicProfileByUsername` parser, `getMyProfileAsPublic` parser에 5개 필드 추가.
- `src/lib/supabase/profileSaveUnified.ts`: `BASE_KEYS` 5개 필드 추가.
- `src/lib/supabase/selectors.ts`: SELECT 컬럼 5개 추가.
- `src/lib/profile/surface.ts`: `coverImageUrl`, `coverImagePositionY`, `artistStatement`, `artistStatementHeroImageUrl`, `artistStatementUpdatedAt` top-level 노출.

#### PR2 — Storage helpers
- `src/lib/supabase/storage.ts`: `PROFILE_MEDIA_LIMITS`, `ProfileMediaKind`, `uploadProfileMedia`, `removeProfileMedia` 추가. 기존 `artworks` 버킷 + `can_manage_artworks_storage_path()` 재사용.

#### PR3 — Settings · Studio hero · Public profile UI
- `src/app/settings/page.tsx`: 프로필 사진 / 커버 / Artist Statement 섹션 신규.
- `src/components/profile/ProfileMediaUploader.tsx` (신규).
- `src/components/profile/ProfileCoverBand.tsx` (신규).
- `src/components/profile/ArtistStatementSection.tsx` (신규).
- `src/components/UserProfileContent.tsx`: 상단 cover 밴드 + 탭 위 statement section-card 마운트.
- `src/app/u/[username]/page.tsx`: 5개 필드 패스 통과.
- `src/lib/i18n/messages.ts`: KR/EN 신규 키 ~25개.
- 회귀 가드: `buildStudioStripTabs` / `studio_portfolio` JSONB / `getAvatarUrl` 미수정.

#### PR4 — Statement 초안 도움 (Profile Copilot 확장)
- `src/lib/ai/contexts.ts` `ProfileContextInput` 확장 (`mode?`, `currentStatement?`, `themesDetail?`, `selectedArtworks?`).
- `src/lib/ai/prompts/index.ts` `PROFILE_STATEMENT_SYSTEM` 신규, `PROFILE_COPILOT_SCHEMA`에 `statementDrafts?: string[]` 추가.
- `src/lib/ai/types.ts` `ProfileSuggestionsResult.statementDrafts?` 추가.
- `src/lib/ai/validation.ts` `parseProfileBody`에서 mode 인식.
- `src/app/api/ai/profile-copilot/route.ts`에서 `mode === "statement"` 분기.
- `src/components/profile/StatementDraftAssist.tsx` (신규) — Settings statement 영역에 "초안 도움" 버튼.
- 기존 Profile Copilot 호출자는 mode 미지정 → default = general (회귀 0).

#### PR5 — Board Pitch Pack Assistant (P1-A)
- `src/lib/entitlements/featureKeys.ts` `ai.board_pitch_pack` 등 3개 신규 키.
- `src/lib/entitlements/planMatrix.ts` 3개 신규 키 베타 전체 plan 허용.
- `src/lib/metering/types.ts` + `src/lib/metering/usageKeys.ts` `AI_*_GENERATED` 메터 + 매핑.
- `src/lib/ai/types.ts` `AiFeatureKey` 확장 + `BoardPitchPackResult`/`ExhibitionReviewResult`/`DelegationBriefResult`.
- `src/lib/ai/safety.ts` `ALLOWED_FEATURES` 확장.
- `src/lib/ai/prompts/index.ts` `BOARD_PITCH_PACK_SYSTEM`/`SCHEMA` (가격·소장·발송 정보 노출 X).
- `src/lib/ai/contexts.ts` `buildBoardPitchPackContext`.
- `src/lib/ai/validation.ts` `parseBoardPitchPackBody`.
- `src/lib/ai/browser.ts` `aiApi.boardPitchPack` 추가.
- `src/app/api/ai/board-pitch-pack/route.ts` (신규) — `shortlists` RLS로 owner/collaborator만 컨텍스트 빌드.
- `src/components/board/BoardPitchPackPanel.tsx` (신규) — board detail에 collapsed CTA, summary/throughline/missingInfo/drafts/perWork.
- `src/app/my/shortlists/[id]/page.tsx` 마운트.

#### PR6 — Exhibition Review (P1-B) + Delegation Brief (P1-C)
- `src/lib/ai/prompts/index.ts` `EXHIBITION_REVIEW_*` / `DELEGATION_BRIEF_*` prompts/schemas.
- `src/lib/ai/contexts.ts` `buildExhibitionReviewContext` / `buildDelegationBriefContext`.
- `src/lib/ai/validation.ts` `parseExhibitionReviewBody` / `parseDelegationBriefBody`.
- `src/lib/ai/browser.ts` `aiApi.exhibitionReview` / `aiApi.delegationBrief`.
- `src/app/api/ai/exhibition-review/route.ts` (신규) — 권한 가드: curator/host (`projects.curator_id`, `host_profile_id`) 또는 active account/inventory/project-scope delegate(`delegations`).
- `src/app/api/ai/delegation-brief/route.ts` (신규) — `userMayActAs(manage_works, account|inventory)` 가드. 카운트 4개(미공개 작품, 미응답 inquiries, 전시 cover gap, profile readiness 6 check %)와 principal 메타만 컨텍스트로 송신.
- `src/components/exhibition/ExhibitionReviewPanel.tsx` (신규) — `/my/exhibitions/[id]/edit`에 마운트.
- `src/components/delegation/DelegationBriefPanel.tsx` (신규) — `/my/delegations` 활성 account/inventory 위임 행 + `/my`에서 `actingAsProfileId`가 켜져 있을 때 마운트.
- `supabase/migrations/20260502000000_p1_ai_keys_extra.sql` (신규).

### 권한 / 보안 요약

| 라우트 | 가드 |
|---|---|
| `POST /api/ai/profile-copilot` (mode=statement) | 기존 그대로 — `requireUserFromRequest` |
| `POST /api/ai/board-pitch-pack` | `shortlists` SELECT가 RLS로 owner/collaborator만 통과 → 행이 없으면 404. 가격·collector·소장 정보 미송신 |
| `POST /api/ai/exhibition-review` | `projects.curator_id == userId` 또는 `host_profile_id == userId` 또는 active account/inventory delegation, 또는 active project-scope delegation(`project_id == exhibitionId`). 미충족 시 403 |
| `POST /api/ai/delegation-brief` | `userMayActAs(manage_works)` + `scope_type in (account, inventory)` 만 통과. principal 카운트만 컨텍스트, 호출자 본인 데이터 0 송출 |

### Beta paywall 정책

3 신규 AI feature key는 `plan_feature_matrix` 시드에서 모든 plan(free 포함) 허용 → visible paywall 미노출. soft cap / quota 노출은 `plan_quota_matrix`로 추후 추가 가능.

### 환경 변수

- 신규 환경 변수 **없음**. 기존 `OPENAI_API_KEY` 재사용.

### Verified

- `npx tsc --noEmit` : 통과.
- 기존 Profile Copilot 호출 흐름은 mode 미지정 시 default=general로 회귀 없음 확인.
- AI 라우트 3종은 모두 `handleAiRoute` 패턴 — soft cap, entitlement gate, ai_events, accept tracking 자동.

---

## 2026-04-26 — Studio: remove redundant Quick Actions strip

### 요약

`/my` 화면 하단의 `StudioQuickActions`(빠른 작업) 섹션을 통째로 제거. 이 줄이 차지하던 세로 공간을 회수하고, 어떤 액션이 어디에서 발화하는지에 대한 SSOT를 명확히 했다.

#### 왜 제거했나

빠른 작업 칩들이 다른 표면과 1:1로 중복돼 있었다.

| 빠른 작업 항목 | 이미 닿을 수 있는 경로 |
|---|---|
| 작품 올리기 (primary) | 글로벌 nav `업로드` |
| 전시 게시물 만들기 | 글로벌 nav `업로드` 안의 전시 탭 |
| 프로필 수정 | 히어로 카드의 `프로필 편집` 버튼 |
| 사람 찾기 | 글로벌 nav `사람` |
| 관심 알림 (`/my/alerts`, tertiary) | 4×2 운영 그리드의 메시지/문의 타일과 기능적으로 겹침. 영문만 노출돼 있어서 한국 유저 체감 품질이 나빴음 |
| 작품 순서 정리 (tertiary) | 히어로 카드의 `공개 프로필 미리보기` → 공개 프로필에서 1클릭 reorder |
| 프로필 완성하기 (tertiary) | `StudioNextStepsRail`("지금 하면 좋은 일")이 동일 경로 안내 |

내비게이션 SSOT가 글로벌 헤더, 히어로 카드, 운영 그리드, Next Steps 레일로 이미 구성돼 있어 빠른 작업 줄은 노이즈였다.

### 변경 위치

- `src/app/my/page.tsx`: `StudioQuickActions` import / `quickActions` `useMemo` / 렌더 호출 제거. `normalizeRoleList`도 이 메모에서만 쓰여서 같이 제거 (`hasAnyRole`은 다른 분기에서 계속 사용).
- `src/components/studio/StudioQuickActions.tsx`: 파일 삭제.
- `src/components/studio/index.ts`: `StudioQuickActions`, `QuickAction` 배럴 export 제거.
- `src/lib/i18n/messages.ts`: `studio.quickActions.*` 영/한 키 12개씩 삭제.

### 호환성 / 회귀 체크

- 가이드 투어 앵커는 `studio-hero` / `studio-next-steps` / `studio-operating-grid` / `studio-portfolio-tab-strip` / `studio-public-works`만 사용. `studio-quick-*` 앵커는 존재하지 않아 투어는 그대로 동작.
- `/my/alerts` 페이지 자체는 살아 있음. 직접 URL 접근 / 알림 트리거에서 들어오는 경로는 유지. UI에서의 진입점 한 곳이 사라진다는 점을 감안해 향후 `studio.operationGrid`로 흡수할지 별도 검토 필요(이번 패치에서는 의도적으로 보류).

### Supabase / 환경 변수

- Supabase SQL 돌려야 할 것은 없음.
- 환경 변수 변경 없음.

### Verified

- `npx tsc --noEmit` 통과.

---

## 2026-04-25 — Website import audit pass: P0/P1/P2 hardening

### 요약

100장+ 이미지 일괄 업로드 + 웹사이트 파싱/매칭 흐름을 처음부터 끝까지 감사한 뒤 SSRF·동시성·UX·세션 위생까지 한 번에 끌어올린 패치. `main`에 직접 커밋하되 PR 단위로 3개로 분리해서 리뷰 가능하게 정리했다.

#### PR 1 — `release(website-import P0)`

- **SSRF 강화** (`src/lib/websiteImport/urlSafety.ts`, `crawlSite.ts`):
  - 사설 IPv6 prefix 차단, 10진/16진/8진 형태 IPv4 표기 정규화 후 사설 대역 검증.
  - 클라우드 메타데이터 호스트 차단(`metadata.google.internal`, `169.254.169.254`).
  - `redirect: "follow"` 폐기 → hop마다 `Location`을 `assertFetchablePageUrl`/`assertFetchableImageUrl` + `assertResolvedHostSafe`로 재검증.
  - HTML/이미지 모두 스트림 읽기로 `MAX_HTML_BYTES`/`MAX_IMAGE_BYTES` 상한 강제, `Content-Length` 사전 거절.
- **사용자 수동 선택 보존** (`matchEngine.ts`, `match/route.ts`): 매칭 재실행 시 `manual_pick: true`인 행은 재처리에서 제외하고 결과에 다시 합쳐 돌려준다.
- **동시성 + 단일 디코드** (`dhash.ts` `dhashAndMetadataFromImageBuffer`, `match/route.ts`): 작품당 디코딩 1회로 dHash + sharp metadata 모두 산출. `MATCH_CONCURRENCY = 4`.
- **고장난 스캔 자동 회복** (`scan/route.ts`): `scanning`이 90초(=`maxDuration` 60초 + 여유 30초) 이상 머무르면 죽은 것으로 보고 새 스캔 허용. 그렇지 않으면 `409 retry_after_ms`. 사용자당 60초에 2회 rate limit.
- **에러 코드 전파**: `WebsiteImportMatchRow.error_code`(`fetch_failed`/`decode_failed`/`no_candidates`/`no_similar`)를 P0에서 데이터로 추가.

#### PR 2 — `release(website-import P1)`

- **일괄 업로드 동시성 + 실패 누적** (`src/app/upload/bulk/page.tsx`): 4 worker 풀로 동시 업로드, 성공·실패 카운터/실패 파일 목록을 UI에 노출, 업로드 중 페이지 이탈 시 `beforeunload` 경고.
- **Apply 라우트 최적화** (`apply/route.ts`): 단일 `.in()` 조회 + `runWithLimit` 4 동시성 + `count: "exact"` + `eq("artist_id").eq("visibility","draft")`로 race 제거. 0건 적용이면 세션 status를 `applied`로 묻지 않고 직전 상태 복원.
- **메타데이터 파서 보강** (`metadataParse.ts`): 한국어 매체 사전(`MEDIUM_KEYWORDS_KO`), 제목에서 연도-only 토큰만 떨궈내고 "Diary 2020" 같은 제목 보존, `mm`/`m`/`ft` → `cm`/`in` 정규화. `mergeCaptionBlocks`는 em-dash 정규식과 충돌하지 않도록 ` · ` 결합으로 전환. 신규 케이스는 `tests/website-import.test.ts`에 추가.
- **i18n**: `bulk.uploadDoneWithFailures`, `bulk.uploadFailuresTitle`, `bulk.uploadBeforeUnload` 추가.

#### PR 3 — `release(website-import P2)`

- **스캔 취소 API + UI** (`src/app/api/import/website/session/[id]/cancel/route.ts`, `WebsiteImportPanel.tsx`): `POST /cancel`은 idempotent하게 세션을 `cancelled`로 마킹. UI는 스캔 진행 중에 "스캔 중지" 버튼을 노출하고 결과를 토스트로 안내. `bulk.wi.cancel`/`cancelling`/`cancelled` i18n 추가.
- **세션 GC 마이그레이션** (`supabase/migrations/20260429000000_website_import_sessions_gc.sql`): `gc_website_import_sessions(retention_days int default 30)` SECURITY DEFINER 함수 + `pg_cron`이 활성화돼 있으면 매일 04:17 UTC에 자동 실행. 30일 이상 된 세션을 삭제해 JSONB 페이로드 누적 방지.
- **Match row error_code UI 안내**: `no_match` 행에 `fetch_failed` / `decode_failed` / `no_candidates` / `no_similar` 별로 사람이 읽을 수 있는 한국어/영문 안내 문구 노출. 새 i18n 키 `bulk.wi.errorFetchFailed` 외 4개.
- **Delegation 사전 검증** (`api/import/website/session/route.ts`): `actingProfileId`가 본인이 아닐 때 `delegations`에서 `account|inventory` scope + `manage_works` 권한이 active 상태인지 미리 확인하고, 부합하지 않으면 `403 delegation_not_authorized`. RLS 뒤로 무성히 묻히던 권한 실패를 즉시 명시적으로 처리.

### Supabase / 환경 변수

- **Supabase SQL 적용 필요**: `supabase/migrations/20260429000000_website_import_sessions_gc.sql`. SQL Editor에서 1회 실행.
- 환경 변수 변경 없음.

### Verified

- `npx tsc --noEmit` 통과.
- `npm run test:website-import` 통과.

---

## 2026-04-25 — Tour auto-start: once per user, ignore version bumps

### 요약

- **정책 변경**: 가이드 오버레이 자동 발동을 **사용자당 평생 1회**로 제한. 한 번 완료/스킵한 사용자에게는 로그아웃·재로그인이나 투어 버전 bump가 일어나도 다시 자동으로 뜨지 않음.
- **Manual reopen 그대로**: 우상단 `TourHelpButton`(가이드 보기)은 언제든 다시 띄울 수 있는 유일한 공식 경로.
- **이유**: 카피 수정만 해도 `tour.version`을 올리는 운영 패턴 + 자동 재발동 → 매 배포마다 오버레이가 다시 떠서 노이즈. 사용자도 명시적으로 1회로 묶고 싶다고 요청.

### 변경 위치

- `src/components/tour/TourProvider.tsx` `requestAutoStart`: `state.version < tour.version` 분기 제거. 이제 `!state || state.status === "not_seen"`일 때만 자동 발동.
- `src/lib/tours/tourPersistence.ts`: `localStorage` 키를 사용자별로 분리 (`abstract.tour.v2.{uid}.{tourId}`). 같은 브라우저에서 다른 계정으로 로그인해도 이전 사용자의 "completed"가 새 사용자에게 새지 않음. 기존 v1 키는 한 번만 마이그레이션 소스로 읽혀서 기존 사용자 경험은 깨지지 않음.
- 미사용 `loadTourStateLocal` export 제거.

### Supabase / 환경 변수

- Supabase SQL 돌려야 할 것은 없음.
- 환경 변수 변경 없음.

### Verified

- `npx tsc --noEmit` 통과.

---

## 2026-04-24 — Studio portfolio tabs + studio tour step

### 요약

- **공개 작품 영역**: `profile_details.studio_portfolio`에 탭 순서·기본 탭 이름/공개 여부·커스텀 탭·작품 배치 저장. `/my`와 공개 프로필(`/u/...`)에 반영.
- **RPC**: `lookup_profile_by_username`이 `studio_portfolio`만 추가 반환 (`supabase/migrations/20260428000000_lookup_profile_studio_portfolio.sql`). 배포 시 Supabase에 마이그레이션 적용 필요.
- **스튜디오 투어**: `studio.main` 버전 **3**. 공개 작품·탭 안내 스텝(7·8) 스포트라이트는 **`studio-portfolio-tab-strip`**(탭 줄·↕·⚙만)으로 한정. 한국어 카피에서 「바깥」 표현 제거.

### Verified

- `npx tsc --noEmit` 통과.

### 2026-04-24 부록 — 투어 한글 깨짐(글리프)

- 원인: `Geist` `latin` 서브셋만 로드된 상태에서 일부 환경이 한글을 Geist로 치환해 **잘못된 글리프**로 그림.
- 조치: `globals.css`의 `body` 및 `@theme --font-sans`에 **시스템 CJK 폴백** 스택 추가, `Geist`에 `adjustFontFallback`, 투어 `TourOverlay` 루트에 `lang` 동기화.

---

## 2026-04-26 — Overlay Guided Tour System

### 왜 필요했나

`/my`, `/people`, `/upload`, `/my/exhibitions/new`, `/my/delegations`, `/my/network` 순으로 수차례 IA/UX 정돈 패치가 누적되면서 표면은 일관돼졌지만, 베타로 합류하는 초기 유저에게 "작업실·보드·위임·전시 게시물" 같은 Abstract 고유 개념이 여전히 낯설다. 텍스트 설명을 늘리는 대신, **첫 방문 1회성 가이드 오버레이**로 한 페이지의 2–5개 핵심 액션을 가볍게 짚어주는 시스템을 도입.

설계 기조:
- 과장하지 않는 premium/calm 톤, 1 타이틀 + 1–2문장.
- Registry/config 중심. 새 투어 추가나 카피 변경은 page 코드를 건드리지 않고 레지스트리만 수정.
- 앵커는 모두 `data-tour="..."` 속성. 텍스트/CSS 셀렉터 의존 금지.
- Per-user progress 영속화(DB+localStorage). 해제하면 재방문 시 재등장하지 않음.
- Version bump시에만 다시 한 번 노출.
- Missing anchor는 **silently skip**하여 조건부 UI에서도 안전.

### 아키텍처

```
src/lib/tours/
  tourTypes.ts         ← TourStep / TourDefinition / TourState 타입
  tourRegistry.ts      ← TOURS 맵 (SSOT for all tour copy & steps)
  tourPersistence.ts   ← loadTourState / saveTourState (DB + localStorage)
  tourUtils.ts         ← findTourTarget, measureTarget, waitForTourTarget, ensureTargetVisible

src/components/tour/
  TourProvider.tsx     ← Context provider + controller. Root-mounted.
  TourOverlay.tsx      ← Backdrop(SVG spotlight mask) + halo + popover + arrow + controls + step dots
  TourTrigger.tsx      ← 페이지에서 <TourTrigger tourId=... /> 1회 장착하면 auto-start 요청
  TourHelpButton.tsx   ← "가이드 보기" 수동 재진입 어포던스
  index.ts             ← barrel export

supabase/migrations/
  20260426000000_user_tour_state.sql  ← user_tour_state 테이블 + RLS
```

**TourProvider**는 `RootLayout`에서 `ActingAsProvider` 하위에 1회 mount. 컨텍스트는 `requestAutoStart(tourId)` / `startTour(tourId)` API만 노출. 실제 auto-start 로직은 provider 내부에서 처리하며, 이미 평가한 `(tourId@version)`은 ref로 memoize하여 이중 진입 차단.

**진입 플로우**:
1. 페이지에 `<TourTrigger tourId={...} />` 배치.
2. Provider가 `loadTourState(tourId)` 호출 — 로컬 → DB 순(없으면 null).
3. `status === 'not_seen'` 또는 `stored.version < current.version` 이면 auto-start.
4. 400ms 디퍼 후 `enterTour()`가 `requiredAnchors` 프레젠스 체크 → `guard()` → 개별 앵커 `waitForTourTarget(400ms)` 로 resolvedSteps 계산.
5. 빈 배열이면 조용히 취소(로딩 skeleton 위에 투어가 뜨는 사고 방지).

**스포트라이트 렌더**:
- Backdrop는 full-screen SVG. `<mask>`에 black 라운드 rect(padding 10px, radius 14px)로 target 영역을 뚫어 natural cutout.
- 추가로 흰색 halo ring + soft shadow로 target을 "살짝 들어올린" 인상.
- Popover는 portal 렌더, 기본 placement는 step에서 선언하되 viewport clamp + `pickPlacement()`로 실패 시 공간이 가장 큰 방향으로 swap.
- Arrow는 placement 반대 방향에 rotate-45 square로 ring과 배경을 그대로 연결.

**접근성**:
- Popover에 `role="dialog" aria-modal="true" aria-labelledby="tour-title"`.
- 스텝 변경 시 primary CTA로 초기 포커스 이동(80ms 디퍼).
- `Esc` → skip, `←/→` → prev/next.
- 모든 컨트롤은 키보드로 조작 가능.

### 영속화

- 테이블 `public.user_tour_state`: `(user_id, tour_id)` PK, `version int`, `status in ('not_seen','in_progress','completed','skipped')`, `last_step int`, `updated_at`.
- RLS: SELECT/INSERT/UPDATE/DELETE 모두 `auth.uid() = user_id`.
- `tourPersistence.ts`가 DB write를 best-effort로 수행 — 실패해도 throw하지 않음. 동일 값이 localStorage에 미러링되어 같은 기기에서는 재방문 즉시 반영.
- 로그아웃/anonymous 유저도 localStorage만으로 once-only 동작 유지.

### 투어 카탈로그 v1

| Tour id | 페이지 | 스텝 | 핵심 목적 |
|---|---|---|---|
| `studio.main` | `/my` | 8 | Studio hero / Next steps / Operating grid / Workshop / Boards / Exhibitions / Public works (탭 줄) / Portfolio tabs (동일 탭 줄) |
| `upload.main` | `/upload/*` | 5 | Tabs 개요 / Single / Bulk / Exhibition post / Intent 선택 |
| `exhibition.create` | `/my/exhibitions/new` | 4 | Post purpose / Dates / Status / Curator·Host |
| `people.main` | `/people` | 4 | Search / Discovery lanes / Role filters / Card actions |
| `delegation.main` | `/my/delegations` | 4 | What delegation is / Invite / Received / Sent |
| `network.main` | `/my/network` | 3 | Tabs / Search·Sort / List |

각 스텝의 실제 카피는 `messages.ts`의 `tour.*` 키(KR/EN)로 관리.

### 신규 data-tour 앵커

| Anchor | 위치 |
|---|---|
| `studio-hero` | `StudioHeroPanel` (기존) |
| `studio-next-steps` | `StudioNextStepsRail` (기존) |
| `studio-operating-grid` / `studio-card-*` | `StudioOperationGrid` (기존) |
| `studio-public-works` | `/my/page.tsx` 헬퍼 카드(투어 타깃 아님, 앵커 보존) |
| `studio-portfolio-tab-strip` | `StudioPortfolioPanel.tsx` 탭 줄 전용(`↕`·`⚙` 포함) |
| `upload-tabs` | `upload/layout.tsx` nav |
| `upload-tab-single` / `upload-tab-bulk` / `upload-tab-exhibition` | 각 탭 `<Link>` |
| `upload-intent-selector` | `/upload` intent step wrapper |
| `exhibition-form-title` / `exhibition-form-dates` / `exhibition-form-status` / `exhibition-form-curator` | `/my/exhibitions/new` form fields |
| `people-search` / `people-lane-tabs` / `people-role-filters` / `people-card-actions` | `PeopleClient.tsx` (card-actions는 첫 번째 visible card에만) |
| `delegation-header` / `delegation-invite` / `delegation-received` / `delegation-sent` | `/my/delegations` 섹션들 |
| `network-tabs` / `network-search` / `network-sort` / `network-list` | `/my/network` (기존) |

누락되거나 조건부로 사라지는 앵커는 프레임워크가 silently skip.

### 분석(best-effort)

`logBetaEvent`에 5개 이벤트 확장: `tour_shown`, `tour_step_advanced`, `tour_skipped`, `tour_completed`, `tour_reopened`. `beta_analytics_events` 테이블에 payload(`tourId`, `version`, `stepIndex`)와 함께 기록. 실패해도 UI는 영향 없음.

### 새 투어를 추가하는 법

1. `src/lib/tours/tourRegistry.ts`의 `TOUR_IDS` + `TOURS`에 항목 추가. `version: 1`, `steps[]`에 각 step `{ id, target, titleKey, bodyKey, placement }`.
2. `messages.ts`에 `tour.<newId>.*` 키 KR/EN 동시에 추가.
3. 대상 페이지에 `<TourTrigger tourId={TOUR_IDS.newId} />` 1회 배치.
4. 제목 옆에 `<TourHelpButton tourId={TOUR_IDS.newId} />` 배치(선택, 수동 재진입용).
5. 타깃 엘리먼트에 `data-tour="..."` 부여. 대부분은 이미 레이아웃 수준에서 존재.

### 투어 버전 bump이 필요한 경우

- 스텝을 추가/제거/재정렬
- 앵커 이름을 바꿔야 하는 UI 리팩터
- 카피를 유저에게 다시 상기시켜야 하는 의미 변경(라벨 명칭 교체 등)

bump: `tourRegistry.ts`에서 해당 tour의 `version` 을 +1. 다른 투어 상태는 영향 없음.

### 수동 적용 필요

- Supabase SQL editor에서 `supabase/migrations/20260426000000_user_tour_state.sql` 실행. 실패해도 client는 localStorage로 작동하지만 cross-device persistence를 위해 적용 필요.

### QA 체크리스트

Framework:
- [ ] /my 첫 진입 시 studio 투어 자동 실행.
- [ ] Skip 후 재방문하면 자동 실행되지 않음.
- [ ] "가이드 보기" 버튼으로 수동 재진입 가능.
- [ ] 스텝 Next/Prev/Skip/Done 모두 동작.
- [ ] Esc/←/→ 키보드 네비게이션.
- [ ] 오버레이가 모달 위로 올라감(z-[1200]).
- [ ] 모바일 뷰포트에서 popover clipping 없음.
- [ ] 타깃이 스크롤 밖이면 부드럽게 스크롤 인.
- [ ] Target 누락 시 step이 건너뛰어짐, 전체 누락 시 투어 미실행(로그 없음).

Per-tour:
- [ ] `/my` studio: 7 steps, 워크숍·보드·전시 카드 하이라이트.
- [ ] `/upload`: tabs 설명 후 single/bulk/exhibition 각각 하이라이트, 마지막 intent 셀렉터.
- [ ] `/upload/bulk` 또는 `/upload/exhibition`에서는 intent 스텝 auto-skip (anchor 부재).
- [ ] `/my/exhibitions/new`: 4 steps(title/dates/status/curator).
- [ ] `/people`: search, lane tabs, role filters, first card actions.
- [ ] `/my/delegations`: header, invite, received, sent.
- [ ] `/my/network`: tabs, search, list.

Cross-locale:
- [ ] KR 유저 카피 자연스러움.
- [ ] EN 유저 카피 자연스러움.

### 기존 기능 회귀 방지

- 기존 `data-tour` 앵커 이름 변경 없음.
- `TourProvider`는 context 미사용 시 no-op fallback 반환(비-오덴트 페이지 안전).
- localStorage만으로도 작동하므로 DB 마이그레이션 지연 시에도 회귀 없음.
- `beta_analytics_events` insert 실패는 swallow되므로 기존 event 체인에 영향 없음.

### 알려진 트레이드오프

- Provider가 `ActingAsProvider` 하위에 있어 acting-as 모드에서도 투어가 뜰 수 있음(정책: 앵커가 있는 한 괜찮다고 판단). 원치 않을 경우 `TourTrigger` 를 `!actingAsProfileId` 가드와 함께 배치(`/my` 에서 이미 적용).
- 같은 기기에서 여러 계정을 쓰면 localStorage가 account-less key라 한쪽이 다른 쪽의 투어를 먹일 수 있음. 로그인 유저에게는 DB가 source of truth 이므로 재로그인 후 재평가됨.

---

## 2026-04-25 — Studio Counter Fixes + Messaging Feature Activation

### 왜 필요했나

직전 Studio/Network 패치 리뷰에서 네 가지 후속 이슈가 나왔다.
1. 헤더의 `My Profile/내 프로필` 라벨이 실제 목적지(`/my`의 스튜디오 대시보드)와 어긋남.
2. `네트워크` 타일이 팔로워 카운트만 보여줌 — 목적지 페이지가 팔로워+팔로잉을 모두 다루는데 단일 숫자라 오해.
3. `작업실` 타일 숫자(`artworks.length` = 내 공개 작품 + claims 테이블에서 내가 `subject_profile_id`로 오른 공개 작품 최대 50건)가 `/my/library`(=`artist_id = me` 전체, visibility=all)와 불일치.
4. `connection_messages` 스키마는 있지만 UI 진입점이 `/people`의 Follow-with-Intro 한 곳뿐이었고, 받은 메시지에 회신할 수도 없었음. 가격 문의(`/my/inquiries`)와 별개 inbox로 분리되어 사용자에겐 두 개의 inbox가 존재.

### 스튜디오 카운터 / 헤더 통일

- **`nav.myProfile` 리라벨**: `My Profile → My Studio`, `내 프로필 → 내 스튜디오`. i18n 키 하나만 바꿔서 헤더(데스크톱/모바일) + 모든 하위 페이지 back link 11곳 + `artworkBack` 브레드크럼이 일관되게 반영됨.
- **네트워크 타일 composite**: `valueLabel: "${followers} · ${following}"` 형식. 서브타이틀("팔로워와 팔로잉")이 이미 순서를 설명하므로 추가 레이블 없이 자명. `stats.followingCount` 의존성 추가.
- **작업실 타일 소스 교체**: `artworks.length` → `stats?.artworksCount ?? 0`. `stats.artworksCount`는 `artist_id = me`의 **모든 visibility** 카운트라서 `/my/library`(기본 `visibility="all"`) 뷰와 항상 일치.

### 메시지 기능 정식 활성화 (Q4)

`connection_messages` 표를 1:1 inbox에서 **양방향 대화 스레드 + 어디서나 보낼 수 있는 Compose**로 승격.

#### DB 마이그레이션 `20260425000000_connection_message_threads.sql`

- `public.connection_messages.participant_key` — `text generated always as (least(...)||':'||greatest(...)) stored`. 보내는/받는 방향을 단일 key로 canonical화.
- Index `idx_connection_messages_participant_created on (participant_key, created_at desc)`로 스레드 페이지네이션을 O(N)으로.
- RPC `list_connection_conversations(limit_count, before_ts)` — 호출자 기준 thread 당 1행(`participant_key`, `other_user_id`, last preview, `last_is_from_me`, `unread_count`). `before_ts` cursor는 방금 본 페이지에서 가장 오래된 `last_created_at`을 전달.

RLS는 기존 그대로(`connection_messages_select_own` 이 sender OR recipient 둘 다 허용). **팔로우는 DB-level 요구 사항이 아님** — 모든 로그인 유저는 다른 유저에게 메시지를 보낼 수 있고, 쿼터는 이미 `social.connection_unlimited` feature key가 `planMatrix`/`seed_plan_matrix`에 정의되어 있어 BETA_ALL_PAID를 내리는 시점에 자동 적용.

#### 클라이언트 (`src/lib/supabase/connectionMessages.ts`)

기존 API(`sendConnectionMessage`, `listMyReceivedMessages`, `markConnectionMessageRead`, `getUnreadConnectionMessageCount`)는 back-compat로 유지. 신규:
- `type ConversationSummary`
- `listMyConversations({ limit, beforeTs })` — RPC 호출 → `profiles` 단일 `in("id",…)`로 peer 프로필 하이드레이션.
- `listConversationWith(otherUserId, { limit, beforeTs })` — `participant_key` eq 기반 쿼리, oldest-first 반환(채팅 버블용).
- `markConversationRead(otherUserId)` — 특정 peer로부터 받은 미읽음 메시지 일괄 읽음 처리.

#### 신규 페이지/컴포넌트

- `src/app/my/messages/page.tsx` — 기존 받은 메시지 리스트 → **대화 리스트**로 리팩터링. Preview, unread badge, "나:" prefix (내가 보낸 마지막이면), 시간, Load more 커서.
- `src/app/my/messages/[peer]/page.tsx` — 신규 **스레드 디테일**. `peer`는 username(pretty) 또는 uuid(placeholder 계정 fallback). 채팅 버블 + 날짜 divider + 이전 메시지 페이지네이션 + 인라인 회신 composer. 진입 시 `markConversationRead(peerId)`로 자동 읽음 처리.
- `src/components/connection/MessageComposer.tsx` — 공용 composer. textarea + 문자수 카운트(4000) + `useFeatureAccess("social.connection_unlimited")`로 **사용량 hint / near_limit 경고 / soft block**. ⌘/Ctrl+Enter 전송. `sendConnectionMessage` 경유하므로 metering (`connection.message_sent` usage event) 유지.
- `src/components/connection/MessageRecipientButton.tsx` — `ProfileActions`에서 사용하는 "메시지" 버튼 + portal sheet. 내부 composer에 `autoFocus`, 전송 성공 시 1.4s confirm toast 후 자동 닫힘.
- `src/components/ProfileActions.tsx` — FollowButton 옆에 `MessageRecipientButton` 나란히. 자기 자신 프로필에서는 여전히 렌더 안 함.

#### Entitlement / Metering 통합

- Composer는 `useFeatureAccess("social.connection_unlimited")`로 실시간 quota 조회. 기존 `seed_plan_matrix.sql`의 rule(free 월 5건, artist_pro/discovery_pro 월 100건, hybrid_pro 월 300건, gallery_workspace unlimited)을 그대로 사용. BETA_ALL_PAID가 켜진 현재는 `allowed=true`로 override되지만 usage_events는 계속 쌓이므로 post-beta 전환 즉시 차단이 동작.
- 전송 후 `refresh()`로 quota 재해석 → UI가 최신 `used`를 반영.

#### 알림/기존 트리거

`on_connection_message_notify` 트리거와 `notify_on_connection_message()` 함수는 그대로. 스레드에서 회신하더라도 동일한 `connection_message` 타입 알림이 상대에게 전송됨.

#### i18n 키(KR/EN) 추가

- `connection.inbox.subtitleThreads`, `connection.inbox.emptyHint`, `connection.inbox.findPeople`, `connection.inbox.unknownUser`, `connection.inbox.youLabel`
- `connection.thread.*` (backToInbox / notFound / empty / loadOlder / viewProfile)
- `connection.composer.*` (ctaMessage / sheetTitle / placeholder / placeholderTo / send / sent / usageUnlimited / usageLimited / nearLimit / blocked)
- `nav.myProfile` 값 갱신(영문/한글).

#### 영향 / 리그레션 체크

- `/my/messages` 기존 진입점 URL 동일, subtitle만 교체. 기존 signal badge(`getUnreadConnectionMessageCount`)는 건드리지 않음 — 인바운드 미읽음은 스레드 탐색 시 `markConversationRead`로 해소.
- `IntroMessageAssist`(/people)는 수정 안 됨 — 기존 Follow-with-Intro 경로 보존.
- `price_inquiries` inbox(`/my/inquiries`)는 이번 패치 범위 외. 별도 스키마/pipeline 유지.
- `FollowProfileRow`는 이번 패치에서 변경 없음(직전 Network 패치에서 `followed_at` 추가한 상태 그대로).

#### 수동 QA 체크리스트

1. `/u/<peer>`에서 "메시지" 클릭 → sheet 열림 → 보내기 → `/my/messages`에 대화 나타남.
2. `/my/messages` 에서 대화 카드 클릭 → `/my/messages/<peer>`로 이동, 미읽음 뱃지 사라짐, 채팅 버블이 오래된 → 최신 순으로 정렬.
3. 상대가 답장하면 동일 thread에 append (새로고침 후). 답장 UI의 ⌘+Enter가 전송.
4. 쿼터 hint: 무료 플랜 시드에서 5건 초과시 `blocked` 배지 렌더 (BETA_ALL_PAID OFF 필요).
5. 헤더 "내 스튜디오 / My Studio" 표기, 각 `← 내 스튜디오로/Back to My Studio` 동작.
6. 스튜디오 작업실 타일 = `/my/library` 총 카운트 일치, 네트워크 타일 = `9 · 12` composite.

### Supabase 적용 필요

- `supabase/migrations/20260425000000_connection_message_threads.sql` 수동 실행 필요.

### 환경 변수

변경 없음.

### Verified

- `npx tsc --noEmit` 통과.
- `npm run lint`에서 새로 건드린 파일 관련 에러 없음(기존 파일의 pre-existing 경고/오류는 무시).

### 변경 파일

- Added: `supabase/migrations/20260425000000_connection_message_threads.sql`
- Added: `src/app/my/messages/[peer]/page.tsx`
- Added: `src/components/connection/MessageComposer.tsx`
- Added: `src/components/connection/MessageRecipientButton.tsx`
- Modified: `src/app/my/messages/page.tsx`
- Modified: `src/components/ProfileActions.tsx`
- Modified: `src/lib/supabase/connectionMessages.ts`
- Modified: `src/lib/i18n/messages.ts`
- Modified: `src/components/Header.tsx` (주석 통일)
- Modified: `src/app/my/page.tsx` (네트워크/작업실 타일 소스 교체)

---

## 2026-04-24 — Studio/Profile UX Reset + Network Page Upgrade

### 왜 필요했나

`/my`가 계정 페이지에서 "스튜디오 대시보드"로 격상되면서, 기존 구조는 패시브 정보(7일 조회수/팔로워 카운트/미처리 문의 카운트의 큰 카드 행)가 최상단을 차지하고, `다음에 할 일`이 너무 컸으며, 8개에 가까운 비슷한 중량의 액션이 경쟁하고 있었다. 네트워크 버튼도 단순 `/my/followers` 목록으로만 연결되어 관계 관리 용도로 부족했다.

이번 패치는 (가이드 투어 패치 이전에) **IA와 dashboard UX를 먼저 안정화**하고, **`네트워크` destination을 진짜 관계 관리 페이지로 격상**한다. 패치 Brief: `Abstract_Patch_Brief_Studio_Profile_UX_Reset_Plus_Network_2026-04-23.md`.

### 스튜디오(/my) 레이아웃 변경

Before → After:

| Before | After |
|---|---|
| `StudioHero`(풀 폭) → `StudioSignals`(4칸 패시브 stat 로우) → `StudioNextActions`(풀 폭) → `StudioSectionNav`(7칸 혼합 그리드) → `StudioQuickActions` → `StudioViewsInsights`(프로필 조회 로우) | `StudioHeroPanel`(Hero + 우측 `StudioNextStepsRail` 사이드레일) → `StudioOperationGrid`(2×4 8타일) → `StudioQuickActions`(컴팩트 유지) |

변경 요약:
- 큰 passive stat 로우 제거. 각 카운트는 8타일 중 해당 타일로 흡수. 프로필 조회는 "프로필 조회" 타일로 흡수(entitlement locked 시 `—` 표시 + 점선 보더).
- `StudioNextActions`(풀 폭)는 제거하고, 동일한 `computeStudioNextActions` priority engine 결과를 `StudioNextStepsRail`이 읽어 Hero 옆 사이드레일로 렌더. 데스크톱 `lg:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]`로 나란히, 그 이하 뷰포트는 자연스럽게 스택.
- 타일 그룹핑(Brief §4.4 엄수):
  - Row 1 (창작/큐레이션/운영): `전시 · 작업실 · 보드 · 메시지`
  - Row 2 (관계/요청/검증/가시성): `문의 · 소유권 · 네트워크 · 프로필 조회`
- `/my/page.tsx` 폭 `max-w-4xl` → `max-w-5xl` (사이드레일 수용).
- `StudioIntelligenceSurface`는 그대로 포트폴리오 하단에 시각적으로 demote된 상태 유지.

### 신규 컴포넌트

- `src/components/studio/StudioHeroPanel.tsx` — 히어로 + 사이드레일 그리드 래퍼. `data-tour="studio-hero"`.
- `src/components/studio/StudioNextStepsRail.tsx` — 우측 컴팩트 모듈(2–4 items). `data-tour="studio-next-steps"`.
- `src/components/studio/StudioOperationGrid.tsx` — 8타일(2×4) 그리드. `data-tour="studio-operating-grid"` + 타일별 `data-tour="studio-card-*"`.
- `StudioHero`는 자체 `mb-6` 제거, 폼 팔로워/팔로잉 링크를 `/my/network?tab=followers|following`로 이관. `suppress-*` 기타 prop 변경 없음.

기존 `StudioSignals`, `StudioSectionNav`, `StudioViewsInsights`, `StudioNextActions`는 **barrel에서 여전히 export**하되 신규 페이지에서는 사용하지 않는다. 호환/복원 용도로 남김.

### 네트워크 페이지 신설

- 신규 라우트 `src/app/my/network/page.tsx`.
- 탭(URL `?tab=followers|following`으로 동기화 — deep link + shallow `router.replace`), 검색(이름/핸들/bio), 정렬(`최신순` / `이름순`).
- `lib/supabase/follows.ts` `getMyFollowers` / `getMyFollowing` 반환값에 `followed_at` 추가(follow row `created_at`). `FollowProfileRow.followed_at?: string | null`. 기존 호출부(`/my/followers`, `/my/following`, `connectionMessages.sender`)는 optional 필드라 breaking change 없음.
- 정렬 "최신순" = `followed_at desc` (값 없으면 이름순 fallback). 이름순 = `localeCompare`.
- 각 로우: 아바타 / 이름 / `@handle` · bio 한 줄 / `FollowButton`. Row 클릭 시 공개 프로필로 이동(`/u/:username`).
- 빈 상태 3종: no followers / no following / no search result.
- `data-tour="network-tabs" | "network-search" | "network-sort" | "network-list"`.
- 기존 `/my/followers`, `/my/following` 페이지는 **백워드 컴팩트용으로 그대로 남김**(알림/북마크 링크 보호). Hero/OperationGrid의 링크는 모두 `/my/network`로 갱신.

### i18n

신규 키(KR/EN 양쪽): `studio.nextSteps.title|empty`, `studio.operationGrid.title`, `studio.sections.views|viewsDesc`, `network.*` 전체 블록.

### data-tour 앵커 (후속 가이드 투어 패치용 안정 셀렉터)

- `studio-hero`, `studio-next-steps`, `studio-operating-grid`
- `studio-card-exhibitions`, `studio-card-workshop`, `studio-card-boards`, `studio-card-messages`
- `studio-public-works`
- `studio-portfolio-tab-strip` (스튜디오 투어 7·8단계 — 탭 줄만)
- `network-tabs`, `network-search`, `network-sort`, `network-list`

### 데이터/엔티타이틀먼트 영향도

- `insights.profile_viewer_identity` 해석 로직과 entitlement 호출 경로 유지. 단, `/my`에서 viewer 리스트를 더 이상 상단에 펼치지 않으므로 `getProfileViewers` 호출이 제거되어 해당 경로의 RLS 히트가 소폭 감소.
- `getMyStats`, `getProfileViewsCount`, `getBoardSaveSignals`, `getMyPriceInquiryCount`, `getMyPendingClaimsCount`, `getUnreadConnectionMessageCount` 호출은 그대로. 이들이 반환한 값은 모두 8타일에 분배되어 소비된다.
- 액팅 모드(`actingAsProfileId`)일 때는 타일/쾌속작업이 non-owner context이므로 기존 논리대로 히든 유지(변화 없음).

### 회귀 체크 (이미 수행)

- `tsc --noEmit` 통과.
- 수정 파일에 한해 `eslint` 통과(프로젝트 기존 pre-existing 오류는 이번 스코프 외).
- 팔로워/팔로잉 기존 라우트(/my/followers, /my/following) 유지 → 기존 알림 CTA 깨짐 없음.
- `connectionMessages.sender` 타입 호환(optional followed_at).

### 알려진 잔여 아이템 / 후속 과제

- `/my/followers`, `/my/following`는 장기적으로 `/my/network?tab=...`으로 redirect 처리 가능(이번 스코프 외). 즉시 제거 시 기존 알림 링크가 404가 될 수 있어 유지.
- `프로필 조회` 타일은 `/settings`로 라우팅(방문자 전체 보기가 거기 있음). 추후 전용 `/my/views` 페이지로 승격 가능.
- 네트워크 "관련순"은 **구현하지 않음**. 랭킹 데이터 없음(Brief §5 D에 명시된 지침 그대로). 현재 정렬은 `최신순`/`이름순` 2종.

### 터치한 파일

- `src/app/my/page.tsx` — 재구성.
- `src/app/my/network/page.tsx` — **신설**.
- `src/components/studio/StudioHero.tsx` — mb 제거, 링크 재타깃.
- `src/components/studio/StudioHeroPanel.tsx` — **신설**.
- `src/components/studio/StudioNextStepsRail.tsx` — **신설**.
- `src/components/studio/StudioOperationGrid.tsx` — **신설**.
- `src/components/studio/index.ts` — 신규 export 추가.
- `src/lib/supabase/follows.ts` — `followed_at` 부착.
- `src/lib/i18n/messages.ts` — `studio.nextSteps.*`, `studio.operationGrid.*`, `studio.sections.views*`, `network.*` KR/EN 추가.

---

## 2026-04-24 — Monetization Readiness Spine Patch

### 왜 필요했나

앞선 2026-04-23 패치에서 `BETA_ALL_PAID` 플래그 + `SEE_BOARD_SAVER_IDENTITY` 등 소수의 feature key만 박아 두었는데, 유료화 로드맵이 12개월에 걸쳐 5개 플랜(`free` / `artist_pro` / `discovery_pro` / `hybrid_pro` / `gallery_workspace`)으로 확장되면 다음이 반드시 필요해진다:

1. **Entitlement SSOT** — 기능 키·플랜 매트릭스를 TS와 DB 양쪽에서 동일하게 참조.
2. **Metering foundation** — 플랜 전환 시점에 quota 계산이 가능한 단일 usage 테이블.
3. **Delegation audit** — seat-based billing을 위해 "누가 누구를 대신해 무엇을 했는지" 추적.
4. **Workspace 도메인 준비** — 기관(갤러리) 시트 개념의 DB/이름 공간을 미리 박아 두고 UI는 추후.

Paywall 자체, Stripe 연동, Pricing 페이지는 **의도적으로 이번 범위에서 제외**. 이번 패치는 "언제든 paywall을 세울 수 있는 뼈대"만 완성한다.

### 핵심 모듈

- `src/lib/entitlements/` — SSOT.
  - `featureKeys.ts` — 모든 canonical feature 키(33개). 레거시 4개는 `LEGACY_FEATURE_KEY_ALIAS`로 호환.
  - `planMatrix.ts` — `PLAN_FEATURE_MATRIX`(feature → plans[])와 `PLAN_QUOTA_MATRIX`(feature → plan → quota rule).
  - `betaOverrides.ts` — `BETA_ALL_PAID=true` 플래그 이관. Beta 기간엔 `applyBetaOverride`가 모든 거부 결정을 `source=beta_override / uiState=beta_granted`으로 변환하되 **quota 계산은 그림자로 수행**. Beta 해제 시점 `false` 플립만 하면 실제 plan gating이 즉시 켜진다.
  - `quotaHelpers.ts` — `fetchUsageForFeature`, `computeQuotaInfo` 유틸.
  - `resolveEntitlement.ts` — `resolveEntitlementFor({featureKey, userId, actingAsOwnerUserId, workspaceId})`. acting-as/workspace plan 합성 + quota 체크를 한 함수로. 30초 TTL 캐시로 핫패스 보호.
  - `legacy.ts` — 기존 `getMyEntitlements`/`hasFeature` 시그니처를 유지하되 내부적으로 새 resolver로 dispatch. 기존 call site는 점진 이관.
  - `index.ts` — 배럴.
- `src/lib/metering/` — usage 기록.
  - `usageKeys.ts` — 모든 event_key 상수(`ai.*.generated`, `board.created`, `connection.message_sent`, `feature.impression`, `feature.gate_blocked`, `delegation.acting_as_entered` 등).
  - `recordUsageEvent.ts` — 단일 엔트리. 실패는 silent. Optional dual-write → `beta_analytics_events`로 기존 대시보드 호환.
  - `aggregates.ts` — window aggregation 헬퍼.
- `src/lib/delegation/actingContext.ts` — `acting_context_events` 기록 + `logActingScopeChange` 헬퍼.
- `src/hooks/useFeatureAccess.ts` — 클라이언트 훅. `actingAsProfileId` 변화에 자동 재해결.
- `src/components/monetization/FeatureBadge.tsx`, `UpgradeHint.tsx` — paywall hint UI 프리미티브(beta 중엔 자동으로 렌더 스킵).

### DB 마이그레이션 (7개, 타임스탬프 `20260423120000`~`20260423123000`)

| 파일 | 내용 |
|---|---|
| `20260423120000_plans_and_plan_matrix.sql` | `public.plans`, `public.plan_feature_matrix`, `public.plan_quota_matrix` 테이블. RLS read-all. |
| `20260423120500_entitlements_status_upgrade.sql` | `entitlements`에 `plan_source`, `trial_ends_at` 컬럼 + `status` CHECK 확장. |
| `20260423121000_usage_events.sql` | `public.usage_events` (user_id, workspace_id, feature_key, event_key, value_int, metadata). 본인/서비스롤 insert + 본인 select RLS. |
| `20260423121500_acting_context_events.sql` | append-only 감사 로그. actor는 본인 insert, subject는 자신이 당한 기록 select 가능. |
| `20260423122000_workspaces.sql` | `workspaces`, `workspace_members`, `workspace_invites`. `SECURITY DEFINER` 멤버십 헬퍼 + RLS. |
| `20260423122500_entitlement_decisions_log.sql` | 샘플링된 `entitlement_decisions`. 본인/서비스롤 scope. |
| `20260423123000_seed_plan_matrix.sql` | 위 TS 매트릭스와 1:1 mirror. idempotent upsert. |

### 배선이 들어간 기존 코드

- `src/lib/ai/route.ts` `handleAiRoute` — 인증 후 soft-cap 직전에 `resolveEntitlementFor`. 차단 시 `feature.gate_blocked` 기록 + 402/429 `degraded`. 허용 성공 시 `ai.*.generated` meter.
- `src/lib/supabase/shortlists.ts` — `createShortlist` → `board.created`, `addArtwork/ExhibitionToShortlist` → `board.saved_artwork|exhibition`.
- `src/lib/supabase/connectionMessages.ts` `sendConnectionMessage` → `connection.message_sent`.
- `src/lib/supabase/artworks.ts` `createDraftArtwork` → `artwork.uploaded` + acting-as면 `artwork.create_draft` 감사 로그.
- `src/lib/supabase/exhibitions.ts` `createExhibition` → `exhibition.created` + acting-as 감사.
- `src/lib/supabase/priceInquiries.ts` `replyToPriceInquiry` → `inquiry.replied` + acting-as 감사.
- `src/context/ActingAsContext.tsx` — `setActingAs` / `clearActingAs`에서 `delegation.acting_as_entered|exited` meter.
- `src/app/my/page.tsx`, `src/app/notifications/page.tsx` — 기존 `hasFeature(...)` 호출을 `resolveEntitlementFor`(page)과 `useFeatureAccess`(notifications)로 이관. 외부 문구·UX는 그대로.

### 진단 페이지

- `/dev/entitlements` — 개발 모드 또는 `NEXT_PUBLIC_ENTITLEMENTS_DIAG=1`일 때 활성. 모든 `FEATURE_KEYS`에 대해 `resolveEntitlementFor` 결과를 테이블로 표시(plan/source/uiState/quota/hint). acting-as 컨텍스트 영향도 함께 확인 가능.
- `/dev/ai-metrics` — 기존 AI 루틴 요약에 더해 `usage_events` 30일 집계 섹션 추가.

### 유료화 플립 체크리스트

1. `BETA_ALL_PAID=false`로 전환.
2. `plans` / `plan_feature_matrix` / `plan_quota_matrix` 를 최신 매트릭스로 재seed(또는 Stripe webhook이 자동 upsert).
3. 기존 유저에게 기본 `free` 플랜 행을 `entitlements`에 insert(또는 trial 자동 부여).
4. Stripe checkout / portal 연결. 결제 성공 시 `entitlements.status='active', plan_source='stripe', plan=...` upsert.
5. Workspace 도메인 front-end 착수(invite/member/billing 페이지).
6. `UpgradeHint` 실제 CTA 문구 및 전환 deeplink 작성.

추가 유료화 제안 15+건은 [docs/MONETIZATION_PROPOSALS.md](docs/MONETIZATION_PROPOSALS.md) 참조. 그 중 Group A는 이번 스파인 패치로 이미 meter/enforcement까지 준비 완료.

---

## 2026-04-23 — 보드 담기 알림 + 아티스트 시그널 + 프리미엄 레이어

### 왜 필요했나

아티스트 입장에서 누군가 자기 작품을 보드에 담는 행위는, 특히 신진이고 대외 인지도가 낮을수록 강한 관심 시그널이다. 이걸 아무 피드백 없이 누락시키는 건 제품 취지와 안 맞음. 동시에 큐레이터의 스카우팅 프라이버시도 보호해야 하므로, 노출 깊이를 플랜으로 게이팅하는 구조를 도입.

### DB 변경 — `supabase/migrations/20260423100000_board_save_notifications.sql`

- `notifications_type_check` CHECK 제약 확장: `board_save`, `board_public` 추가.
- 트리거 `on_board_save_notify` — `shortlist_items` INSERT 시 작품의 `artist_id`에게 알림.
  - Self-save 스킵 (작가 == 보드 오너).
  - 같은 `(artist, actor, artwork)` 조합이 7일 내 이미 알림을 받았다면 dedup. 큐레이터가 작품을 다른 보드로 옮기는 것만으로는 다시 알리지 않음.
  - Payload에는 `shortlist_id`, `is_private`만 담음. **보드 제목·내용은 넣지 않음** (프라이버시).
- 트리거 `on_shortlist_public_transition` — `shortlists.is_private true → false` 전환 시, 보드에 포함된 **모든 아티스트**(보드 오너 제외)에게 알림.
  - WHEN절 `(old.is_private = true and new.is_private = false)`로 실제 전환만 포착.
  - 공개된 정보이므로 Payload에 `shortlist_title`, `share_token` 노출.
  - 비공개↔공개 토글을 반복하면 전환마다 재발행(의도).
- RPC `get_board_save_signals()` — SECURITY DEFINER, 반환 `{boards_count, savers_count}`.
  - `auth.uid()`의 작품이 담긴 **고유 보드 수**와 **고유 저장자 수**만 반환.
  - `s.owner_id <> auth.uid()` 조건으로 self-curation은 카운트에서 제외.
  - 개별 보드·큐레이터 신원은 절대 노출 안 함(집계 전용).

### 프론트 변경

- `src/lib/supabase/notifications.ts` — `NotificationType`에 `board_save`, `board_public` 추가.
- `src/lib/supabase/shortlists.ts` — `getBoardSaveSignals()` RPC wrapper.
- `src/app/notifications/page.tsx` — 두 타입 렌더링 + plan 기반 문구 분기.
  - `board_save` 링크는 항상 `/artwork/{artwork_id}` (비공개 보드일 수 있으므로 보드 자체로는 링크 X).
  - `board_public` 링크는 **유료만** `/room/{token}`, 무료는 `/artwork/{artwork_id}` (큐리오시티 갭 → 업그레이드 훅).
- `src/app/my/page.tsx` — `StudioSignals`에 "내 작품이 담긴 보드 N개" 타일 (`boards_count > 0`일 때만; acting-as-gallery 중엔 숨김).
- `src/lib/i18n/messages.ts` — 한/영 문구 8개 키.

### 문구 (한국어)

| 이벤트 | 무료/기본 | 유료 |
|---|---|---|
| `board_save` | 누군가 회원님의 작품 〈{title}〉을(를) 보드에 담았어요 | {name}님이 회원님의 작품 〈{title}〉을(를) 보드에 담았어요 |
| `board_public` | 회원님의 작품 〈{title}〉이(가) 담긴 보드가 공개되었어요 | 회원님의 작품 〈{title}〉이(가) 담겨 있는 {name}님의 보드 〈{shortlistTitle}〉이(가) 공개되었어요 |

### 프리미엄 레이어 — `src/lib/entitlements.ts`

- `BETA_ALL_PAID = true` 플래그 추가. 베타 기간 동안 온보딩된 모든 유저를 유료 취급 → `hasFeature()`가 선언된 기능 전부 true 반환. 유료 런칭 시점에 `false`로 플립하면 실제 플랜 매트릭스가 즉시 적용됨.
- 신규 feature 키:
  - `SEE_BOARD_SAVER_IDENTITY` → `artist_pro` 전용. 보드 담기 알림에서 담은 사람 이름 공개.
  - `SEE_BOARD_PUBLIC_ACTOR_DETAILS` → `artist_pro` 전용. 공개 전환 알림에서 보드 주인·제목·룸 링크 공개.

### 유료화 로드맵 메모

유료 런칭 시 플립할 지점을 미리 박아둠:

- **아티스트 측 (artist_pro)**
  - `SEE_BOARD_SAVER_IDENTITY` — 누가 담았는지 보기
  - `SEE_BOARD_PUBLIC_ACTOR_DETAILS` — 공개 보드 상세 직접 링크
  - (기존) `VIEW_PROFILE_VIEWERS_LIST`, `VIEW_ARTWORK_VIEWERS_LIST` — 방문자 로그
  - 향후 후보: "내 작품이 담긴 공개 보드 전용 뷰"(`/my/featured-in`), "Collector Pulse" 집계 인사이트(최근 30일 저장자 추이 등)
- **큐레이터/콜렉터 측 (collector_pro)**
  - 후보: 보드 수 쿼터(무료 N개 초과 시 유료). `shortlists` 테이블에서 `owner_id` count만 보면 돼서 구현 간단.
  - 후보: 공유 룸 애널리틱스(조회·체류시간), 공개 보드 만료일 세팅, 공동 편집자 수 제한 해제.
- **공용 (pro 전반)**
  - 후보: AI 전시 기획 초안(`ExhibitionDraftAssist`) 사용량 상한, 프로파일 커스터마이징(도메인·테마), 향후 노출 부스트.

각 후보는 지금은 "베타 ALL_PAID"에 묻혀 보이지 않지만 `FEATURE_PLANS` 매트릭스에 등록하는 순간 무료 티어에서는 자동 차단됨. 추가 시엔 반드시 feature 키를 `FEATURE_PLANS`에 등록하고 UI 콜사이트에서 `hasFeature(plan, KEY)`로 감싸는 패턴 유지.

### 추후 작업 (별도 패치로 메모)

- **"내 작품이 담긴 공개 보드" 전용 뷰**: 현재는 알림 클릭으로만 도달. 아티스트의 `/my/shortlists` 상단 보조 섹션 혹은 `/my/featured-in` 페이지로 `board_public` 이력을 누적 표시하면 UX 연속성이 생김. 보드 오너십 의미(`내 보드`)와 혼동되지 않도록 별도 탭/섹션으로 분리 필수.
- **알림 dedup 윈도우 튜닝**: 현재 7일. 실사용 피드백 보고 1–14일 사이에서 조정.
- **`board_public` 반복 토글 스팸 가드**: 동일 보드를 하루에 5번 토글하는 큐레이터가 생기면 `OLD.is_private = TRUE AND NEW.is_private = FALSE AND 최근 24h 알림 없음`으로 강화 가능. 지금은 의도적 단순함 유지.

### 검증

- 트리거: `board_save` cross-board dedup=1, self-save=0, `board_public` 첫 전환=1, 재토글=2 (의도).
- RPC: self-curation 제외 후 `boards_count=1, savers_count=1` 확인.
- `tsc --noEmit` clean, lint clean.

---

## 2026-04-22 — Boards RLS 재귀 버그 핫픽스 + 보드 → 전시 게시물 진화 경로

### 증상

`/my/shortlists`에서 "보드 만들기"가 항상 실패하고 "보드를 만들지 못했어요…" 토스트만 떴음. 패치 이전부터 이미 깨져 있던 잠복 버그.

### 근본 원인

Supabase `postgres` 로그에서 확인:

```
ERROR: infinite recursion detected in policy for relation "shortlists"
```

두 RLS 정책이 서로 EXISTS 서브쿼리로 물려 있었음:
- `shortlists.shortlists_collab_select` → `EXISTS (SELECT FROM shortlist_collaborators …)`
- `shortlist_collaborators.shortlist_collab_owner_manage` (FOR ALL) → `EXISTS (SELECT FROM shortlists …)`

둘 다 PERMISSIVE라 SELECT 시 둘 다 OR로 평가되고 각 EXISTS가 상대 테이블의 RLS를 다시 트리거 → 재귀. Postgres가 감지해 쿼리 전체를 abort. PostgREST의 `.insert().select()` (returning=representation)도 뒤따르는 SELECT에서 같은 에러로 row를 돌려받지 못하고 클라이언트가 실패로 판정. 그래서 테이블은 비어 있고 UI는 계속 실패 토스트를 내던 상태.

(`shortlist_items` / `shortlist_views`의 owner 정책도 같은 패턴을 가지고 있었음.)

### 수정

`supabase/migrations/20260422140000_shortlists_rls_recursion_fix.sql` 추가. Supabase에 이미 적용됨(MCP `apply_migration`).

핵심: cross-table EXISTS를 `SECURITY DEFINER` 헬퍼로 치환해 RLS 평가가 상대 테이블로 재진입하지 않도록 끊음.

신규 함수 (STABLE SECURITY DEFINER, search_path=public, authenticated에게 EXECUTE 권한):

- `public.is_shortlist_owner(_sid uuid)`
- `public.is_shortlist_collaborator(_sid uuid)`
- `public.is_shortlist_editor(_sid uuid)`

재작성된 정책:

- `shortlists.shortlists_collab_select` → `USING (is_shortlist_collaborator(id))`
- `shortlist_collaborators.shortlist_collab_owner_manage` (ALL) → USING/WITH CHECK `is_shortlist_owner(shortlist_id)`
- `shortlist_items.shortlist_items_owner` (ALL) → `is_shortlist_owner(shortlist_id)`
- `shortlist_items.shortlist_items_collab_select` → `is_shortlist_collaborator(shortlist_id)`
- `shortlist_items.shortlist_items_collab_editor` (ALL) → `is_shortlist_editor(shortlist_id)`
- `shortlist_views.shortlist_views_owner_select` → `is_shortlist_owner(shortlist_id)`

SECURITY DEFINER 함수 안에서 테이블을 읽을 때는 RLS를 우회하므로 외부 정책이 함수를 호출해도 재진입이 발생하지 않음. 함수 자체는 boolean만 돌려주므로 정보 누출 위험 없음.

### 검증

- `pg_policies` 상 모든 재작성된 qual이 함수 호출 식으로 바뀜.
- 시뮬레이션: `SET LOCAL role authenticated` + JWT claims 주입해 `SELECT count(*) FROM shortlists` → 0 (에러 없음).
- INSERT ... RETURNING id, title 동일 조건에서 정상 동작 (테스트 row 삽입/삭제로 round-trip 확인).

### 보드 → 전시 게시물 진화 경로

브리프 취지("보드가 자연스럽게 전시 게시물로 진화")에 맞춰 홍보 경로를 구축:

1. **보드 상세** (`/my/shortlists/[id]`)
   - 타이틀 블록 아래에 "이 보드를 전시 게시물로 발전시키기" CTA 카드 추가.
   - 작품이 1개 이상일 때만 활성화. 비활성화 시 "작품을 최소 1개 이상 담아두면 활성화돼요." 힌트.
   - 클릭 → `/my/exhibitions/new?fromBoard=<id>` 이동 + `board_promote_started` 이벤트.

2. **전시 생성** (`/my/exhibitions/new`)
   - `fromBoard` 쿼리 감지 시 보드 타이틀로 제목 프리필(사용자가 수정한 뒤면 덮어쓰지 않음).
   - 상단 배너: "보드에서 시작: {title} · 작품 N개".
   - 생성 성공 후 `/my/exhibitions/<new-id>/add?fromBoard=<boardId>`로 이동해 상태 이월.

3. **전시에 작품 추가** (`/my/exhibitions/[id]/add`)
   - `fromBoard` 쿼리 감지 시 해당 보드의 artwork_id 목록을 프리페치.
   - "작품 선택" 단계 최상단에 요약 배너 + `보드의 작품 N개 모두 추가` 원클릭 버튼.
   - 이미 전시에 담겨 있는 작품은 스킵(중복 방지). 일부 실패 시 "부분 성공" 토스트, 전체 실패 시 재시도 안내.
   - 성공 시 `board_promote_bulk_added` 이벤트 (added, total, exhibition_id, board_id).

새 i18n 키: `boards.promote.cta|hint|disabledHint|fromBoardBanner|addAllFromBoard|adding|addedToast|partialToast|failedToast` (KO/EN).
새 Beta 이벤트: `board_promote_started`, `board_promote_bulk_added`.

보드 자체는 유지되므로 "비교/검토 공간 → 공개 게시물 승격" 흐름이 자연스럽게 이어짐. 보드 상세에서 다시 CTA를 눌러 또 다른 전시로도 확장 가능.

### Supabase SQL 적용

이미 프로덕션(`sgufonscldvdwfgzltfw`)에 MCP `apply_migration`으로 반영됨. 로컬 개발/다른 환경에서는 `supabase/migrations/20260422140000_shortlists_rls_recursion_fix.sql`을 SQL Editor에서 실행.

### 영향 파일

- `supabase/migrations/20260422140000_shortlists_rls_recursion_fix.sql` (신규)
- `src/lib/i18n/messages.ts`, `src/lib/beta/logEvent.ts`
- `src/app/my/shortlists/[id]/page.tsx`
- `src/app/my/exhibitions/new/page.tsx`, `src/app/my/exhibitions/[id]/add/page.tsx`

---

## 2026-04-22 — Workshop/Boards IA 재정비 + /my Studio UI/UX 업그레이드

두 개의 패치 브리프를 묶어 한 번에 반영:
- `Abstract_Patch_Brief_Workshop_Boards_2026-04-22.md` — 라이브러리/쇼트리스트 IA/네이밍/UX 복구
- `Abstract_UIUX_Upgrade_Patch_Brief_2026-04-22.md` — `/my`(스튜디오) 대시보드 구조·계층 정비

### 네이밍 맵 (UI 레이블만 변경, 라우트 경로는 유지)

| 기존 UI | 변경 UI (KO) | 변경 UI (EN) | 라우트 (불변) |
|---------|--------------|--------------|---------------|
| 라이브러리 | 작업실 | Workshop | `/my/library` |
| 쇼트리스트 | 보드 | Boards | `/my/shortlists` |
| 쇼트리스트에 담기 | 보드에 담기 | Save to board | `SaveToShortlistModal` |
| 새 쇼트리스트 | 새 보드 | New board | `/my/shortlists` |
| 전시 만들기 | 전시 게시물 만들기 | Create exhibition post | `/my/exhibitions/new`, `/upload/exhibition` |
| 내 프로필 | 내 스튜디오 | My studio | `/my` |

경로는 바꾸지 않음. 북마크/딥링크/앱 라우팅이 깨지지 않도록 UI 레이블만 교체. 향후 `/my/workshop`·`/my/boards`로 옮길지는 트래픽/리디렉트 계획과 함께 별도 판단.

### /my 스튜디오 구조 변경

- **페이지 타이틀**: "내 프로필" → "내 스튜디오" (+ 부제: "작품·전시·연락을 운영하는 나만의 대시보드").
- **StudioHero**: 역할 칩 아래 `팔로워 · 팔로잉` 인라인 카운트(클릭 가능) 추가.
- **StudioSignals**: 팔로워 라벨 통일(`studio.signals.followers` 사용; 델타 전용 키와 분리).
- **StudioQuickActions**: 3단 계층으로 재편
  - Primary(1): 작품 올리기
  - Secondary(2~3): 전시 게시물 만들기 · 프로필 편집 · 사람 찾기
  - Tertiary(오버플로 `더 보기`): 작업실/보드/저장된 검색/포트폴리오 정렬/프로필 완성
- **StudioSectionNav**: `grid-cols-1 sm:2 lg:4`로 변경, 카드마다 1줄 설명(`descKey`) 추가. `portfolio` 섹션 제거(상단 스튜디오 프레임으로 흡수), 대신 `workshop`·`boards` 엔트리 노출.
- **공개 작품 섹션**: 포트폴리오 패널 위에 "공개 작품 · 내부 작업은 작업실에서" helper + 작업실 링크.

### /my/exhibitions/new 프레이밍

- 타이틀: "전시 게시물 만들기" + 부제 "이미 진행했거나, 현재 진행 중이거나, 곧 진행할 전시의 정보를 정리해 공개하는 페이지를 만듭니다."
- AI 문안 도우미는 제목 입력 이후에만 등장하는 접힘 패널(`선택 사항`)로 강등. 기본은 접힘.
- `/upload/exhibition` 탭 라벨도 "전시 게시물 만들기"로 통일 (리다이렉트 경로는 동일).

### Boards (구 Shortlists) 기능 복구

- **생성 흐름**: 에러 피드백(`boards.createFailed`) + 성공 토스트(`boards.createSuccess`) + 300ms 후 상세 페이지로 라우팅.
- **목록/상세**: 모든 하드코딩 문자열을 `boards.*` 네임스페이스로 이전. 공유 링크 복사 성공 피드백 추가.
- **썸네일 버그**: `listShortlistItems`가 `artwork.image_path`를 읽도록 확장. 상세에서 `getArtworkImageUrl(image_path, "thumb")` 사용. 이미지 없는 작품에 대한 폴백 박스.
- **SaveToShortlistModal (보드에 담기)**: 완전 i18n화. 전시도 아트워크와 동일한 중복 감지/해제 지원(`getShortlistIdsForExhibition`, `removeExhibitionFromShortlist` 신규). 모달 하단 `모든 보드 보기` 링크 추가.
- **updated_at 일관성**: `addExhibitionToShortlist`도 부모 `shortlists.updated_at`을 갱신해 최근순 정렬 정합성 확보.

### i18n

- `src/lib/i18n/messages.ts`에 다음 네임스페이스 확장/추가:
  - `studio.pageTitle`, `studio.pageSubtitle`, `studio.hero.followers`, `studio.hero.following`, `studio.sections.*Desc`, `studio.quickActions.*`, `studio.portfolioHelper.*`
  - `library.*` (Workshop 레이블), `exhibition.createSubtitle`, `upload.tabExhibition` 재작성
  - `boards.*` (Boards 전체), `boards.save.*` (모달), `common.close`, `common.cancel`
  - `ai.assist.introLabel`, `ai.assist.optional`
- KO/EN 양쪽 모두 동기화.

### 의도적 연기(deferred)

- 라우트 경로 실제 이동 (`/my/library` → `/my/workshop`, `/my/shortlists` → `/my/boards`): 리디렉트·SEO·외부 공유 링크 영향 검토 후 별도 패치.
- `StudioNextActions` 비주얼 재설계: 이번 패치 범위 밖. 기존 구조 유지.
- 아트워크/전시 상세 페이지 Save 버튼 시각 재설계: 라벨만 `보드에 담기`로 통일(기능/스타일 변경 없음).

### 영향 범위 (touched files)

- `src/app/my/page.tsx`, `src/app/my/library/page.tsx`, `src/app/my/shortlists/page.tsx`, `src/app/my/shortlists/[id]/page.tsx`, `src/app/my/exhibitions/new/page.tsx`
- `src/components/studio/StudioHero.tsx`, `StudioQuickActions.tsx`, `StudioSectionNav.tsx`
- `src/components/SaveToShortlistModal.tsx`
- `src/lib/supabase/shortlists.ts` (타입/쿼리 확장 + 신규 함수)
- `src/lib/i18n/messages.ts` (KO/EN)
- `src/app/artwork/[id]/page.tsx`, `src/app/e/[id]/page.tsx` (Save 버튼 라벨만)

### 검증

- `npx tsc --noEmit` — clean.
- `npm run lint`로 변경 파일만 스코핑 — 신규 error 0, 기존 warning 1(이미지 태그, 기존 패턴).

---

## 2026-04-20 — 이메일 링크 redirect URL NEXT_PUBLIC_APP_URL 고정 + vercel.com 이동 원인 정리

### 코드 수정
- `src/lib/supabase/auth.ts`: `getAuthOrigin()` 헬퍼 추가. `signUpWithPassword`, `sendMagicLink`, `sendPasswordReset` 세 곳 모두 `window.location.origin` 대신 `NEXT_PUBLIC_APP_URL` 우선 사용. Vercel Preview URL(`henry-kims-projects-*.vercel.app`)이 이메일 링크에 박히는 문제 해결.

### Supabase 대시보드 필수 설정 (코드만으로는 안 됨)

이메일 링크가 `vercel.com`으로 가는 현상의 원인:
- Supabase는 `emailRedirectTo`로 넘긴 URL이 **Redirect URLs 허용 목록에 없으면 무시**하고 **Site URL로 폴백**함
- Vercel ↔ Supabase 자동 통합 시 Site URL이 `vercel.com` 계열로 잘못 설정되는 경우 발생

**Supabase Dashboard → Authentication → URL Configuration에서 반드시 확인:**

| 항목 | 올바른 값 |
|------|-----------|
| Site URL | `https://abstract-mvp-dxfn.vercel.app` |
| Redirect URLs | `https://abstract-mvp-dxfn.vercel.app/auth/callback` 포함 |

Redirect URLs에 없으면 `emailRedirectTo`가 무시되고 Site URL로 떨어짐 → vercel.com 이동 현상.

---

## 2026-04-20 — 온보딩 라우팅 3개 버그 수정

- **루트(`/`) 비로그인 라우팅**: 기존 `/onboarding`(가입) 대신 `/login`으로 변경. 돌아오는 기존 사용자가 가입 폼이 아닌 로그인 폼을 보게 됨. (신규 유저는 로그인 하단 "바로 시작하기" 링크로 진입)
- **AuthGate RPC 폴백**: `getMyAuthState()` RPC 일시 실패 시 기존엔 그냥 통과(→ 피드). 이제 `getMyProfile()` + 클라이언트 `isPlaceholderUsername` 으로 2차 체크, 난수 유저네임이면 `/onboarding/identity` 강제 리디렉트.
- **RandomIdBanner**: dismiss 버튼 제거, amber 배경 + 굵은 텍스트로 눈에 잘 띄는 디자인으로 변경. `role="alert"` 적용.
- Supabase SQL: `20260421120000_identity_completeness.sql` 적용 필요 (이전 패치에서 동일).

---

## 2026-04-20 — 가입 확인 이메일 링크 → /onboarding/identity 정상 라우팅

- **문제**: `signUpWithPassword`에 `emailRedirectTo`가 없어 Supabase가 대시보드 Site URL(루트 `/`)로 인증 링크를 보냄. 그 결과 이메일 링크를 누르면 `/auth/callback`을 거치지 않고 바로 피드로 떨어져, `routeByAuthState` → `/onboarding/identity` 흐름이 완전히 우회됨.
- **수정**: `src/lib/supabase/auth.ts` — `signUpWithPassword`에 `emailRedirectTo: ${origin}/auth/callback` 추가. 이제 확인 링크 클릭 → `/auth/callback` → `routeByAuthState` → `needs_identity_setup`이면 `/onboarding/identity`로 정상 이동.
- Supabase SQL 돌려야 할 것: 없음.

---

## 2026-04-20 — Login EN subtitle, completeness SSOT, upload claim copy

- **`/login` (EN)**: 서브타이틀에서 `[text-wrap:balance]`·`max-w-[32ch]` 제거, 헤더 전체 너비 사용. 두 문장은 각각 블록이지만 영어 2번째 줄이 "Enter your email and" 에서 끊기지 않고 한 줄로 읽히도록 함. KO 는 기존 좁은 measure + balance 유지.
- **프로필 완성도 불일치 (/my 67% vs 설정 92/100)**:
  - **원인 1**: Studio(`/my`) 가 `profile_completeness` DB 컬럼을 무시하고 클라이언트 재계산만 표시. 설정은 저장 시 기록된 DB 값을 우선 표시.
  - **원인 2**: `getProfileSurface` 가 설정과 달리 `profile_details.collector_price_band` / `collector_acquisition_channels` 를 읽지 않아 콜렉터 모듈 점수가 재계산에서 낮게 나옴.
  - **조치**: `resolveDisplayedProfileCompleteness()` 로 **DB 값 우선, 없으면 재계산**을 `/my`·설정 카드에 통일. `surface.ts` 에서 collector_* 레거시 키를 `price_band` / `acquisition_channels` 와 동일 우선순위로 정규화.
- **업로드 클레임 버튼 카피**: KO/EN 모두 "~만 사용/only" 톤 제거 → `내 작품 (아티스트)`, `소장 작품 (콜렉터)` 등 페르소나 꼬리표만 부드럽게 표기.

---

## 2026-04-19 — Onboarding Sign-off Hardening Patch (v2)

브랜치: 현재 작업 브랜치.

### 0. 한 줄 요약
> "온보딩 front door 베타 sign-off 전 마지막 hardening 패스. 역할/대표역할 desync 차단, 실제 routing 동작을 검증하는 runtime 스모크, 로그인 서브타이틀 polish, dev 환경 SQL 누락 감지."

### 1. Track 1 — primary-role / roles 동기화 불변식
**문제**: 기존 identity-finish 에서 `main_role` 을 지정한 뒤 같은 역할 chip 을 해제하면 `main_role ∉ roles` 상태가 생겨, 서버에 저장될 경우 탐색/검색 일관성이 깨졌음.

**해결**:
- `src/app/onboarding/identity/page.tsx`: `toggleRole()` 이 현재 `main_role` chip 의 제거를 차단. 대신 인라인 힌트(`identity.finish.primaryLockHint`) 를 표시하여 "위 메뉴에서 다른 대표 역할을 먼저 고르라" 고 안내. 제거를 허용하려면 `<select>` 에서 primary 를 다른 값으로 바꾼 뒤 해제하면 됨.
- `handleSubmit()` 제출 전 최종 방어선: `roles.includes(mainRole)` 이 false 면 저장 차단 + `identity.finish.primaryDesync` 오류 노출.
- primary chip 에 `title` 속성으로 설명 노출.

**불변식**: 저장 payload 에서 `main_role ∉ roles` 는 불가능.

### 2. Track 2 — Runtime routing 스모크 신설
기존 `tests/onboarding-smoke.mjs` 는 grep 수준 static check. Beta sign-off 에는 부족.

**추가**: `tests/onboarding-routing-runtime.mjs` — Node 24 의 `--experimental-strip-types` 로 `src/lib/identity/routing.ts` 를 직접 import 해 실제 `routeByAuthState()` 를 구동.

**시나리오 (9종)**:
1. 비밀번호 회원가입 직후 (`needs_identity_setup`) → `/onboarding/identity?next=...`
2. 매직링크 1-hop placeholder (세션 + placeholder username) → identity-finish
3. 완료 유저 → `next` 또는 `/feed`
4a. 초대 회원가입 + `next=/invites/delegation?token=abc` → identity-finish 이 `next` 보존
4b. identity 완료 후 동일 state → 원래 초대 페이지로 복귀
5. 세션 없음 → `/login` (+ `next`)
6. 세션은 있으나 RPC state=null (과거 로그인 루프 버그) → default destination, never `/login`
7. 비밀번호 미설정 계정 → `/set-password`
8. `needs_onboarding` 만 true → `/onboarding`
9. `safeNextPath` 가 `//evil.com`, `https://evil.com` 거부

**실행**: `npm run test:onboarding-runtime` (package.json 에 스크립트 추가).

### 3. Track 3 — Dev-only SQL 누락 감지
**문제**: `supabase/migrations/20260421120000_identity_completeness.sql` 이 staging/dev 에 미적용이면 `get_my_auth_state()` 가 새 컬럼 없는 구버전 스키마를 반환 → 프런트엔드는 legacy fallback 으로 내려가 "겉보기엔 멀쩡하지만 실은 gate 가 동작하지 않는" 상태가 생김.

**해결**: `src/lib/supabase/auth.ts` 의 `getMyAuthState()` 가 응답에서 `needs_identity_setup` / `is_placeholder_username` 이 누락된 것을 감지하면 `NODE_ENV !== "production"` 에서만 한 번 `console.warn` 을 띄워 어떤 마이그레이션이 필요한지 명시. Production 에서는 완전 무음.

### 4. Track 5 — 로그인 서브타이틀 polish
**문제**: `/login` 서브타이틀 "Welcome back. Enter your email and password to continue." / "돌아오신 것을 환영해요. 이메일과 비밀번호로 이어서 사용하세요." 가 좁은 viewport 에서 어색하게 2 줄로 깨져 온보딩 다른 surface 대비 품질감이 떨어짐.

**해결**:
- i18n: `login.welcomeBack` 제거 → `login.welcomeBackTitle` ("Welcome back." / "돌아오신 것을 환영해요.") + `login.welcomeBackHint` ("Enter your email and password to continue." / "이메일과 비밀번호로 이어서 사용하세요.") 로 분할.
- `src/app/login/page.tsx`: 두 문장을 각각 `<span className="block">` 으로 렌더, `max-w-[32ch]` + `[text-wrap:balance]` + `leading-relaxed` 로 의도적 2-line 블록 구성. EN/KO 둘 다 균형 있게 읽힘.

### 5. Track 4 — 경로 정리 재확인
placeholder / signed-in 유저가 다음 surface 를 통과할 때 루프 없음 재확인 (Runtime 스모크가 이를 런타임으로도 검증):
- `/` → signup-first
- `/login` → 기존 유저 전용, 완료 후 `routeByAuthState(..., { sessionPresent: true })`
- `/auth/callback` → `sessionPresent: true`
- `/onboarding` → signed-in 은 즉시 `routeByAuthState`
- `/onboarding/identity` → 완료된 state 는 gate 를 통해 우회
- `AuthGate` → RPC state=null 이면 현재 페이지 유지 (루프 방지)
- Header "My Profile" → placeholder 유저는 `/onboarding/identity`
- `/invites/delegation` → 가입 링크에 `next` 보존

### 6. i18n 세부 변경
EN+KO 양쪽:
- 제거: `login.welcomeBack`.
- 추가: `login.welcomeBackTitle`, `login.welcomeBackHint`, `identity.finish.primaryLockHint`, `identity.finish.primaryDesync`.

### 7. "벌크" → "일괄" 한국어 통일 (사용자 요청)
업로드 화면과 하부 버튼 메뉴의 "벌크" 한글 표기를 "일괄" 로 교체. 영어 문자열 (`bulk.*` 키 값 중 "Bulk") 은 손대지 않음.
- `src/lib/i18n/messages.ts`: `exhibition.uploadBulkWorks`, `exhibition.dropImagesHere` (KO), `upload.tabBulk` (KO) 에서 "벌크" → "일괄".
- `src/app/my/exhibitions/[id]/page.tsx`: 버킷 업로드 버튼 2곳 `"(벌크)"` → `"(일괄)"`.
- `src/app/my/exhibitions/[id]/add/page.tsx`: 코드 주석 한 줄 동반 교체.

### 8. Acceptance 재확인
- [x] `main_role` / `roles` 절대 desync 되지 않음 (UI + submit 가드 이중 보호).
- [x] Runtime onboarding smokes 9종 모두 pass.
- [x] Dev 환경에서 SQL 누락 즉시 감지 가능.
- [x] Placeholder 유저 경로 루프 없음.
- [x] Invite round-trip 유지.
- [x] 로그인 서브타이틀 KO/EN 의도된 2-line 블록.
- [x] `npx tsc --noEmit` 통과, 패치 대상 파일 lint-clean (기존 이슈는 범위 외).

### 9. 실행 명령
```bash
npm run test:ai-safety
npm run test:onboarding-smoke
npm run test:onboarding-runtime
npx tsc --noEmit
```

---

## 2026-04-19 — Onboarding Front Door Finalization Patch

브랜치: 현재 작업 브랜치.

### 0. 한 줄 요약
> "비회원은 한 가지 길만 본다: `/` → `/onboarding` → `/onboarding/identity`. `/login` 은 기존 회원 전용, 매직링크는 접어둔 보조 옵션으로만 존재한다."

### 1. Front-door IA 확정
- **`/` (root)**
  - 세션 없음 → `/onboarding` (이전에는 `/login` 으로 튕겼음). 차가운 트래픽이 처음 보는 것은 **signup-first** 화면.
  - 세션 있음 → 기존대로 `routeByAuthState(..., { sessionPresent: true })`.
- **`/onboarding`**
  - 여전히 이메일 + 비밀번호 + 확인 3필드. CTA 를 "바로 시작하기" / "Get started" 톤으로 조정.
  - H1: "Abstract 바로 시작하기" / "Get started with Abstract". 기능 문구는 차분하게 유지 (브랜딩 패스 아님).
  - 푸터 "이미 계정이 있으신가요? 로그인" 링크는 그대로 — returning user 를 `/login` 으로 안내.
- **`/login` (완전 재작성)**
  - Login-first 로 축소. 상단에 차분한 "돌아오신 것을 환영해요" 헤더, 이메일/비밀번호 1 form.
  - **비밀번호 없이 로그인** 은 disclosure 버튼 뒤로 접힘 (기본 상태: 닫힘). 펼치면 회색 박스 안에 작은 이메일 입력 + "로그인 링크 보내기" 버튼. 메인 폼과 시각적 무게가 경쟁하지 않음.
  - "매직링크" / "magic link" 용어는 사용자 표시 문자열에서 전부 제거 (Track F). 대체 용어: "비밀번호 없이 로그인", "이메일로 일회용 로그인 링크", "로그인 링크 보내기".
  - 하단에 크게 노출되는 "Abstract가 처음이신가요? **바로 시작하기**" 링크 → `/onboarding`. next 파라미터는 보존.

### 2. 매직링크 정책
- **허용**: `/login` 내부의 disclosure 뒤 보조 옵션 / invite / auth callback / 내부 도구.
- **금지**: 공개 첫 화면에 password 로그인과 같은 무게로 노출되는 폼; "매직링크" 용어; 신규 유저가 비밀번호 설정을 건너뛰게 만드는 기본 경로.

### 3. i18n 변경
EN+KO:
- 제거: `login.useEmailLink`, `login.magicLinkPlaceholder`, `login.sendMagicLink`, `login.checkEmail`.
- 추가: `login.welcomeBack`, `login.startSignup`, `login.passwordlessOpen`, `login.passwordlessClose`, `login.passwordlessHint`, `login.passwordlessSend`, `login.passwordlessSent`, `login.passwordlessRateLimit`, `login.noAccount` (문구 조정: "New to Abstract?" / "Abstract가 처음이신가요?").
- 조정: `onboarding.createAccount` → "Abstract 바로 시작하기" / "Get started with Abstract", `onboarding.createAccountButton` → "바로 시작하기" / "Get started", `onboarding.creatingAccount` → "계정을 만드는 중..." / "Getting started...".
- KO messages.ts 전수 스캔으로 "매직" 문자열이 사용자 표시 값에서 0건임을 스모크가 강제.

### 4. Runtime smoke 확장 (`tests/onboarding-smoke.mjs`)
이미 있는 invariant 1~5 유지. 신규 invariant 6 추가:

- **6a**: `src/app/page.tsx` 의 no-session 분기는 `ONBOARDING_PATH` 로만 리다이렉트한다. `LOGIN_PATH` 로 바꾸면 실패.
- **6b**: `/login` 은 `login.magicLinkPlaceholder` / `login.sendMagicLink` 키를 호출하면 안 되고, passwordless form 은 반드시 `passwordlessOpen` state 뒤에 gated 되어 있어야 하며, `/onboarding` 링크를 노출해야 함.
- **6c**: `src/lib/i18n/messages.ts` 의 사용자 표시 값 어디에도 "매직" 또는 "magic link" 가 없어야 함.

실행: `npm run test:onboarding-smoke`.

### 5. 검증
- `npx tsc --noEmit` pass.
- `npx eslint src/app/page.tsx src/app/login src/app/onboarding tests/onboarding-smoke.mjs src/lib/i18n/messages.ts` clean.
- `node tests/ai-safety.mjs` pass.
- `node tests/onboarding-smoke.mjs` pass (invariants 1~6 포함).

### 6. 수동 QA 매트릭스
1. 로그아웃 상태에서 루트 `/` 접속: `/onboarding` 으로 리다이렉트. 로그인 화면을 먼저 마주치지 않음.
2. `/onboarding` CTA 클릭 → 가입 성공 → `/onboarding/identity` 로 연결.
3. `/login` 직접 접속: 이메일/비밀번호 폼이 지배적이고, "비밀번호 없이 로그인" 은 접혀 있음. 펼쳐도 시각 무게는 보조.
4. `/login` 에서 "바로 시작하기" 링크 클릭 → `/onboarding` (next 보존 포함).
5. `/login?next=/artwork/xxx`: 로그인 성공 후 `/artwork/xxx` 로 복귀, passwordless 열어도 next 보존.
6. 초대 링크(`/invites/delegation?token=abc`)에서 "Sign up" → `/onboarding?next=/invites/delegation?token=abc` → 가입 후 identity 완료하면 초대 페이지로 복귀.
7. Placeholder 계정으로 로그인: Header "My Profile" 이 여전히 `/onboarding/identity` 로 보내는지.
8. 전체 소스와 i18n 값에서 "매직" 문자열 grep: 0건.

---

## 2026-04-19 — Onboarding Smoothness Follow-up Patch

브랜치: 현재 작업 브랜치.

### 0. 한 줄 요약

> "가입은 이메일·비밀번호만으로 가볍게. 모든 공개 identity 는 `/onboarding/identity` 한 곳에서. 모든 signup flavor(password / magic-link / invite)는 동일한 identity gate 로 수렴."

### 1. Front door 리셰이프
- `/onboarding`: 신규 유저 가입 전용 surface 로 축소. 수집 항목은 `email` + `password` + `password confirmation` 뿐. 역할/사용자명/표시 이름/공개 범위는 모두 제거.
  - `signUpWithPassword(email, password)` 를 metadata 없이 호출 → 백엔드 trigger 가 minimal profile row 를 만들 때 placeholder 로 들어와도 gate 가 `/onboarding/identity` 로 회수한다.
  - 세션이 있는 방문자는 `routeByAuthState(..., { sessionPresent: true })` 로 즉시 재라우팅 되어 이 페이지가 보이지 않음.
- `/onboarding/identity`: 2단계 identity-finish surface 로 톤다운 개선.
  - "Step 2 of 2" eyebrow + 섹션 3개 (`You` / `Role` / `Visibility`) 분리. 첫 역할 선택 시 primary 가 자동 지정되어 "역할을 골랐는데 primary 가 비어있음" 혼란 제거.
  - sticky primary CTA ("Continue to Abstract") + 차분한 one-time setup 카피.
  - 여전히 live username availability, 추천, preview, destination restore, public/private, role 선택 유지.
- `src/lib/i18n/messages.ts`: 폐기된 signup-시절 키 (labelUsername/labelRoles/privacyTitle/…) 모두 제거, 새 키 (`onboarding.stepEyebrow`, `onboarding.passwordHint`, `onboarding.nextStepHint`, `identity.finish.stepEyebrow`, `identity.finish.section*`, `identity.finish.displayNameHint`, `identity.finish.rolesHint`) 추가.

### 2. 하나의 identity gate
- 모든 entry (`/`, `/login`, `/auth/callback`, `/onboarding`, `/onboarding/identity`) 에서 `routeByAuthState(...)` 호출 시 세션이 이미 확인된 경우 **반드시** `sessionPresent: true` 를 넘긴다. 이 규칙을 `tests/onboarding-smoke.mjs` 의 invariant 3 이 강제한다.
- AuthGate: 세션이 있는데 `get_my_auth_state()` 가 null 을 반환한 경우 `/login` 으로 튕기지 않고 페이지를 그대로 렌더(이미 Identity Overhaul 에서 적용, 재확인).
- Header "My Profile": placeholder username 이거나 profile 이 없으면 `/onboarding/identity` 로 (Identity Overhaul 유지).
- `/invites/delegation` 의 "Sign up" 링크는 `next` 를 항상 보존해서 초대 가입도 identity-finish 를 거쳐 초대 페이지로 다시 돌아온다.

### 3. Runtime smoke (`tests/onboarding-smoke.mjs`)
정적 grep 수준의 회귀 테스트지만 "대문이 다시 무거워지거나 session-present 가 빠진 commit" 을 즉시 차단한다.

1. `/onboarding` 에 `setUsername` / `setDisplayName` / `setMainRole` / `checkUsernameAvailability` / `saveProfileUnified` / 구 i18n 라벨이 다시 들어오면 실패.
2. `checkUsernameAvailability` / `check_username_availability` 는 identity-finish page + `UsernameField` + RPC wrapper + suggestion 로직에서만 허용. 그 외 파일에서 호출하면 실패.
3. 주요 entry 5개 파일 모두 `routeByAuthState(...)` 를 호출해야 하고, 그 호출 인자에 `sessionPresent: true` 가 있어야 함.
4. Header 는 `isPlaceholderUsername(...)` 을 여전히 호출하며 `/onboarding/identity` 로 링크해야 함.
5. `/invites/delegation` 는 `/onboarding?next=` 형태로 링크해야 함.

실행: `npm run test:onboarding-smoke`.

### 4. 검증
- `npx tsc --noEmit` pass.
- `npx eslint src/app/onboarding src/components/ds src/components/onboarding src/lib/identity` clean.
- `node tests/ai-safety.mjs` pass.
- `node tests/onboarding-smoke.mjs` pass.

### 5. 수동 QA 매트릭스
1. 비회원 → `/onboarding`: 이메일/비밀번호 3개 필드만 보이는지.
2. 비회원 → `/onboarding?next=/invites/delegation?token=abc`: 가입 성공 후 `/onboarding/identity?next=...` 로 넘어가고, identity 완성 뒤 delegation 페이지로 복귀하는지.
3. 매직링크 로그인 → placeholder 상태로 복귀: `/auth/callback` 이 `/onboarding/identity` 로 보내는지.
4. 정상 계정 로그인: `/onboarding/identity` 를 건너뛰고 destination 으로 바로 이동하는지.
5. Placeholder 계정으로 Header "My Profile" 클릭: `/onboarding/identity` 로 이동하는지.
6. Identity 완성 후 section 3개가 모두 정렬되어 보이고, 역할 첫 선택이 자동으로 primary 가 되는지.

---

## 2026-04-19 — Onboarding Identity Overhaul Patch

브랜치: 현재 작업 브랜치.

### 0. 한 줄 요약

> "로그인 ≠ 신원 완성. 플레이스홀더 유저는 절대 공개 surface 에 정상처럼 보이면 안 된다. Identity 완성 여부는 `get_my_auth_state()` 한 곳에서 결정되고, 모든 entry 가 동일한 `routeByAuthState` gate 로 수렴된다."

### 1. Identity SSOT (DB)

- `supabase/migrations/20260421120000_identity_completeness.sql`
  - `public.is_placeholder_username(text)` — `^user_[a-f0-9]{6,16}$` 정규식을 DB 공용 헬퍼로 고정.
  - `public.get_my_auth_state()` 확장(additive): `display_name`, `is_placeholder_username`, `needs_identity_setup` 추가. `needs_identity_setup` 은 (a) 프로필 미존재, (b) username 이 placeholder, (c) display_name 빈값, (d) roles 누락, (e) main_role 누락 중 하나라도 해당되면 true.
  - `public.check_username_availability(text)` 신규 RPC — reason: `ok` / `invalid` / `reserved` / `placeholder` / `taken` / `self`.
  - `public.ops_onboarding_summary()` — placeholder 판정을 새 헬퍼로 교체.
  - `public.v_identity_rescue_stats` (security_invoker) — 오퍼레이터용 placeholder/rescue 카운트.

### 2. Routing Gate 수렴

- `src/lib/identity/routing.ts` — `routeByAuthState(state, { nextPath })` 가 **유일한** 경로 결정 함수. 우선순위: `needs_identity_setup` → `/onboarding/identity` → `needs_onboarding` → `/onboarding` → `!has_password` → `/set-password` → `next`.
- `src/app/page.tsx`, `src/app/login/page.tsx`, `src/app/auth/callback/page.tsx`, `src/components/AuthGate.tsx`, `src/app/onboarding/page.tsx` 전부 이 헬퍼로 통일. AuthGate 는 gap 이 실제로 있을 때만 `router.replace` (루프 방지).
- `src/components/ProfileBootstrap.tsx` — `/onboarding`, `/onboarding/identity`, `/username-fix`, `/set-password`, `/auth/*` 에서는 `ensure_my_profile` 호출 skip (placeholder 재생산 차단).

### 3. Identity-finish 전용 페이지

- `src/app/onboarding/identity/page.tsx` — 단일 surface. display_name → UsernameField → main_role → roles → public/private → 저장. 저장 후 `routeByAuthState` 로 복귀.
- `src/components/onboarding/UsernameField.tsx` — debounce 300ms `check_username_availability` RPC, 제안 chip tap-to-fill.
- `src/components/onboarding/IdentityPreview.tsx` — 실시간 미니 프로필 헤더. placeholder 인 동안엔 `@handle` 대신 중립 라벨.
- `src/lib/identity/suggestions.ts` — display_name/email 에서 후보 생성 → RPC 로 availability 확인.
- `src/app/username-fix/page.tsx` — legacy shim. `sessionStorage` 잔재 정리 후 `/onboarding/identity?next=...` 로 replace.
- `src/app/onboarding/page.tsx` — 로그인된 placeholder 유저가 들어오면 즉시 `routeByAuthState` 로 위임(이전의 "profile 모드"는 제거).

### 4. Public surface 억제

- `src/lib/identity/placeholder.ts` — 클라이언트 canonical regex. `src/lib/profile/randomUsername.ts` 는 deprecated alias.
- `src/lib/identity/format.ts`
  - `formatUsername(profile)` → placeholder 면 `null`.
  - `formatDisplayName(profile, t?)` → display_name 없고 placeholder 면 `identity.incompletePlaceholder`.
  - `formatIdentityPair(profile, t?)` → 같은 기준, primary 는 중립 라벨, secondary 는 빈값.
  - `hasPublicLinkableUsername(profile)` → placeholder 가 아닐 때만 true. 공개 링크 보호용.
- 소비자 업데이트: `FeedArtworkCard`, `ArtworkCard`, `FeedDiscoveryBlock`, `PeopleClient` (placeholder 자체를 리스트에서 제외), `UserProfileContent`, `my/inquiries`.
- `src/components/RandomIdBanner.tsx` — CTA 를 `/onboarding/identity` 로 변경, i18n 키(`banner.identityFinish.*`) 사용.
- `src/components/Header.tsx` — `myHref` 가 placeholder 이면 `/onboarding/identity`, 아바타 fallback 글자도 `user_...` 대신 `?` 로 마스킹.

### 5. Invite / login smoothing

- `src/app/invites/delegation/page.tsx` — 미로그인 상태 signup 버튼이 `/onboarding?next=/invites/delegation?token=...` 으로 `next` 보존.
- `src/app/api/delegation-invite-email/route.ts` — base URL 검증 강화: vercel.com 거부에 더해 non-https 거부(localhost 예외), 경로 정규화.
- `src/app/login/page.tsx` — password 로그인 경로도 `routeByAuthState` 로 수렴(placeholder 유저는 자동으로 identity-finish 로 라우팅).

### 6. Ops

- `src/app/my/ops/page.tsx` — 라벨 "Random ID" → "Placeholder ID", legacy "Username fix" 버튼은 `/onboarding/identity` 복사로 교체. 상단에 `v_identity_rescue_stats` 4-칸 요약 섹션(Still placeholder / New placeholder 7d·30d / Rescued 7d / Rescued 30d).

### 7. i18n

- `src/lib/i18n/messages.ts` 확장: `identity.finish.*`, `identity.username.live.*`, `identity.username.suggestions.*`, `identity.preview.*`, `identity.incompletePlaceholder`, `banner.identityFinish.*` (en/ko).

### 8. 검증

- `npx tsc --noEmit` pass.
- `npm run lint` pass.
- QA 매트릭스: (a) 신규 이메일+비밀번호 가입 (b) magic-link 가입 (c) 기존 비밀번호 유저 (d) 위임 초대 수락 (e) placeholder 유저가 `/feed` 접근 → gate 가 `/onboarding/identity` 로 라우팅 (f) identity-complete 유저 → 기존 경로 유지 (g) 직접 `/username-fix` 진입 → 새 surface 로 redirect.

---

## 2026-04-19 — AI Wave 2 Actionful Studio Patch

브랜치: 현재 작업 브랜치.

### 0. 한 줄 요약

> "Wave 2는 AI preview 레이어를 '정말 쓰이는' Studio/워크플로우 레이어로 전환한다. 스키마 확장은 관측용 뷰(`v_ai_events_summary`)뿐이며, 신뢰 경계는 Wave 1을 유지한다."

### 1. Track 0 — Cleanup

- **0.A Confirm primitive**: `src/components/ds/ConfirmActionDialog.tsx` 신설 (focus trap, Esc/backdrop cancel, body scroll lock). `AiDraftPanel` replace, 작품 삭제, shortlist 파괴적 액션(토큰 회전·제거·컬래버레이터)을 전부 DS 모달로 이식. `window.confirm` 잔존 0건 (AI 경로).
- **0.B Acceptance SSOT**: `src/lib/ai/accept.ts` 의 `markAiAccepted(aiEventId, {feature, via})` 를 모든 소비자 경로가 사용. Inquiry는 **send-after-edit** 규칙 — apply/copy 시점이 아니라 `/api/messages/reply` 성공 직후에만 accepted 플립.
- **0.C Path drift**: `/api/ai/accept` 주석과 `src/lib/ai/browser.ts` 주석이 canonical helper 를 `src/lib/ai/accept.ts` 로 지칭.
- **0.D 4카드 표준화**: `src/components/studio/intelligence/aiCardState.ts` (`aiErrorKey`) 로 degradation → i18n 매핑 통일. Profile/Portfolio/Digest/Matchmaker 모두 idle/loading/degraded/empty/dismiss 상태를 같은 골격으로 렌더.

### 2. Track A–G — 기능 확장

| Track | 핵심 변경 |
|---|---|
| A. Profile Copilot | `bioDrafts`/`headlineDrafts`/`discoverabilityRationale` 확장. 프롬프트 `PROFILE_COPILOT_SYSTEM` 에 username/role/public 변경 금지 footer. 클라이언트 후처리에서도 해당 패턴 필터. |
| B. Portfolio Copilot | 제안을 kind (`reorder`/`feature`/`highlight`/`gap`)로 그룹, `artworkIds` 딥링크 칩, `ordering` 섹션은 "Copy checklist"로 제공. 개별 "Mark reviewed" 상태. |
| C. Exhibition Post Producer Lite | non-title draft 에 `ai.exhibition.previewOnly` 힌트. 직접 DB 업데이트 없음. |
| D. Inquiry Concierge v2 | `lengthPreference` (`short`/`medium`/`long`) 토글 + `tonePrefs` 보존. 프롬프트에 가격·소유권 조작 금지 footer. |
| E. Matchmaker | `suggestedAction` (`follow_back`/`intro_note`/`share_exhibition`/`save_for_later`) 와 `suggestedArtworkIds` 렌더. `intro_note` 는 `IntroMessageAssist` 를 인라인으로 오픈. `me.artworks` 컨텍스트 전달. |
| F. Weekly Studio Digest | `recentUploads` 컨텍스트, sparse-signal 규칙 시스템 프롬프트. |
| G. Action 어휘 | `ai.action.useAsBio`, `ai.action.useAsReply` 등 task-oriented 라벨. `AiDraftPanel.applyLabelKey` prop. |

### 3. Track H — 관측/베타 컨트롤

- 마이그레이션 `supabase/migrations/20260420120000_v_ai_events_summary.sql`: `v_ai_events_summary` (security_invoker) — feature 별 total/accepted/degraded, 7d 카운트, avg/p95 latency.
- `/dev/ai-metrics` (개발 환경 + `NEXT_PUBLIC_AI_METRICS=1`) 개발자 게이티드 페이지.
- `src/lib/ai/route.ts` 비-프로덕션에서 `console.debug` 로 prompt/response 크기 + latency 출력.

### 4. 검증

- `npx tsc --noEmit` pass.
- `node tests/ai-safety.mjs` pass. 신규 invariant:
  - #4 `src/components/ai/**` 에서 `window.confirm` 금지.
  - #5 `PROFILE_COPILOT_SYSTEM` 의 username/role/public 변경 금지 안내 및 `INQUIRY_REPLY_SYSTEM` 의 가격·소유권 조작 금지 안내 필수.
- `npm run lint` — 본 패치 범위 경고 0건 (기존 잔존 경고는 무관).

### 5. 데이터/운영 노트

- Supabase: `20260420120000_v_ai_events_summary.sql` 적용 필요. RLS 는 기저 `ai_events` 의 owner-only 정책을 그대로 상속.
- 신규 테이블/인덱스 없음. `ai_events` 의 기존 스키마(Wave 1) 재사용.

---

## 2026-04-19 — AI Wave 1 Hardening Patch

브랜치: 현재 작업 브랜치.

### 0. 한 줄 요약

> "Wave 1 AI 레이어를 신뢰 경계·로케일·텔레메트리·SSOT·액션 어휘·라우트 하드닝 축에서 마감한다. 신규 기능 없음."

### 1. 스코프 (7 트랙)

| 트랙 | 내용 |
|---|---|
| A. Trust-boundary | `MatchmakerCard` 포함 모든 AI surface에서 마운트 자동 생성 제거. `Generate draft`를 명시적 CTA로 통일. `tests/ai-safety.mjs` (npm `test:ai-safety`)로 (1) AI 컴포넌트 `useEffect` 내 `trigger/fetch/callAi` 금지, (2) `/api/ai/*` 라우트가 메시지/알림/팔로우 같은 외부 부작용을 갖지 않음, (3) 코드베이스 어디에도 `locale: "ko"` 하드코드가 없음을 정적으로 보장. |
| B. Locale correctness | `src/lib/i18n/useT.ts`의 `locale`을 모든 AI 컴포넌트/`StudioIntelligenceSurface`에 전달. 모든 `/api/ai/*` 요청 body에 실제 UI 로케일을 실어 보냄. 하드코드 `"ko"` 전량 제거. |
| C. Acceptance telemetry | `logAiEvent`가 `ai_events.id`를 반환. 새 라우트 `POST /api/ai/accept`가 owner-RLS로 `accepted=true` 플립. 마이그레이션 `20260419150000_ai_events_accepted.sql`이 `ai_events_update_own` UPDATE 정책 추가. 클라이언트 `acceptAiEvent`를 모든 apply/copy/link 경로에 연결. |
| D. Profile SSOT | `/my`, `StudioIntelligenceSurface`, `/people`에서 `profile_details` 직접 머지 중단. 모두 `getProfileSurface(profile)` 결과의 `ProfileSurface` 타입만 소비. |
| E. Action vocabulary | `AiDraftPanel`에 `ApplyMode = "insert" \| "append" \| "replace" \| "link"` 정식 도입. `"auto"`는 `currentValue` 유무로 insert ↔ replace 결정. replace는 `window.confirm`. `onDismiss` 제공. `ai.action.*` i18n 키 추가. |
| F. Route hardening | 신규 `src/lib/ai/validation.ts`로 8개 라우트마다 `parse*Body` 화이트리스트 검증 + 컨텍스트 크기 가드 (`LIMITS`). 검증 실패 시 400 `{degraded:true, reason:"invalid_input"}`. `handleAiRoute`는 성공·no_key·에러 어디서든 `aiEventId`를 일관되게 반환. |
| G. Wave 2 readiness | `src/lib/ai/tonePrefs.ts`가 `localStorage` 기반으로 서페이스별 마지막 톤을 기억 (`ai.tone.bio`, `ai.tone.inquiry`). `AiDraftPanel`의 인서션 포인트(`currentValue` + `onApply(mode)`)를 안정화하여 Wave 2 액션 연결 지점 고정. |

### 2. 핵심 파일

```
src/lib/ai/
  ├─ types.ts          (AiDegradation에 aiEventId, "invalid_input" reason, AiLocale)
  ├─ events.ts         (logAiEvent → Promise<string|null>, markAiEventAccepted 추가)
  ├─ validation.ts     (신규, 라우트 body 스키마 + LIMITS)
  ├─ route.ts          (validateBody 훅, degradedResponse 통일, aiEventId 응답)
  ├─ browser.ts        (acceptAiEvent, getAccessToken, 400/503 처리)
  └─ tonePrefs.ts      (신규, localStorage 톤 기억)

src/app/api/ai/accept/route.ts   (신규)
supabase/migrations/20260419150000_ai_events_accepted.sql  (신규)

src/components/ai/
  ├─ AiDraftPanel.tsx         (ApplyMode, Replace confirm, onDismiss)
  ├─ BioDraftAssist.tsx       (useState lazy + tonePrefs + acceptAiEvent)
  ├─ InquiryReplyAssist.tsx   (동일 + currentReply prop)
  ├─ ExhibitionDraftAssist.tsx, IntroMessageAssist.tsx

src/components/studio/
  ├─ StudioIntelligenceSurface.tsx  (ProfileSurface prop, locale 플럼빙)
  └─ intelligence/{Profile,Portfolio,WeeklyDigest,Matchmaker}Card.tsx

src/app/my/page.tsx, src/app/people/PeopleClient.tsx (getProfileSurface 통일)

tests/ai-safety.mjs  (신규)
```

### 3. RLS / DB 변경

`ai_events_update_own` (owner UPDATE). 라우트는 `accepted` 외 컬럼을 쓰지 않는다 (API 레이어에서 보장, RLS는 소유권만 보장).

### 4. 검증

- `npx tsc --noEmit` — 통과.
- `npm run test:ai-safety` — AI safety: all invariants hold.
- `supabase db push` — 신규 마이그레이션 적용 완료.
- 수동 QA (EN/KO, 8개 라우트, Studio 초기 진입 자동 생성 없음, apply 시 `ai_events.accepted=true` 확인) 는 `docs/QA_MEGA_UPGRADE.md`의 Wave 1 체크리스트를 재사용.

### 5. 리스크 / 노트

- `acceptAiEvent`는 best-effort. 네트워크 실패 시 사용자 흐름을 막지 않음. 집계상 `accepted_events / total_events` 가 아주 약간 과소계수될 수 있음.
- `tonePrefs`는 오직 로컬. 계정 연동 아님.
- `validation.LIMITS` 값(예: 포트폴리오 24작품, 바이오 8,000자)은 토큰 비용 기준 초기 추정치. `ai_events.context_size` 분포를 본 뒤 조정.

---

## 2026-04-19 — AI-Native Studio Layer (Wave 1)

브랜치: 현재 작업 브랜치.

### 0. 한 줄 요약

> "`/my` Studio에 AI 초안 보조 레이어를 얹는다. 결과물은 모두 편집 가능한 미리보기이며, 신뢰 경계 자동 판정은 하지 않는다."

### 1. 스코프

| 트랙 | 내용 |
|---|---|
| 인프라 (Track 0) | `openai` 패키지 추가, `ai_events` 테이블 + RLS (`20260419120000_ai_events.sql`), 환경 변수 문서화 (`.env.example`에 `OPENAI_API_KEY`, `OPENAI_MODEL`, `AI_USER_DAILY_SOFT_CAP`). |
| AI 코어 (Track D) | `src/lib/ai/{client,safety,events,softCap,prompts,contexts,route,browser,types}` + 8개 route handler (`/api/ai/*`). Bearer JWT + RLS 기반 서버 슈파베이스 클라이언트. 8초 timeout, 1회 재시도, 파싱 실패 시 `degraded: true`. |
| Studio Intelligence (Track A) | `StudioIntelligenceSurface`가 4카드 (`ProfileCopilotCard`, `PortfolioCopilotCard`, `WeeklyDigestCard`, `MatchmakerCard`)를 렌더. `actingAsProfileId`일 때는 노출하지 않음. |
| Workflow assist (Track B) | `BioDraftAssist` (settings), `ExhibitionDraftAssist` (new / edit 전시), `InquiryReplyAssist` (`/my/inquiries`, `/artwork/[id]` 작가 블록). 전시 초안은 저장하지 않으며 제목만 채택 가능. 답장은 textarea에 삽입 후 사람이 전송. |
| Matchmaker Lite (Track C) | Studio Matchmaker 카드 + `/people` 카드의 `연결 메시지 초안` 버튼 (`IntroMessageAssist`). 자동 전송 없음. |
| UX 카피 (Track E) | `ai.*` i18n 네임스페이스 신규 (EN/KO). 사용자 surface에 "AI" 단어 미사용 (`ai.disclosure.tooltip`만 예외). |
| 관측/비용 (Track F) | `ai_events` insert (feature, context_size, latency_ms, model, error_code). `checkDailySoftCap` (기본 30 req/user/day, `AI_USER_DAILY_SOFT_CAP`으로 조정 가능). 클라이언트 채택 시 `logBetaEvent("ai_accepted", {...})`. |
| 문서 (Track G) | `docs/DESIGN.md` 섹션 1.4 (Trust boundary), 1.5 (Studio intelligence hierarchy), 1.6 (AI assist CTAs in workflows). `docs/QA_MEGA_UPGRADE.md`에 수동 QA 체크리스트. |

### 2. 명시적 연기 / 비범위

- 전시 description / wall text / invite blurb **DB 저장**은 이번 웨이브 범위 밖 (`projects` 테이블에 컬럼 없음). 현재는 복사 / 편집 전용.
- 포트폴리오 자동 재정렬 저장, press kit PDF 생성, 자동 outreach 발송, multi-agent UI는 모두 이번 웨이브 범위 밖.
- Claim 승인 / provenance 확정 / identity merge 자동화는 영구 금지 (safety.ts).

### 3. 환경 변수

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini         # 선택
AI_USER_DAILY_SOFT_CAP=30        # 선택
```

`OPENAI_API_KEY` 미설정 시 모든 AI route는 503 + `{degraded:true, reason:"no_key"}` 반환, UI는 조용히 fallback 문구만 표시.

### 4. 리스크

- Supabase 세션 쿠키가 아닌 `Authorization: Bearer <access_token>` 패턴이 새 약속. `src/lib/ai/browser.ts`의 `callAi` 한 곳에만 존재.
- OpenAI JSON 이탈 시 `stripCodeFence` + 마지막 `{...}` 파싱 fallback. 그래도 실패면 `degraded: true`.
- Soft cap 값(30)은 초기 추정치 — `ai_events` 로그 본 뒤 조정.

---

## 2026-04-18 — Abstract Next Mega Upgrade (Studio Slim-down + Design Spine + Reco Contract)

브랜치: 현재 작업 브랜치.

### 0. 한 줄 요약

> "`/my`를 진짜 Studio 셸로 얇게, 공용 UI 골격을 제자리에, 신원·추천 계약은 하나로."

### 1. 무엇이 달라졌나 (Before / After)

| 축 | Before | After |
|---|---|---|
| `/my` 페이지 | 1,000+ 라인, 헤더/CTA/KPI/포트폴리오 중복 블록 | 395 라인 오케스트레이터. 대형 블록은 `StudioQuickActions` / `StudioViewsInsights` / `StudioPortfolioPanel` / `StudioIntelligenceSurface`로 분리 |
| 디자인 골격 | 페이지마다 `rounded-lg border` 아드혹 카드·빈 상태 | `src/components/ds/*` 공유 프리미티브 (`SectionFrame`, `SectionTitle`, `EmptyState`, `Chip`)를 `/my`, `/people`, `/u`, `/e`, `/artwork`, `/notifications`, `/my/inquiries`에 적용 |
| 신원 표기 | 업로드/전시/편집 폼에서 `p.display_name \|\| p.username \|\| p.id` 아드혹 표현 | 전 플로우에서 `formatIdentityPair` / `formatDisplayName` / `formatUsername` 경유 |
| People 추천 | `getPeopleRecs` + `searchPeopleWithArtwork` 두 계약을 혼용 | `getPeopleRecommendations` 단일 계약 (+ `searchVariant: "merged" \| "name_only"`); `PeopleClient`, `FeedContent` 모두 이 계약만 호출 |
| AI 삽입점 | 구조 없음 | `StudioIntelligenceSurface` 빈 컨테이너만 배치 (가짜 AI 문구 금지, `aria-hidden` 장식 슬롯) |

### 2. 새/갱신된 표면

```
src/components/ds/
  ├─ SectionFrame.tsx   (rounded-2xl / tone / padding)
  ├─ SectionTitle.tsx   (eyebrow + heading + action)
  ├─ EmptyState.tsx     (title / desc / primary·secondary action)
  └─ Chip.tsx           (neutral/accent/warning/success/muted)

src/components/studio/
  ├─ StudioQuickActions.tsx     (Next Actions 보조 CTA 한 줄)
  ├─ StudioViewsInsights.tsx    (7일 profile views + 최근 viewer 3, settings 딥링크)
  ├─ StudioPortfolioPanel.tsx   (persona tabs, 재정렬, bulk delete)
  └─ StudioIntelligenceSurface.tsx (AI 삽입용 정적 컨테이너)

src/lib/supabase/recommendations.ts — getPeopleRecommendations + searchVariant
```

### 3. 정책 (SSOT 보강)

- `/my` 및 프로필 기반 모든 surface는 카드·빈 상태·칩을 `src/components/ds/*`에서 가져온다. 페이지 레벨에서 `rounded-lg border …` 카드 shell을 재선언하지 않는다.
- 사람 이름·핸들은 항상 `formatIdentityPair` / `formatDisplayName` / `formatUsername`를 통과한다. 검색 드롭다운·`Selected` 라벨·전시 칩도 예외가 아니다.
- People 추천·검색은 `getPeopleRecommendations` 하나만 호출한다. `getPeopleRecs` / `searchPeopleWithArtwork`는 내부 구현 디테일이며 UI 경로에서 직접 사용하지 않는다.
- AI 기능이 준비되기 전까지 `StudioIntelligenceSurface`는 문구 없는 구조적 슬롯으로만 존재한다. "곧 제공" 같은 약속 카피를 추가하지 않는다.

### 4. 리스크 / 의도적 연기

- `StudioPortfolioPanel` 안에 아직 legacy persona 탭/삭제 UX가 그대로 유지됨. 탭 레일과 카드 그리드를 더 얇게 만드는 작업은 후속 UI 패스에서 진행.
- `StudioIntelligenceSurface`는 구조만 제공하고 실제 AI 컨텐츠는 후속 AI 패치로 연기. 이 패치에서는 텍스트·가짜 데이터 금지 원칙을 유지.
- `/settings` 인사이트 패널은 기존 구현을 유지하며, `StudioViewsInsights`는 딥링크만 제공. 본격 인사이트 이동은 별도 과제.

## 2026-04-18 — Abstract Mega Upgrade (Identity + Trust + Profile-first UX + Proactive Portfolio)

브랜치: `feature/abstract-mega-upgrade-profile-first`

### 0. 한 줄 요약

> "기본을 견고하게, 프로필을 중심으로, 의사 결정을 1개씩."

### 1. Before / After

| 축 | Before | After |
|---|---|---|
| Auth 상태 | `localStorage.HAS_PASSWORD_KEY`에 의존 (비권위적) | `public.get_my_auth_state()` RPC를 호출부 7곳에서 사용 |
| Storage RLS | `artworks` bucket에 public delete 정책 존재 | `can_manage_artworks_storage_path()` 함수로 소유자/프로젝트 멤버만 관리 |
| Profiles RLS | `profiles_select_self USING(true)` 등 과도 허용 | `profiles_read_public_or_self` 1개로 축약, private 차단 |
| Shortlists/Projects RLS | self-join 오타로 권한 평가 불가 | `EXISTS (... sc.profile_id = auth.uid())`로 재작성 |
| 정체성 렌더 | ad-hoc `profile.display_name` | `src/lib/identity/format.ts` SSOT 경유 |
| Role 라벨 | 하드코딩 문자열 | `roleLabel(key, t)` + i18n 키 (artist/curator/collector/gallerist) |
| 추천 이유 | `follow_graph` 태그를 그대로 노출 | `reasonTagToI18n` 사용자 문장 |
| Recommendation API | RPC 2개 직접 호출 | `getPeopleRecommendations` 단일 contract |
| Provenance 라벨 | `CURATED`, `EXHIBITED` raw | `provenanceLabel()` + `label.*` i18n |
| 아트워크 상세 | 정보가 평면 나열 | 작품→작가(역할칩+팔로우)→provenance→전시→가격→related |
| /my | 921 라인 단일 페이지 | `StudioHero` + `StudioSignals` + `StudioNextActions` + `StudioSectionNav` 상단 + 기존 상세 유지 |
| Acting-as | 페이지마다 별도 UI | 글로벌 `ActingAsBanner` |
| 온보딩 | 검증 실패 메시지만 | `@handle` 실시간 availability, public/private 토글, role chip, 프리뷰 카드 |
| Debug 페이지 | dev 분기만 | middleware에서 production 접근 차단 |

### 2. 기능 지도 (새 표면)

```
/my
  └─ StudioHero         (src/components/studio/StudioHero.tsx)
  └─ StudioSignals      (7일 views/followers/inquiries/claims)
  └─ StudioNextActions  (src/lib/studio/priority.ts 가 우선순위 계산)
  └─ StudioSectionNav   (Portfolio / Exhibitions / Inbox / Network / Operations)
/onboarding             (live @handle check + privacy toggle + preview)
/my/claims              (trust workflow copy + pending badge)
/my/delegations         (stage chips: Invitation / Acting as / Closed)
<ActingAsBanner/>       (layout 최상단, 계정 위임 상태 상시 표시)

src/lib/identity/format.ts          — display_name/@handle/role pair SSOT
src/lib/identity/roles.ts           — RoleKey + roleLabel + hasAnyRole
src/lib/people/reason.ts            — 추천 이유 사람 언어화
src/lib/supabase/recommendations.ts — getPeopleRecommendations 단일 contract
src/lib/provenance/label.ts         — claim_type → user-facing label
src/lib/profile/surface.ts          — getProfileSurface: profile_details 격하
src/lib/studio/priority.ts          — Next Actions 우선순위 엔진
```

### 3. 정책 (SSOT)

- DB 인증 상태는 `get_my_auth_state()` 하나가 결정한다. 클라이언트는 판단하지 않는다.
- `storage.objects` 정책은 `artworks`에 대해서만 `can_manage_artworks_storage_path` 경유로 허용한다. 공개 delete는 절대 존재하지 않는다.
- UI에서 `profile.display_name` / `profile_details` 직접 참조 금지. 모든 접근은 `formatIdentityPair`, `formatRoleChips`, `getProfileSurface`를 통과한다.
- provenance/role/reason의 표시는 항상 i18n 키를 거친다.

### 4. 테스트

- `supabase/tests/p0_rls_matrix.sql` — storage/profiles/shortlists/projects/auth-state smoke matrix.
- `e2e/auth-gate.spec.ts` — anon 사용자가 `/my`, `/onboarding`, `/set-password`에서 올바르게 redirect 되는지 검증.
- 기존 `e2e/smoke.spec.ts` 회귀.

### 5. 리스크

- /my 페이지는 신규 Studio 블록과 기존 컴포넌트가 공존한다. 후속 PR에서 하단 상세 섹션을 `StudioSectionNav` 기준으로 /my/\* 로 이전해야 최종 단순화가 완료된다.
- `profile_details` 컬럼은 RLS 축약만 수행했고 삭제하지 않았다. 다음 패치에서 컬럼을 제거하기 전에 기록 작성 코드 경로를 점검해야 한다.

## 2026-03-30 — "Basics Are Solid" Patch

기능 추가 없이 기본기를 복원하는 올인원 패치. "이 플랫폼은 살아있고 기본이 탄탄하다"를 우선함.

### 변경 요약

- **Scope A — Feed 복원**: `loadMore` 시 중복 방지 (`deduplicateAndSort` 헬퍼), 양 탭(All/Following) 모두 IntersectionObserver 무한 스크롤, 끝 상태("You're all caught up") 표시, 불필요한 가드 제거.
- **Scope B — Artist attribution SSOT**: `getArtworkArtistLabel()` SSOT resolver. 전시 페이지 그룹핑을 복합 키(`artist_id || ext:label`)로 변경. 외부(미가입) 아티스트 이름이 빈 버킷으로 빠지지 않음.
- **Scope C — Size truth 경화**:
  - `parseSizeWithUnit()` 수정: inch/cm 접미사가 **명시적으로 존재**할 때만 해당 단위로 인식. `100 x 80` (접미사 없음) → `unit: null` (unitless).
  - `formatSizeForLocale()` 수정: `sizeUnit === null`일 때 원본 수치 보존, cm→in 변환 하지 않음.
  - `parseSize()` 수정: inch regex에서 explicit suffix 요구.
- **Scope D — Price truth 경화**:
  - `getArtworkPriceDisplay()` 공유 유틸 추가 (`artworks.ts`). 입력 통화를 우선 표시: `₩3,000,000 KRW (≈ $2,250 USD)`. USD 입력은 단순 표시.
  - i18n 키 추가: `artwork.priceUponRequest`, `artwork.priceHidden`, `artwork.priceApprox`.
  - `ArtworkCard`, `FeedArtworkCard`, `artwork/[id]` 3곳의 hardcoded `getPriceDisplay` → 공유 유틸로 교체.
- **Scope E — Import 정직성**:
  - SUPPORTED_COLUMNS 15개 → 7개로 축소 (title, year, medium, size, size_unit, ownership_status, pricing_mode). 실제 `updateArtwork`가 persist하는 필드만 표시.
  - description, price, currency, is_price_public, artist_name, artist_username, tags 제거 (persist 안 됨).
  - 템플릿, 요약, copy는 정직한 계약만 반영.
- **Scope F — 표면 간소화**: Save 모달 "Save" 제목, Alerts de-emphasis, Ops 내부전용, Room 헤더 간소화 (이전 패치).

### 수정 파일

| 파일 | 변경 |
|---|---|
| `src/lib/size/format.ts` | `parseSizeWithUnit` unitless 수정, `formatSizeForLocale` null unit 보존, `parseSize` inch regex 수정 |
| `src/lib/supabase/artworks.ts` | `getArtworkPriceDisplay()` 추가 |
| `src/lib/i18n/messages.ts` | price i18n 키 3개 추가 (en/ko) |
| `src/components/ArtworkCard.tsx` | hardcoded `getPriceDisplay` → `getArtworkPriceDisplay` |
| `src/components/FeedArtworkCard.tsx` | 동일 |
| `src/app/artwork/[id]/page.tsx` | 동일 |
| `src/app/my/library/import/page.tsx` | SUPPORTED_COLUMNS 축소, dead persist 코드 제거 |
| `src/components/FeedContent.tsx` | dedup, 끝 상태, IO 통일 |
| `src/app/e/[id]/page.tsx` | artist SSOT 적용 |
| `src/app/my/exhibitions/[id]/page.tsx` | artist SSOT 적용 |
| `src/components/SaveToShortlistModal.tsx` | copy 간소화 |
| `src/app/my/shortlists/[id]/page.tsx` | share controls 간소화 |
| `src/app/room/[token]/page.tsx` | 헤더 간소화 |
| `src/app/my/alerts/page.tsx` | digest de-emphasize |
| `src/app/my/ops/page.tsx` | "(internal)" 표시 |
| `src/app/my/page.tsx` | Ops 링크 제거 |
| `docs/HANDOFF.md` | 이 섹션 |
| `docs/QA_SMOKE.md` | 체크 업데이트 |

**Supabase SQL:** 돌려야 할 것 없음.

**환경 변수:** 변경 없음.

### Artist attribution SSOT (product truth)

`getArtworkArtistLabel(artwork)` — `src/lib/supabase/artworks.ts`

우선순위:
1. `claims → external_artists.display_name` (초대된 미가입 아티스트)
2. `profiles.display_name` (가입된 아티스트)
3. `@profiles.username`
4. fallback: `null` → UI에서 `t("artwork.artistFallback")` 표시

모든 작품 아티스트 이름 표시에 이 함수만 사용해야 함.

### Feed 동작 (product truth)

- **All / Following 모두**: IntersectionObserver (rootMargin 400px) 기반 무한 스크롤
- **Dedup**: merge 시 artwork ID / exhibition ID 기준 중복 제거
- **끝 상태**: cursor가 null → "You're all caught up" 텍스트 표시
- **Refresh**: 수동 refresh 버튼 + visibility/focus TTL refresh (90초)
- **No scroll fallback**: IntersectionObserver만 사용

### Size truth (product truth)

`parseSizeWithUnit(size)` — `src/lib/size/format.ts`

- `"20 x 30 in"` → unit: "in", widthCm: 50.8, heightCm: 76.2
- `"50 x 40 cm"` → unit: "cm", widthCm: 50, heightCm: 40
- `"30F"` → unit: "cm", 호수 기반 cm
- `"100 x 80"` → unit: null (unitless), widthCm: 100, heightCm: 80

`formatSizeForLocale(size, locale, sizeUnit)`:
- `sizeUnit === "in"`: EN에서 inch 그대로, KO에서 cm 변환
- `sizeUnit === "cm"`: KO에서 cm 그대로, EN에서 inch 변환
- `sizeUnit === null`: 원본 수치 보존, 단위 변환 없음

### Price truth (product truth)

`getArtworkPriceDisplay(artwork, t)` — `src/lib/supabase/artworks.ts`

- `pricing_mode === "inquire"` → i18n `artwork.priceUponRequest`
- `is_price_public === false` → i18n `artwork.priceHidden`
- 입력 통화 존재 시: `₩3,000,000 KRW (≈ $2,250 USD)` — 입력 통화 우선, FX 메타 있을 때만 USD 근사
- USD 입력: `$2,250 USD` 단순 표시
- 입력 통화 없으면 `$X USD` fallback

### Import contract (product truth)

**실제 persist 되는 필드만 지원:** title (필수), year, medium, size, size_unit, ownership_status, pricing_mode

**미지원 (일부러 제거):** description, visibility, price, currency, is_price_public, artist_name, artist_username, tags — `updateArtwork` payload에 없거나 DB 컬럼 불일치.

### Internal routes

| 경로 | 대상 | 접근 |
|---|---|---|
| `/my/ops` | 운영팀 | URL 직접 접근만 (대시보드에 미노출) |

### Acceptance checks

1. 메인 피드 하단에서 추가 콘텐츠 안정적 로딩
2. 중복 반복 카드 없음
3. `/e/[id]` 외부 아티스트 이름 정확
4. `artwork/[id]` 아티스트 어트리뷰션 정확
5. 사이즈 매트릭스 통과: `20x30in` → inch, `50x40cm` → cm, `100x80` → unitless, `30F` → 호수
6. KRW/USD 가격 표시 정확
7. Import 템플릿에 7개 필드만, 정직한 요약
8. Save 모달 간소화
9. Alerts 간소화
10. `/my/ops` 미노출
11. 빌드 통과

---

## 2026-03-30 — Beta Differentiation Wave 2.1 (integration)

Wave 2 표면을 실제 유저 워크플로우에 연결하는 통합 패치.

### 변경 요약

- **Scope A — Shortlist entry points**: `/artwork/[id]`에 "Save" 버튼 + `SaveToShortlistModal` 컴포넌트; `/e/[id]`에 "Save" 버튼 + 전시 shortlist 저장; 기존 shortlist 선택/생성/제거 가능; `shortlist_item_added`/`shortlist_item_removed` 분석 이벤트.
- **Scope B — Shortlist collaboration**: `/my/shortlists/[id]`에 collaborator 검색·추가·제거 UI; role 선택 (viewer/editor); share controls: copy link, rotate token (이전 링크 무효화), room active 토글; `shortlist_collaborator_added`/`room_copy_link` 이벤트.
- **Scope C — Room conversion**: `/room/[token]`에 "Ask about this work" CTA; `inquiry_clicked` 분석 로깅; `?fromRoom=` query로 artwork detail에 room breadcrumb; `room_viewed`/`room_opened_artwork`/`room_inquiry_clicked` 이벤트; private viewing room 레이블 + 만료 메시지.
- **Scope D — Alerts integration**: `notify_followers_new_work` trigger를 artist/medium interest 매칭으로 확장; follow 알림과 interest 알림의 payload `source` 구분; `digest_events` 테이블 + notification 기반 자동 큐 producer; `/my/alerts`에 digest preview; 알림 텍스트에서 follow vs interest 구분.
- **Scope E — Pipeline collaboration**: `inquiry_notes` RLS를 author-only → artwork artist + assignee 접근 가능하도록 변경; `auto_update_last_contact_date` 트리거 (message 삽입 시 + stage 변경 시); `/my/inquiries`에 "Assign to me" 버튼 + assigned 뱃지.
- **Scope F — Import v2**: 지원 컬럼 7→15개로 확장 (description, visibility, price, currency, is_price_public, artist_name, tags 등); title+year 기반 중복 검출 + skip duplicates 옵션; 개선된 매핑 UI (2-column grid) + 완료 요약.
- **Scope G — Ops panel v2**: 필터 추가 (with_delegations, recent_7d); 행별 "Profile link" 복사 + "Username fix" 링크 복사; CSV export; 5-KPI 대시보드.

### 신규 파일

| 파일 | 설명 |
|---|---|
| `supabase/migrations/p0_wave2_1_integration.sql` | Wave 2.1 스키마: share controls, notes RLS v2, last_contact triggers, interest notification, digest queue |
| `src/components/SaveToShortlistModal.tsx` | 범용 "Save to shortlist" 모달 |

### 수정 파일

| 파일 | 변경 |
|---|---|
| `src/lib/beta/logEvent.ts` | 7개 신규 이벤트 타입 추가 |
| `src/lib/supabase/shortlists.ts` | `rotateShareToken`, `toggleRoomActive`, `setRoomExpiry`, `searchProfilesForCollab`, `getShortlistIdsForArtwork`, `removeArtworkFromShortlist`; `room_active`/`expires_at` 타입 |
| `src/lib/supabase/alerts.ts` | `DigestEventRow` 타입, `listPendingDigestEvents` |
| `src/lib/supabase/notifications.ts` | `new_work` 타입 (Wave 2에서 추가됨, 유지) |
| `src/app/artwork/[id]/page.tsx` | Save 버튼 + modal + `fromRoom` breadcrumb |
| `src/app/e/[id]/page.tsx` | Save 버튼 + modal |
| `src/app/my/shortlists/[id]/page.tsx` | Collaborator UI + share controls (전면 재작성) |
| `src/app/room/[token]/page.tsx` | Inquiry CTA + analytics + 만료 처리 (전면 재작성) |
| `src/app/my/inquiries/page.tsx` | Assignee 컨트롤 |
| `src/app/my/library/import/page.tsx` | v2: 확장 컬럼 + 중복 검출 (전면 재작성) |
| `src/app/my/ops/page.tsx` | Actionable controls + CSV export (전면 재작성) |
| `src/app/my/alerts/page.tsx` | Digest preview 섹션 |
| `src/app/notifications/page.tsx` | `new_work` source 구분 (follow vs interest) |

**Supabase SQL 적용 필요:** `supabase/migrations/p0_wave2_1_integration.sql` — Wave 2 SQL 이후에 실행.

**환경 변수:** 변경 없음.

### Acceptance checks

1. `/artwork/[id]` → "Save" → shortlist 선택/생성 → 중복 안전
2. `/e/[id]` → "Save" → 전시를 shortlist에 추가
3. `/my/shortlists/[id]` → collaborator 검색·추가·제거 + role badge
4. `/my/shortlists/[id]` → rotate link → 이전 `/room/` 링크 404
5. `/room/[token]` → "Ask about this work" CTA → `inquiry_clicked` 로그
6. `/room/[token]` → 작품 클릭 → `/artwork/[id]?fromRoom=` → room breadcrumb 표시
7. Saved interest (medium: "Oil") → 아티스트가 Oil 작품 업로드 → interest 알림 생성
8. 알림 텍스트: follow 출처 vs interest 출처 구분
9. `/my/alerts` → digest preview에 pending events 표시
10. `inquiry_notes` → artist + assignee 접근 가능 (author-only 아님)
11. Message 전송 → `last_contact_date` 자동 업데이트
12. `/my/inquiries` → "Assign to me" → assigned badge
13. CSV import → 15개 컬럼 매핑 + 중복 검출 + skip
14. `/my/ops` → CSV export + profile link 복사 + recent_7d 필터
15. `npx tsc --noEmit` 통과

---

## 2026-03-30 — Beta Differentiation Wave 2

### 변경 요약

- **Scope A — Shortlists / Private Rooms**: `shortlists`, `shortlist_items`, `shortlist_collaborators`, `shortlist_views` 테이블; `/my/shortlists` (목록·생성), `/my/shortlists/[id]` (상세·편집), `/room/[token]` (공유 뷰잉 룸); `get_shortlist_by_token`, `get_shortlist_items_by_token` RPC; 조회·열기·inquiry_clicked 분석.
- **Scope B — Sales Pipeline Lite**: `pipeline_stage` enum (`new`~`closed_lost`), `assignee_id`, `next_action_date`, `last_contact_date` 컬럼 추가; `inquiry_notes` 내부 메모 테이블; `update_inquiry_pipeline` RPC; `/my/inquiries`에 pipeline 필터·단계 변경·next action 날짜·내부 메모 UI.
- **Scope C — Structured Import/Export**: `src/lib/csv/parse.ts` 클라이언트 CSV 파서·생성·다운로드; `/my/library/import` 위자드 (붙여넣기 → 매핑 → 유효성 검사 → 가져오기); `/my/library`에 Export CSV 버튼.
- **Scope D — Follow Alerts/Digest**: `alert_preferences`, `saved_interests` 테이블; `notify_followers_new_work` 트리거 (공개 작품 업로드 시 팔로워에게 알림); `/my/alerts` 설정 페이지 (신작 알림 토글, digest 빈도, 관심사 저장).
- **Scope E — Ops Panel**: `ops_onboarding_summary` RPC; `/my/ops` 페이지 (전체 프로필 수, 난수 아이디, 미업로드, 대리 위임 현황; 필터링 테이블).

### 신규 파일

| 파일 | 설명 |
|---|---|
| `supabase/migrations/p0_wave2_differentiation.sql` | 전체 Wave 2 스키마 |
| `src/lib/supabase/shortlists.ts` | Shortlist CRUD + room RPC |
| `src/lib/supabase/alerts.ts` | Alert preferences + saved interests |
| `src/lib/csv/parse.ts` | CSV 파서·생성·다운로드 |
| `src/app/my/shortlists/page.tsx` | 숏리스트 목록 |
| `src/app/my/shortlists/[id]/page.tsx` | 숏리스트 상세 |
| `src/app/room/[token]/page.tsx` | 공유 뷰잉 룸 |
| `src/app/my/library/import/page.tsx` | CSV 가져오기 위자드 |
| `src/app/my/alerts/page.tsx` | 알림 설정 |
| `src/app/my/ops/page.tsx` | 베타 운영 패널 |

### 수정 파일

| 파일 | 변경 |
|---|---|
| `src/lib/supabase/priceInquiries.ts` | `PipelineStage` 타입, pipeline 컬럼, `updateInquiryPipeline`, `listInquiryNotes`, `addInquiryNote` |
| `src/app/my/inquiries/page.tsx` | Pipeline 필터·단계 변경·next action·내부 메모 UI |
| `src/app/my/library/page.tsx` | Import/Export 버튼 추가 |

**Supabase SQL 적용 필요:** `supabase/migrations/p0_wave2_differentiation.sql` — Wave 1 SQL 이후에 실행.

**환경 변수:** 변경 없음.

---

## 2026-03-30 — Beta Hardening Wave 1.1 (reconciliation)

Wave 1 (2026-03-27)에서 HANDOFF에 기술되었으나 main에 실제 반영되지 않았던 항목을 정합 패치.

### 이전에 불일치했던 사항 및 수정 내역

| 항목 | 불일치 | 수정 |
|---|---|---|
| Feed `getFollowingIds` 중복 | `listFollowingArtworks` 내부에서 `follows` 테이블을 다시 쿼리 → FeedContent의 `getFollowingIds()`와 동일 데이터 이중 fetch | `FollowingOptions.followingIds` 추가; FeedContent에서 미리 가져온 ID를 전달하여 내부 follows 쿼리 생략 |
| Feed instrumentation payload 부족 | `feed_data_loaded` 이벤트에 `item_count`, `source`, `duration_ms` 누락 | 이벤트명 `feed_loaded`로 정규화; 모든 피드 이벤트에 `item_count`, `source`, `duration_ms` 추가 |
| Feed TTL dev 로깅 없음 | pathname/focus/visibility TTL skip 시 디버그 정보 없음 | `NODE_ENV=development`일 때 `console.debug`로 skip 사유·경과 시간 출력 |
| Artwork detail inquiry: one-shot | `/artwork/[id]`의 inquirer·artist view 모두 `artist_reply` 단일 필드만 표시, 스레드 미노출 | `listPriceInquiryMessages` + `appendPriceInquiryMessage` 연동; inquirer도 follow-up 가능; artist는 closed 전까지 계속 답변 가능 |
| HANDOFF: reconciliation 섹션 부재 | Wave 1 HANDOFF가 "완료됨" 기술이나 실제 main과 불일치 | 본 섹션 추가 |

### Acceptance checks

- `getFollowingIds` — FeedContent 내 호출 2회(all/following 분기 각 1회), `listFollowingArtworks`에 `followingIds` 전달하여 내부 중복 제거
- `window.addEventListener("scroll"` — FeedContent에 없음 (IO만 사용)
- Following 탭 load-more — `followingArtCursor` + `followingExhCursor`로 무한 페이지
- 90s TTL — `FEED_BG_REFRESH_TTL_MS = 90_000`; pathname/focus/visibility는 TTL 미만이면 skip
- `/notifications` mount 시 `markAllAsRead()` 호출 없음
- 개별 알림 click → `markNotificationRead(row.id)` 호출
- "Mark all as read" 버튼 존재
- Artwork detail: inquirer 스레드 표시 + follow-up; artist 스레드 표시 + 복수 답변
- `npx tsc --noEmit` 통과
- `npm run build` 통과 (exit 0, 21s)
- 변경 파일 대상 `eslint` 통과

**변경 파일:** `src/lib/supabase/artworks.ts`, `src/components/FeedContent.tsx`, `src/lib/beta/logEvent.ts`, `src/app/artwork/[id]/page.tsx`, `docs/HANDOFF.md`, `docs/QA_SMOKE.md`

**Supabase SQL:** 추가 마이그레이션 없음. Wave 1의 `p0_beta_hardening_wave1.sql`이 이미 적용되어 있으면 충분.

**환경 변수:** 변경 없음.

---

## 2026-03-27 — Beta Hardening Wave 1 (ops depth)

- **피드 (`FeedContent`)**: 팔로잉 탭에 작품·전시 **커서 페이지네이션** 및 load-more; `getFollowingIds` 단일 호출; pathname/focus/visibility는 **90s TTL**로만 백그라운드 갱신(수동 새로고침은 강제); IntersectionObserver만 사용(스크롤 폴백 제거); `beta_analytics_events`에 피드 로드/첫 페인트/ loadMore 계측.
- **가격 문의**: `price_inquiry_messages` 스레드 API 정리; 작가 인박스는 `artworks!inner`로 **서버 필터 + 키셋 페이지**; `/my/inquiries`에 상태 필터·검색·스레드·읽음(`mark_price_inquiry_read`)·답변 append.
- **알림**: 목록 진입 시 **전체 읽음 자동 처리 제거**; 행 클릭 시 해당 알림만 읽음; **「모두 읽음」** 버튼 별도. 가격 문의 알림 링크 → `/my/inquiries`.
- **라이브러리**: `/my/library` — `listMyArtworksForLibrary` 기반 필터·정렬·더 보기; `/my`에서 링크(대리 로그인 시 숨김).
- **벌크 업로드**: 제목 접두/접미/치환(확인 모달), 사이즈·단위, 고정가·통화·가격 공개, 전시 연결/해제, CSV 텍스트 붙여넣기로 초안 생성, 벌크 발행 시 `bulk_publish_completed` 이벤트.
- **분석·기타**: `LikeButton`/`FollowButton`/전시 생성에 베타 이벤트; `/my/diagnostics`(개발 또는 `NEXT_PUBLIC_DIAGNOSTICS=1`); Playwright 최소 스모크; README·`docs/QA_SMOKE.md`·Runbook·`.env.example` 갱신.

**Supabase SQL 적용 필요:** `supabase/migrations/p0_beta_hardening_wave1.sql` (이미 적용한 환경은 재실행 idempotent).

**환경 변수:** (선택) `NEXT_PUBLIC_DIAGNOSTICS=1` — 프로덕션에서 진단 페이지 노출. `.env.example` 및 `docs/03_RUNBOOK.md` 반영됨.

**Verified:** 변경 파일 대상 `eslint` 통과; `npm run build` 통과.

## 2026-03-23 — 난수 아이디 1회성 유도 개선(나중에 비영구)

- 로그인/매직링크 콜백 후 난수 아이디(`user_XXXXXXXX`) 감지 시 `/username-fix` 안내 페이지로 유도.
- `/username-fix`의 `나중에` 동작을 **비영구 처리**로 변경:
  - localStorage dismiss를 저장하지 않음.
  - 세션 prompt 플래그만 정리하고 기존 경로로 이동.
  - 이후 재진입 시 다시 안내 노출 가능(적극 유도).
- 설정 페이지에서 유저네임 입력/검증/중복 체크 후 저장 가능하도록 반영.
- 랜덤 아이디 판별 로직을 공용 유틸(`src/lib/profile/randomUsername.ts`)로 통일.

**Supabase SQL 적용 필요:** 없음.

**Verified:** `ReadLints` 통과, `npm run build`는 기존과 같이 환경에서 장시간 빌드 단계 대기(완료 로그 미수집).

## 2026-02-19 — 전시 관리자 초대·작가 버킷·벌크 전시 컨텍스트

- **전시 관리자 초대: 유저 검색 + 이메일**
  - 전시 편집(`/my/exhibitions/[id]/edit`)·전시 작품 추가(`/my/exhibitions/[id]/add`)에서 관리자 초대 시: **가입한 유저**는 이름·@유저네임 검색으로 선택 후 `createDelegationInviteForProfile`(project scope)로 앱 내 초대. **미가입자**는 기존처럼 이메일 입력 후 `createDelegationInvite` + 초대 메일 발송.
- **전시 작품 추가: 작가 단위 버킷**
  - 2단계(작품 선택)에서 참여 작가·외부 작가마다 **버킷** 하나씩 표시. 각 버킷: (1) **드롭 존** — 로컬 이미지 파일 1점 드롭 → 단일 업로드, 2점 이상 → 벌크 업로드로 이동(파일은 `pendingExhibitionUpload` 스토어로 전달). (2) **단일 작품 추가**·**벌크 작품 추가** 버튼. 참여 작가 없으면 "1단계에서 참여 작가 추가" 안내.
- **벌크 업로드: 전시·작가 컨텍스트**
  - 전시 작품 추가에서 벌크 링크 시 `addToExhibition`·`from=exhibition`·`artistId`(또는 외부는 `externalName`·`externalEmail`) 쿼리 전달. 벌크 페이지에서 이 파라미터 있으면 intent=CURATED·작가/외부 preselected·attribution 스킵 후 바로 업로드 단계. 드롭한 파일이 있으면 스토어에서 꺼내 `pendingFiles`에 추가. 발행 시 `projectId`로 클레임 연결·전시에 작품 추가 후 전시 작품 추가 페이지로 리다이렉트.
- **단일 업로드**: 전시에서 진입 시 드롭한 파일 1개가 스토어에 있으면 `setImage`·`setStep("form")`으로 폼 단계 직진입.
- **API**: `PublishWithProvenanceOptions`에 `projectId` 추가. `publishArtworksWithProvenance`에서 CURATED/INVENTORY 클레임 생성 시 `projectId` 전달.
- **문서**: `docs/EXHIBITION_ADD_WORKS_ROOT_CAUSE.md`(작가 중복 선택 루프 원인), `docs/EXHIBITION_ARTIST_BUCKETS_DESIGN.md`(작가 버킷·DnD 설계), `docs/ONBOARDING_UX_FLOWS.md`(온보딩·난수아이디 UX 플로우).

**Supabase SQL 적용 필요:** 없음.

**Verified:** `npm run build` 통과.

---

## 2026-02-19 — 온보딩 UX 개선 (매직링크 진입·난수 아이디 배너)

- **매직링크 진입 시 프로필 폼 노출**
  - `ProfileBootstrap`: `pathname === "/onboarding"`일 때 `ensure_my_profile()` 호출 생략. 매직링크 클릭 → 콜백에서 `/onboarding` 이동 시 프로필이 생성되지 않아, 온보딩에서 유저아이디·공개 이름·역할을 한 번에 입력 후 저장 (추가 매직링크 발송 없음).
- **온보딩 문구**
  - "프로필 완성" 화면에 "유저 아이디와 공개 이름을 입력하세요. 추가 이메일 링크는 발송되지 않습니다" 안내 추가 (i18n: `onboarding.completeProfileHint`).
- **제출 후 이동**
  - 프로필 제출 후 비밀번호 미설정(`HAS_PASSWORD_KEY` 없음)이면 `/set-password`, 있으면 `/feed`로 이동.
- **난수 아이디 사용자 배너**
  - `username`이 `user_` + 8자 16진수 패턴인 사용자에게 헤더 하단에 안내 배너: "설정에서 유저 아이디를 설정하세요" + 설정 링크. 닫기 시 `localStorage`에 저장해 재노출 안 함 (`RandomIdBanner`).
- **문서**
  - `docs/ONBOARDING_AND_USERNAME_AUDIT.md`에 §7 벤치마킹·적용 개선 사항 추가.

**Supabase SQL 적용 필요:** 없음.

**Verified:** `npm run build` 통과.

---

## 2026-02-19 — 업로더 삭제 권한·사이즈 단위·피드 더 불러오기

- **1) 업로드 당사자 삭제 권한**
  - `artworks.created_by` 컬럼 추가 (업로드한 프로필 ID). `canDeleteArtwork`: artist 또는 claim 보유자 또는 **created_by**일 때 삭제 허용.
  - RLS: artworks DELETE, artwork_images DELETE에 `created_by = auth.uid()` 조건 추가.
  - 싱글/드래프트 생성 시 `created_by` = 세션 유저로 설정.

- **2) 작품 사이즈 단위 보존·표시**
  - `artworks.size_unit` 추가 (`'cm' | 'in' | null`). 사용자 입력 단위를 저장.
  - `parseSizeWithUnit()`: 입력 문자열에서 단위 감지. `formatSizeForLocale(size, locale, sizeUnit)`: size_unit이 'in'이면 KO에서만 cm로 변환 표시, 'cm'이면 EN에서만 in으로 변환 표시.
  - 싱글 업로드·작품 수정 시 `parseSizeWithUnit`으로 단위 저장.

- **3) 피드 무한 스크롤(더 불러오기)**
  - **전체** 탭: `listPublicArtworks`에 cursor 페이지네이션 (`ArtworkCursor`), `listPublicExhibitionsForFeed`에 cursor. 응답에 `nextCursor` 포함.
  - `FeedContent`: 스크롤 끝 감지(IntersectionObserver) 시 `loadMore()`로 다음 페이지 요청 후 피드에 이어붙임. **팔로잉** 탭은 기존대로 한 번만 로드.

- **4) 벌크 업로드·외부 작가 이름**
  - 외부 작가 이름 최소 2자 + **다음** 버튼을 눌러야 업로드 단계로 이동 (1자 입력만으로 자동 전환 방지). `attributionStepDone` 상태로 명시적 진행.

**Supabase SQL 적용 필요:**  
- `supabase/migrations/p0_artworks_created_by_and_size_unit.sql`

**Verified:** (빌드·타입 체크 후, 삭제 권한·사이즈 표시·피드 스크롤 더 불러오기·벌크 다음 버튼 동작 확인 권장.)

---

## 2026-02-19 — 관리자 위임(Delegation): 전시/계정 관리 권한 공유

- **목적**: 특정 전시 또는 계정에 대한 관리 권한을 다른 사용자에게 위임. (매니저·큐레이터·어시스턴트 등)
- **DB**
  - **`delegations`** 테이블: `delegator_profile_id`, `delegate_profile_id`(nullable), `delegate_email`, `scope_type`(account|project|inventory), `project_id`(scope=project 시), `permissions`, `invite_token`, `status`(pending|active|revoked).
  - 마이그레이션: `p0_delegations.sql`, `p0_delegations_exhibition_works_projects_rls.sql`.
  - 신규 가입 시 `delegate_email`이 일치하는 pending 위임은 트리거로 자동 연결(`delegate_profile_id` 설정, status=active).
- **플로우**
  - **초대**: 전시 “작품 추가” 페이지에서 “관리자 초대”로 이메일 입력 → `create_delegation_invite` RPC → `/api/delegation-invite-email`로 초대 메일 발송. 링크: `{NEXT_PUBLIC_APP_URL}/invites/delegation?token=...` (Vercel에 NEXT_PUBLIC_APP_URL 설정 필수. Runbook 참고.)
  - **수락**
    - **케이스 A (이미 로그인)**: 초대 링크 접속 → “수락” 클릭 → `accept_delegation_by_token` (세션 이메일과 초대 이메일 일치 시에만). 위임 2개 이상이면 `/my/delegations`, 1개면 해당 전시 추가 페이지 또는 `/my/delegations`로 이동.
    - **케이스 B (미로그인)**: “로그인하여 수락” → `/login?next=/invites/delegation?token=...` → 로그인(비밀번호 또는 매직링크) 후 콜백에서 `next` 있으면 해당 URL로 리다이렉트 → 케이스 A와 동일 수락.
  - **신규 유저**: 초대 링크로 가입 시 기존 온보딩(유저네임·프로필명·역할) 유지. 가입 완료 후 트리거로 해당 이메일의 pending 위임이 자동 활성화.
- **RLS**
  - `exhibition_works`: insert/update/delete 시 전시 소유자(curator/host) 또는 **해당 전시에 대한 project-scope delegation이 있는 delegate** 허용.
  - `projects`: update만 delegate 허용(insert/delete는 curator/host만).
- **UI**
  - `/my/delegations`: 받은 위임·보낸 위임 목록. “Manage”로 전시 추가 페이지 이동 시 “acting as” 배너 표시.
  - 헤더: “acting as” 중일 때 “관리 중: {이름}” 배너 + “내 계정으로 전환” 버튼. 아바타 메뉴에 “위임” 링크.
  - 로그인·콜백: `next` 쿼리 파라미터 지원(초대 수락 후 직행).
- **알림**: 위임 수신 시 앱 내 알림은 추후 알림 시스템 정비 시 추가 예정.

**Supabase SQL 적용 필요:**  
- `supabase/migrations/p0_delegations.sql`  
- `supabase/migrations/p0_delegations_exhibition_works_projects_rls.sql`  

**Verified:** (빌드·타입 체크 후, 전시 추가 페이지에서 관리자 초대 → 이메일 수신 → 수락 플로우·RLS 동작 확인 권장.)

---

## 2026-02-22 — 매직링크 온보딩: 인증 메일 중복·난수 아이디 방지

- **문제**: 매직링크 가입 후 프로필(유저네임·디스플레이네임·페르소나) 입력 후 확인 시 “인증 메일이 다시 간다”는 인식, 일부 유저가 난수 아이디로 남는 현상.
- **원인 정리**  
  - “인증 메일이 다시 간다”: 프로필 완료 화면의 “Set password” 버튼이 `sendPasswordReset`로 **비밀번호 재설정 메일**을 발송함. 매직링크 유저는 이후 `/set-password`로 이동해 앱 내에서 비밀번호를 설정하므로, 온보딩에서 이메일 발송은 불필요하고 혼동만 유발.  
  - 이메일·비밀번호 **신규 가입** 시에만 Supabase가 “회원가입 확인” 메일을 보냄(프로필 폼 제출과는 무관).  
  - 난수 아이디: 프로필 저장 실패 시 에러 메시지가 불명확해 재시도가 줄어들 수 있음.
- **변경 사항**  
  1. **Auth 콜백** (`/auth/callback`): 세션 확정 후 프로필 유무·비밀번호 설정 여부를 판단해 한 번에 리다이렉트. (프로필 없음 → `/onboarding`, 비밀번호 미설정 → `/set-password`, 그 외 → `/feed`.)  
  2. **온보딩(프로필 모드)**: “Set password” 버튼(이메일 발송) 제거. “Continue를 누르면 다음 화면에서 비밀번호를 설정할 수 있습니다” 안내만 유지.  
  3. **프로필 저장 실패 시**: 에러 메시지를 “프로필 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.” 등으로 명확히 표시.
- **Supabase 권장**: 이메일·비밀번호 가입 시 “확인 메일” 없이 바로 세션을 주고 싶다면, Dashboard → Authentication → Providers → Email → **Confirm email** 비활성화. (보안상 확인 메일을 유지할 경우 현재 동작 유지.)

**Verified:** (매직링크 로그인 → 프로필 입력 → Continue → set-password 화면으로 이동, 이메일 미발송 확인 권장.)

---

## 2026-02-22 — 업로드 탭 구조·의도 라벨·전시 생성·기존 작품 추가

- **업로드 탭 3개**: "개별 업로드" | "벌크(일괄) 업로드" | "전시 만들기". `/upload` 레이아웃에서 탭으로 이동, 전시 만들기는 `/my/exhibitions/new?from=upload`로 이동 후 생성.
- **의도(분류) 4종**: "내 작품 (아티스트 페르소나만)", "소장 작품 (콜렉터 페르소나만)", "갤러리 - 전시 & 보유 (갤러리/갤러리스트 페르소나만)", "큐레이션 작품 (큐레이터 페르소나만)". 단일·벌크 업로드 모두 i18n 키로 통일.
- **전시 생성 직후**: 생성 완료 시 전시 상세가 아니라 **기존 작품 추가** 페이지(`/my/exhibitions/[id]/add`)로 리다이렉트해, 바로 기존 업로드 작품을 전시에 넣을 수 있게 함.
- **전시에 기존 작품 추가 시 프로비넌스**: 전시에 작품을 추가하면 `exhibition_works`에 넣는 것뿐 아니라, **CURATED** 프로비넌스 클레임을 자동 생성함. "이 작품을 이 전시에서 큐레이션했다"는 시제가 포함된 갤러리–큐레이터 프로비넌스가 한 번에 만들어짐. (작품이 내부 작가 프로필을 가질 때만 생성, 이미 클레임이 있으면 RPC 실패는 무시.)
- **업로드 시 전시에 곧바로 추가**: `/upload?addToExhibition=전시ID`로 업로드하면서 의도를 CURATED/INVENTORY로 선택하면, 클레임 생성 시 `project_id`에 해당 전시를 넣어 전시와 프로비넌스가 연결됨.

### 전시·기존 작품·프로비넌스 동작 (쉬운 설명)

1. **전시를 만들면**  
   제목·기간 등을 입력해 전시 게시물을 만든 뒤, 곧바로 "기존 작품 추가" 화면으로 이동합니다.

2. **기존 작품을 전시에 넣으면**  
   내가 올린 작품·내가 리스팅한 작품 목록에서 골라 "추가"를 누르면, (1) 그 전시의 작품 목록에 들어가고, (2) 동시에 "이 작품을 이 전시에서 큐레이션했다"는 **프로비넌스(시제)** 가 자동으로 만들어집니다. 그래서 전시 게시물 생성과 갤러리–큐레이터 프로비넌스가 자연스럽게 맞습니다.

3. **새 작품을 올리면서 전시에 넣으면**  
   업로드 페이지에서 "전시에 추가"로 들어와 새 작품을 올리고, 의도를 "큐레이션 작품" 등으로 선택해 저장하면, 작품 생성·클레임·전시 연결이 한 번에 되고, 해당 전시 ID가 프로비넌스에 붙습니다.

4. **이미 만든 전시 수정**  
   전시 제목·기간·작품 구성 등 수정은 **업로드 탭이 아니라** "내 전시" 상세(`/my/exhibitions/[id]`)나 프로필의 전시 카드에서 진행합니다.

**Verified:** (빌드·린트 통과 후, 업로드 탭 3개·전시 생성 → 기존 작품 추가·프로비넌스 연동 플로우 확인 권장.)

---

## 2026-02-22 — i18n 옵션 C: 커버리지 확대 + 아티스트 중심 번역

- **방향**: “둘 다 + 지속적 통일감 유지” 적용. KO 선택 시 노출되는 영문 하드코딩 제거, 아티스트·커뮤니티 맥락에 맞는 한국어 문구 사용.
- **신규 키 (en/ko 쌍)**: `common.*`(에러/안내/라벨), `upload.*`(의도·소유·가격·플레이스홀더·라벨), `exhibition.*`, `settings.*`(플레이스홀더·라벨), `login.*`, `onboarding.*`, `setPassword.*`, `authReset.*`, `my.*`, `bulk.*`, `app.title`/`app.description` 등 대량 추가.
- **치환 범위**: 업로드(의도/폼/디덱), 전시(내 전시 상세·편집·작품 추가·목록), My(프로필/통계 에러·전시 버튼), 클레임/가격문의(에러·토스트), 로그인(플레이스홀더), 설정(플레이스홀더·라벨·Retry details·Dev debug), 공개 전시 `/e/[id]`(Not found). placeholder "DELETE"는 삭제 확인용으로 번역 없이 유지.
- **기존 ko 문구**: 변경 없음. 누락 키 보강 및 하드코딩 제거만 수행.
- **메타**: `layout` 제목/설명을 `app.title`/`app.description` 톤으로 수정(영문).

**Verified:** (빌드·린트 통과 후, KO 토글 시 업로드/전시/My/설정 등 주요 플로우에서 한국어 노출 확인 권장.)

---

## 2026-02-20 — i18n·언어 통일 개선 방안 정리 + 브라우저 자동번역 방지

- **문서**: `docs/I18N_IMPROVEMENT_OPTIONS.md` — 현재 이슈(KO에서 영문 노출, 브라우저 자동번역 충돌), 벤치마킹, 옵션 A/B/C/D와 장단점·권장 순서 정리.
- **옵션 A 적용 (기능 영향 없음)**  
  - **`<html lang>` 동기화**: 클라이언트에서 선택 로케일(쿠키)에 따라 `document.documentElement.lang`을 `en`/`ko`로 설정하는 `HtmlLangSync` 컴포넌트 추가.  
  - **`<body translate="no">`**: 앱 전체를 브라우저 자동 번역에서 제외해 "Feed → 먹이", "Abstract → 초록" 등 이중 번역 방지.  
  - **브랜드 "Abstract"**: `<span translate="no">`로 감싸 명시적 제외( body 에 이미 `translate="no"` 적용으로 중복이지만 브랜드 보호 강화).

**Verified:** (배포 후 KO 선택 시 메뉴는 기존과 동일; 브라우저 번역 시 앱 문구가 덮어씌워지지 않는지 확인 권장.)

---

## 2026-02-20 — 가격문의 답변 시 RLS 오류 수정

- **증상**: 패치 이전에 올라온 가격문의에 작가가 답변을 저장할 때 `new row violates row-level security policy for table "price_inquiries"` 발생.
- **원인**: `p0_claims_period_and_price_inquiry_delegates.sql`의 UPDATE 정책 `price_inquiries_update_reply`가 **WITH CHECK**에서 `replied_at is null`을 요구함. 답변 저장 시 `replied_at`을 설정하므로 갱신된 행이 이 조건을 만족하지 않아 RLS에 걸림.
- **수정**: WITH CHECK에서는 “수정 후 행”에 대해 `replied_at is null`을 요구하지 않고, 응답 권한(작가/대리인)만 검사하도록 변경. **USING**은 그대로 두어 “아직 답 없는 문의만 수정 가능” 유지.
- **Supabase SQL**: `supabase/migrations/p0_price_inquiry_update_rls_fix.sql` 실행 필요.

**Verified:** (배포 후 기존 가격문의 답변 저장 동작 확인 권장.)

---

## 2026-02-19 — 피드 전시 노출 + 공개 전시 페이지 + 전시 미디어 자유 버킷 + 탭 재정렬

- **피드**: 팔로우 중인 프로필이 큐레이터/호스트인 전시를 피드에 노출. `listExhibitionsForFeed(profileIds)`로 조회 후 작품과 `created_at` 기준으로 병합, 5개마다 discovery 블록 끼워 넣기. `FeedExhibitionCard`로 전시 카드 표시.
- **피드(수정)**: 전체 탭은 `listPublicExhibitionsForFeed()`로 퍼블릭 전시 전체를 노출하도록 변경(팔로우 기반 제한 해제). 따라서 본인 전시도 전체 피드에서 노출됨.
- **피드 전시 카드 UI 1차 정리**: 전시 카드 크기를 작품 카드와 유사한 체급으로 조정하고, 기간/장소가 카드 본문에서 항상 보이도록 레이아웃 변경. 썸네일 스택 화질은 `thumb`→`medium`으로 상향.
- **피드 전시 카드 UI 2차 정리(사람 추천 톤 정렬)**: 전시 추천 블록을 사람 추천 블록과 유사한 패턴(헤더 + 하단 썸네일 그리드)으로 변경. 전시 블록 span을 `lg:col-span-2`로 맞춰 피드 리듬/조화를 개선.
- **공개 전시 페이지**: `/e/[id]` — 읽기 전용. 작가별 작품 버킷, 전시전경/부대행사(및 자유 제목 버킷) 섹션. 소유자(큐레이터/호스트)는 "전시 관리" 링크로 `/my/exhibitions/[id]` 이동.
- **전시 미디어 자유 제목 버킷**: `exhibition_media`에 `bucket_title` 컬럼 추가, `type`에 `custom` 허용. 전시 상세·공개 페이지에서 버킷별 그룹 표시(제목 = bucket_title ?? 기본 라벨). 내 전시 상세에서 "사진 추가" per 버킷, "버킷 추가"(제목 + 첫 사진)로 커스텀 섹션 생성. **Supabase SQL**: `p1_exhibition_media_bucket_title.sql` 실행 필요.
- **전시 DnD 확장**: 내 전시 상세에서 (1) 아티스트 버킷 순서 DnD, (2) 아티스트 버킷 내부 작품 순서 DnD, (3) 미디어 버킷 순서 DnD, (4) 미디어 버킷 내부 이미지 순서 DnD, (5) 미디어 삭제, (6) 미디어 벌크 업로드 + 업로드 전 순서 DnD를 지원.
- **빈 버킷 순서 영구 저장**: `exhibition_media_buckets` 메타 테이블 추가로 이미지가 0장인 버킷도 순서를 유지. **Supabase SQL**: `p2_exhibition_media_buckets.sql` 실행 필요.
- **전시 삭제 옵션**: `/my/exhibitions/[id]/edit`에 전시 전체 삭제 추가.  
  - 옵션 A: 전시 이력만 삭제(작품/프로비넌스 유지)  
  - 옵션 B: 전시 연동 작품까지 삭제(작품+프로비넌스 히스토리 포함)
- **전시 대표 썸네일 스택**: `projects.cover_image_paths`(text[]) 추가 후, 전시 상세에서 대표 썸네일 선택/순서 저장(최대 3개). 피드/내 전시 목록/내 프로필 전시 탭 카드에서 스택 썸네일 표시. **Supabase SQL**: `p3_exhibition_cover_image_paths.sql` 실행 필요.
- **탭 재정렬**: My 페이지 탭 옆 "↕" 클릭 시 순서 변경 모드. 위/아래 화살표로 순서 변경 후 "저장" 시 `profile_details.tab_order`에 저장. `getOrderedPersonaTabs(..., savedOrder)`로 저장된 순서 적용.

**Verified:** `npm run build` 통과.

### 피드 레이아웃 방향: 인스타형 vs 핀터레스트형

- **인스타형(통일 그리드)**  
  - 장점: 한눈에 정돈됨, 브랜드/포트폴리오 인상 강함, 팔로우·참여 전환에 유리(리서치에서 일관 그리드가 팔로우율·노출에 유리하다는 보고 있음).  
  - 단점: 세로형·가로형 작품이 섞이면 썸네일 크롭으로 일부 작품이 잘릴 수 있음.
- **핀터레스트형(매스너리/엇나감)**  
  - 장점: 원본 비율 유지, 시선 이탈·탐색에 유리.  
  - 단점: 피드가 산만해 보일 수 있고, “작가/갤러리” 정체성보다 “아이디어 수집” 느낌에 가깝다.

- **추천**: Abstract는 **인스타형(통일감 우선)** 유지가 적합.  
  - 목표가 “팔로우·참여·전시/작품 구매”이고, 작품 피드가 포트폴리오 역할을 하므로, 카드 크기·비율을 맞추고 추천 블록(사람/전시)도 동일한 라벨·타이포 규칙을 쓰는 쪽이 좋음.
- **적용**: (1) 추천 라벨 통일 — `Recommended · People` / `Recommended · Exhibitions` 동일 포맷. (2) 추천 블록 라벨 타이포 통일 — `text-xs font-medium uppercase tracking-wide text-zinc-500`. (3) 기본 피드 셀은 작품 카드 기준 정사각 유지, 모듈(사람/전시)은 `lg:col-span-2`로 동일 span 유지.

---

## 2026-02-19 — 탭 정리(갤러리/큐레이션 제거, 전체 버킷) + 전시 상세 작가별·전시전경/부대행사

- **탭**: 갤러리(INVENTORY), 큐레이션/전시(CURATED) 탭 제거. 비아티스트는 "전체" 탭이 항상 마지막(우측). 아티스트: 전체·전시·내 작품·소장. 콜렉터: 소장·전시·전체. 큐레이터/갤러리: 전시·전체.
- **전체 탭**: "전체" 선택 시 My work / Curated by me / Exhibited here / Collected 버킷(섹션)으로 표시.
- **전시 상세**: 작품을 작가별 버킷으로 표시(썸네일 그리드, 작게). 전시전경(installation), 부대행사(side_event) 섹션 추가(이미지 업로드 UI는 추후).
- **DB**: `p0_exhibition_media.sql` — 전시전경/부대행사용 `exhibition_media` 테이블. **Supabase SQL Editor에서 실행 필요.**

---

## 2026-02-19 — 클레임 기간(period) 기능 + 가격 문의 알림 수정 + 업로드 period 입력

오늘 작업: 클레임에 과거/현재/미래 기간 구분 추가, 작가가 클레임 확인 시 기간 수정 가능하도록 UI 반영. 가격 문의 알림이 일부 작가에게 가지 않던 문제 수정. 업로드 시 갤러리/큐레이터가 period_status 입력 가능하도록 추가.

### A. 클레임 기간(period_status) 기능 완성
- **DB**: `claims` 테이블에 `period_status` (past/current/future), `start_date`, `end_date` 컬럼 추가. `p0_claims_period_and_price_inquiry_delegates.sql`에서 기존 confirmed INVENTORY/CURATED/EXHIBITED는 `period_status = 'current'`로 backfill.
- **클레임 요청 UI**: 작품 상세에서 "curated by me" / "exhibited by me" 선택 시 **기간 선택**(과거 종료 / 현재 진행 / 미래 예정) 필드 표시. 요청 시 `createClaimRequest`에 `period_status` 전달.
- **클레임 확인 UI**: 작가가 pending 클레임 승인 시, CURATED/EXHIBITED는 **기간 수정 폼** 표시(기본값: 요청자가 제안한 period 또는 current). "기간 확정" 클릭 시 `confirmClaim(claimId, { period_status })` 호출. OWNS는 기간 없이 바로 승인.
- **RPC**: `createClaimRequest`, `confirmClaim`에 `period_status` 옵션 파라미터 추가. `PendingClaimRow` 타입에 `period_status`, `start_date`, `end_date` 필드 추가.
- **i18n**: `artwork.periodPast`, `artwork.periodCurrent`, `artwork.periodFuture`, `artwork.periodLabel`, `artwork.sendRequest`, `artwork.confirmWithPeriod` 추가(영/한).

### B. 가격 문의 알림 미수신 문제 수정
- **증상**: 일부 아티스트가 작품에 대한 가격 문의 알림을 전혀 받지 못함.
- **원인**: `price_inquiry_artist_id(artwork_id)`가 **CREATED 클레임의 subject_profile_id만** 반환. CREATED 클레임이 없는 작품(비공개/초안, 백필 누락, 레거시 데이터)은 `NULL` 반환 → 수신자 목록에서 제외되어 알림이 생성되지 않음.
- **수정**: `p0_price_inquiry_artist_id_fallback.sql` — `price_inquiry_artist_id` 함수를 **CREATED 클레임 우선, 없으면 `artworks.artist_id`로 fallback**하도록 변경. CREATED가 없어도 `artist_id`가 있으면 알림 수신 가능.
- **영향**: `can_reply_to_price_inquiry`, `can_select_price_inquiry`, `get_price_inquiry_recipient_ids` 모두 `price_inquiry_artist_id`를 사용하므로, fallback 적용 시 자동으로 `artist_id` 사용자도 답변·문의 조회·알림 수신 가능. CREATED와 `artist_id` 불일치 시 CREATED 우선(coalesce).

### C. 업로드 시 period_status 입력 기능 추가
- **업로드 플로우**: 갤러리/큐레이터가 작품 업로드 시 INVENTORY/CURATED 선택하면 **기간 선택 필드** 표시(과거/현재/미래). 기본값은 "현재 진행".
- **벌크 업로드**: 동일하게 period_status 선택 UI 추가. `publishArtworksWithProvenance` 호출 시 period_status 전달.
- **RPC 수정**: `create_external_artist_and_claim`, `create_claim_for_existing_artist`에 `p_period_status` 파라미터 추가. `p0_upload_claim_period_status.sql` 마이그레이션.
- **타입**: `CreateExternalArtistAndClaimArgs`, `CreateClaimForExistingArtistArgs`에 `period_status?: "past" | "current" | "future" | null` 추가.

### D. 타입 에러 픽스
- **증상**: 배포 빌드 실패 — `claimType === "EXHIBITED"` 비교에서 타입 오류(업로드 IntentType에 EXHIBITED 없음).
- **수정**: 업로드/벌크 업로드 페이지에서 `claimType === "INVENTORY" || claimType === "CURATED"`만 체크하도록 변경. EXHIBITED는 작품 상세에서만 사용(요청 플로우).

### E. 오늘 수정/추가된 파일 요약
| 구분 | 파일 | 내용 |
|------|------|------|
| DB | `p0_claims_period_and_price_inquiry_delegates.sql` | period_status 컬럼 추가, delegate 알림 로직, RLS 업데이트 |
| DB | `p0_price_inquiry_artist_id_fallback.sql` | **신규** — price_inquiry_artist_id에 artworks.artist_id fallback |
| DB | `p0_upload_claim_period_status.sql` | **신규** — 업로드 RPC에 period_status 파라미터 추가 |
| 앱 | `src/lib/provenance/rpc.ts` | createClaimRequest/confirmClaim에 period_status 옵션, PendingClaimRow에 period 필드 |
| 앱 | `src/app/artwork/[id]/page.tsx` | 클레임 요청/확인 UI에 period_status 선택 폼 추가 |
| 앱 | `src/app/upload/page.tsx` | 업로드 시 INVENTORY/CURATED 선택하면 period_status 입력 필드 |
| 앱 | `src/app/upload/bulk/page.tsx` | 벌크 업로드에도 period_status 선택 UI 추가 |
| 앱 | `src/lib/supabase/artworks.ts` | publishArtworksWithProvenance에 period_status 옵션 추가 |
| 앱 | `src/lib/provenance/types.ts` | CreateExternalArtistAndClaimArgs, CreateClaimForExistingArtistArgs에 period_status 추가 |
| 앱 | `src/lib/i18n/messages.ts` | period 관련 i18n 메시지 추가 |
| 문서 | `docs/PRICE_INQUIRY_NOTIFICATION_ANALYSIS.md` | **신규** — 가격 문의 알림 미수신 원인 분석 문서 |

### F. Supabase SQL 실행 순서 (기존 + 추가)
기존 순서대로 실행한 뒤, 필요 시 추가 마이그레이션 실행.

1. ~ 9. (기존과 동일)
10. **`p0_price_inquiry_artist_id_fallback.sql`** — 가격 문의 알림이 일부 작가에게 가지 않을 때 실행
11. **`p0_upload_claim_period_status.sql`** — 업로드 시 period_status 입력 기능 활성화

### G. 검증
- 클레임 요청: CURATED/EXHIBITED 선택 시 기간 선택 필드 표시, 요청 생성 성공.
- 클레임 확인: 작가가 pending CURATED/EXHIBITED 승인 시 기간 수정 폼 표시, period_status 저장 확인.
- 가격 문의 알림: CREATED 클레임 없는 작품도 `artist_id` 기반으로 알림 수신 확인.
- 업로드: 갤러리/큐레이터가 작품 업로드 시 period_status 입력 및 클레임 생성 확인.

---

## 2026-02-19 — 가격 문의·클레임 안정화 + 작품 삭제 CASCADE

오늘 작업: 가격 문의·"이 작품은…" 클레임 기능이 400 에러를 내던 원인을 정리하고, DB·앱을 수정해 두 기능이 안정 동작하도록 반영함. 작품 삭제 시 클레임 때문에 실패하던 문제 해결.

### A. 42703(undefined_column) 대응
- **증상**: 가격 문의 POST·클레임 요청 POST 시 400, Supabase 로그에 `PostgREST; error=42703`. 화면에는 "Failed to send inquiry" / "Request failed"만 표시.
- **원인**: 실제 DB에 일부 테이블/컬럼이 없거나 마이그레이션 적용 순서 차이로, 트리거·RLS가 참조하는 컬럼이 없을 때 42703 발생.
- **수정**:
  - **가격 문의용 artist 조회**: `price_inquiry_artist_id(artwork_id)`를 **claims만** 사용하도록 변경 (CREATED 클레임의 subject_profile_id). `artworks.artist_id`, `claims.status` 참조 제거 → 해당 컬럼이 없어도 42703 없음.
  - **notifications 컬럼 보강**: `p0_notifications.sql`·`p0_repair_42703.sql`에서 `artwork_id`, `claim_id`, `payload`를 `add column if not exists`로 보장.
  - **artworks.artist_id / claims.status**: `p0_claims_status_request_confirm.sql` 상단·repair에서 `add column if not exists`로 보장.
  - **복구 스크립트**: `p0_repair_42703.sql` — 컬럼 보강 + `price_inquiry_artist_id`·`artwork_artist_id` 함수 재정의. 42703 발생 시 Supabase SQL Editor에서 한 번 실행.

### B. RLS 무한 재귀 재발 방지
- **증상**: 피드/작품 목록에서 "infinite recursion detected in policy for relation 'artworks'", GET /artworks 500.
- **원인**: `p0_claims_status_request_confirm.sql`에서 claims 정책을 다시 만들 때 `exists (select 1 from artworks ...)`를 사용해, artworks SELECT → claims RLS → artworks 참조 → 재귀 발생.
- **수정**: `p0_claims_status_request_confirm.sql`에서 claims 정책 전부 **`artwork_artist_id(work_id) = auth.uid()`**만 사용하도록 변경. 동일 파일 상단에 `artwork_artist_id` 함수 정의 포함. 정책이 artworks를 직접 읽지 않아 재귀 제거.

### C. 에러 메시지 UI·콘솔 노출
- **증상**: Supabase가 준 실제 에러 메시지가 아니라 "Failed to send inquiry" / "Request failed"만 보임.
- **원인**: Supabase/PostgREST 에러가 `Error` 인스턴스가 아닌 `{ message, code }` 객체로 오는데, `error instanceof Error`만 체크해 fallback만 표시됨.
- **수정**:
  - `src/lib/supabase/errors.ts`: `formatSupabaseError(error, fallback)` — 객체·문자열·Error 모두에서 메시지 추출. `logSupabaseError(context, error)` — 브라우저 콘솔에 원본 에러 출력.
  - 작품 상세 페이지: 가격 문의·클레임 요청/승인/거절/삭제 실패 시 위 유틸 사용 + 콘솔 로그. 서버가 준 메시지가 화면에 표시되도록 함.

### D. 마이그레이션 idempotency(재실행 안전)
- **정책**: `p0_price_inquiries.sql` — price_inquiries 정책 생성 전 `drop policy if exists` 4개 추가. `p0_claims_status_request_confirm.sql` — claims_artist_confirm, claims_artist_reject 생성 전 `drop policy if exists` 추가. 동일 스크립트 재실행 시 정책 중복 오류 방지.

### E. 오늘 수정/추가된 파일 요약
| 구분 | 파일 | 내용 |
|------|------|------|
| DB | `p0_price_inquiries.sql` | price_inquiry_artist_id를 claims만 사용, 정책 drop 후 생성 |
| DB | `p0_claims_status_request_confirm.sql` | artwork_artist_id 정의, 정책에서 함수 사용, artist_id·정책 drop 보강 |
| DB | `p0_notifications.sql` | notifications에 artwork_id, claim_id, payload add column if not exists |
| DB | `p0_repair_42703.sql` | **신규** — 컬럼 보강 + artist resolver 함수 일괄 정리 (42703 시 1회 실행) |
| DB | `p0_claims_work_id_cascade.sql` | **신규** — claims.work_id foreign key를 ON DELETE CASCADE로 변경 |
| 앱 | `src/lib/supabase/errors.ts` | **신규** — formatSupabaseError, logSupabaseError |
| 앱 | `src/app/artwork/[id]/page.tsx` | 에러 시 위 유틸 사용 및 콘솔 로그 |

### F. Supabase SQL 실행 순서 (기존 + 보강)
기존 순서대로 실행한 뒤, 필요 시 추가 마이그레이션 실행.

1. ~ 7. (기존과 동일: p0_claims_sync_artwork_artist … p0_price_inquiries)
8. **(선택)** `p0_repair_42703.sql` — 42703 또는 "column … does not exist" 발생 시 실행
9. **`p0_claims_work_id_cascade.sql`** — 작품 삭제 시 클레임 때문에 실패할 때 실행 (한 번만)

### G. 작품 삭제 CASCADE 수정
- **증상**: 작품 삭제 시 "update or delete on table 'artworks' violates foreign key constraint 'claims_work_id_fkey' on table 'claims'" 에러. 사진은 삭제되지만 작품 정보(metadata)는 남아 "껍데기"처럼 피드에 표시됨.
- **원인**: `claims.work_id`가 `artworks(id)`를 참조하는데 `ON DELETE CASCADE`가 없어, 작품 삭제 시 관련 클레임이 있으면 foreign key constraint 위반으로 삭제 실패.
- **수정**: `p0_claims_work_id_cascade.sql` — `claims.work_id` foreign key를 `ON DELETE CASCADE`로 변경. 작품 삭제 시 관련 클레임도 함께 삭제됨.
- **참고**: `price_inquiries.artwork_id`, `artwork_likes.artwork_id`는 이미 `ON DELETE CASCADE`. `notifications.artwork_id`는 `ON DELETE SET NULL` (알림은 남아도 됨).

### H. 검증
- 가격 문의: 가격 비공개 작품에서 "가격 문의하기" → 전송 성공, "작가가 여기에 답변할 예정입니다" 표시. 문의한 사용자만 해당 문의 상태 조회.
- "이 작품은…" 클레임: 옵션 선택 시 확정 요청 생성 성공, 작가 쪽 대기 목록·승인/거절 동작.
- 피드/작품 목록: infinite recursion·500 없이 로드.
- 작품 삭제: 클레임이 있는 작품도 삭제 성공, 작품 정보와 관련 클레임 모두 제거됨.

---

## 2026-02-18 — 이번 업데이트 전체 (Bugfix + 프로비넌스 네트워크 + 요청·확정 클레임 + 단일 드롭다운 UI)

### A. Bugfix: 외부 작가 → 온보딩 작가 전환 시 artist_id 미반영
- **현상**: (1) 외부 작가로 업로드된 작품이 온보딩 작가 피드에 자동으로 안 뜸 (2) 편집에서 온보딩 작가로 바꾼 뒤 저장해도 artist가 lister로 되돌아감
- **원인**: claim만 갱신하고 `artworks.artist_id`는 갱신하지 않음
- **수정**:
  - DB: `p0_claims_sync_artwork_artist.sql` — claims INSERT/UPDATE 시 `artist_profile_id`가 있으면 `artworks.artist_id` 자동 반영 트리거
  - 앱: `UpdateArtworkPayload`에 `artist_id` 추가, 편집 시 외부→온보딩 전환하면 payload에 `artist_id` 포함

### B. 프로비넌스 네트워크 (4): 아티스트 프로필 + 작품별 공개 설정
- **DB**: `artworks.provenance_visible` (boolean, default true). 마이그레이션: `p0_artworks_provenance_visible.sql`
- **편집**: 작품 수정에 "프로비넌스 공개 (큐레이터·소장자 등)" 체크박스 추가, 저장 시 `provenance_visible` 반영
- **프로필**: 아티스트/퍼블릭 프로필 작품 카드에 프로비넌스 블록 표시 (curated by, collected by, secured by 등)
- **비공개**: `provenance_visible = false`이면 작가 또는 해당 작품 claim 당사자만 프로비넌스 노출 (`canViewProvenance`)
- **구현**: `ArtworkProvenanceBlock`, `canViewProvenance`, `getProvenanceClaims`; ArtworkCard에 `viewerId` 전달 시 프로비넌스 표시

### C. 클레임 요청·확정 모델 (Request → Artist Confirm/Reject)
- **플로우**: 콜렉터/큐레이터/갤러리가 "확정 요청" 생성 → 작가가 승인(confirmed) 또는 거절(삭제). 프로비넌스에는 **confirmed** 클레임만 노출.
- **DB**: `claims.status` — `'pending' | 'confirmed'`, default `'confirmed'`. 마이그레이션: `p0_claims_status_request_confirm.sql`
  - RLS: 요청자(subject)만 insert/update/delete 본인 claim; 작가만 해당 작품의 pending claim 승인/거절.
  - SELECT: 공개는 `visibility = 'public'` 이고 `status = 'confirmed'`(또는 null)인 경우만; 요청자·작가는 pending 포함 조회 가능.
- **앱**: `createClaimRequest`, `confirmClaim`, `rejectClaim`, `listPendingClaimsForWork` (src/lib/provenance/rpc.ts). 프로비넌스/편집 권한은 `getConfirmedClaims` 기반(confirmed만).

### D. 작품 상세 클레임 UI — 단일 트리거 + 드롭다운 (심플 인터페이스)
- **트리거**: 버튼 하나 — "This artwork is…" / "이 작품은…". 클릭 시 드롭다운 열림, 바깥 클릭 시 닫힘.
- **드롭다운 옵션** (선택 시 해당 타입으로 확정 요청 생성):
  1. **owned by me** / 내가 소장 중입니다 (OWNS)
  2. **curated by me** / 내가 큐레이팅 했습니다 (CURATED)
  3. **exhibited by me** / 내 전시에 참여했습니다 (EXHIBITED)
- **노출 규칙**:
  - **소장(OWNS)**: 현재 로그인한 유저가 이미 이 작품에 OWNS 클레임을 보유한 경우에만 "owned by me" 옵션 **숨김**. 다른 계정이 볼 때는 "owned by me"가 보이므로 2·3차 소장자도 요청 가능.
  - **큐레이팅/전시**: CURATED·EXHIBITED는 동일 유저가 여러 번 요청 가능(여러 전시·여러 큐레이션 기록). 옵션은 항상 표시.
- **작가 전용**: 이 작품에 대한 "대기 중인 요청" 목록 + 각 요청에 **승인** / **거절** 버튼.
- **프로비넌스 히스토리**: confirmed 클레임만 목록에 표시; 동일 큐레이터의 여러 CURATED/EXHIBITED는 각각 별도 행으로 표시(날짜로 구분).
- **i18n**: `artwork.thisArtworkIs`, `artwork.ownedByMe`, `artwork.curatedByMe`, `artwork.exhibitedByMe` (en/ko).

### E. 피드·데이터
- **피드**: 최신 primary claim만 표기, 클레임 2개 이상이면 "+N more" 표시 (`FeedArtworkCard`)
- **데이터**: claims select에 `created_at`, `status` 포함; `ArtworkClaim` 타입에 `status` 추가

### F. Hotfix: RLS 무한 재귀 + ensure_my_profile 42804 (페이지 마비 해결)
- **증상**: 피드/전체 페이지 마비, "infinite recursion detected in policy for relation artworks", 500 (artworks), 400 (ensure_my_profile).
- **원인**:
  - **500 / 42P17 / 무한 재귀**: artworks SELECT 정책이 claims를 참조하고, claims SELECT 정책이 artworks를 참조 → RLS 평가 시 순환.
  - **400 / 42804**: `ensure_my_profile` 반환 타입과 `profiles.profile_completeness`(smallint) 불일치.
- **수정**:
  - `p0_claims_rls_break_recursion.sql`: `artwork_artist_id(work_id)` SECURITY DEFINER 함수 추가. claims 정책에서 `exists (select 1 from artworks ...)` 제거 후 `public.artwork_artist_id(work_id) = auth.uid()` 사용 → artworks 테이블을 정책 안에서 직접 읽지 않아 재귀 제거.
  - `p0_ensure_my_profile_return_type.sql`: `ensure_my_profile`에서 `profile_completeness::int` 캐스팅 및 null-uid 시 빈 결과 반환 유지.

### G. 픽스 배치 (삭제 권한 · Back 링크 · 원본 보기 · 모바일 헤더)
- **삭제 권한**: 아티스트가 아닌 업로더(리스터)도 해당 작품 삭제 가능. `canDeleteArtwork(artwork, userId)` 추가(artist 또는 claim subject). RLS는 기존에 이미 허용; UI만 `canDelete` 기준으로 삭제 버튼 노출.
- **Back 링크**: 작품 상세/수정에서 "Back to feed" 대신 **진입 전 페이지**로 복귀. `setArtworkBack(pathname)` / `getArtworkBack()` (sessionStorage). ArtworkCard, FeedArtworkCard, ArtistThreadCard, 업로드 성공 시 path 저장 → 상세에서 "← Back to My profile / Feed / People / …" 표시.
- **원본 크기 보기**: 작품 상세에서 **데스크톱(768px 이상)**만 이미지 클릭 시 원본 크기 라이트박스. Escape/배경 클릭으로 닫기.
- **모바일 헤더**: 우상단·모바일 메뉴 모두 **"My Profile"** 고정 표시 (기존 "Complete your profile" 제거). 링크는 그대로 `/my` 또는 `/onboarding`.

### H. 알림 (옵션 A: 아바타 배지 + 알림 페이지)
- **UI**: 헤더 아바타에 **읽지 않은 알림 개수 배지**(빨간 원). 아바타 클릭 시 드롭다운 상단에 "알림" 링크 → `/notifications`. 모바일 메뉴에도 "알림 (N)" 링크.
- **알림 종류**: 좋아요(내 작품), 신규 팔로우, 클레임 요청(작가에게), 클레임 승인/거절(요청자에게). DB 트리거로 자동 생성.
- **페이지**: `/notifications` — 목록 진입 시 전체 읽음 처리, `notifications-read` 이벤트로 헤더 배지 갱신.
- **DB**: `p0_notifications.sql` — `notifications` 테이블, RLS, 트리거(artwork_likes, follows, claims). 기존 테이블에 `read_at` 없을 수 있으므로 `add column if not exists read_at` 포함.
- **앱**: `src/lib/supabase/notifications.ts` (getUnreadCount, listNotifications, markAllAsRead), `src/app/notifications/page.tsx`, i18n `notifications.*`.

### I. 가격 문의 (Price inquiries)
- **플로우**: "Price upon request" / 가격 비공개 작품에 대해 방문자가 **가격 문의** 가능 → 작가가 `/my/inquiries`에서 답변. 문의자·작가 모두 알림 수신.
- **DB**: `p0_price_inquiries.sql` — `price_inquiries` 테이블(artwork_id, inquirer_id, message, artist_reply, replied_at), RLS(문의자 insert/본인 조회, 작가 해당 작품 조회·답변), `notifications` type check에 `price_inquiry` / `price_inquiry_reply` 추가, 트리거(문의 생성 → 작가 알림, 답변 → 문의자 알림).
- **앱**: `src/lib/supabase/priceInquiries.ts` (create, listForArtist, getMyInquiryForArtwork, reply). 작품 상세: 가격 비공개 시 "Ask for price" 버튼·폼. `/my/inquiries`: 작가용 문의 목록·답변 UI. `/my`: "가격 문의" 카드 링크. 알림 페이지에 가격 문의/답변 문구·링크. i18n `priceInquiry.*`, `notifications.priceInquiryText` / `priceInquiryReplyText`.

### 이번 릴리즈 Supabase SQL (수동 실행)
Supabase SQL Editor에서 아래 파일들을 **순서대로** 실행:
1. `supabase/migrations/p0_claims_sync_artwork_artist.sql`
2. `supabase/migrations/p0_artworks_provenance_visible.sql`
3. `supabase/migrations/p0_claims_status_request_confirm.sql`
4. `supabase/migrations/p0_claims_rls_break_recursion.sql`  ← **페이지 마비 해결**
5. `supabase/migrations/p0_ensure_my_profile_return_type.sql`  ← **400 ensure_my_profile 해결**
6. `supabase/migrations/p0_notifications.sql`  ← **알림(옵션 A)**
7. `supabase/migrations/p0_price_inquiries.sql`  ← **가격 문의**

### 검증
- `npm run build` 통과 후 배포

### 이번 변경 반영 후 Git 명령어 (로컬에서 실행)
```bash
git pull origin main
git add -A
git status
git commit -m "feat: 픽스 배치(삭제 권한·Back 링크·원본 보기·모바일 헤더) + 알림 옵션 A"
git push origin main
```

## 2026-02-12 — P1: 온보딩/로그인 UX + 프로비넌스 표기 변경

- **로그인**: "Don't have an account?" 뒤 줄바꿈 → 회원가입 링크 다음 줄로 표시
- **프로비넌스 표기**: "Listed by X · Curated" → "curated by X" / "collected by X" / "secured by X" (INVENTORY=갤러리 인벤토리·컨사인먼트)
- `claimTypeToByPhrase()` 추가 (OWNS→collected, CURATED→curated, INVENTORY→secured)
- ArtworkCard, ArtistThreadCard 반영
- Supabase SQL: 없음 (앱/코드만 변경)
- Verified: `npm run build` 통과

## 2026-02-12 — 온보딩: 이메일·비밀번호 회원가입 (매직링크 대안)

- `/onboarding` 비로그인 시: 이메일, 비밀번호, username, display name, main role, roles 한 번에 입력 → `signUpWithPassword`로 계정 생성
- 매직링크는 유지; Supabase 정책 제한으로 초대 작가 온보딩 지연 시 하드 라우트로 바로 가입 가능
- 로그인 후 프로필 없을 때: `user_metadata`(username, display_name, main_role, roles)로 폼 프리필
- `/login`: "계정이 없으신가요? 이메일·비밀번호로 회원가입" → `/onboarding` 링크 추가
- Supabase SQL: 없음 (앱/코드만 변경)
- Verified: `npm run build` 통과

## 2026-02-17 — P0: Feed perf hotfix (thumb 폭발 억제 + image optimize)

- Feed 카드/리스트/프로필 그리드에서 `getArtworkImageUrl(..., "thumb")` 사용 (400px, quality 70)
- 작품 상세(`/artwork/[id]`)에서 `getArtworkImageUrl(..., "medium")` 사용 (1200px, quality 80)
- 아바타는 `"avatar"` variant (96px)
- next/image 적용: `unoptimized` 제거, `sizes`, `loading="lazy"`, 상단 2개만 `priority`
- next.config: `/storage/v1/render/image/public/**` remotePatterns 추가 (Supabase Image Transformations)
- Feed limit 80→50, discovery blocks 5→4
- 작품 수정 페이지(`/artwork/[id]/edit`)는 원본 이미지 사용 (변경 없음)
- Verified: `npm run build` 통과, /feed 네트워크 이미지 요청 수 감소 예상

## 2026-02-16 — P0: Profile save SSOT (single RPC) + remove PATCH /profiles + fix header flash/completeness init

- Enforced single write path: `supabase.rpc("upsert_my_profile")` for base+details+completeness (no direct PATCH/UPDATE to `profiles`)
- Removed legacy writes: no `supabase.from("profiles").update/upsert/insert` remain (read-only selects OK)
- Fixed UX: eliminated "Complete your profile" flash on refresh by gating Header on profile load
- Fixed completeness init: avoid defaulting to 0; show loading until profile hydrated
- DB migrations:
  - `p0_profile_ssot_single_rpc.sql` (upsert_my_profile security definer + grants)
  - `p0_profiles_username_autogen.sql` (auto-generate username on insert if missing)  [if applied]
- Verified:
  - Local `npm run build` passes
  - Vercel deploy passes
  - Supabase logs show no PATCH /profiles on save

## 2026-02-16 — P0: Main profile save fixed (RPC only) + username invariant enforced

- **Code**: Main profile save now uses a single function `saveMyProfileBaseRpc(payload)` in `src/lib/profile/saveProfileBase.ts`, which calls `supabase.rpc("update_my_profile_base", { p_patch, p_completeness })` and returns refreshed profile via `getMyProfile()`. No direct PATCH/UPDATE to `profiles` for main profile save.
- **Settings**: Main profile section and details section save via `saveMyProfileBaseRpc` + `saveProfileDetailsRpc` (update_my_profile_base + update_my_profile_details). Onboarding still uses `saveProfileUnified` (upsert_my_profile) to set username on first signup.
- **DB migrations**:
  - `p0_profiles_username_backfill.sql`: backfill existing rows with null username (`user_` + first 12 hex chars of id).
  - `p0_profiles_username_autogen.sql`: BEFORE INSERT trigger sets username to `user_` + first 12 hex of id when null (invariant for new rows).
- **RPC**: `update_my_profile_base` (p0_fix) is SECURITY DEFINER, does not overwrite username, uses `ensure_profile_row()` so profile row exists; returns updated row.
- **Verified**: (1) Existing account: edit main profile → Save → success, no PATCH in logs. (2) New account: profiles row exists (ensure_profile_row / trigger), edit main profile → Save → success. (3) Supabase logs: no PATCH /rest/v1/profiles for main profile save; only RPC calls.
- **Remaining**: Onboarding sets username via `upsert_my_profile` (p_base.username). Details save uses `update_my_profile_details` RPC.

## 2026-02-16 — P0: Fix TS build by aligning Profile type with DB (profile_completeness)

- **Type SSOT**: Added and exported canonical `Profile` type in `src/lib/supabase/profiles.ts` with `profile_completeness`, `profile_details`, `education`, `roles`, and all columns from `PROFILE_ME_SELECT`. Settings and other consumers import `type Profile` from profiles.
- **getMyProfile()**: Return type set to `Promise<{ data: Profile | null; error: unknown }>`. Select already included `profile_completeness` via `PROFILE_ME_SELECT`; no select change. Result cast to `Profile | null` for type safety.
- **settings/page.tsx**: Removed local `Profile` type; import `Profile` from `@/lib/supabase/profiles`. Dropped unnecessary `refreshed as Profile | null` cast; `ref` is now correctly typed from `getMyProfile()`.
- **Verified**: `npm run build` passes.

## 2026-02-16 — P0: Main profile save fixed (no PATCH; RPC-only; username NOT NULL guarded)

- **Root cause**: PATCH /rest/v1/profiles (or RPC payload) was sending `username: null`/empty → DB NOT NULL violation (23502). In `upsert_my_profile`, when `p_base` contained key `username` with value `""` or null, the RPC set `username = nullif(trim(...), '')` → null.
- **Fix summary**:
  - **RPC**: New migration `p0_profiles_username_never_null_rpc.sql` — `upsert_my_profile` now sets `username` only when `p_base` supplies a non-empty value; otherwise `username = coalesce(v_username, p.username)` so existing username is never overwritten with null.
  - **Client**: `compactPatch()` in `saveProfileBase.ts` and `profileSaveUnified.ts` strips `null`/`undefined`/`""` from payloads before RPC. Main profile save does not send `username` (whitelist excludes it in saveMyProfileBaseRpc); unified path only includes `username` when caller provides a non-empty value (e.g. onboarding).
  - **DB**: Trigger `p0_profiles_username_autogen` (BEFORE INSERT) already ensures new profile rows get a generated username when null.
- **Verification**: `npm run build` passes. Manual: login → change display_name/bio/location → Save → DB updates; no PATCH /profiles in Network tab; Supabase logs show only RPC calls.

## 2026-02-16 — P0: Unblock profile save (education NOT NULL) + payload null stripping

- **Root cause**: `profiles.education` (jsonb) was NOT NULL; main profile save sent `education:null`, causing Postgres 23502 and 400 on save.
- **DB**: Dropped NOT NULL constraint on `public.profiles.education` (`p0_profiles_education_drop_notnull.sql`) to allow empty education.
- **Client**: Hardened save payload by stripping `null`/`undefined`/`""` keys; optionally strips empty `[]` and `{}`; explicitly removes `education` when null; removes readonly fields (`id`, `username`, `profile_updated_at`, `profile_completeness`, `profile_details`) from basePatch in both `saveProfileBase.ts` and `profileSaveUnified.ts`.
- **Verified**: Profile save succeeds; no PATCH /profiles; no 23502.

## 2026-02-16 — P0: Multi-account save fix + invariant summary

- **Bug**: Save still fails for some accounts (e.g. henrykimceo) after education nullable hotfix. Possible causes: another NOT NULL column (23502), RLS/permission (42501), or stale profile.id after account switch.
- **Investigation**: Save path uses RPC only (no PostgREST PATCH /profiles). `saveMyProfileBaseRpc` → `update_my_profile_base`; `saveProfileDetailsRpc` → `update_my_profile_details`; Onboarding → `upsert_my_profile`. All RPCs use `auth.uid()` internally (ME-only), never accept user_id from client.
- **Account switching**: `AuthBootstrap` calls `router.refresh()` on SIGNED_IN / TOKEN_REFRESHED / USER_UPDATED. Settings has UID mismatch check: if `currentProfile?.id !== uid`, refetches and if still mismatch shows "Session/profile mismatch. Reloaded; try again." and `router.refresh()`.
- **Final invariant**:
  1. No PostgREST writes to `profiles` — all profile saves go through RPC (`update_my_profile_base`, `update_my_profile_details`, `upsert_my_profile`).
  2. Optional fields are nullable or defaulted — `education` NOT NULL dropped; `username` guarded by RPC coalesce + trigger; `compactPatch` strips null/undefined/"" before RPC.
  3. ME-only RPC — all RPCs use `auth.uid()`; never `PATCH /profiles?id=eq.<id>`.

## 2026-02-16 — v1.15: SSOT save hard stop (no PostgREST profiles write)

- **Full audit**: No `.from("profiles").update/upsert/insert/delete` or `fetch(/rest/v1/profiles)` in codebase. Profiles reads only (select); writes via RPC.
- **Runtime hard stop**: `src/lib/supabase/client.ts` wraps `global.fetch`; blocks any request where URL contains `/rest/v1/profiles` AND method is PATCH/POST/PUT/DELETE. Throws with message `[SSOT] Blocked: profiles write via PostgREST; use rpc("upsert_my_profile") only`. Logs `{ url, method, stack }` to console.
- **Save path**: Single RPC `upsert_my_profile` (base+details+completeness); Settings main save also uses `update_my_profile_base` + `update_my_profile_details`. All ME-only (`auth.uid()`).
- **Failure logging**: `saveMyProfileBaseRpc` and `profileSaveUnified` already log `{ message, code, details, hint }` on RPC failure.

## 2026-02-16 — P0: Profile save debug visibility + RPC/RLS hardening for remaining 400s

- **Structured error logging**: Added `ProfileSaveError` type; `saveProfileUnified` returns `{ ok: false, code, message, details, hint, step: "unified_upsert" }` instead of throwing. Console logs `{ rpc, argsKeys, code, message, details, hint }`.
- **Unified save path**: Settings now uses `saveProfileUnified` only (base + details + completeness in one RPC). Replaced `saveMyProfileBaseRpc` + `saveProfileDetailsRpc` with single `saveProfileUnified`. Onboarding and profiles.ts already used `saveProfileUnified`.
- **Error UI**: On failure, Settings shows `Save failed: <code> <message>`. DEV: DebugPanel with details/hint and Copy debug button.
- **DB hardening**: `p0_profile_bootstrap_rpc_harden.sql` — `ensure_my_profile` delegates to `ensure_profile_row` (username-safe insert); re-grants on `ensure_my_profile`, `upsert_my_profile`, `update_my_profile_base`, `update_my_profile_details` to authenticated.
- **Verified**: Save succeeds for problematic accounts; no PATCH /profiles; logs show only RPC calls.

## 2026-02-16 — P0: Fix RPC save failure 42804 (main_role enum vs text CASE mismatch)

- **Root cause**: Postgres 42804 "CASE types main_role and text cannot be matched". `profiles.main_role` is enum; RPC used `p_base->>'main_role'` (text) in CASE without casting.
- **Fix**: `p0_fix_main_role_case_cast.sql` — parse `v_main_role := nullif(trim(coalesce(p_base->>'main_role','')), '')` and set `main_role = case when v_main_role is not null then v_main_role::public.main_role else p.main_role end` so both branches return enum.
- **RPCs patched**: `upsert_my_profile`, `update_my_profile_base`.
- **Verified**: siennako can save base/details; other accounts unchanged; still no PostgREST PATCH writes.

## 2026-02-16 — Batch A: Profile Details CTA + completeness init (no more 0 on first login)

- **Settings UX**: Replaced subtle "Profile details" label with a clear CTA button: "Add profile details" (primary style) when empty; "Edit profile details" (secondary) when details exist. Button toggles accordion and scrolls into view.
- **Completeness init fix**: Removed `0` fallback while loading/unknown; render "—" until hydrated. Bar width uses 0 when loading or `profile_completeness == null`. If DB completeness is null, compute once after hydration (confidence-gated) and persist via `persistCompletenessOnly` RPC (best-effort). SessionStorage key `ab_pc_init_<uid>` prevents loops; cleared on sign-out.
- **persistCompletenessOnly**: Added to profileSaveUnified; calls `saveProfileUnified({ basePatch: {}, detailsPatch: {}, completeness })`.
- **Verified**: No 0-flash on first login; saves remain RPC-only; no PostgREST writes to `/profiles`.

## 2026-02-16 — P0: Upload provenance hotfix (Collector/Curator/Gallerist) + 페르소나 확장

- **Hotfix (DB)**: `p0_upload_provenance_hotfix.sql` — (1) `ensure_my_profile`: return empty instead of raise when `auth.uid()` null (prevents 400); (2) artworks: SELECT public/own/claim, INSERT authenticated, DELETE artist-or-lister; (3) artwork_images: INSERT when artist OR has claim (collector/curator can attach).
- **Upload flow fix**: Claim 생성 순서를 이미지 첨부 **이전**으로 변경 — RLS가 claim 기반으로 artwork_images INSERT를 허용하므로, claim을 먼저 만들어야 함. 실패 시 에러에 code 포함 표시.
- **deleteArtwork**: artist_id 필터 제거, RLS로 삭제 권한 판단 (artist 또는 lister).
- **Upload UX 확장**: Intent — Gallery inc. inventory (INVENTORY), Curated/Exhibited (CURATED) 병합. CREATED 외에는 모두 Attribution(작가 연결) 필수. Attribution 단계 렌더 조건 `intent === "OWNS"` → `needsAttribution(intent)` 수정으로 INVENTORY/CURATED 선택 시 빈 화면 버그 해결.
- **Collector 프로필**: `listPublicArtworksListedByProfileId` 추가 — claims.subject_profile_id 기반. 프로필 페이지에서 artist 작품 + lister 작품 병합 표시. ArtworkCard "Listed by"에 리스터 프로필 링크 추가.
- **Gallery label**: "Gallery (inc. inventory)".
- **페르소나 탭**: 공개 프로필 및 My 페이지에 전체 | 내 작품 | 소장품 | 갤러리 | 큐레이션/전시 탭 추가. `personaTabs.ts` 공유, claim_type 기반 필터.
- **My 페이지**: `listPublicArtworksListedByProfileId`로 리스팅 작품 병합, 탭으로 페르소나별 필터.
- **Pending**: External artist 초대(이메일/연락처로 초대 링크 발송) — 아직 미구현, 홀드. 프로젝트 연결(Curated), 벌크 업로드 페르소나 UI.
</think>

## 2026-02-16 — Batch B: Price multi-select, artwork aspect, upload redirect, reorder UX

- **Price band**: Multi-select (max 5) via TaxonomyChipSelect. DB stores `price_band` as string[] in profile_details. Backward compat: string→array when reading.
- **Artwork aspect ratio**: `object-cover` → `object-contain` on ArtworkCard, ArtistThreadCard, artwork detail page so non-square images display without cropping.
- **Upload**: After successful upload, redirect to `/u/{username}` (public profile) instead of artwork detail.
- **Reorder**: Save/Cancel buttons moved above the artwork grid (where Reorder button was).

## 2026-02-16 — My/Settings UX: completeness compact status + i18n

- **My page**: Moved Profile completeness from large top block to compact status in header (top-right, next to action buttons). Small label "Profile completeness" + icon bar + "X/100" or "—", click → /settings, hover shows hint.
- **Settings**: Edit profile details button size reduced (inline-block, py-2) to match other action buttons.
- **Settings i18n**: "Edit profile details" KO → "상세 프로필 수정".

## 2026-02-16 — Completeness: compute-only on /my, persist only on save

- **My page**: Completeness is computed from profile data on load and displayed. No DB write on /my load. Removed `persistCompletenessOnly` call and `ab_pc_init_*` sessionStorage logic.
- **Settings / Onboarding**: Completeness is computed and persisted only when user saves (via `saveProfileUnified`).
- **Display**: Treat 0 same as null — show "—" when completeness is 0 or null. Bar width 0 for empty.
- **ProfileBootstrap**: Removed `ab_pc_init_*` cleanup on sign-out (no longer used).
- **Verified**: No 0 flash on new login; DB completeness updated only on save; RPC-only.

---

## 표준 워크플로우 (Standard Workflow)

코드 변경 후 다음 순서로 진행:

1. **로컬 빌드**: `npm run build`
2. **Git 커밋 및 푸시**: `git status && git add -A && git commit -m "<메시지>" && git push origin main`
3. **HANDOFF.md 업데이트**: 변경 내용을 상단에 새 섹션으로 추가

---

## 1) Project identity
- Product: **Abstract** (art platform MVP)
- Goal: 빠르게 작품을 올리고(아카이브), 사람을 발견하고(팔로우/디렉토리), 작품을 탐색(피드)하는 최소 기능을 안정적으로 제공
- Current theme: **추천(Recommended) + 유료화 기반(Entitlements/Viewers) + 프로필/추천 데이터 강화**

## 2) Repo / Branch / Local
- GitHub repo: `G1ART/abstract-mvp`
- Branch: `main` (assumed)
- Local project folder: TODO

## 3) Production / Deploy
- Vercel Production URL: **https://abstract-mvp-5vik.vercel.app**
- Vercel project name: TODO
- Root Directory (Vercel): TODO (usually ".")

## 4) Tech stack
- Next.js (App Router)
- Supabase (Auth, Postgres, Storage, RLS, RPC)
- Vercel (deploy)
- i18n: cookie `ab_locale` + middleware defaulting

---

## 5) Current MVP capabilities (what works)

### Auth / Onboarding
- Email magic link login
- Onboarding creates/updates profile:
  - `username` required (3–20, lowercase/num/_)
  - `main_role` (single) + `roles` (multi, min 1)
- Password setup:
  - `/set-password` page via `supabase.auth.updateUser({ password })`
  - localStorage flag `has_password` (MVP enforcement)

### Navigation (v5.2)
- Header logo routes to `/feed`
- Logged-in nav order: **Feed** → **People** → **Upload** (main tabs) || **My Profile** → **EN/KR** → **Avatar menu**
- **Settings** is NOT a top-level tab; Settings and Logout live in **Avatar dropdown** (Update profile → /settings, Logout at bottom, danger)
- My Profile or "Complete profile" links to /my or /onboarding (no duplication with onboarding CTA)
- Mobile: same IA; Settings only inside avatar/account menu
- `/me` → redirect(`/my`) (legacy alias)
- `/artists` → redirect(`/people`) (legacy alias)

### Feed (Thread style)
- `/feed` shows artist-centric thread cards:
  - avatar, display_name, @username, bio(2-line), Follow button
  - mini gallery thumbnails (up to 6 artworks)
  - “View profile” link
- Tabs: All / Following
- Sort: Latest / Popular (popular uses likes_count sorting before grouping)
- Refresh + window focus refetch

### Profiles
- `/u/[username]`:
  - public profile shows: avatar, display_name, @username, bio (whitespace-pre-line for line breaks), roles, website/location (if present)
  - shows that artist’s public artworks
  - FollowButton when viewer is not self
- Private profile:
  - non-owner sees “This profile is private.”
  - owner can still view own profile (self-view exception)
- Deep-link:
  - `?mode=reorder` can enter reorder mode for owner if public works exist

### People directory (3-lane recs + Search)
- `/people`:
  - 3-lane 추천(순서 고정):
    1) From people you follow — Your followers follow these people
    2) Based on what you like
    3) A bit different, still your vibe
  - lane별 segmented control + URL sync (`?lane=follow|likes|expand`)
  - q가 있으면 Search 모드로 전환 (search_people RPC)
  - roles 멀티 필터 + Load more (initial 15, +10)
- RPC: `get_people_recs(p_mode, p_roles, p_limit, p_cursor)` (supabase/migrations/people_lanes_rpc.sql)

### Artworks
- Upload flow:
  - upload image to Supabase storage bucket `artworks`
  - create artwork record + attach artwork_images row
- Artwork detail supports likes and view events (de-dup TTL logic)
- Pricing_mode fixed/inquire, price visibility supported
- USD baseline, KRW input converts to USD using env rate (MVP)

### Likes
- `artwork_likes` table
- likes_count normalized in code to avoid postgrest shape issues
- Popular sorting based on likes_count

### My dashboard (/my)
- `/my` (primary): Profile header. **Edit profile (Settings)** primary CTA; View public profile secondary. KPI: Following, Followers, Posts. Profile completeness from `profiles.profile_completeness`. Bulk delete (multi-select). `listMyArtworks({ publicOnly: true })`.
- `/me` → redirect `/my` (legacy). `/my/followers`, `/my/following` — lists with Follow button.
- Mobile: My Profile / Complete profile appears once (no duplicate).

### Settings UX
- `/settings` save redirects to **/u/<username>**
- **Log out** button at bottom (signOut → redirect /login)
- One-time banner: "Profile updated" (sessionStorage flag)
- MigrationGuard warnings do not block UI

### v5.6 Profile Stability Gate (bootstrap + header gate)
- **ProfileBootstrap**: 앱 시작 시 `ensure_my_profile` RPC 1회 호출 — profiles row 보장
- **ensure_my_profile()**: INSERT ... ON CONFLICT (id) DO UPDATE, auth.uid() 기반
- **Header gating**: profile 로딩 중에는 "My Profile" 표시 → "Complete your profile" flash 제거
- **Save gating**: session?.user?.id 없으면 저장 차단, "Please try again" 메시지

### v5.5 Profile Save Guaranteed (UPSERT RPC)
- **Base + Details**: 둘 다 INSERT ... ON CONFLICT (id) DO UPDATE로 UPSERT
- **상황 대응**: (a) profile row 없음, (b) profiles.id 불일치, (c) RLS update 차단 → 모두 저장 성공
- **마이그레이션**: `supabase/migrations/profiles_upsert_rpc.sql` — Supabase SQL Editor에서 수동 실행
- **Backend**: profiles 단일 테이블 + profile_details jsonb + 2개 RPC

### v5.4 Profile Save Root Fix
- **Base save**: `update_my_profile_base` RPC (auth.uid() 기반, 프론트 `.from('profiles').update()` 제거)
- **Details save**: `update_my_profile_details` RPC (동일)
- **profileSave.ts**: `saveProfileBaseRpc(basePatch, completeness)`, `saveProfileDetailsRpc(detailsPatch, completeness)` — Settings/MyProfile 모두 사용
- **Build stamp**: `NEXT_PUBLIC_BUILD_STAMP` (Vercel env) → Header dropdown + Settings 상단 우측 + console.info on mount
- **Loading skeleton**: `src/app/my/loading.tsx` — My Profile 로딩 시 flash 최소화
- **Completeness sync**: RPC 반환값으로 profile_completeness 즉시 갱신; My Profile/Settings 동일 숫자 표시

### Profile details (profiles.profile_details jsonb, v5.1 / v5.2 / v5.3)
- Details in `profiles.profile_details` jsonb; **single save path**: RPC `update_my_profile_details` (merge semantics)
- `updateMyProfileDetailsViaRpc(detailsJson, completeness)` in `src/lib/supabase/profileDetails.ts`; base update does NOT touch profile_details
- Completeness sync: Settings and /my both read `profile_completeness` from DB; no local override. Save flow refreshes initial refs from DB return payload.
- **Completeness overwrite guard (v5.3)**: Never write 0 unless confidence=high. `computeProfileCompleteness()` returns `{ score, confidence }`; when confidence=low (base not loaded, details not loaded), score=null and we omit `profile_completeness`. Only return 0 if profile is truly empty. UI shows "—" when null/undefined.
- **Selectors**: `src/lib/supabase/selectors.ts` exports `PROFILE_ME_SELECT`; getMyProfile and base update use it for consistent profile_completeness + profile_details reads.
- **Save timeouts (v5.3-r1)**: base_update 10s, details_rpc 25s (avoid spurious timeouts).
- **Retry details UX**: When base saved but details failed, inline panel shows "Retry details" button; retry calls details RPC only.
- **Details payload**: compact diff (only changed keys); omit empty arrays/strings to minimize payload.
- **v5.3 Profile Save Patch**:
  - Root cause: full-payload update included problematic fields; patch update prevents invalid fields from being sent.
  - `makePatch(initial, current)` in `src/lib/profile/diffPatch.ts` returns only changed keys.
  - `updateMyProfileBasePatch(patch)` sends only changed base fields (no full payload).
  - Details saved via `updateMyProfileDetails(patch, completeness)` — merge RPC with patch only.
  - No changes Save => "No changes to save", no network/DB calls.
  - PROD: generic error messages only; DEV: Debug panel shows step, supabaseError, patch.

### Bio newlines (v5.2)
- Bio textarea preserves Enter/newlines; `normalizeBioString` trims edges only, preserves internal `\n`
- Display: `whitespace-pre-line` on profile header, people cards, feed thread cards; 2-line previews use `whitespace-pre-line line-clamp-2`

### Profile taxonomy & persona modules
- **Single source of truth**: `docs/PROFILE_TAXONOMY.md` + `src/lib/profile/taxonomy.ts`
- Profile details (Settings): Core + Artist/Collector/Curator modules (역할별 optional). Save 전 `sanitizeProfileDetails` 적용; Dev 저장 실패 시 error detail 로그.
- **Failure logging (v5.3)**: On save failure, `console.error` logs structured event; details failure: `{ event: "details_save_failed", ms, step, code, message, details, hint }` with duration. Dev DebugPanel shows step, duration (ms), RPC name+args (for details_rpc), full supabaseError.

---

## 6) Bulk Upload + Draft System (v1.12)
- Route: `/upload/bulk`
- Flow:
  1. Pending queue (pre-upload remove individual/all)
  2. Start Upload → draft 생성 + 이미지 업로드/첨부
  3. Apply-to-all metadata
  4. Publish panel (validatePublish) 통과 시 publish
  5. Publish 후 public feed 노출

- Data layer (src/lib/supabase/artworks.ts):
  - createDraftArtwork, updateArtwork, listMyDraftArtworks, publishArtworks, validatePublish

---

## 7) Delete / Cleanup (hard delete)
- `/artwork/[id]` owner-only delete (confirm → cascade → redirect `/my`)
- `/my` bulk delete: multi-select mode → Select → checkboxes → Delete selected → confirm ("Delete N posts?") → `deleteArtworksBatch(ids, { concurrency: 5 })` → refresh
- Draft delete: bulk page에서 selected/all delete
- Cascade delete:
  - storage files → artwork_images rows → artworks row
  - storage delete 실패 시 로그(Dev warn/Prod error + payload)
- Bulk delete: `deleteArtworksBatch(ids, { concurrency: 5 })` — `deleteArtworkCascade` per id with concurrency limit

- Supabase SQL scripts (manual apply):
  - `supabase/migrations/artwork_delete_rls.sql`
  - `supabase/migrations/artwork_delete_storage.sql`

---

## 8) Portfolio Reorder (v1.13)
- DB migration:
  - `artist_sort_order bigint NULL`
  - `artist_sort_updated_at timestamptz DEFAULT now()`
  - index (artist_id, artist_sort_order ASC NULLS LAST, created_at DESC)
- UI:
  - owner-only reorder mode (`@dnd-kit/*`)
  - Save/Cancel; 실패 시 retry UX 유지
- Manual step:
  - Supabase SQL Editor run `supabase/migrations/artworks_artist_sort_order.sql`

---

## 9) Supabase DB / Storage / RLS / RPC (critical)

### Tables in use
- profiles
- follows
- artworks
- artwork_images
- artwork_views
- artwork_likes
- entitlements
- profile_views

### Storage
- bucket: `artworks` (public)

### RPC (must exist)
- `public.lookup_profile_by_username(text) returns jsonb`
  - public profile => returns profile payload incl `is_public=true`
  - private profile => returns `{ "is_public": false }`
  - not found => returns null
- People:
  - `public.get_people_recs(p_mode text, p_roles text[], p_limit int, p_cursor text)` — 3-lane recs (follow_graph|likes_based|expand)
  - `public.get_recommended_people(roles text[], limit int, cursor text)` (레거시)
  - `public.search_people(q text, roles text[], limit int, cursor text)`
  - NOTE: roles 필터에서 `main_role::text` / `roles::text[]` 캐스팅 적용 완료 (operator mismatch 해결)
- Viewers:
  - `get_profile_views_count`, `get_profile_viewers` (Pro만)
- Entitlements:
  - `entitlements` table + `ensureFreeEntitlement` app-layer

---

## 10) Migration Guard (Supabase Migration Guard)
- `src/lib/supabase/migrationGuard.ts` 점검:
  - artworks.visibility='draft' 쿼리 가능 여부
  - artist_sort_order 컬럼 존재
  - profiles.profile_details 컬럼 존재
  - update_my_profile_details RPC 존재
  - update_my_profile_base RPC 존재 (v5.4)
  - policy/permission 관련 에러 감지
- `src/components/MigrationGuard.tsx`: layout 마운트, 5분 TTL 캐시
  - Dev: toast + console warn
  - Prod: console.error only
- `src/app/layout.tsx`: MigrationGuard 추가

---

## 11) Entitlements + Profile Viewers (monetization skeleton)
- entitlements: `user_id, plan, status, valid_until`
- profile_views: `profile_id, viewer_id, created_at`
- ProfileViewTracker: 프로필 조회 기록(30분 TTL, 로그인 시만)
- `/me` 인사이트 카드:
  - Free: count만 + upgrade CTA
  - Pro: 최근 viewer 리스트 + see all

---

## 12) QA Smoke
- `docs/QA_SMOKE.md` 참고:
  - Bulk pending/draft/delete/publish
  - artwork delete
  - reorder persist
  - i18n cookie
  - People 추천/검색/load more
  - viewers entitlement

---

## 13) KPI Dashboard (Investor-facing)
- `docs/KPI_DASHBOARD.md` 추가:
  - North Star(qualified connections)
  - 공급/수요(Artist/Discovery MAU)
  - 리텐션(D7/D30)
  - 추천 레인 CTR/Serendipity
  - 유료 intent(Upgrade CTA, viewer unlock)
  - Instrumentation plan(이벤트 표준)

---

## 14) Next: AI Recs v0 skeleton (planned)
목표: “OpenAI 호출을 당장 붙이지 않고”, 임베딩 테이블 + taste profile + 3 레인 UI부터 깔기.
- DB:
  - `artwork_embeddings` (pgvector)
  - `user_taste_profiles` (taste embedding + debug)
- App:
  - like 이벤트 후 taste profile best-effort 업데이트(임베딩 없으면 debug 카운터)
  - feed 레인 3개: For You / Expand / Signals (초기 룰 기반, 나중에 임베딩으로 교체)
- Guard:
  - MigrationGuard에 vector/tables 존재 체크 추가

---

## 15) Operating notes (how to ship)
- Code changes: commit/push → Vercel auto deploy
- SQL/RPC changes: Supabase SQL Editor에서 수동 실행(배포와 별개)
- Pre-deploy sanity:
  - `npm run build` (가능한 경우)
  - env vars in Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, **`NEXT_PUBLIC_APP_URL`** (초대 링크용), (선택) `SENDGRID_API_KEY`, `INVITE_FROM_EMAIL` (Prod/Preview/Dev). 상세: `docs/03_RUNBOOK.md`

---

## 16) Current issues / risks
- has_password localStorage 기반(MVP). 장기적으로 DB flag로 이동 고려.
- Popular sorting client-side. 데이터 커지면 server ranking 필요.
- People 추천은 현재 룰 기반 + fallback. 향후 AI Recs v0로 고도화 필요.
- UUID id 기반 cursor는 추천에 최적은 아님(추후 created_at + id keyset 고려).

---

## 2026-02-16 — Hotfix: main build broken in Settings (missing updateMyProfileDetails symbol)

- Fixed TS compile error in src/app/settings/page.tsx by using the correct details-save function (saveProfileDetailsRpc), replacing stale symbol `updateMyProfileDetails`.

## 2026-02-16 — Hotfix: ProfileBootstrap build fix

- Fixed TS build error in ProfileBootstrap by removing .catch() on PromiseLike and using async IIFE with try/catch (fire-and-forget).

## 2026-02-16 — Hotfix: diffPatch TS build fix

- Fixed TS error in makePatch by stringifying keyof before indexing Record<string, unknown>.

## 2026-02-16 — Emergency: restore deploy without PR (PR creation suspended)

- GitHub account blocked from opening PRs, so we pushed build-fix commits directly to main.
- Fixed Settings stale symbol reference, ProfileBootstrap PromiseLike catch, and diffPatch keyof indexing TS error.
- Next step after deploy: address profile save + completeness/flash issues (functional).

## 2026-02-16 — P0: Profile details SSOT stabilized

- Enforced single SSOT for profile details: `profiles.profile_details` (jsonb).
- Removed/ignored any legacy `profile_details` table reads/writes in app layer.
- Settings/My/Header now read via `getMyProfile()` + `PROFILE_ME_SELECT` consistently.
- Save flow: treat RPC success as success, then re-fetch profile once to prevent false failure UI.
- Header: tri-state gating prevents "Complete your profile" flash during profile load.

## 2026-02-16 — P0: main-only hotfix for profile save failures

- Stopped branch/PR workflow due to PR creation suspension.
- Added explicit auth session guard + real error logging in Settings save handler to diagnose and prevent auth.uid() null RPC failures.

## 2026-02-16 — P0: Profile save unblocked (RLS + SSOT alignment)

- Confirmed Settings reads from legacy `public.profile_details` table; aligned details save path to the same SSOT.
- Added RLS policies for `profiles` and `profile_details` to allow authenticated users to select/insert/update own rows.
- Marked key RPCs as SECURITY DEFINER (best-effort) and granted execute/CRUD to authenticated to prevent silent write blocks.
- Removed confusing "local" badge fallback when NEXT_PUBLIC_BUILD_STAMP is not set.

## 2026-02-16 — P0: unified profile save to upsert_my_profile

- Unified profile save to single RPC (upsert_my_profile) to avoid PostgREST 42702/42804 from legacy update_my_profile_base / update_my_profile_details.

### 2026-02-16 — P0: Main profile save unblocked (RPC-only; prevent username null overwrite)

- Root cause: Settings main profile save used `PATCH /rest/v1/profiles`, sending `username: null/undefined`, violating NOT NULL (23502).
- Fix: Removed direct `profiles` PATCH path; main profile save now calls `rpc('update_my_profile_base')` with a whitelist patch payload (no username/id/readonly fields).
- Result: Main profile saves succeed; details saves remain RPC-based; UI refresh via `getMyProfile()` after save.

### 2026-02-16 — P0: Cross-user save bug fixed (uid guard + auth bootstrap; ME-only RPC saves)

- Root cause: After account switch, Settings save used stale profile.id and issued PATCH `/rest/v1/profiles?id=eq.<old-uid>`, causing writes to wrong row and NOT NULL username failures (23502).
- Fix: Main/details saves are ME-only RPC calls (auth.uid on DB). Added `requireSessionUid()` and uid mismatch guard. Added AuthBootstrap `onAuthStateChange` to clear profile caches and `router.refresh()` on SIGNED_IN/SIGNED_OUT.
- Result: User A/B switching no longer leaks old uid; both main and details saves succeed.

---

## 17) Immediate next steps (recommended)
P0:
1) AI Recs v0 skeleton 구현(임베딩 테이블 + taste profile + 3 레인 UI)
2) KPI instrumentation events 최소 세트 정의/로깅(주간 집계 가능 형태)
3) Profile v0 fields + completeness + 추천 reason 강화(진행 중/다음 스프린트로)

P1:
- Embedding batch job(서버리스/크론) 연결
- Serendipity/diversify 로직 정교화
- 결제/플랜 연동(Stripe) 및 entitlement enforcement 강화
