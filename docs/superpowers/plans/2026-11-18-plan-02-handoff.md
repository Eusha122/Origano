# Plan 02 handoff

Written 18 November 2026, at the end of the session that built Plan 02. Read this first in the next session.

## Where things stand

- Branch `plan-02-first-order`, last commit `7f17e7b`. Working tree clean. Not pushed, not merged.
- All 16 tasks of `2026-11-16-plan-02-first-order.md` are built and passed their task reviews (some after one fix round).
- `pnpm verify` passed at `baae5dd` on the Windows machine (lint, typecheck, 181 unit tests, web build, 6 browser tests, stable over 5 runs).
- The final whole-branch review (most capable model) said "ready to merge with fixes": no critical findings. The fix batch below was dispatched but the builder was stopped by the weekly usage limit before it changed anything.
- Every decision taken during execution is in `2026-11-16-plan-02-ledger.md` (a committed copy of the git-ignored ledger at `.superpowers/sdd/2026-11-16-plan-02-first-order/progress.md`). Lines starting `- … Ruling:` are decisions; lines with `minor (deferred)` are known small issues left for later plans.

## Next steps, in order

1. **Fix batch (one builder, subagent-driven).** Fix all twelve items below, test first, one commit per item or close group. Then `pnpm verify` must pass, and the browser tests must pass twice.
2. **One scoped re-review** of the fix batch (sonnet is enough).
3. **Clean Linux container run** of the full CI (item 3 below writes the recipe into `CLAUDE.md`).
4. **Push** the branch, watch GitHub Actions through the public API (`https://api.github.com/repos/Eusha122/Origano/actions/runs?head_sha=<sha>`); no `gh` CLI is installed.
5. **Merge** into `main` with `--no-ff` once CI is green, push `main`, confirm CI on `main`, delete the branch.
6. Mark Plan 02 done in the roadmap, record the new customer web bundle size in `docs/blueprint/measurements.md`, then run `/graphify .` (see below), then write Plan 03 with the writing-plans skill.

## The fix batch (from the final review)

1. **Duplicate order on a slow-3G retry.** `apps/customer/src/app/checkout.tsx` keeps the idempotency key in screen state, so after a client timeout, leaving and re-entering checkout makes a new key and a second real order; editing the address after a timed-out success gives a dead-end `idempotency_key_reused`. Move the key into `CartProvider` (regenerate only when cart lines change or after a successful order), map `idempotency_key_reused` to "This order may already be placed." with a path to the newest open order (en + bn). Prove it with an e2e test that lets the server process the first POST but aborts its response, leaves and re-enters checkout, taps again, and finds exactly one order.
2. **Demo seed has no guard.** `pnpm db:seed` creates an admin (+8801711000004) on any database. Make `db:seed` zones-only; add `db:seed:demo` that refuses in production and unless the database is `oregano` or ends in `_test`. Unit-test the guard. Update `CLAUDE.md` and `README.md`.
3. **The gate builds only the customer app.** Make `pnpm verify` build all three Expo apps and the admin. Make the e2e config read `E2E_DATABASE_URL` and `E2E_REDIS_URL` (defaults: local). Write the clean-container recipe into `CLAUDE.md` (clone `/src.git` read-only into a `node:24` container, `--add-host=host.docker.internal:host-gateway`, all database and Redis URLs pointing at `host.docker.internal`, install Chromium for `@oregano/e2e`, `pnpm db:migrate`, `pnpm verify`). Document creating `oregano_e2e_test` on an older Docker volume. Update the `CLAUDE.md` layout (contracts, api-client, app-core, ui-native).
4. **Realtime never-authenticates test proves nothing** (`apps/api/src/events/realtime.test.ts`): publish a hint while the unauthenticated socket waits; it must still receive nothing.
5. **Missing indexes:** `order_items(order_id)`, `order_events(order_id, id)`, `orders(rider_id)`, in a new migration (do not edit `0001`; drizzle-kit quotes geography types, so check the generated SQL).
6. **Wrong status copy:** the customer sees "Your rider is collecting it" before any rider has claimed (show "Ready. Waiting for a rider." when `rider` is null); the rider app shows customer-voice status text (add rider-facing strings, en + bn).
7. **Bangla unreachable** in the restaurant and rider apps: add the language button there too.
8. **Stray "Tk 280"** on the real customer home: remove it and its e2e assertion.
9. **"1 items"**: add a singular cart string and update the e2e regex.
10. **Generic errors and no per-item cap:** clear messages for `restaurant_closed`, `item_not_in_restaurant`, `validation_failed`; cap each cart line at 20.
11. **OTP request returns 200**; the plan says 202. Return 202, update tests.
12. **CORS does not expose `x-request-id`**: add `exposedHeaders`, with a test.

## Environment notes for the next session

- In bash, run `export PATH="$HOME/bin:$PATH"` first (pnpm 12 lives in `~/bin`).
- Docker Desktop: `%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe`; then `pnpm db:up`.
- Stale dev servers from this session may still hold ports 4000 and 8081. Closing them needs your permission (the safety check blocked it); the journey tests use other ports.
- A pre-commit hook runs Biome on staged files: `pnpm format` before committing.
- pnpm 12 fails installs on unapproved build scripts: `allowBuilds` in `pnpm-workspace.yaml`.

## Open questions for the founder (unchanged)

- How cash a rider collects reaches the restaurant (needed for Plan 07).
- A legal check on storing personal data outside Bangladesh (needed for Plan 11).
- A native speaker's review of all Bangla text.
- The defaults chosen for blanks in the book (blueprint section 11).
- What happens to an order held by a rider who is suspended mid-delivery (Plan 06).
