# Oregano

Oregano is one food-ordering platform for a whole town, starting in Chapainawabganj, Bangladesh, and growing to all of Bangladesh. It has four surfaces: the customer app (website, Android, iOS), the restaurant app, the rider app, and the admin dashboard. The sources of truth are the product book `Oregano-Product-and-Brand-Book.pdf` (what the product does) and the blueprint `docs/blueprint/2026-11-16-oregano-blueprint.md` (how it is built). Read both before planning work.

## Commands

Prerequisites: Node 24, pnpm (via corepack), Docker.

```bash
pnpm install          # install everything
pnpm db:up            # start local PostgreSQL (PostGIS) and Redis in Docker
pnpm db:migrate       # apply migrations to the local database
pnpm db:seed          # seed the Chapainawabganj zone
pnpm verify           # the completion gate: lint, typecheck, tests, web build, browser tests
pnpm format           # apply Biome formatting
pnpm --filter @oregano/domain test   # one package's tests
```

API tests use a real database (`oregano_test`), created automatically by `infra/postgres-init` the first time `pnpm db:up` runs.

## Layout

```
apps/api/         Fastify backend: config, health checks, database, zones
apps/customer/    Expo app (web, Android, iOS); screens in src/app/
packages/domain/  Pure business rules: money, order state machine
packages/i18n/    English and Bangla messages, money formatting
packages/ui/      Brand tokens and contrast checks
infra/            docker-compose for local services
docs/             Blueprint, measurements, roadmap and plans
Oregano-Logo-Kit/ Official logo artwork: always use these files
```

## Rules

- TypeScript strict everywhere, with `noUncheckedIndexedAccess`. No `any`, no `@ts-ignore`.
- Read a library's current official documentation before installing or using it. Expo changes every SDK; do not trust remembered APIs.
- Packages are named `@oregano/<name>`.
- Money is an integer number of poisha (1 Tk = 100 poisha), typed `Money` from `@oregano/domain`. Never a float or a string.
- Percentages of money round half up to the nearest whole taka.
- Prices display as `Tk 280` in English and `৳২৮০` in Bangla. Use `formatMoney` from `@oregano/i18n`.
- Every user-facing string exists in English and Bangla. UI copy is sentence case.
- Colours, fonts, sizes and radii come from `@oregano/ui`; no literal hex values or pixel sizes in screens. Text colours only from `textPairs`.
- Never retype the logo in a font. Use the files in `Oregano-Logo-Kit/`.
- Write the failing test first. Database tests run against real PostgreSQL, never a mock.
- Order status changes only through `transition()` in `@oregano/domain`.
- A task is done only when `pnpm verify` passes.

## Plans

The roadmap is `docs/superpowers/plans/2026-11-16-oregano-roadmap.md`. Each plan is written with the writing-plans skill just before it is executed, because it depends on what the previous plan produced. Execution progress for a plan is tracked in `.superpowers/sdd/<plan>/progress.md` (git-ignored).
