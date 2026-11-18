# Plan 03 handoff: Part A done, Part B next

Written 18 November 2026 at the end of Part A (Tasks 1 to 10). Read this first in the next session, then `2026-11-18-plan-03-identity-and-onboarding.md` from Task 11.

## Where things stand

- Branch `plan-03-identity-and-onboarding`, off `main` at `6727b44`. Not pushed, not merged.
- Tasks 1 to 10 are built, each with its own commit. `pnpm verify` passed after every task (230 API tests, 13 browser tests at the end of Part A).
- Independent reviews (Opus) ran on Task 6 (OTP limits) and Task 7 (sessions). Every finding was fixed in a follow-up commit (`999fdfa`, `d486355`).
- Task 21 (real SMS providers) is still blocked on the founder naming two providers. Production refuses to start without two real providers, so the API cannot be exposed before then.

## Decisions taken while building Part A (they differ from, or add to, the plan text)

- **Relaxed limits profile** (`LIMITS_PROFILE=relaxed`, local and browser tests only; production refuses it) multiplies counts by 100 and also sets the OTP resend gap to 0, so a demo phone can sign in repeatedly. `withTestApp` defaults to relaxed; limit tests pass `limitsProfile: 'standard'` or explicit `limits`.
- **OTP events** have a third kind, `probe`, that nothing writes any more. A guess for a number with no live code costs nothing and counts nowhere, so answers never reveal whether a number has an account. Per-IP wrong-guess limits count `failure` events only.
- **OTP verify** runs its checks, the comparison and the failure record in one transaction under advisory locks (phone, then address). Sends lock phone, address, then platform, always in that order.
- **IP limits count an IPv6 /64** as one address (`ipPrefix` in `security/crypto.ts`), and an IPv4-mapped IPv6 address as IPv4.
- **Refresh tokens: one answer may be redeemed.** The plan said earlier answers stay valid; that left a thief a permanent second chain. Now, when one sibling is redeemed, its unused siblings die. A token whose answer was already used is theft even inside the 30 seconds. The blueprint says so.
- **Logout** always falls back to the refresh token when the access token identifies nobody.
- **Session lifetimes** live in `config.session` (`SessionLimits`); `withTestApp({ session: { accessSeconds: 2 } })` overrides them.
- **Services** is now `{ db, sms, redis, realtime? }`. `redis` is the limiter's client (no offline queue, so limits fail open at once when Redis is down).
- **The relay** publishes `{ topic, payload }`. Topics: `order.changed`, `session.revoked`, `user.access_changed`. Nothing writes `user.access_changed` yet: Tasks 14 to 16 must write it wherever roles, staff membership or rider status change (use `writeOutbox`).
- **Operator commands:** `pnpm --filter @oregano/api team -- grant|revoke|list ... --operator "<name>"` and `pnpm --filter @oregano/api otp -- unlock <phone> --operator "<name>"`. Both audit.
- **Demo phones added:** 01711000006 (onboarding), 01711000007 (support). CLAUDE.md is updated in Task 20.
- **Error codes** are in `ERROR_CODES`, mapped in `packages/app-core/src/errors.ts` (an exhaustive Record), with English and Bangla text in `packages/i18n`. Every new code needs all three, in the same commit.
- **Local `.env`** (git-ignored) got `DATA_KEYS`, `SMS_PROVIDERS=log` and `LIMITS_PROFILE=relaxed`. `.env.example` has the same.

## Environment notes

- In bash run `export PATH="$HOME/bin:$PATH"` first (pnpm 12).
- Windows Python cannot read bash's `/tmp`. Write helper scripts into the session scratchpad directory and run them with `"/c/Program Files/Python311/python.exe" -I <script>`.
- Large heredocs with many quotes sometimes break the bash tool. Use the Write tool for big files.
- `pnpm add` can take two minutes. Run it in the foreground with a long timeout.
- `drizzle-kit generate` asks interactively when it thinks a table was renamed. Generate in two steps (drop first, then add), and read the SQL: it may need reordering (see `0006`).
- A pre-commit hook runs Biome. Run `pnpm format` before committing, and read lint warnings: the project treats them as findings.
- Playwright starts the servers before global setup migrates the e2e database, so the worker may log one cold-database error at start. The sweeper and SMS dispatcher back off and log each distinct failure once.

## Next steps

1. **Task 11** (document vault). First check whether the MinIO community image is still maintained; if not, use SeaweedFS or Garage and record why. GitHub Actions `services` cannot pass a container command, so start the server with a `docker run -d` step in `ci.yml` (if the safety check blocks that edit, stop and ask the user). Then an Opus review of the vault when the task is done.
2. Tasks 12 to 20 as written. Task 14 (document links and approvals) also gets an Opus review.
3. After Task 20: `pnpm verify`, the clean-container run (add the S3 URL, port 9000, via `host.docker.internal`), the final whole-branch review, then merge with `--no-ff`.
4. Task 21 when the providers are named.

## Open questions for the founder

- The two SMS providers (Task 21).
- The lawyer's written answer on hosting outside Bangladesh, before launch (blueprint "Changes since the book").
- A native speaker's review of the Bangla text, including the new sign-in and error sentences.
