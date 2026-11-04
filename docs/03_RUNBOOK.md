# Abstract — Runbook (How to operate / deploy / recover)

## Local setup (quick)
1) Install deps
- npm install

2) Env
- cp .env.example .env.local
- Fill:
  - NEXT_PUBLIC_SUPABASE_URL
  - NEXT_PUBLIC_SUPABASE_ANON_KEY
  - NEXT_PUBLIC_APP_URL (로컬: `http://localhost:3000`; 배포 시 Vercel에서 프로덕션 URL로 설정)
  - (optional) NEXT_PUBLIC_KRW_TO_USD_RATE
  - (optional) `NEXT_PUBLIC_DIAGNOSTICS=1` — enables `/my/diagnostics` in production (otherwise dev-only). Uses `beta_analytics_events` (apply `p0_beta_hardening_wave1.sql`).
  - `NEXT_PUBLIC_SIGNUP_V2` — Signup v2 wizard feature flag (2026-08-20). 초기값 `false`. `true` 로 두면 `/signup` 신규 마법사 + 리디자인된 로그인 화면이 노출된다. Phase 6 롤아웃 시 10% → 100% 램프 예정. 상세는 `docs/SIGNUP_REDESIGN_SPEC.md` §6/§11.
  - 초대 메일 사용 시: SENDGRID_API_KEY, INVITE_FROM_EMAIL
  - AI: `OPENAI_API_KEY` (서버 전용). `OPENAI_MODEL` 은 비워 두면 코드 기본값 `gpt-6.1-sol`. `gpt-4o` / `gpt-4o-mini` / `gpt-4.1-mini` / `gpt-4.1-nano` / `gpt-6-astra` / `gpt-5.6-sol` / `gpt-5.6` 로 박혀 있으면 코드가 무시하고 `gpt-6.1-sol` 을 쓴다. 그 목록에 없는 다른 모델 ID가 들어 있으면 그 값이 이긴다. `AI_USER_DAILY_SOFT_CAP` 은 읽지 않는다. 계정당 하루 30회 한도는 없다.
  - (optional) `PHOTOROOM_API_KEY` — Theo Image Enhance (Beta) 의 "Object" 파이프라인 + Display Simulation Phase 2 의 Track 2 (`/api/ai/artwork-cutout-alpha`, 투명 PNG cutout). 서버 전용 (NEXT_PUBLIC_ prefix 붙이지 말 것). 미설정 시 Object 모드는 `provider_unauthorized` fallback 을 반환하고, Track 2 cutout 라우트는 501 을 반환한다. Track 1 (무료 Vision bbox 크롭) 은 영향 없음.
  - `NEXT_PUBLIC_PHOTOROOM_ENABLED` — Space Editor 의 "고급 배경 분리 (Pro)" 버튼 노출 여부. 초기값 `false` (버튼 완전히 숨김). `PHOTOROOM_API_KEY` 를 서버에 설정한 다음에만 `true` 로 뒤집는다. false 인데 true 로 두면 UI 는 뜨지만 클릭 시 501 토스트만 뜨므로 사용자가 "기능 고장" 으로 오인함. 두 환경변수는 항상 함께 뒤집는다.
  - Theo Board 발행 시: `THEO_BOARD_PUBLISH_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` (서버 전용). 발행: `THEO_BOARD_PUBLISH_TOKEN=... npm run publish:theo -- --title "..." --type announcement`
  - **IR demo room (Preview 전용, Production에 넣지 말 것):** `NEXT_PUBLIC_IR_DEMO=true`, `IR_DEMO_SECRET` (쿠키 서명, 입장 암호 아님), `IR_DEMO_PASSWORD`, `IR_DEMO_ASSET_ORIGIN` (프로덕션 Storage origin). Preview의 `NEXT_PUBLIC_SUPABASE_URL` / `ANON` / `SUPABASE_SERVICE_ROLE_KEY` 는 **클론 프로젝트** 값이어야 한다. `SENDGRID_API_KEY` 는 데모에 넣지 않는다. 공개 호스트: `demo.withtheo.art` (git branch `ir-demo`). Porkbun에 `demo` CNAME → `cname.vercel-dns.com` (또는 Vercel이 준 `*.vercel-dns-016.com`). 페르소나 시드: `IR_DEMO_SUPABASE_URL` + `IR_DEMO_SERVICE_ROLE_KEY` + `IR_DEMO_PASSWORD` 로 `npm run seed:ir-demo` (프로덕션 ref `sgufonscldvdwfgzltfw` 거부). 상세는 `docs/HANDOFF.md`.

