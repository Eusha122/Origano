# Oregano

Oregano is one food-ordering platform for a whole town, starting in Chapainawabganj, Bangladesh, and growing to all of Bangladesh. It has four surfaces: the customer app (website, Android, iOS), the restaurant app, the rider app, and the admin dashboard. The sources of truth are the product book `Oregano-Product-and-Brand-Book.pdf` (what the product does) and the blueprint `docs/blueprint/2026-11-16-oregano-blueprint.md` (how it is built). Read both before planning work.

## Commands

Prerequisites: Node 24, pnpm (via corepack), Docker.

```bash
pnpm install          # install everything
pnpm db:up            # start local PostgreSQL (PostGIS), Redis and S3-compatible storage (SeaweedFS, port 9000) in Docker
pnpm db:migrate       # apply migrations to the local database
pnpm db:seed          # seed the Chapainawabganj zone (safe on any database)
pnpm db:seed:demo     # add the demo restaurant and users (only on `oregano` or a `*_test` database, never in production)
pnpm --filter @oregano/api team -- grant|revoke|list ... --operator "<name>"   # team roles: only an operator changes them, and it is audited
pnpm --filter @oregano/api otp -- unlock <phone> --operator "<name>"          # clears an OTP lock, audited
pnpm verify           # the completion gate: lint, typecheck, tests, web build, browser tests
pnpm format           # apply Biome formatting
pnpm --filter @oregano/domain test   # one package's tests
pnpm test:e2e         # browser tests only, including the first-order journey (needs pnpm db:up)
```

API tests use a real database (`oregano_test`), created automatically by `infra/postgres-init` the first time `pnpm db:up` runs, and the real S3 server (bucket `oregano-test`, created on first use). MinIO's community image is no longer published, so storage is SeaweedFS (`chrislusf/seaweedfs`, pinned in `infra/docker-compose.yml` and `ci.yml`).

Settings the API reads (see `apps/api/.env.example`): `DATA_KEYS` (required: `kid:base64key`, each key 32 bytes, the first one seals new data), `SMS_PROVIDERS` (`log` locally; production needs two real providers), `LIMITS_PROFILE` (`relaxed` multiplies the rate limits by 100 for local and browser tests; production refuses it), `TRUST_PROXY`, `S3_ENDPOINT`, `S3_BUCKET`, `DEV_OTP_PEEK`. Production refuses to start on an unsafe setting.

Browser tests live in `e2e/` (Playwright). They start their own six servers, never reusing a running one: the API, the outbox worker and the four apps, against their own database `oregano_e2e_test`, which global setup migrates, empties (it refuses any database not named `*_test`) and seeds with the demo data. Global setup also empties the document bucket `oregano-e2e` (it refuses any bucket not named `*-e2e`). `e2e/tests/onboarding.spec.ts` takes a restaurant and a rider from application to approved through the apps and the admin, and covers a rejection and resubmission. Sign-in codes come from the development-only `GET /v1/dev/otp/:phone` (`DEV_OTP_PEEK=true`).

|                    | API  | Customer | Restaurant | Rider | Admin |
| ------------------ | ---- | -------- | ---------- | ----- | ----- |
| Dev ports          | 4000 | 8081     | 8082       | 8083  | 8084  |
| Journey test ports | 4100 | 8191     | 8192       | 8193  | 8194  |

The e2e config reads `E2E_DATABASE_URL`, `E2E_REDIS_URL` and `E2E_S3_ENDPOINT` (defaults: the local Docker services). `pnpm verify` also builds all three Expo web apps and the admin.

### Running the gate in a clean container

Proves the branch passes from a fresh checkout, not just on this machine. With `pnpm db:up` running:

```bash
docker run --rm --add-host=host.docker.internal:host-gateway   -v "$(pwd -W 2>/dev/null || pwd)/.git:/src.git:ro"   -e DATABASE_URL=postgres://oregano:oregano@host.docker.internal:5432/oregano   -e TEST_DATABASE_URL=postgres://oregano:oregano@host.docker.internal:5432/oregano_test   -e E2E_DATABASE_URL=postgres://oregano:oregano@host.docker.internal:5432/oregano_e2e_test   -e REDIS_URL=redis://host.docker.internal:6379   -e E2E_REDIS_URL=redis://host.docker.internal:6379   -e S3_ENDPOINT=http://host.docker.internal:9000   -e E2E_S3_ENDPOINT=http://host.docker.internal:9000   node:24 bash -c "corepack enable && git clone /src.git /work && cd /work && git checkout <the branch to prove>     && pnpm install && pnpm --filter @oregano/e2e exec playwright install --with-deps chromium     && pnpm db:migrate && pnpm verify"
```

The checkout is read-only (`/src.git` is mounted `:ro`). Every database, Redis and S3 URL points at `host.docker.internal`, never `localhost`, which inside the container is the container itself.

On a Docker volume created before `oregano_e2e_test` existed, `infra/postgres-init` will not run again, so create it once by hand:

```bash
docker compose -f infra/docker-compose.yml exec postgres psql -U oregano -c "CREATE DATABASE oregano_e2e_test OWNER oregano;"
```

Demo phones (from `pnpm db:seed:demo`): customer 01711000001, Burger Lane owner 01711000002, rider 01711000003, admin (superadmin) 01711000004, second rider 01711000005, onboarding team member 01711000006, support team member 01711000007. A new phone signs in as a plain customer and can apply to become a restaurant or a rider; sign-in codes come from `GET /v1/dev/otp/<phone>` in development.

## Layout

```
apps/api/         Fastify backend and the outbox worker (src/worker.ts)
apps/customer/    Expo app (web, Android, iOS); screens in src/app/
apps/restaurant/  Expo app for restaurant staff
apps/rider/       Expo app for riders
apps/admin/       Vite web dashboard for the Oregano team (orders, application review with audited document viewer, accounts, agencies, team)
e2e/              Playwright browser tests across all four apps
packages/contracts/ Request and response shapes shared by the API and the apps (zod)
packages/api-client/ Typed API client and realtime socket, no React
packages/app-core/ React glue shared by the apps: session, queries, realtime hints
packages/ui-native/ Brand-styled React Native components shared by the apps
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
- Prices display as `Tk 280` in both languages, with Western digits. Use `formatMoney` from `@oregano/i18n`.
- Plain-language text (status messages, errors, hints, greetings, empty states) exists in English and Bangla. Buttons, field labels, prices, numbers, and data from restaurants (restaurant, menu and street names, addresses) stay English in both languages and are never translated; for those message keys the Bangla entry repeats the English text so `t()` stays complete. UI copy is sentence case. (Changed 18 November 2026 at the founder's request; the book's "full Bangla" is narrowed to this.)
- Colours, fonts, sizes and radii come from `@oregano/ui`; no literal hex values or pixel sizes in screens. Text colours only from `textPairs`.
- Never retype the logo in a font. Use the files in `Oregano-Logo-Kit/`.
- Write the failing test first. Database tests run against real PostgreSQL, never a mock.
- Order status changes only through `transition()` in `@oregano/domain`.
- A task is done only when `pnpm verify` passes.

## Plans

The roadmap is `docs/superpowers/plans/2026-11-16-oregano-roadmap.md`. Each plan is written with the writing-plans skill just before it is executed, because it depends on what the previous plan produced. Execution progress for a plan is tracked in `.superpowers/sdd/<plan>/progress.md` (git-ignored).
