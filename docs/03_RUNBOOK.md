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
  - 초대 메일 사용 시: SENDGRID_API_KEY, INVITE_FROM_EMAIL
  - (optional) `PHOTOROOM_API_KEY` — Theo Image Enhance (Beta) 의 "Object" 파이프라인. 서버 전용 (NEXT_PUBLIC_ prefix 붙이지 말 것). 미설정 시 Object 모드는 `provider_unauthorized` fallback 을 반환하고 로컬 flat 파이프라인만 동작한다.
  - Theo Board 발행 시: `THEO_BOARD_PUBLISH_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` (서버 전용). 발행: `THEO_BOARD_PUBLISH_TOKEN=... npm run publish:theo -- --title "..." --type announcement`

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
- **NEXT_PUBLIC_APP_URL** — 앱 공개 URL (예: `https://abstract-mvp-dxfn.vercel.app`). 위임/초대 이메일 링크의 base로 사용. 없으면 초대 링크가 잘못된 주소로 갈 수 있음.
- (optional) NEXT_PUBLIC_KRW_TO_USD_RATE
- (optional) **NEXT_PUBLIC_DIAGNOSTICS** — `1`이면 `/my/diagnostics` 노출(베타 이벤트 테이블 필요)

  초대 메일(위임·아티스트 초대)을 쓰는 경우 추가:
- **SENDGRID_API_KEY**
- **INVITE_FROM_EMAIL** (예: `Abstract <noreply@your-domain.com>`)

  Theo Image Enhance (Beta, 2026-08-05) — "Object" 파이프라인 사용 시:
- **PHOTOROOM_API_KEY** — [Photoroom SDK](https://sdk.photoroom.com) 의 세그멘테이션 API 키. 서버 전용(Server-side Only). `NEXT_PUBLIC_` prefix 붙이면 안 된다. 없으면 Object 모드가 `provider_unauthorized` fallback 을 반환하고 flat(평면 작품) 파이프라인만 동작한다.

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