3) Run
- npm run dev
- open http://localhost:3000

## Supabase essentials
### Required tables (current)
- profiles
- follows
- artworks
- artwork_images
- artwork_views
- artwork_likes

### Storage
- bucket: artworks (public)

### RLS approach (high level)
- profiles: SELECT is_public = true OR auth.uid() = id
- follows/artworks/artwork_images/artwork_views/artwork_likes: scoped policies with auth.uid() checks
- Private profile lookup: use security definer RPC returning limited data

### RPC required
- lookup_profile_by_username(p_username text) → jsonb
  - returns minimal fields for public profiles
  - returns {is_public:false} only for private

## Deploy (Vercel)
### One-time
1) Create Vercel project connected to GitHub repo
2) Set Environment Variables in Vercel (Production at minimum):
- **NEXT_PUBLIC_SUPABASE_URL**
- **NEXT_PUBLIC_SUPABASE_ANON_KEY**
- **NEXT_PUBLIC_APP_URL** — 앱 공개 URL (예: `https://withtheo.art`). 위임/초대 이메일 링크와 OAuth가 돌아온 뒤의 주소의 base. 없으면 초대 링크가 잘못된 주소로 갈 수 있음.
- Google / Apple 로그인용 클라이언트 ID와 시크릿은 Vercel 환경 변수가 아니다. Supabase Dashboard → Authentication → Providers 에만 둔다. The Green Calendar 클라이언트는 넣지 않는다. 절차는 아래 "Supabase OAuth setup".
- (optional) NEXT_PUBLIC_KRW_TO_USD_RATE
- (optional) **NEXT_PUBLIC_DIAGNOSTICS** — `1`이면 `/my/diagnostics` 노출(베타 이벤트 테이블 필요)
- **NEXT_PUBLIC_SIGNUP_V2** — Signup v2 wizard 피처 플래그 (2026-08-20 도입). 초기 배포는 `false` 로 세팅 (레거시 `/onboarding` + `/login` 유지). Phase 1 QA 이후 `true` 로 램프. Preview 환경에서 먼저 `true` 로 두고 내부 검증하는 것을 권장. 상세: `docs/SIGNUP_REDESIGN_SPEC.md` §6/§11.
- **OPENAI_API_KEY** — 서버 전용. 텍스트 코파일럿과 비전(작품 영역, 품질 게이트, 벽 감지, CV)이 이 키로 `gpt-6.1-sol` 을 호출한다.
- **OPENAI_MODEL** — 비워 두는 것을 권장 (코드 기본값 `gpt-6.1-sol`). `gpt-4o`, `gpt-4o-mini`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6` 은 코드가 무시하고 `gpt-6.1-sol` 을 쓴다. Vercel에 `gpt-5.6-sol`이 남아 있어도 지울 필요는 없다. 그 목록에 없는 다른 모델 ID가 들어 있으면 그 값이 이긴다.
- **AI_USER_DAILY_SOFT_CAP** — 읽지 않는다. 예전에 계정당 UTC 하루 30회 초안 한도였다. 설정이 남아 있어도 호출을 막지 않으며, 새로 넣을 필요는 없다.

  **IR demo room — Production Environment 에는 절대 넣지 말 것** (넣으면 라이브 사이트가 `/ir` 뒤로 잠김):
- **NEXT_PUBLIC_IR_DEMO** — git branch `ir-demo` Preview에서만 `true`. 공개 호스트 `demo.withtheo.art`.
- **IR_DEMO_SECRET** — `theo_ir` 쿠키 서명 (서버 전용). 입장 화면 암호가 아님.
- **IR_DEMO_PASSWORD** — 세 페르소나 공통 비밀번호 (서버 전용, 시드 스크립트와 동일)
- **IR_DEMO_ASSET_ORIGIN** — 프로덕션 Storage origin `https://sgufonscldvdwfgzltfw.supabase.co` (읽기 전용 폴백)
- Preview의 **NEXT_PUBLIC_SUPABASE_URL** / **NEXT_PUBLIC_SUPABASE_ANON_KEY** / **SUPABASE_SERVICE_ROLE_KEY** 는 클론 브랜치 값. `SENDGRID_API_KEY` 는 데모 Preview에 넣지 않음.

  초대 메일(위임·아티스트 초대)을 쓰는 경우 추가:
