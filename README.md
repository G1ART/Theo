# Theo MVP

Next.js and Supabase app: artist-centric feed, uploads, exhibitions, price inquiries, and lightweight beta analytics.

## Prerequisites

- Node.js 20+
- Supabase project with migrations applied (see `docs/HANDOFF.md` and `supabase/migrations/`)

## Setup

```bash
cp .env.example .env.local
```

Set at least `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_APP_URL` (for local dev use `http://localhost:3000`).

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Scripts

- `npm run dev` — development server
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run test:e2e` — Playwright (`e2e/smoke.spec.ts`); optional `PLAYWRIGHT_BASE_URL`, or `PLAYWRIGHT_START_SERVER=1` to boot dev

## Beta operations

- **Library:** `/my/library` — manage artworks with filters and cursor pagination.
- **Inquiries:** `/my/inquiries` — threaded inbox; notifications are not all marked read on visit.
- **Diagnostics:** `/my/diagnostics` — available in development, or when `NEXT_PUBLIC_DIAGNOSTICS=1` (requires `beta_analytics_events` from SQL migration).

## Documentation

- `docs/HANDOFF.md` — handoff and SQL order
- `docs/03_RUNBOOK.md` — deploy and environment variables
- `docs/QA_SMOKE.md` — smoke checklist
