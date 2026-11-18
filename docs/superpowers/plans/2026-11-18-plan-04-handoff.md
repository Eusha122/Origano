# Plan 04 handoff: Plan 03 done, Plan 04 next

Written 18 November 2026 at the end of Plan 03. Read this first in the next session, then the roadmap's Plan 04 entry, then write the Plan 04 plan with the writing-plans skill before any code.

## First thing in the new session

1. Run `/graphify .` to build the knowledge graph of the repo, then answer "where does X live" questions from `graphify-out/` before reading raw files.
2. Read: `CLAUDE.md`, `docs/superpowers/plans/2026-11-16-oregano-roadmap.md` (Plan 04), the blueprint (`docs/blueprint/2026-11-16-oregano-blueprint.md`), and book sections 3.4 to 3.6, 4.2, 4.4 and 4.5.
3. Write `docs/superpowers/plans/<date>-plan-04-catalog-and-zones.md` with the writing-plans skill, on a new branch `plan-04-catalog-and-zones` off `main`.

## Where things stand

- Plan 03 is merged to `main` (`5770c22`, `--no-ff`) and pushed. GitHub CI passed, including the new SeaweedFS storage step.
- `pnpm verify` passed twice before the merge (326 API tests, 16 browser tests). A clean-container run passed on the branch before the last review fixes.
- Every task had its own commit. Opus reviews ran on Task 11 (vault), Task 14 (document links and approvals) and the whole branch; every finding was fixed.
- **Still open from Plan 03:** Task 21, two real SMS providers. Production refuses to start without two, so the API cannot be exposed to the internet until the founder names them.

## What Plan 03 left in place that Plan 04 builds on

- **Restaurants** have `status` (`approved` or `suspended`, no default). Only approved restaurants are listed or orderable. A newly approved restaurant starts with `is_open = false`, `name_bn = name_en`, `cuisine_bn = cuisine_en`: Plan 04's menu manager and opening hours are what let an owner fill these in and open.
- **Restaurant staff and owners:** `restaurant_staff.role` is `owner` or `staff`. `requireOwner(db, user, restaurantId)` in `apps/api/src/identity/staff.ts` (async, it reads the role). Menu editing should decide owner-only vs any staff explicitly.
- **Object storage** for images: `apps/api/src/media/store.ts` (`createS3Store`, `openStore`), SeaweedFS locally on port 9000, buckets created on first use outside production. The identity vault (`media/vault.ts`) is for identity documents only: encrypted, never public. Menu and restaurant images are public content and need their own path (no encryption, resized, cacheable), not the vault.
- **Image handling:** `media/image.ts` already sniffs magic bytes and re-encodes with `sharp` (limits on bytes and pixels). Reuse its approach for menu photos, with different sizes and output.
- **Multipart** is registered globally: one file, 8 MB, no other fields. A 413 is `document_too_large`; menu uploads may want their own error code.
- **Rate limits** live in `apps/api/src/security/rate-limit.ts`; the `uploads` rule matches only `/v1/onboarding/.../documents/`. New upload routes need their own rule. `GET /v1/restaurants*` is limited per IP.
- **Zones:** `zones` table with a PostGIS boundary and fee settings; `GET /v1/zones` lists active zones. `findZoneForPoint` in `zones/repo.ts`. Plan 04 adds zone drawing and fee settings in the admin.
- **Admin dashboard** (`apps/admin`, Vite, plain CSS from tokens): tabs by permission through `teamCan`. Add new tabs to `Nav.tsx`. A meta CSP is built into the production page from `VITE_API_URL` (`img-src 'self' blob: data:`); public menu images from S3 will need their origin added to `img-src`.
- **Audit log:** every admin and owner action writes an `audit_log` row in the same transaction (`writeAudit`). Data holds ids, kinds and outcomes, plus suspension reasons.
- **Realtime:** a `user.access_changed` outbox event closes the user's sockets with 4401; the apps then refresh `me` and the application queries (`handleAuthFailed`).

## Decisions and conventions to keep

- Error codes: a new code goes into `ERROR_CODES` (contracts), the exhaustive map in `packages/app-core/src/errors.ts`, and English and Bangla text in `packages/i18n`, in the same commit.
- Plain sentences in both languages; buttons, labels and restaurant data stay English in both (the Bangla entry repeats the English). Western digits in Bangla text too.
- A repeated action is not an error: answer 200 with the current state and write nothing.
- Module ownership: a module never reads another module's tables; call its exported function. Two known compromises remain (admin document routes read `identity_documents`; dispatch writes `orders` when releasing a suspended rider's orders).
- Tests first, against real PostgreSQL and the real S3 server. `withTestApp` takes `limits`, `session`, `clock` and `logStream` options and exposes `config`.

## Environment notes

- In bash: `export PATH="$HOME/bin:$PATH"` first (pnpm 12).
- Windows Python cannot read bash's `/tmp`; write helper scripts to the session scratchpad and run them with `"/c/Program Files/Python311/python.exe" -I <script>`.
- Large bash heredocs with quotes break the bash tool: use the Write tool for files, and small Python scripts for multi-line edits.
- Biome reformats on commit and `pnpm format`; re-read a file before an exact-match edit if formatting may have changed it.
- **Metro does not hot-reload edits on this machine.** After changing an Expo app, restart its dev server with `--clear` (`cd apps/<app> && CI=1 pnpm exec expo start --web --port 808x --clear`) before showing the founder. Vite (admin, 8084) does reload.
- Dev sign-in codes: `http://localhost:4000/v1/dev/otp/<phone>` with the real number in place of `<phone>`.
- `drizzle-kit generate` may ask interactively about renames; read the generated SQL, and backfill before adding NOT NULL or CHECK constraints (see `0010`, `0011`).
- The browser tests start their own servers on ports 4100 and 8191 to 8194; a full `pnpm verify` takes about 6 minutes.
- One API test flaked once under load and passed on rerun; it was not identified. Watch for it.

## On design

The founder asked whether the current UI is final. It is not: it is working scaffolding on the brand tokens. The real design pass (Foodpanda and Uber Eats level, using the ui-ux-pro-max, design-taste-frontend and impeccable skills) belongs to Plan 05, starting with the customer app and upgrading the shared components in `packages/ui-native`. Nothing in the roadmap yet covers polishing the restaurant and rider apps; propose adding it. Plan 04's owner-facing menu screens should stay functional and clean, not polished, unless the founder asks otherwise.

## Open questions for the founder

- The two SMS providers (Plan 03 Task 21).
- The lawyer's written answer on hosting outside Bangladesh, before launch.
- A native speaker's review of the Bangla text, including the Plan 03 sign-in, onboarding and error sentences.
- Plan 04 will raise its own: for example who may edit the menu (owner only or all staff), and the default opening hours for a new restaurant.