- **SENDGRID_API_KEY**
- **INVITE_FROM_EMAIL** (예: `Theo <noreply@withtheo.art>`)

  Theo Image Enhance (Beta, 2026-08-05) — "Object" 파이프라인 사용 시:
- **PHOTOROOM_API_KEY** — [Photoroom SDK](https://sdk.photoroom.com) 의 세그멘테이션 API 키. 서버 전용(Server-side Only). `NEXT_PUBLIC_` prefix 붙이면 안 된다. 두 곳에서 사용된다: (1) Theo Image Enhance (Beta) Object 파이프라인, (2) Display Simulation Phase 2 — Track 2 (`/api/ai/artwork-cutout-alpha`) 로 시뮬레이션용 투명 PNG cutout 을 생성. 미설정 시 (1) Object 모드는 `provider_unauthorized` fallback 을 반환하고 flat 파이프라인만 동작, (2) Track 2 cutout 라우트는 HTTP 501 로 응답한다 (Track 1 무료 Vision bbox 크롭은 계속 작동).
- **NEXT_PUBLIC_PHOTOROOM_ENABLED** (public) — Space Editor 의 "고급 배경 분리 (Pro)" 버튼 노출 스위치. 기본 `false` (미노출). `PHOTOROOM_API_KEY` 를 실제로 서버에 세팅한 뒤에만 `true` 로 뒤집는다. `true` 인데 서버 키가 없으면 사용자는 501 토스트만 계속 보게 되므로 두 값을 함께 관리한다.

  Theo Board (2026-08-13) — 발행 API / CLI. **둘 다 서버 전용** (`NEXT_PUBLIC_` 붙이지 말 것):
- **THEO_BOARD_PUBLISH_TOKEN** — CLI(및 향후 Slack)가 `POST /api/theo-board/*` 에 보내는 Bearer 시크릿. 긴 랜덤 문자열.
- **SUPABASE_SERVICE_ROLE_KEY** — 보드 글 INSERT/숨김/핀. RLS를 우회한다. 브라우저·`NEXT_PUBLIC_` 금지.
- 발행 한 줄: `THEO_BOARD_PUBLISH_TOKEN=... npm run publish:theo -- --title "..." --type announcement` (로컬은 `.env.local` 또는 export. 앱이 떠 있어야 함. SQL 미적용 시 insert는 실패하고 rail은 placeholder 유지.)

3) Root Directory
- Must be folder containing package.json for Next.js app (usually ".")

### Each deploy
1) Ensure local build passes
- npm run build
- npx tsc --noEmit

2) Commit & push
- git add -A
- git commit -m "release: vX.Y.Z"
- git push

3) Vercel will auto build
- If build fails, use “Redeploy without cache / Clear cache” when needed

## Supabase OAuth setup (Google + Apple — Signup v2 Phase 3, 2026-08-19)

Signup v2 의 Quick Start pill (`/login` 리디자인 + `/signup` Step 1) 은
`signInWithOAuthProvider("google" | "apple")` 로 Supabase Auth 의 OAuth
플로우를 태운다. **모든 client id / secret / redirect URL 은 Supabase
Dashboard 에서만 관리한다** — 앱 코드에는 secret 이 없다 (`NEXT_PUBLIC_*`
prefix 도 붙지 않는다). 코드는 provider 미설정 상태에서도 안전하게
토스트 fallback 을 낸다 ("이 로그인 방식은 아직 준비 중입니다. 이메일로
로그인해 주세요."), 그래서 아래 세팅은 **여유 있게, 배포와 상관없이
언제든** 진행하면 된다.

Kakao 는 spec §5 #5 로 deferred — pill 이 항상 disabled 이므로
Dashboard 에서 켜지 말 것 (지금 켜도 앱에서 클릭 안 됨).

### 1) Google 세팅

2026-11-02 프로덕션은 Supabase 프로젝트 `sgufonscldvdwfgzltfw` 의 Google
제공자로 가입한다. 코드에는 클라이언트 ID가 없다. 그 제공자가 지금
보내는 클라이언트는 구글 프로젝트 번호 `827860082883`, 동의 화면 이름
**The Green Calendar**, 공개 support email `thegreencalendar@g-1.art`,
사용자 유형 **Internal** 이다. 일반 Gmail 은
구글 화면에서 `403 org_internal` 로 막힌다. 이 클라이언트는 Theo 가입에서
뺀다. 캘린더 scope 는 가입 요청에 없다. 가입 scope 는 `email`, `profile`,
`openid` 만이다.

Supabase 가 Google 제공자 칸에 적어 둔 scope 를 요청 앞에 붙인다. 앱이
그 뒤를 `openid email profile` 로 잇는다. 칸에 `calendar` 가 있으면
가입이 캘린더 권한까지 묻게 되므로 비우거나 `email profile` 만 둔다.

1. Google Cloud Console 에서 프로젝트 번호 `827860082883`
   (The Green Calendar) 을 연다. 이 프로젝트의 OAuth 클라이언트는
   Theo 에 쓰지 않는다.
2. Theo 용 프로젝트를 새로 만들거나, 이미 **External** 인 Theo 프로젝트가
   있으면 그것을 쓴다. 저장소와 Vercel 에는 Theo 용 클라이언트 ID가 없다.
   Audience / OAuth consent screen 이 Internal 에서 External 로 바뀌지
   않으면, 그 워크스페이스 안에 새 클라이언트를 만들지 말고 프로젝트를
   새로 만든다.
3. **OAuth consent screen** (새 콘솔에서는 Google Auth Platform →
   Audience / Branding):
   - User type: **External**.
   - 앱 이름: Theo. The Green Calendar 를 쓰지 않는다.
   - Support email, 로고, 승인된 도메인 `withtheo.art`.
   - Privacy / Terms: `https://withtheo.art/legal/privacy`,
     `https://withtheo.art/legal/terms`.
   - Scopes: `openid`, `email`, `profile`,
     `.../auth/userinfo.email`, `.../auth/userinfo.profile` 만.
     Calendar API 와 `calendar.readonly` 는 넣지 않는다.
   - Publishing status 가 Testing 이면 Test users 에 베타 Gmail 을
     넣거나, **In production** 으로 게시한다. email/profile/openid 는
     민감 scope 가 아니라서 긴 심사 없이 게시되는 경우가 많다.
     Internal 로 두면 그 조직 밖 Gmail 은 계속 403 이다.
4. **Credentials** → OAuth client ID → Web application.
   - Authorized JavaScript origins: `https://withtheo.art`,
     `http://localhost:3000`.
   - Authorized redirect URIs:
     `https://sgufonscldvdwfgzltfw.supabase.co/auth/v1/callback`
     만. 앱의 `/auth/callback` 은 구글 redirect URI 가 아니다.
     구글이 Supabase 로 돌려보내고, Supabase 가
     `/auth/callback?provider=google&from=…&next=…` 로 넘긴다.
5. Supabase Dashboard → Authentication → Providers → **Google** → Enable.
   - Client ID / Client Secret 을 방금 만든 Theo External 클라이언트로
     바꾼다. The Green Calendar 값은 지운다.
   - Scopes 는 비우거나 `email profile` 만.
   - Skip nonce check 는 off.
6. Supabase → Authentication → URL Configuration.
   - Site URL: `https://withtheo.art` (`NEXT_PUBLIC_APP_URL` 과 같게).
   - Redirect URLs: `https://withtheo.art/auth/callback`,
     `http://localhost:3000/auth/callback`.
7. Vercel 에 Google 클라이언트 변수를 추가하지 않는다.
8. 일반 Gmail 로 `/login` 또는 `/signup` 의 Google 을 누른다. 동의 화면에
   Theo 가 보여야 한다. The Green Calendar / 조직 내부라고 나오면
   Supabase Google 제공자에 그 클라이언트가 아직 남아 있는 것이다.
   가입이 끝나면 그 Gmail 이 이미 초대 메일이면 작품·크레딧이 그 계정에
   붙는다. 비밀번호 가입은 활성화 메일을 연 뒤에 붙는다.

### 2) Apple 세팅
1. Apple Developer → Certificates, Identifiers & Profiles → **Identifiers** → **App IDs** 에서 Sign in with Apple capability 를 활성화한 App ID 가 없으면 새로 만든다. 이미 있으면 재사용.
2. **Services IDs** 를 새로 만든다 (e.g. `com.<company>.web.signin`). Sign in with Apple 을 켜고 "Configure":
   - **Primary App ID**: 위 App ID.
   - **Domains and Subdomains**: `<Supabase project>.supabase.co` (Supabase 카드가 표시).
   - **Return URLs**: `https://<Supabase project>.supabase.co/auth/v1/callback`.
3. **Keys** → 새 Key → Sign in with Apple 활성화 → 키 다운로드 (`.p8` 파일). Key ID 와 Team ID 를 메모.
4. Supabase Dashboard → Authentication → Providers → **Apple** → toggle Enable.
   - **Services ID**: 위 Services ID 값 (`com.<company>.web.signin`).
   - **Team ID**: Apple Developer 계정의 팀 ID.
   - **Key ID**: 위 Key ID.
   - **Private key**: `.p8` 파일 내용 전체 (`-----BEGIN PRIVATE KEY-----` 포함) 를 그대로 붙여넣기.
   - Save.
5. 첫 로그인 검증: 위 Google 케이스와 동일하게 `/login` → "Apple" pill 로 1회 검증.

### 3) 앱 쪽 필요 세팅 — 이미 되어 있음
- **Redirect URLs allowlist** (Supabase Dashboard → Authentication → URL Configuration → Redirect URLs) 에 `https://<운영 도메인>/auth/callback` 이 이미 등록되어 있어야 함 (아래 "Supabase Auth redirect URLs" 섹션 참고). OAuth flow 도 이 콜백을 쓴다.
- `NEXT_PUBLIC_APP_URL` 이 실제 배포 도메인과 일치해야 helper 가 리다이렉트 URL 을 올바르게 조립한다 (아래 "Set Environment Variables in Vercel" 참고).

### 4) 관측 / 문제 해결
- 클릭했을 때 아무 반응 없이 토스트 "이 로그인 방식은 아직 준비 중입니다..." 가 뜨면 → Supabase Dashboard 에서 provider 가 아직 Enabled 가 아니거나 client id/secret 저장이 안 된 상태. Dashboard 재확인.
- 구글 화면이 "조직 내에서만 사용할 수 있습니다" / `403 org_internal` 이고 앱 이름이 The Green Calendar 이면, Supabase Google 제공자가 Internal 클라이언트다. 위 1) 대로 Theo External 클라이언트로 바꾼다. 코드로 우회하지 않는다. 브라우저 뒤로 가면 가입 화면에 "이 Google 계정으로는 가입할 수 없어요. 이메일로 계속해 주세요." 가 나온다.
- Google 콘센트 화면에서 "This app is blocked" (access_denied, Testing) → OAuth consent screen 이 Testing 이고 사용자가 test user 가 아니다. Test users 에 이메일을 넣거나 In production 으로 게시한다.
- Apple 이 로그인 창을 띄우다가 "invalid_client" 로 실패 → Services ID / Team ID / Key ID / Private key 중 하나가 어긋남. 특히 Private key 는 `-----BEGIN PRIVATE KEY-----` 헤더/푸터 라인까지 포함되어야 함.
- `/auth/callback` 이후 무한 스피너 → 브라우저 콘솔에서 `get_my_auth_state` RPC 응답 확인. Signup v2 마이그레이션 (`20260819180000_upsert_my_profile_signup_v2.sql`) 이 적용되지 않은 상태일 수 있음.

## Supabase Auth redirect URLs
Supabase Dashboard → Authentication → URL Configuration

**Site URL** (한 개 — 사용자에게 발송되는 모든 Auth 메일의 base 가 됨):
- 운영 도메인 그 자체 (예: `https://your-domain.com` 또는 `https://abstract-mvp-dxfn.vercel.app`)
- 이 값이 비어 있거나 잘못되어 있으면 비밀번호 재설정/매직 링크가
  엉뚱한 도메인 (예: `vercel.com`) 으로 라우팅된다. (QA 2026-06-26 #3)
- Vercel 의 `NEXT_PUBLIC_APP_URL` 과 항상 일치해야 한다.

**Redirect URLs (allowlist)** — Auth 메일 링크가 도착할 모든 콜백:
- `https://<운영 도메인>/auth/callback`
- `https://<운영 도메인>/auth/reset`
- `https://<운영 도메인>/set-password`
- `http://localhost:3000/auth/callback` (로컬 개발용)
- `http://localhost:3000/auth/reset` (로컬 개발용)

새 도메인을 붙일 때 체크리스트:
1) Vercel 의 `NEXT_PUBLIC_APP_URL` 갱신 → Redeploy.
2) Supabase Site URL 을 같은 값으로 갱신.
3) Redirect URLs 에 위 3 개 콜백을 새 도메인으로 추가 (옛 도메인은
   하위 호환을 위해 일시적으로 유지 가능).
4) `/auth/forgot` 에서 본인에게 메일 발송 → 링크가 운영 도메인의
   `/auth/reset?…` 로 떨어지는지 1 회 검증.

## Common failure modes & fixes
### 1) “supabaseUrl is required” during Vercel build
Cause:
- Vercel env vars not set or not applied to Production, or wrong Root Directory
Fix:
- Check Vercel Settings → Environment Variables (Production)
- Redeploy (clear cache)
- Verify Root Directory points to correct Next app

### 2) Next.js build error: useSearchParams must be wrapped in Suspense
Fix:
- Move useSearchParams into client component and wrap with <Suspense> in page.tsx

### 3) Supabase email rate limit exceeded
Fix:
- Use different email temporarily for testing
- For real beta: configure SMTP provider (Resend/SendGrid/etc.)

### 4) RLS blocks public/private distinction
Fix:
- Keep profiles SELECT policy: is_public = true OR auth.uid() = id
- Use RPC for safe “exists but private” feedback

## Rollback (Vercel)
- Vercel → Deployments → pick last good deployment → “Promote” (or redeploy)
- Keep git tags for releases: vX.Y.Z

Supabase RPC 관련 섹션을 조금 더 명확히:
lookup_profile_by_username는 “public이면 확장 필드 포함, private면 is_public:false만 반환”
“함수 변경 시 create or replace가 안 되면 drop 후 create”
그리고 배포 전 체크리스트에 한 줄 추가:
“SQL 변경이 있으면 Supabase SQL Editor에서 적용했는지 확인(배포와 별개)”

