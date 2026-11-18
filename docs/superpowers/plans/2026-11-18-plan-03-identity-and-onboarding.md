# Oregano Identity Hardening and Onboarding: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign-in that is safe to put on the internet: limited, queued SMS, short access tokens with rotating refresh tokens, rate limits everywhere. On top of it, a restaurant and a rider can each go from application to approved without anyone touching the database. Identity documents are verified, then deleted.

**Architecture:** The plan has three parts.

- **Part A (Tasks 1 to 10) hardens identity.**
  - OTP limits live in PostgreSQL, in the same transaction as the challenge, because they guard real SMS money.
  - SMS goes through an encrypted queue that the worker drains through a provider chain.
  - Sessions become a family of opaque tokens: a 15-minute access token and a 60-day refresh token that rotates on every use. The web keeps the refresh token in an httpOnly cookie.
  - General request limits live in Redis and fail open.
- **Part B (Tasks 11 to 20) adds onboarding.**
  - A media vault re-encodes and envelope-encrypts identity images in private S3-compatible storage.
  - The onboarding module runs applications through one account state machine in `@oregano/domain`.
  - The admin reviews applications through an audited, expiring, admin-only document link.
  - The worker's retention sweeper deletes files 7 days after the decision.
- **Part C (Task 21) adds the two real SMS providers.** It is blocked until the founder chooses them.

**Tech Stack:** Everything from Plan 02, plus:

- `@fastify/rate-limit` with the existing `ioredis`;
- `@fastify/cookie`, `@fastify/helmet` and `@fastify/multipart`;
- `sharp` (native: needs `allowBuilds`);
- `@aws-sdk/client-s3` with a local S3-compatible server in Docker and CI;
- `expo-image-picker` in the restaurant and rider apps.

Read each library's current official documentation before installing it (CLAUDE.md rule).

**Spec:** `docs/blueprint/2026-11-16-oregano-blueprint.md`: sections 3, 5 (module ownership), 6 (sign-up flows), 7 (security), 8, and "Changes since the book", which wins over the book. Also `Oregano-Product-and-Brand-Book.pdf` sections 2, 3.1, 4.1, 4.6, 5.1, 6 and 12. Read the roadmap's Plan 03 entry and its "Must include" list, `CLAUDE.md`, and `docs/superpowers/plans/2026-11-16-plan-02-ledger.md` (the Task 4, Task 8 and Task 10 deferrals land here).

## Global Constraints

- Every rule in `CLAUDE.md` applies:
  - strict TypeScript, test first, real PostgreSQL in tests, and `pnpm verify` as the gate;
  - colours and sizes from `@oregano/ui`;
  - English and Bangla for plain sentences only, while buttons, labels, prices, numbers and restaurant data stay English.
- Blueprint first: Task 1 writes every number below into the blueprint before any code uses it. If execution needs a different value, change the blueprint first, with the reason.
- **Module ownership** (blueprint section 5). A module never reads or writes another module's tables; it calls that module's exported function.

  | Module          | Owns                                        |
  | --------------- | ------------------------------------------- |
  | `identity`      | OTP, sessions, team roles, restaurant staff |
  | `notifications` | SMS queue and providers                     |
  | `media`         | the document vault                          |
  | `onboarding`    | applications, agencies, rider invites       |
  | `admin`         | the audit log                               |
  | `dispatch`      | offers                                      |

- **Personal data rules:**
  - Never store an ID-document number. No form asks for one.
  - Never store a raw IP address. Store `ipHash` = HMAC-SHA256 (HKDF subkey `ip-hash` of `OTP_SECRET`), hex, first 32 characters.
  - Never log a token, cookie, OTP code, document byte or payout account number.
  - Phones in logs are masked to the last 3 digits (`+8801*******001`).
- **Secrets:**
  - `OTP_SECRET` (existing, at least 32 characters) keys the OTP HMAC. HKDF subkeys of it, with info strings `ip-hash` and `doc-ticket`, key IP hashing and document tickets.
  - `DATA_KEYS` is `kid:base64key[,kid:base64key...]`, each key exactly 32 bytes, the first one active. It encrypts SMS payloads, payout account numbers and documents with AES-256-GCM.
  - Rotating `OTP_SECRET` only invalidates short-lived values (codes, 48-hour IP windows, 5-minute tickets).
- **Production refuses to start** (a `ConfigError` naming the setting) when any of these holds:
  - `DEV_OTP_PEEK=true`;
  - `LIMITS_PROFILE=relaxed`;
  - `SMS_PROVIDERS` has fewer than two distinct providers, or includes `log`;
  - `TRUST_PROXY` is empty;
  - any `CORS_ORIGINS` entry is not `https`;
  - `S3_ENDPOINT` is not `https`.
- `DATA_KEYS` is required in every environment. `.env.example`, `withTestApp` and the e2e config each set their own key.
- **Limits.** Every value lives in one `Limits` object in `apps/api/src/config.ts`. `LIMITS_PROFILE=relaxed` multiplies every count by 100, for local development and browser tests only.

| Limit                                           | Default                                       | Store                                 | Over the limit                                         |
| ----------------------------------------------- | --------------------------------------------- | ------------------------------------- | ------------------------------------------------------ |
| OTP code                                        | 6 digits, valid 300 s, 5 wrong tries per code | Postgres                              | code burned, `otp_attempts_exceeded`                   |
| OTP resend gap per phone                        | 60 s                                          | Postgres                              | 429 `otp_resend_too_soon` + `Retry-After`              |
| OTP sends per phone                             | 5 per hour, 10 per 24 h                       | Postgres                              | 429 `otp_rate_limited`                                 |
| OTP sends per IP                                | 20 per hour, 100 per 24 h                     | Postgres                              | 429 `otp_rate_limited`                                 |
| OTP sends, whole platform                       | 1,000 per hour                                | Postgres                              | 503 `sms_unavailable`, error log `sms_budget_exceeded` |
| Wrong codes per phone (survive a new code)      | 10 per rolling 24 h                           | Postgres                              | 429 `otp_locked`, for both request and verify          |
| Wrong codes per IP, across phones               | 30 per hour                                   | Postgres                              | 429 `otp_rate_limited` on verify                       |
| Any route, per IP                               | 300 per minute                                | Redis, fail open                      | 429 `rate_limited`                                     |
| Any write (POST, PUT, PATCH, DELETE), per user  | 60 per minute                                 | Redis, fail open                      | 429 `rate_limited`                                     |
| `POST /v1/orders`, per user                     | 5 per 10 minutes                              | Redis, fail open                      | 429 `rate_limited`                                     |
| Open (not terminal) orders per customer         | 3                                             | Postgres, exact                       | 409 `too_many_open_orders`                             |
| `GET /v1/restaurants*`, per IP                  | 120 per minute                                | Redis, fail open                      | 429 `rate_limited`                                     |
| `POST /v1/auth/refresh`, per IP                 | 30 per minute                                 | Redis, fail open                      | 429 `rate_limited`                                     |
| WebSocket upgrades, per IP                      | 30 per minute                                 | Redis, fail open                      | 429 before upgrade                                     |
| WebSocket connections, per IP, per API instance | 20                                            | memory (a connection is per instance) | close 4429                                             |
| Document uploads, per user                      | 30 per hour                                   | Redis, fail open                      | 429 `rate_limited`                                     |
| Staff per restaurant                            | 20                                            | Postgres                              | 409 `staff_limit_reached`                              |

- **Sessions:**
  - access token 15 minutes;
  - refresh token 60 days, sliding;
  - a session family's absolute life is 180 days, or 12 hours if the user has any team role when the session is issued;
  - refresh-reuse grace is 30 seconds;
  - tokens are 32 random bytes in base64url, stored only as SHA-256.
- **Refresh token transport:**
  - A request with an `Origin` header in `CORS_ORIGINS` is in cookie mode. The refresh token goes into the cookie `__Secure-oregano_rt` (production) or `oregano_rt` (otherwise): `HttpOnly; Secure; SameSite=Strict; Path=/v1/auth; Max-Age` = the refresh lifetime. It is never put in the body.
  - A request with no `Origin` header (native apps) is in body mode.
  - A request whose `Origin` is not in the list gets 403 `forbidden` on `/v1/auth/*`.
  - A cookie-mode refresh must carry the header `X-Oregano-Client: web`.
- **Deployment constraint (Plan 11):** the web apps and the API must be same-site (for example `oregano.com.bd` and `api.oregano.com.bd`), or the Strict cookie is never sent.
- **Documents:**
  - Accepted: JPEG, PNG or WebP by magic bytes, at most 8 MB and at most 40 megapixels.
  - Re-encoded to JPEG at quality 82, longest edge at most 2000 px, EXIF orientation applied, all metadata stripped.
  - Envelope encryption: a random data key per file, wrapped by the active `DATA_KEYS` key.
  - Object keys are `docs/<random uuid>`, so they carry no personal data.
  - An admin view link lives 300 s.
  - The file is deleted:
    - 7 days after the decision;
    - 30 days after the last activity on an undecided application;
    - 1 hour after an upload that never completed;
    - at once when the same document type is uploaded again.
  - After deletion only the kind, the reviewer, the review time and the outcome remain.
- **Retention:**
  - `otp_events`: 48 hours.
  - `otp_challenges`: 24 hours after expiry.
  - `sms_messages`: the ciphertext is purged when sent or at expiry; the row is deleted after 30 days.
  - `auth_tokens`: deleted 7 days after expiry.
  - Revoked `auth_sessions`: deleted after 30 days.
  - Guarantor and payout details of a rejected or abandoned application: cleared 30 days after the last activity.
- **Account states** come only through `accountTransition()` in `@oregano/domain`:
  - states: `applied`, `under_review`, `approved`, `rejected`, `suspended`;
  - actions: `submit`, `approve`, `reject`, `resubmit`, `suspend`, `reinstate`.
- **Team roles:** `superadmin`, `onboarding`, `support`.
  - They are granted and revoked only by the operator CLI (Task 4), never by an API.
  - `users.is_admin` is removed.
- **Rider types** are exactly `independent`, `agency` and `restaurant_staff`.
- **Vehicle types** are exactly `bicycle`, `motorcycle`, `electric_bike` and `on_foot`. A registration number is required for `motorcycle` and `electric_bike`.
- **Agency codes** are 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, generated randomly and unique.
- **Suspended rider** ("Changes since the book"):
  - Suspension releases every order the rider holds that is still `preparing` or `ready` back to the offer pool.
  - Orders already `on_the_way` stay with the rider, who can still deliver them.
- **Restaurants:**
  - `restaurants.status` is `approved` or `suspended`, with no default.
  - Only `approved` restaurants are listed or orderable.
  - A newly approved restaurant starts with `is_open = false`.
- **Audit log.** Every admin, owner and operator action, and every document link and opening, writes an `audit_log` row in the same transaction. Rows can never be updated or deleted (a trigger). The roles that may truncate the table are dealt with in Plan 11.
- **Error codes.** Every new code goes into `ERROR_CODES` in `packages/contracts/src/errors.ts`. From Task 8 on, the task that adds a code also adds, in the same commit:
  - its entry in the exhaustive `Record<ErrorCode, MessageKey>` in `packages/app-core/src/errors.ts`;
  - its English and Bangla sentence in `packages/i18n/src/en.ts` and `bn.ts`.

  Otherwise typecheck fails. Those three files are implicitly in the Files list of every such task.
- **The gate holds after every task.** Each task's last check is `pnpm verify`, not only the package's tests. A task that changes a contract also updates every consumer (api-client, app-core, apps, `e2e/journey.ts`) in the same task.
- **A repeated action is not an error** (Plan 02 rule). If an account, document or application is already in the state an action would produce, the action returns 200 with the current view and writes nothing. 409 `invalid_transition` is only for moves `accountTransition` does not allow.
- **Migrations.** Always new files from `pnpm --filter @oregano/api db:generate`. Triggers and backfills go in `drizzle-kit generate --custom` files. Never edit `0000` to `0002`. drizzle-kit quotes geography types, so read the generated SQL.
- **Ports.** As in CLAUDE.md. The local S3 server listens on 9000.

## Review Focus

1. **A refresh on bad 3G, or two tabs refreshing at once.** The server rotates the token but the client never sees the answer, then the client retries with the old token, or a second tab sends the same token. The user must stay signed in. A genuinely stolen token replayed later must revoke the whole family. Pinned in Task 7 (grace tests) and Task 8 (single-flight test).
2. **Many real customers behind one carrier NAT address, and a forged `X-Forwarded-For`.** Per-phone limits must stop guessing even when the IPs rotate. A forged header from an untrusted address must not change the IP the limits count. Pinned in Task 3 (trusted-proxy test) and Task 6 (rotation test).
3. **A document link that has been copied, has expired, or is opened by another admin, a non-admin or a support-only admin, or a file opened after deletion.** Each is refused. Every successful opening is logged. Pinned in Task 14.
4. **A restaurant-staff rider asking for, claiming or being hinted another restaurant's order, and a suspended rider who already has the food.** The first is invisible and refused. The second can still deliver, while orders they have not picked up return to the pool. Pinned in Tasks 15 and 16.
5. **An upload that is not what it claims.** A PDF renamed to `.jpg`, an HTML or JPEG polyglot, a pixel bomb, a phone photo with GPS in its EXIF data, or an 8 MB+ body. Each is rejected, or stored stripped of metadata. Pinned in Task 11.

---

## API surface added or changed

All routes are under `/v1`. Bodies are validated with the named `@oregano/contracts` schema; a failure is `400 validation_failed`. "Team: X" means the user holds a team role that has permission X (Task 2).

| Method and path                                                                                                                                                    | Who                                              | Body                                   | Success                                                                  | Errors                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `POST /auth/otp/request`                                                                                                                                           | anyone                                           | `OtpRequestBody` (+ optional `locale`) | 202 `OtpRequestResponse`                                                 | 400 `invalid_phone`; 429 `otp_resend_too_soon`, `otp_rate_limited`, `otp_locked`; 503 `sms_unavailable` |
| `POST /auth/otp/verify`                                                                                                                                            | anyone                                           | `OtpVerifyBody`                        | 200 `SessionResponse` (+ cookie in cookie mode)                          | 401 `otp_invalid`, `otp_expired`, `otp_attempts_exceeded`; 429 `otp_locked`, `otp_rate_limited`         |
| `POST /auth/refresh`                                                                                                                                               | holder of a refresh token                        | `RefreshBody`                          | 200 `RefreshResponse`                                                    | 401 `unauthenticated`; 403 `forbidden`                                                                  |
| `POST /auth/logout`                                                                                                                                                | signed in, or holder of a refresh token          | none                                   | 204, cookie cleared                                                      | none                                                                                                    |
| `GET /me`                                                                                                                                                          | signed in                                        | none                                   | 200 `Me` (now with `teamRoles`, `rider.status`, `rider.type`)            | 401                                                                                                     |
| `GET /dev/otp/:phone`                                                                                                                                              | only with `DEV_OTP_PEEK=true`                    | none                                   | 200 `{ code }`                                                           | 404                                                                                                     |
| `GET /zones`                                                                                                                                                       | anyone                                           | none                                   | 200 `{ zones: ZoneSummary[] }` (active zones)                            | none                                                                                                    |
| `GET`/`PUT /onboarding/restaurant-application`                                                                                                                     | signed in                                        | `RestaurantApplicationBody`            | 200 `RestaurantApplicationView`                                          | 409 `application_not_editable`                                                                          |
| `POST /onboarding/restaurant-application/documents/:kind`                                                                                                          | the applicant                                    | multipart, one file                    | 201 `DocumentSummary`                                                    | 400 `unsupported_document`; 413 `document_too_large`; 409 `application_not_editable`                    |
| `POST /onboarding/restaurant-application/submit`                                                                                                                   | the applicant                                    | `{ noTradeLicence: boolean }`          | 200 view                                                                 | 422 `application_incomplete`; 409 `invalid_transition`                                                  |
| `GET`/`PUT /onboarding/rider`                                                                                                                                      | signed in                                        | `RiderApplicationBody`                 | 200 `RiderApplicationView`                                               | 422 `agency_code_invalid`, `rider_invite_missing`; 409 `application_not_editable`                       |
| `POST /onboarding/rider/documents/:kind`                                                                                                                           | the applicant                                    | multipart                              | 201 `DocumentSummary`                                                    | as for restaurants                                                                                      |
| `POST /onboarding/rider/submit`                                                                                                                                    | the applicant                                    | none                                   | 200 view                                                                 | 422 `application_incomplete`; 409 `invalid_transition`                                                  |
| `GET /admin/applications?kind=&status=`                                                                                                                            | team: `applications.review`                      | none                                   | 200 `{ items: ApplicationQueueItem[] }`, oldest submitted first, max 100 | 403                                                                                                     |
| `GET /admin/applications/restaurant/:id`, `GET /admin/applications/rider/:userId`                                                                                  | team: `applications.review`                      | none                                   | 200 detail (payout masked)                                               | 404                                                                                                     |
| `POST /admin/applications/restaurant/:id/approve`                                                                                                                  | team: `applications.review`                      | `ApproveRestaurantBody`                | 200 detail                                                               | 422 `outside_zone`, `application_incomplete`; 409 `invalid_transition`                                  |
| `POST /admin/applications/restaurant/:id/reject`, `POST /admin/applications/rider/:userId/reject`                                                                  | team: `applications.review`                      | `RejectBody`                           | 200 detail                                                               | 409                                                                                                     |
| `POST /admin/applications/rider/:userId/approve`                                                                                                                   | team: `applications.review`                      | none                                   | 200 detail                                                               | 422 `application_incomplete`; 409                                                                       |
| `POST /admin/restaurant-applications`                                                                                                                              | team: `applications.review`                      | `AdminCreateRestaurantApplicationBody` | 201 detail (door 1: the team applies for the owner)                      | 409 `application_exists`                                                                                |
| `POST /admin/documents/:id/link`                                                                                                                                   | team: `documents.view`                           | none                                   | 200 `{ url, ticket, expiresAt }`                                         | 404; 410 `document_deleted`                                                                             |
| `GET /admin/documents/:id/content` + header `X-Document-Ticket`                                                                                                    | team: `documents.view`, same admin as the ticket | none                                   | 200 `image/jpeg`                                                         | 403 `link_expired`; 410 `document_deleted`                                                              |
| `POST /admin/riders/:userId/suspend` and `/reinstate`; `POST /admin/restaurants/:id/suspend` and `/reinstate`; `POST /admin/agencies/:id/suspend` and `/reinstate` | team: `accounts.manage`                          | `ReasonBody`                           | 200                                                                      | 409 `invalid_transition`                                                                                |
| `GET`/`POST /admin/agencies`                                                                                                                                       | team: `accounts.manage`                          | `CreateAgencyBody`                     | 200 list / 201 `Agency` (with code)                                      | none                                                                                                    |
| `GET /admin/team`                                                                                                                                                  | team: `team.read`                                | none                                   | 200 `{ members: TeamMember[] }`                                          | 403                                                                                                     |
| `GET`/`POST /restaurant/:restaurantId/staff`, `DELETE /restaurant/:restaurantId/staff/:userId`                                                                     | that restaurant's owner                          | `AddStaffBody`                         | 200 / 201 / 204                                                          | 403; 409 `staff_limit_reached`, `cannot_remove_last_owner`                                              |
| `GET`/`POST /restaurant/:restaurantId/rider-invites`, `DELETE /restaurant/:restaurantId/rider-invites/:phone`                                                      | that restaurant's owner                          | `RiderInviteBody`                      | 200 / 201 / 204                                                          | 403                                                                                                     |
| `POST /orders`                                                                                                                                                     | customer                                         | as before                              | as before                                                                | + 409 `too_many_open_orders`, 429 `rate_limited`; a suspended restaurant gives 422 `restaurant_closed`  |

---

## Part A: Identity hardening

### Task 1: Write the decisions into the blueprint and roadmap

**Files:**

- Modify: `docs/blueprint/2026-11-16-oregano-blueprint.md`, `docs/superpowers/plans/2026-11-16-oregano-roadmap.md`

- [ ] **Step 1: Renumber.** Rename the first `## 13. Research notes` to `## 14. Research notes`, so that "Changes since the book" is the only section 13.
- [ ] **Step 2: Rewrite the bullets in section 7.**
  - Replace the "Sign-in" and "Sessions" bullets with the OTP rows of the Global Constraints limits table, the session lifetimes, the transport rule and the reuse grace.
  - Add a sentence explaining that OTP counters live in PostgreSQL because they guard SMS money, and that general limits live in Redis and fail open, so a Redis outage never blocks ordering (section 8).
  - Add the carrier NAT note: per-IP numbers are deliberately generous, so watch `otp_rate_limited` counts after launch.
  - Add the lockout tradeoff (ASVS: anti-automation versus lockout). The 24-hour per-phone lock stops code guessing, but anyone can lock a real owner or rider out for a day. The mitigations are a warn-level `otp_phone_locked` log to alert on, and the audited operator command `otp:unlock` (Task 6).
  - Change "Personal documents" to point at "Changes since the book".
- [ ] **Step 3: Add a dated entry (18 November 2026) to "Changes since the book" covering:**
  - the full limits table;
  - SMS sent through an encrypted queue drained by the worker (rule 3 holds, and the code is never stored in plain text);
  - opaque access tokens checked in the database on every request, so revocation takes effect at once;
  - the 12-hour team sessions;
  - the document pipeline and retention defaults (30 days undecided, 1 hour incomplete upload, 30 days for guarantor and payout details);
  - agencies run by the team, with riders joining by agency code;
  - staff riders joining by an invite from their restaurant;
  - the suspended-rider release rule;
  - the 3-open-orders cap;
  - the same-site deployment constraint.
  - Give each a "Why" line and a "Cost if wrong" line, as the existing entries do.
- [ ] **Step 4: Update the roadmap.** Set Plan 03's status to "Written: `2026-11-18-plan-03-identity-and-onboarding.md`" and note that Task 21 is blocked on the founder's SMS provider choice.
- [ ] **Step 5: Commit.** `docs: record Plan 03 limits, sessions and document decisions in the blueprint`

### Task 2: Account states and team permissions in the domain

**Files:**

- Create: `packages/domain/src/account.ts`, `packages/domain/src/team.ts`, `packages/domain/src/account.test.ts`, `packages/domain/src/team.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

- Produces, from `@oregano/domain`:

```ts
export const ACCOUNT_STATUSES = ['applied', 'under_review', 'approved', 'rejected', 'suspended'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
export const ACCOUNT_ACTIONS = ['submit', 'approve', 'reject', 'resubmit', 'suspend', 'reinstate'] as const;
export type AccountAction = (typeof ACCOUNT_ACTIONS)[number];
/** The next status, or null when the action is not allowed from `from`. */
export function accountTransition(from: AccountStatus, action: AccountAction): AccountStatus | null;

export const TEAM_ROLES = ['superadmin', 'onboarding', 'support'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
export const PERMISSIONS = [
  'orders.read',
  'applications.review',
  'documents.view',
  'accounts.manage',
  'team.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export function teamCan(roles: readonly TeamRole[], permission: Permission): boolean;

export const RIDER_TYPES = ['independent', 'agency', 'restaurant_staff'] as const;
export type RiderType = (typeof RIDER_TYPES)[number];
export const VEHICLE_TYPES = ['bicycle', 'motorcycle', 'electric_bike', 'on_foot'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];
export function vehicleNeedsRegistration(type: VehicleType): boolean;
```

- [ ] **Step 1: Write the failing tests.**
  - `account.test.ts` checks the whole 5 × 6 table. The allowed moves are exactly:
    - `applied` + `submit` → `under_review`
    - `under_review` + `approve` → `approved`
    - `under_review` + `reject` → `rejected`
    - `rejected` + `resubmit` → `under_review`
    - `approved` + `suspend` → `suspended`
    - `suspended` + `reinstate` → `approved`

    Every other pair is `null`. Loop over `ACCOUNT_STATUSES × ACCOUNT_ACTIONS` so no pair is missed.
  - `team.test.ts` checks:
    - `superadmin` has every permission;
    - `onboarding` has `orders.read`, `applications.review`, `documents.view` and `accounts.manage`, but not `team.read`;
    - `support` has only `orders.read`;
    - `[]` has nothing;
    - `vehicleNeedsRegistration` is true only for `motorcycle` and `electric_bike`.
- [ ] **Step 2: Run them and see them fail.** `pnpm --filter @oregano/domain test`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement both files.** Use lookup tables, not `if` chains, so branch coverage stays full.
- [ ] **Step 4: Run the tests, then check coverage.** `pnpm --filter @oregano/domain test`. Expected: PASS. Then run the package's coverage command; branch coverage of both files is 100%.
- [ ] **Step 5: Commit.** `feat(domain): account state machine and team permissions`

### Task 3: Config, keys, client IP, headers and log redaction

**Files:**

- Create: `apps/api/src/security/crypto.ts`, `apps/api/src/security/crypto.test.ts`, `apps/api/src/security/client-ip.test.ts`
- Modify: `apps/api/src/config.ts`, `apps/api/src/config.test.ts`, `apps/api/src/app.ts`, `apps/api/src/app.test.ts`, `apps/api/.env.example`, `apps/api/src/testing/app.ts`, `apps/api/package.json`, `e2e/playwright.config.ts` (API and worker env gain a fixed test `DATA_KEYS`)

**Interfaces:**

- Produces:

```ts
// config.ts — added to Config
trustProxy: string[] | false;            // TRUST_PROXY: comma separated IPs/CIDRs; empty means false (not allowed in production)
dataKeys: { active: string; keys: Map<string, Buffer> };   // DATA_KEYS
limitsProfile: 'standard' | 'relaxed';   // LIMITS_PROFILE
limits: Limits;                          // the Global Constraints table; relaxed multiplies every count by 100
smsProviders: string[];                  // SMS_PROVIDERS, e.g. ['log']
rateLimitPrefix: string;                 // RATE_LIMIT_PREFIX, default 'oregano'
webOtpDomain: string | null;             // WEB_OTP_DOMAIN, optional
s3: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean };
export type Limits = { /* one readonly number field per row of the limits table; names below */ };
// Limits fields: otpTtlSeconds, otpResendSeconds, otpMaxAttempts, otpSendsPerPhoneHour, otpSendsPerPhoneDay,
// otpSendsPerIpHour, otpSendsPerIpDay, otpSendsGlobalHour, otpFailuresPerPhoneDay, otpFailuresPerIpHour,
// routePerIpMinute, writesPerUserMinute, ordersPerUserTenMinutes, openOrdersPerCustomer, restaurantListPerIpMinute,
// refreshPerIpMinute, wsUpgradesPerIpMinute, wsConnectionsPerIp, uploadsPerUserHour, staffPerRestaurant

// security/crypto.ts
export function subkey(secret: string, purpose: 'ip-hash' | 'doc-ticket'): Buffer;           // HKDF-SHA256, 32 bytes
export function hashIp(key: Buffer, ip: string): string;                                     // hex, 32 chars
export function sealString(keys: Config['dataKeys'], plaintext: string, aad: string): string; // 'v1.<kid>.<iv>.<tag>.<ct>' base64url parts
export function openString(keys: Config['dataKeys'], sealed: string, aad: string): string;    // throws on tamper or unknown kid
export type SealedKey = { kid: string; wrappedKey: string };                                  // a data key wrapped by a master key
export function newDataKey(keys: Config['dataKeys'], aad: string): { key: Buffer; sealed: SealedKey };
export function unwrapDataKey(keys: Config['dataKeys'], sealed: SealedKey, aad: string): Buffer;
export function encryptBytes(key: Buffer, plaintext: Buffer, aad: string): Buffer;            // iv(12) | tag(16) | ciphertext
export function decryptBytes(key: Buffer, sealed: Buffer, aad: string): Buffer;
```

- `buildApp` passes `trustProxy: config.trustProxy` to Fastify, registers `@fastify/helmet` (the defaults are fine for a JSON API), and sets logger `redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]']`.
- `withTestApp` accepts `options.limitsProfile?: 'standard' | 'relaxed'` (default `'relaxed'`), so ordinary API test files never trip a limit from 127.0.0.1. It also accepts `options.limits?: Partial<Limits>` and `options.trustProxy?: string[]`. It sets `DATA_KEYS` to a fixed test key and `RATE_LIMIT_PREFIX` to `test-<random>` for each file.
- The limit tests (`otp-limits.test.ts`, `rate-limit.test.ts`) pass `limitsProfile: 'standard'` or explicit small `limits`.

- [ ] **Step 1: Write the failing tests.**
  - `config.test.ts` adds one test per production refusal in Global Constraints. Each asserts that the `ConfigError` names the setting (for example `DATA_KEYS: is required in production`) and that the message never contains the value. One more test asserts that `LIMITS_PROFILE=relaxed` makes `limits.otpSendsPerPhoneHour === 500`.
  - `crypto.test.ts` covers:
    - a round trip of `sealString` and `openString`;
    - a tampered ciphertext or AAD throws;
    - an unknown `kid` throws;
    - text sealed under an old `kid` still opens after a new key is put first;
    - a round trip of `newDataKey`, `unwrapDataKey`, `encryptBytes` and `decryptBytes`;
    - `hashIp` is stable for one key, differs across keys, and never contains the IP.
  - `client-ip.test.ts` uses `inject` with `remoteAddress`:
    - With `trustProxy: ['10.0.0.1']`, a request from `10.0.0.1` with `X-Forwarded-For: 203.0.113.9` gets `request.ip === '203.0.113.9'`.
    - The same header from `198.51.100.7` gets `request.ip === '198.51.100.7'`.
    - Assert through a test-only route registered on the built app.
  - `app.test.ts` adds:
    - the response has `x-content-type-options: nosniff` and `strict-transport-security`;
    - a log line for a request with `Authorization: Bearer abc` contains `[Redacted]` and not `abc`. Capture with a pino stream destination.
- [ ] **Step 2: Run them and see them fail.** `pnpm --filter @oregano/api test -- config crypto client-ip app`. Expected: FAIL.
- [ ] **Step 3: Install and implement.**
  - Install `@fastify/helmet` after reading its docs.
  - Implement the config fields and refusals, `crypto.ts` (`node:crypto` only: `hkdfSync`, `createCipheriv('aes-256-gcm')`, `timingSafeEqual`), and the Fastify options.
  - Update `.env.example` with dev values: a generated base64 key for `DATA_KEYS`, `SMS_PROVIDERS=log`, `LIMITS_PROFILE=relaxed`, and the S3 values from Task 11, left commented until then.
- [ ] **Step 4: Run the tests.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(api): trusted proxy, security headers, log redaction, data keys and production refusals`

### Task 4: Team roles and the audit log

**Files:**

- Create: `apps/api/src/admin/audit.ts`, `apps/api/src/admin/audit.test.ts`, `apps/api/src/identity/team.ts`, `apps/api/src/identity/team-cli.ts`, `apps/api/src/identity/team.test.ts`, a new migration
- Modify: `apps/api/src/identity/schema.ts`, `apps/api/src/admin/schema.ts` (create), `apps/api/src/db/schema.ts`, `apps/api/src/identity/sessions.ts`, `apps/api/src/identity/auth.ts`, `apps/api/src/admin/routes.ts`, `apps/api/src/events/realtime.ts`, `apps/api/src/dev/seed-demo.ts`, `packages/contracts/src/auth.ts`, `apps/api/package.json`

**Interfaces:**

- Tables:
  - `team_members(user_id uuid PK → users, role text CHECK IN TEAM_ROLES, granted_at, granted_by_label text)`. One role per member is enough.
  - `audit_log(id bigserial, actor_type text CHECK IN ('user','operator','system'), actor_id uuid NULL, actor_label text NULL, action text, target_type text, target_id text, data jsonb DEFAULT '{}', request_id text NULL, ip_hash text NULL, created_at)`, with an index on `(target_type, target_id, id)`.
  - A custom-migration trigger `audit_log_append_only` raises on UPDATE or DELETE.
  - The migration drops `users.is_admin` after inserting `team_members(role='superadmin')` for every user who had it.
- Produces:

```ts
// admin/audit.ts
export type AuditAction =
  | 'team.granted'
  | 'team.revoked'
  | 'session.reuse_detected'
  | 'application.created'
  | 'application.submitted'
  | 'application.approved'
  | 'application.rejected'
  | 'application.licence_waived'
  | 'document.uploaded'
  | 'document.link_issued'
  | 'document.opened'
  | 'document.deleted'
  | 'rider.suspended'
  | 'rider.reinstated'
  | 'restaurant.suspended'
  | 'restaurant.reinstated'
  | 'agency.created'
  | 'agency.suspended'
  | 'agency.reinstated'
  | 'staff.added'
  | 'staff.removed'
  | 'rider_invite.created'
  | 'rider_invite.deleted';
export type AuditEntry = {
  actor: { type: 'user'; id: string } | { type: 'operator'; label: string } | { type: 'system' };
  action: AuditAction;
  targetType: string;
  targetId: string;
  data?: Record<string, string | number | boolean | null>; // never personal data
  requestId?: string;
  ipHash?: string;
};
export function writeAudit(tx: Executor, entry: AuditEntry): Promise<void>;

// identity/team.ts
export function grantTeamRole(db: Db, phone: BdPhone, role: TeamRole, operator: string): Promise<void>; // audits, revokes the user's sessions
export function revokeTeamRole(db: Db, phone: BdPhone, operator: string): Promise<void>;
export function listTeam(db: Executor): Promise<TeamMember[]>;
```

- `AuthUser` becomes `{ id, phone, name, teamRoles: TeamRole[], restaurantIds, rider }`. `isAdmin` is gone. `requireRole(request, 'admin')` is replaced by `requirePermission(request, permission: Permission): AuthUser`, which gives 403 `forbidden` when `teamCan` is false.
- `Me` gains `teamRoles: TeamRole[]`. `roles` contains `'admin'` when `teamRoles` is not empty, so existing app gates keep working.
- `audienceIncludes` treats a user with `orders.read` as an admin. `GET /admin/orders` requires `orders.read`.
- `GET /v1/admin/team` returns `{ members: [{ userId, phone, name, role, grantedAt }] }` and needs `team.read`.
- CLI: `pnpm --filter @oregano/api team -- grant <phone> <role> --operator "<name>"`, plus `revoke <phone> --operator "<name>"` and `list`. It refuses to run without `--operator` and refuses an unknown role. Granting to a phone with no account creates the user.
- Demo seed: the admin 01711000004 becomes `superadmin`. Add `01711000006` as an `onboarding` member and `01711000007` as `support` (CLAUDE.md demo table updated in Task 20).

- [ ] **Step 1: Write the failing tests.**
  - `audit.test.ts`: `writeAudit` inserts one row; `UPDATE audit_log …` and `DELETE FROM audit_log …` each reject with the trigger's message.
  - `team.test.ts`:
    - `grantTeamRole` adds the role, writes `team.granted` with actor `operator`, and revokes the user's live sessions (asserted after Task 7 lands; until then assert the audit row and role only, and Task 7 adds the session assertion);
    - `revokeTeamRole` removes it;
    - a support-only user gets 403 on `GET /v1/admin/team` and 200 on `GET /v1/admin/orders`;
    - an onboarding user gets 403 on `/admin/team`;
    - `superadmin` gets 200 on both;
    - `GET /v1/me` for the seeded admin has `teamRoles: ['superadmin']` and `roles` containing `'admin'`.
  - Update the existing admin and identity tests that used `is_admin`.
- [ ] **Step 2: Run them and see them fail.** `pnpm --filter @oregano/api test -- audit team admin identity`
- [ ] **Step 3: Implement.** Write the schema, generate the migration plus a custom trigger migration, then the functions, the CLI (a `tsx` script reading `process.argv`, using `normalizeBdPhone`), the `requirePermission` swap and the seed change.
- [ ] **Step 4: Run the tests.** `pnpm --filter @oregano/api test`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(identity): team roles granted only by the operator CLI, and an append-only audit log`

### Task 5: SMS queue, provider chain and dev peek

**Files:**

- Create: `apps/api/src/notifications/sms/types.ts`, `providers.ts`, `queue.ts`, `schema.ts`, `sms.test.ts`, a migration
- Modify: `apps/api/src/worker.ts`, `apps/api/src/app.ts` (`Services`), `apps/api/src/identity/dev-routes.ts`, `apps/api/src/testing/app.ts`, `apps/api/src/server.ts`, `packages/i18n/src/en.ts`, `packages/i18n/src/bn.ts`

**Interfaces:**

- Table `sms_messages`:
  - columns: `id uuid, purpose text CHECK IN ('otp'), phone text, body_sealed text NULL, status text CHECK IN ('queued','sent','failed','expired'), attempts int DEFAULT 0, provider text NULL, provider_message_id text NULL, purge_after_send boolean, next_attempt_at, expires_at, created_at, sent_at NULL`;
  - a partial index on `(next_attempt_at) WHERE status = 'queued'`, and an index on `(phone, created_at DESC)`.
- Produces:

```ts
// types.ts
export interface SmsProvider { readonly name: string; send(phone: BdPhone, text: string): Promise<{ providerMessageId: string }>; }
export class SmsSendError extends Error { constructor(readonly provider: string, readonly retryable: boolean, message: string); }

// providers.ts
export class LoggingSmsProvider implements SmsProvider { /* name 'log'; logs masked phone and the text: development only */ }
export class CapturingSmsProvider implements SmsProvider { readonly sent: { phone: string; text: string }[]; failNext(times: number): void; }
export function createProviders(names: string[], log: Logger): SmsProvider[];  // throws for an unknown name; Task 21 adds real names

// queue.ts
export function enqueueSms(tx: Executor, deps: { keys: Config['dataKeys']; retainUntilExpiry: boolean },
  msg: { purpose: 'otp'; phone: BdPhone; text: string; expiresAt: Date }): Promise<string>;
export function dispatchSmsOnce(db: Db, deps: { keys: Config['dataKeys']; providers: SmsProvider[]; timeoutMs?: number }, batch?: number): Promise<number>;
export function startSmsDispatcher(db: Db, deps: …, opts?: { intervalMs?: number }): { stop(): Promise<void> };  // default 250 ms
export function peekLatestOtpText(db: Executor, keys: Config['dataKeys'], phone: BdPhone): Promise<string | null>;
```

- `dispatchSmsOnce`:
  - claims due `queued` rows with `FOR UPDATE SKIP LOCKED`;
  - opens each body (AAD = the row id);
  - tries the providers in order, each bounded by `timeoutMs` (default 5,000);
  - on success: `status='sent'`, records the provider and message id, and nulls `body_sealed` when `purge_after_send`;
  - when every provider fails: `attempts+1`, and `next_attempt_at` = now + 2 s, then 5 s, then 15 s;
  - past `expires_at`: `status='expired'`, body nulled;
  - a provider that failed 3 times in a row is skipped for 60 s (an in-memory breaker in the dispatcher).
- `Services.otpSender` is replaced by `Services.sms: { keys; retainUntilExpiry: boolean }`, with `retainUntilExpiry = config.devOtpPeek`.
- The worker starts `startSmsDispatcher` beside the relay, with `createProviders(config.smsProviders)`.
- `GET /v1/dev/otp/:phone` uses `peekLatestOtpText` and extracts the 6 digits.
- `withTestApp` exposes `otp.last(phone): Promise<string | undefined>` built on `peekLatestOtpText`. This is now async: update its callers.
- i18n keys `sms.otp` (en: `Your Oregano code is {code}. It expires in 5 minutes. Never share it.`; bn: `আপনার Oregano কোড {code}। 5 মিনিটে মেয়াদ শেষ হবে। কাউকে জানাবেন না।`). When `webOtpDomain` is set, the queued text gets `\n\n@{domain} #{code}` appended, which is the WebOTP format.

- [ ] **Step 1: Write the failing tests in `sms.test.ts`, against the real database.**
  - `enqueueSms` stores no plain text: `body_sealed` does not contain the text.
  - `dispatchSmsOnce` with `[Capturing A]` sends once and marks the row `sent` with provider A. With `purge_after_send`, `body_sealed` is null afterwards.
  - With A failing (`failNext(1)`) and B healthy, B sends and the row records B.
  - With both failing, the row stays `queued` with `attempts = 1` and `next_attempt_at` about 2 s ahead.
  - An expired row becomes `expired` with its body nulled and is never sent.
  - Two `dispatchSmsOnce` calls running at once send each row exactly once (count `sent` on Capturing).
  - A provider that hangs past `timeoutMs` counts as a failure.
- [ ] **Step 2: Run them and see them fail.** `pnpm --filter @oregano/api test -- sms`
- [ ] **Step 3: Implement.** Also check that the e2e servers still sign in: the e2e config already starts the worker; add `SMS_PROVIDERS=log` to its environment.
- [ ] **Step 4: Run the tests.** `pnpm --filter @oregano/api test` (callers of `otp.last` updated). Expected: PASS.
- [ ] **Step 5: Commit.** `feat(notifications): encrypted SMS queue drained by the worker through a failover chain`

### Task 6: OTP limits that hold

**Files:**

- Modify: `apps/api/src/identity/otp.ts`, `apps/api/src/identity/routes.ts`, `apps/api/src/identity/schema.ts`, `apps/api/src/identity/identity.test.ts`, `packages/contracts/src/auth.ts`, `packages/contracts/src/errors.ts`, `e2e/playwright.config.ts` (API env gains `LIMITS_PROFILE=relaxed`; the Plan 02 journeys sign in the same demo phones many times per run)
- Create: `apps/api/src/identity/otp-limits.test.ts`, a migration

**Interfaces:**

- Tables:
  - `otp_challenges` is rebuilt with `phone text PRIMARY KEY`, so a phone has at most one challenge (the unique constraint from the roadmap). Columns: `code_hash, expires_at, attempts (0..5), consumed_at, created_at`.
  - New `otp_events(id bigserial, kind text CHECK IN ('send','failure'), phone text, ip_hash text, created_at)`, with indexes on `(phone, kind, created_at)`, `(ip_hash, kind, created_at)` and `(kind, created_at)`.
- Produces:

```ts
export type OtpContext = { phone: BdPhone; ipHash: string; locale: 'en' | 'bn' };
export function requestOtp(
  db: Db,
  deps: { secret: string; limits: Limits; sms: Services['sms']; webOtpDomain: string | null },
  ctx: OtpContext,
): Promise<void>;
export function verifyOtp(
  db: Db,
  deps: { secret: string; limits: Limits },
  ctx: Omit<OtpContext, 'locale'>,
  code: string,
): Promise<void>; // throws AppError; on success the challenge is consumed inside the caller's tx (see below)
```

- `requestOtp` runs in one transaction under `pg_advisory_xact_lock(hashtext('otp:' || phone))`, and checks in this order:
  1. the phone is locked (failures in the last 24 h ≥ `otpFailuresPerPhoneDay`): `otp_locked`;
  2. the resend gap (the last `send` for this phone is under `otpResendSeconds` old): `otp_resend_too_soon`, with a `Retry-After` header of the remaining seconds;
  3. phone hour and day counts, then IP hour and day counts: `otp_rate_limited`;
  4. the platform hour count: `sms_unavailable`, plus an error log `sms_budget_exceeded`.

  Then it upserts the challenge (`attempts = 0`), inserts a `send` event and enqueues the SMS in the same transaction.
- `verifyOtp`, in this order:
  1. the IP failures in the last hour ≥ `otpFailuresPerIpHour`: `otp_rate_limited`;
  2. the phone is locked: `otp_locked`;
  3. the challenge checks as before.

  A wrong code increments `attempts` and inserts a `failure` event in its own committed statement. The 5th wrong try burns the code. A correct code is consumed with `UPDATE … WHERE phone = $1 AND code_hash = $2 AND consumed_at IS NULL`, so a code replaced in the meantime fails as `otp_invalid`.
- `OtpRequestBody` gains `locale: z.enum(['en','bn']).optional()`.
- New error codes: `otp_resend_too_soon`, `otp_rate_limited`, `otp_locked`, `sms_unavailable`.
- When a phone becomes locked, write a warn-level log `otp_phone_locked`, with the masked phone and the IP hash.
- Operator CLI: `pnpm --filter @oregano/api otp -- unlock <phone> --operator "<name>"`, in `apps/api/src/identity/otp-cli.ts`. It deletes that phone's `failure` events and writes the audit row `otp.unlocked` (add it to `AuditAction`), with actor `operator`.
- The routes compute `ipHash = hashIp(subkey(config.otpSecret,'ip-hash'), request.ip)`.

- [ ] **Step 1: Write the failing tests in `otp-limits.test.ts`.** Use `inject({ remoteAddress })` and fresh phones per test.
  - A second request within 60 s gives 429 `otp_resend_too_soon` with a `retry-after` header between 1 and 60. After moving the last `send` event back 61 s, it gives 202.
  - The 6th send for one phone within an hour (gap bypassed by moving events back) gives `otp_rate_limited`. The 11th within 24 h does too.
  - 21 phones from one IP: the 21st gives `otp_rate_limited`. The same phone from a new IP is still limited by the phone limits.
  - Five wrong codes, a new code, five wrong codes, then the correct code gives `otp_locked`. A new request for that phone also gives `otp_locked`. This is the "counts survive a new code" requirement.
  - Rotating IPs: 10 failures for one phone spread over 10 IPs gives `otp_locked` (Review Focus 2).
  - One IP, 31 wrong codes across 31 phones: the 31st gives `otp_rate_limited` even for a phone with no failures.
  - The global cap (`limits.otpSendsGlobalHour: 3`): the 4th phone gives 503 `sms_unavailable`, and no challenge or SMS row is written for it.
  - Two simultaneous requests for one phone leave exactly one challenge row and one SMS row, and the other gets `otp_resend_too_soon`.
  - Two simultaneous correct verifies: exactly one 200.
  - The code in the queued SMS matches the challenge. The Bangla locale queues the Bangla text.
  - After a lock, `otp unlock` with `--operator` lets the phone request a code again and writes one `otp.unlocked` audit row. Without `--operator` it refuses.
- [ ] **Step 2: Run them and see them fail.** `pnpm --filter @oregano/api test -- otp-limits identity`
- [ ] **Step 3: Implement.** Keep the Plan 02 identity tests passing; the "a new request replaces the earlier code" test now waits out the gap by moving the event back.
- [ ] **Step 4: Run the gate.** `pnpm verify`. Expected: PASS, including the Plan 02 browser journeys under `LIMITS_PROFILE=relaxed`.
- [ ] **Step 5: Commit.** `feat(identity): per-phone, per-IP and platform OTP limits; failures survive a new code`

### Task 7: Sessions with short access tokens and rotating refresh tokens

**Files:**

- Modify: `apps/api/src/identity/sessions.ts`, `apps/api/src/identity/auth.ts`, `apps/api/src/identity/routes.ts`, `apps/api/src/identity/schema.ts`, `apps/api/src/identity/team.ts`, `apps/api/src/app.ts`, `apps/api/src/testing/app.ts`, `apps/api/src/events/outbox.ts`, `apps/api/src/events/relay.ts`, `apps/api/src/events/realtime.ts`, `packages/contracts/src/auth.ts`, `apps/api/package.json`
- Modify, with the minimal change only, so the gate stays green until Task 8:
  - `packages/api-client/src/client.ts`: `verifyOtp` returns the new `SessionResponse`;
  - `packages/app-core/src/session.tsx`: `signIn` stores `accessToken` where it stored `token`;
  - `e2e/journey.ts`: `signInWithApi` reads `accessToken`.

  These all run in body mode, which works because Expo web and admin still send the Bearer token. Task 8 then switches web to cookie mode.
- Create: `apps/api/src/identity/sessions.test.ts`, a migration (drops `sessions`, creates the two tables below; signing everyone out is fine before launch)

**Interfaces:**

- Tables:
  - `auth_sessions(id uuid, user_id → users ON DELETE CASCADE, client text CHECK IN ('web','native'), created_at, last_used_at, absolute_expires_at, revoked_at NULL, revoke_reason text NULL CHECK IN ('logout','reuse_detected','team_change','operator'))`.
  - `auth_tokens(id uuid, session_id → auth_sessions ON DELETE CASCADE, kind text CHECK IN ('access','refresh'), token_hash text UNIQUE, parent_id uuid NULL, expires_at, used_at NULL, created_at)`, with indexes on `(session_id)` and `(parent_id)`.
- Produces:

```ts
export type IssuedTokens = { accessToken: string; accessExpiresAt: Date; refreshToken: string; refreshExpiresAt: Date };
export function startSession(
  tx: Executor,
  user: AuthUser,
  client: 'web' | 'native',
  limits: SessionLimits,
): Promise<IssuedTokens & { sessionId: string }>;
export function refreshSession(
  db: Db,
  refreshToken: string,
  limits: SessionLimits,
): Promise<IssuedTokens | 'invalid' | 'reused'>;
export function authenticateAccess(
  db: Executor,
  accessToken: string,
): Promise<{ user: AuthUser; sessionId: string; expiresAt: Date } | null>;
export function revokeSession(tx: Executor, sessionId: string, reason: RevokeReason): Promise<void>;
export function revokeUserSessions(tx: Executor, userId: string, reason: RevokeReason): Promise<void>;
export type SessionLimits = {
  accessSeconds: 900;
  refreshDays: 60;
  absoluteDays: 180;
  teamAbsoluteHours: 12;
  reuseGraceSeconds: 30;
};
```

- `refreshSession` runs in one transaction, locking the presented refresh row and its session `FOR UPDATE`:
  - **Unknown, revoked, expired, or past `absolute_expires_at`:** `'invalid'`.
  - **`used_at` is null:** set `used_at = now()`. Issue a new access token and a new refresh token, with `parent_id` = the presented refresh token and refresh expiry = min(now + 60 days, absolute).
  - **`used_at` within 30 s, and the token has fewer than 3 children:** issue a fresh sibling pair with the same `parent_id`. Earlier children stay valid. Never supersede them: two tabs' `Set-Cookie` responses can arrive in either order, so whichever sibling ends up in the shared cookie must still work. This is the grace rule.
  - **Otherwise** (used more than 30 s ago, or a 4th child asked for): `revokeSession(…, 'reuse_detected')`, write the `session.reuse_detected` audit row, write an outbox `session.revoked` event, and return `'reused'`.
- `authenticateAccess` is one query joining `auth_tokens` (kind access, not expired), `auth_sessions` (not revoked, not past absolute) and the user load. It updates `last_used_at` at most once a minute.
- The `onRequest` hook sets `request.user` and `request.sessionId`.
- Contracts:

```ts
export const SessionResponse = z.object({
  accessToken: z.string(),
  accessExpiresAt: z.iso.datetime(),
  refreshToken: z.string().nullable(),
  user: Me,
});
export const RefreshBody = z.object({ refreshToken: z.string().min(20).max(200).optional() });
export const RefreshResponse = SessionResponse.omit({ user: true });
```

- Transport follows the Global Constraints rule. Use `@fastify/cookie`; CORS gets `credentials: true`.
- `POST /auth/logout` revokes the session from the access token, or else from the refresh token in the body or cookie, clears the cookie, and returns 204.
- Outbox topics: `session.revoked { sessionId }` and `user.access_changed { userId }`, written by `revokeSession`, `revokeUserSessions` and every later task that changes a user's roles, memberships or rider status.
- `RealtimeHub` changes:
  - It dispatches on topic: the relay now publishes `{ topic, payload }`, so update `relayOnce`'s message and the hub's parser together.
  - It keeps `{ socket, user, sessionId, expiresAt }` and closes with 4401 when `expiresAt` passes, when its session is revoked, or when its user's access changes.
  - Authentication uses `authenticateAccess`.
- `grantTeamRole` and `revokeTeamRole` call `revokeUserSessions(…, 'team_change')`; finish Task 4's pending session assertion.

- [ ] **Step 1: Write the failing tests in `sessions.test.ts`.**
  - Verify with no `Origin` gives `refreshToken` as a string and no `set-cookie`.
  - Verify with `Origin: http://localhost:8081` (allowed) gives `refreshToken: null` and a `set-cookie` with `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/v1/auth`.
  - Verify with `Origin: https://evil.example` gives 403.
  - The access token works on `/v1/me`. After moving its `expires_at` into the past it gives 401.
  - Refresh rotates: the new access token works, and the old refresh token is marked used.
  - **Grace (lost response):** refresh with R1 → (A2, R2), and the response is lost. Refresh with R1 again within 30 s → 200 (A3, R3). Both R2 and R3 can each refresh successfully once more, and the session is not revoked.
  - **Two tabs:** two simultaneous refreshes with R1 both give 200 (R2 and R3). Whichever reaches the cookie last, R2 or R3, refreshes successfully, and the session is not revoked.
  - A 4th refresh with R1 inside the grace window revokes the session.
  - **Reuse:** refresh with R1 → R2. Use R2 → R3. Then R1 again after the grace (move `used_at` back 31 s) gives 401. The whole session is revoked (A3 now 401), the audit row exists, and the outbox has `session.revoked`.
  - Cookie-mode refresh without `X-Oregano-Client: web` gives 403.
  - A team member's session has `absolute_expires_at` 12 h out; a customer's is 180 days.
  - Logout revokes the session and clears the cookie (`Max-Age=0`).
  - `grantTeamRole` revokes the user's sessions.
  - Realtime: a socket authenticated with an access token is closed with 4401 when the session is revoked (publish through the relay) and when the token expires (a short `accessSeconds` in this test).
- [ ] **Step 2: Run them and see them fail.** `pnpm --filter @oregano/api test -- sessions realtime identity`
- [ ] **Step 3: Implement.** Update `withTestApp.signIn` to return the access token (body mode), every test that read `.token`, and the minimal client changes listed under Files.
- [ ] **Step 4: Run the gate.** `pnpm verify`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(identity): 15-minute access tokens, rotating refresh tokens with reuse detection and a 3G grace window`

### Task 8: Clients: silent refresh, the cookie on web, realtime re-auth, every error mapped

**Files:**

- Modify: `packages/api-client/src/client.ts`, `packages/api-client/src/client.test.ts`, `packages/api-client/src/realtime.ts`, `packages/api-client/src/realtime.test.ts`, `packages/app-core/src/session.tsx`, `packages/app-core/src/realtime.tsx`, `packages/app-core/src/index.ts`, `packages/app-core/package.json`, `apps/*/src/components.tsx` (remove the local `errorKey`), `apps/admin/src/*`, `apps/api/src/clients/client.test.ts`, `packages/i18n/src/en.ts`, `packages/i18n/src/bn.ts`, `e2e/journey.ts`
- Pre-signed-in browsers in `e2e/journey.ts` used to write the token to `localStorage` (`oregano.session`), which no longer works. Replace that with:
  1. a verify call through `context.request`, which shares the browser context's cookie jar, with `Origin: <app url>`, so the refresh cookie lands in the context;
  2. an init script that sets `localStorage['oregano.hasSession'] = '1'`.
- Create: `packages/app-core/src/errors.ts`, `packages/app-core/src/errors.test.ts`

**Interfaces:**

- Produces:

```ts
// api-client
export type SessionStore = {
  mode: 'cookie' | 'body';
  getAccessToken(): string | null;
  getRefreshToken(): string | null; // always null in cookie mode
  save(tokens: { accessToken: string; refreshToken: string | null }): void;
  clear(): void;
};
export function createApiClient(opts: {
  baseUrl: string;
  session: SessionStore;
  onSignedOut?: () => void;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): ApiClient;
// ApiClient gains: refresh(): Promise<boolean>  (single-flight; false = signed out)
// ApiClient.verifyOtp keeps its signature and calls session.save itself.
// Requests to /v1/auth/* use credentials: 'include' in cookie mode and send X-Oregano-Client: web.

// app-core
export function createWebSessionStore(): SessionStore; // access token in memory; only a non-secret 'oregano.hasSession' = '1' in localStorage; removes the old 'oregano.session' key on creation
export function createMemorySessionStore(): SessionStore; // native, body mode, until Plan 10 adds the keystore
export function errorMessageKey(error: unknown): MessageKey; // exhaustive Record<ErrorCode, MessageKey>; status 0 → offline key
```

- On a 401 from any route outside `/v1/auth/`, the client calls `refresh()` (shared by all concurrent callers), then retries the original request once with the same headers, including the same `Idempotency-Key`. If the refresh fails, the client clears the session and calls `onSignedOut`.
- `useSession`:
  - `isSignedIn` is true when an access token is held, or (web) when `hasSession` is set.
  - At start-up with `hasSession` and no access token, it calls `refresh()` once.
  - A network failure keeps `isSignedIn` true, which is the Plan 02 offline rule.
  - `ApiProvider` takes `session: SessionStore` instead of `storage`.
- The realtime client gets its token from `getAccessToken()`. On close 4401 it awaits `refresh()` and reconnects; when the refresh fails it stops.
- `errorMessageKey` covers every `ERROR_CODES` entry, including those added by later tasks: each task adds its keys here.

- [ ] **Step 1: Write the failing tests.**
  - `client.test.ts` (fake fetch):
    - two concurrent requests get 401, and exactly one `/v1/auth/refresh` call is made, after which both originals are retried once and succeed;
    - a retried `placeOrder` carries the same `idempotency-key`;
    - a failed refresh calls `onSignedOut` once and clears the session;
    - cookie mode sends `credentials: 'include'` and `x-oregano-client: web` only on `/v1/auth/*`;
    - body mode puts `refreshToken` in the refresh body.
  - `errors.test.ts`: every `ERROR_CODES` value maps to a key present in both `en` and `bn`.
  - `apps/api/src/clients/client.test.ts` (real API): verify, then expire the access token in the database, then `me()` still succeeds through a silent refresh.
  - `realtime.test.ts`: on close 4401 the client refreshes and reconnects with the new token.
- [ ] **Step 2: Run them and see them fail.** `pnpm --filter @oregano/api-client test && pnpm --filter @oregano/app-core test && pnpm --filter @oregano/api test -- clients`
- [ ] **Step 3: Implement, and switch every app's provider.** The three Expo apps use `createWebSessionStore()` on web and `createMemorySessionStore()` on native (`Platform.OS`); admin uses `createWebSessionStore()`.
- [ ] **Step 4: Run the gate.** `pnpm verify`. Expected: PASS, including the Plan 02 browser journeys, which now sign in through the cookie.
- [ ] **Step 5: Commit.** `feat(clients): silent single-flight refresh, httpOnly refresh cookie on web, realtime re-auth, every error code has copy`

### Task 9: Rate limits on every route, the open-order cap, WebSocket caps

**Files:**

- Create: `apps/api/src/security/rate-limit.ts`, `apps/api/src/security/rate-limit.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/ordering/service.ts`, `apps/api/src/ordering/place-order.test.ts`, `apps/api/src/catalog/routes.ts`, `apps/api/src/identity/routes.ts`, `apps/api/src/events/realtime.ts`, `apps/api/src/events/realtime.test.ts`, `packages/contracts/src/errors.ts`, `apps/api/package.json`

**Interfaces:**

- Produces:

```ts
export function registerRateLimits(app: FastifyInstance, deps: { redis: Redis; limits: Limits; prefix: string }): Promise<void>;
export const routeLimit: {
  orders: RouteRateLimit; restaurantList: RouteRateLimit; refresh: RouteRateLimit; uploads: RouteRateLimit;
}; // per-route `config.rateLimit` objects
```

- Use `@fastify/rate-limit` (read its docs: Redis store, `keyGenerator`, `hook`, `skipOnError`, `nameSpace`, per-route config, `errorResponseBuilder`):
  - `hook: 'preHandler'`, so `request.user` is known;
  - `skipOnError: true`, so Redis being down fails open (log a warning once a minute);
  - keys are `u:<userId>` for writes by a signed-in user and `ip:<ipHash>` otherwise;
  - the 429 body is the standard error envelope with `rate_limited` and the message `Too many requests. Wait a minute and try again.`, plus `Retry-After`.
- `Services` gains `redis: Redis`: one shared client, `maxRetriesPerRequest: 1`, `commandTimeout: 2000`.
- `placeOrder`: inside its transaction, take `pg_advisory_xact_lock(hashtext('orders:' || customerId))`, count the customer's non-terminal orders (`isTerminal` from `@oregano/domain`; export the status list, which removes the Plan 02 hard-coded SQL list), and throw 409 `too_many_open_orders` at 3 or more. An idempotent replay returns the stored response before the count.
- WebSocket:
  - upgrades are rate-limited per IP in an `onRequest` hook on `/v1/realtime`;
  - the hub keeps `Map<ipHash, number>`; the 21st open connection is closed with 4429.
- CORS `exposedHeaders` becomes `['x-request-id', 'retry-after']`, so web apps can show the countdown. Test the header is exposed.
- New error codes: `rate_limited`, `too_many_open_orders`.

- [ ] **Step 1: Write the failing tests.**
  - `rate-limit.test.ts` (real Redis, limits overridden small):
    - the 4th `GET /v1/restaurants` from one IP with `restaurantListPerIpMinute: 3` gives 429 `rate_limited` with `retry-after`, while another IP still gets 200;
    - the 4th `POST /v1/orders` by one user with `ordersPerUserTenMinutes: 3` gives 429 across different idempotency keys;
    - writes are keyed by user, not IP: two users on one IP each get their own budget;
    - with Redis pointed at a closed port, requests still succeed (fail open).
  - `place-order.test.ts`: a 4th open order gives 409 `too_many_open_orders`; after one is delivered (through `transition`), a new one succeeds; 4 concurrent placements with different keys give exactly 3 orders.
  - `realtime.test.ts`: the 21st socket from one IP is closed with 4429.
- [ ] **Step 2: Run them and see them fail.** `pnpm --filter @oregano/api test -- rate-limit place-order realtime`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** `pnpm --filter @oregano/api test`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(api): Redis-backed per-IP and per-user limits on every route, three open orders per customer, WebSocket caps`

### Task 10: Retention sweeper in the worker

**Files:**

- Create: `apps/api/src/worker/sweeper.ts`, `apps/api/src/worker/sweeper.test.ts`
- Modify: `apps/api/src/worker.ts`, `apps/api/src/identity/otp.ts`, `apps/api/src/identity/sessions.ts`, `apps/api/src/notifications/sms/queue.ts`

**Interfaces:**

- Each module exports its own prune function. The sweeper only composes them, which keeps module ownership.

```ts
export type SweepJob = { name: string; run(db: Db, now: Date): Promise<number> }; // returns rows affected
export function runSweepOnce(db: Db, jobs: SweepJob[], now?: Date): Promise<Record<string, number>>;
export function startSweeper(db: Db, jobs: SweepJob[], opts?: { intervalMs?: number }): { stop(): Promise<void> }; // default 300 000 ms; logs counts, never rows
// identity: pruneOtp(db, now) — otp_events > 48 h, otp_challenges expired > 24 h
// identity: pruneSessions(db, now) — auth_tokens expired > 7 d, revoked auth_sessions > 30 d
// notifications: pruneSms(db, now) — null body_sealed past expires_at, delete rows > 30 d
```

- [ ] **Step 1: Write the failing tests.** For each job, insert one row just inside and one just outside its window; after `runSweepOnce` only the outside one is gone or purged. Running twice changes nothing the second time. One failing job (a throwing stub) does not stop the others; the error is logged.
- [ ] **Step 2: Run them and see them fail.** `pnpm --filter @oregano/api test -- sweeper`
- [ ] **Step 3: Implement, and start the sweeper in `worker.ts`.**
- [ ] **Step 4: Checkpoint A.** Run `pnpm verify`; expected PASS. Then run the clean-container recipe in CLAUDE.md, with the branch name changed to this plan's branch; expected PASS.
- [ ] **Step 5: Commit.** `feat(worker): retention sweeper for OTP, SMS and session rows`

Part A is done. The API still must not be exposed until Task 21 gives it two real SMS providers, and production refuses to start without them.

---

## Part B: Onboarding

### Task 11: Object storage and the document vault

**Files:**

- Create: `apps/api/src/media/store.ts`, `apps/api/src/media/vault.ts`, `apps/api/src/media/schema.ts`, `apps/api/src/media/image.ts`, `apps/api/src/media/vault.test.ts`, `apps/api/src/media/fixtures/` (test images listed below), a migration
- Modify: `infra/docker-compose.yml`, `.github/workflows/ci.yml`, `apps/api/src/config.ts`, `apps/api/.env.example`, `pnpm-workspace.yaml` (`allowBuilds` for `sharp`), `apps/api/package.json`, `apps/api/src/testing/app.ts`, `e2e/global-setup.ts`

**Interfaces:**

- **Local S3-compatible server.** First check whether the MinIO community image is still published and maintained. If not, use SeaweedFS (`weed server -s3`) or Garage. Record the choice and the reason in the ledger. Add it to docker-compose (port 9000, a volume) and as a CI service.
  - GitHub Actions `services` cannot pass a container command, and these servers need one (`server /data`, `server -s3`). Start the server in `ci.yml` with a `docker run -d … ` step and a readiness wait before `pnpm verify`. Check the current Actions docs first; if `services` now supports a command, use it.
  - If the safety classifier blocks the `ci.yml` edit, stop and ask the user (Plan 02 rule).
  - Buckets: `oregano` (dev), `oregano-test`, `oregano-e2e`. Each is created on first use by `ensureBucket`, outside production.
- Table `identity_documents`:
  - columns: `id uuid, subject_type text CHECK IN ('rider','restaurant_application'), subject_id uuid, kind text, status text CHECK IN ('pending','stored','deleted'), storage_key text NULL, sealed_key jsonb NULL, byte_size int NULL, uploaded_by uuid, uploaded_at, review_outcome text NULL CHECK IN ('accepted','rejected'), reviewed_by uuid NULL, reviewed_at NULL, delete_after NULL, deleted_at NULL, deleted_reason text NULL CHECK IN ('decision_retention','abandoned','replaced','upload_failed')`;
  - a CHECK that `kind` is one of the `DocumentKind` values below;
  - a partial unique index on `(subject_type, subject_id, kind) WHERE status = 'stored'`.
- Produces:

```ts
// store.ts
export interface ObjectStore {
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
export function createS3Store(cfg: Config['s3']): ObjectStore & { ensureBucket(): Promise<void> }; // @aws-sdk/client-s3; server-side encryption header sent in production

// image.ts
export type ImageCheck =
  | { ok: true; jpeg: Buffer }
  | { ok: false; code: 'unsupported_document' | 'document_too_large' };
export function normaliseDocumentImage(input: Buffer): Promise<ImageCheck>; // magic bytes → sharp(limitInputPixels 40e6).rotate().resize(2000,2000,{fit:'inside',withoutEnlargement:true}).jpeg({quality:82}); metadata not kept

// vault.ts
export const DOCUMENT_KINDS = [
  'nid_front',
  'nid_back',
  'photo',
  'trade_licence',
  'owner_nid_front',
  'owner_nid_back',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type DocumentSubject = { type: 'rider' | 'restaurant_application'; id: string };
export function storeDocument(
  deps: VaultDeps,
  subject: DocumentSubject,
  kind: DocumentKind,
  upload: Buffer,
  uploadedBy: string,
): Promise<DocumentSummary>;
export function readDocument(deps: VaultDeps, documentId: string): Promise<Buffer | 'deleted' | null>;
export function listDocuments(db: Executor, subject: DocumentSubject): Promise<DocumentSummary[]>; // kinds, status, uploadedAt, outcome; never keys
export function recordDecision(
  tx: Executor,
  subject: DocumentSubject,
  outcome: 'accepted' | 'rejected',
  reviewerId: string,
  deleteAfter: Date,
): Promise<void>;
export function deleteDocumentContent(deps: VaultDeps, documentId: string, reason: DeletedReason): Promise<void>; // idempotent; audits 'document.deleted' (system)
export function pruneDocuments(
  deps: VaultDeps,
  now: Date,
  isAbandoned: (subject: DocumentSubject) => Promise<boolean>,
): Promise<number>;
export type VaultDeps = { db: Db; store: ObjectStore; keys: Config['dataKeys'] };
```

- `storeDocument` order, so there are no unfindable orphans:
  1. normalise (reject before any write);
  2. commit a `pending` row with its `storage_key`;
  3. `newDataKey` (AAD = the document id), `encryptBytes`, `put`;
  4. in one transaction, mark the row `stored`, mark any earlier `stored` row of the same kind `deleted` (`replaced`), and audit `document.uploaded`;
  5. delete the replaced object's content.
- `pruneDocuments` deletes content where `delete_after <= now`, where the row is `pending` and older than 1 hour, and where the subject is abandoned (the predicate comes from onboarding, Task 12). Register it as a sweep job.
- Multipart: register `@fastify/multipart` with limits `{ fileSize: 8 MB, files: 1, fields: 0 }`. A truncated or oversized file gives 413 `document_too_large`. Add the error codes `unsupported_document`, `document_too_large`, `document_deleted` and `link_expired`.
- Fixtures (small, committed, made by a script in the fixtures folder):
  - `ok.jpg` with EXIF GPS tags;
  - `ok.png` and `ok.webp`;
  - `fake.jpg` (a PDF renamed);
  - `polyglot.jpg` (JPEG magic followed by HTML);
  - `bomb.png` (a 20000 × 20000 PNG, compressed small).

- [ ] **Step 1: Write the failing tests in `vault.test.ts`, against the real database and the real S3 server.**
  - `ok.jpg` is stored. The object in S3 is not a JPEG (no `FFD8FF` at the start) and does not contain the GPS bytes. `readDocument` returns a JPEG whose sharp metadata has no `exif`, and whose longest edge is ≤ 2000.
  - `fake.jpg` gives `unsupported_document`, and no row or object is written.
  - `polyglot.jpg` is either rejected, or stored as a re-encoded JPEG that no longer contains `<html`.
  - `bomb.png` gives `unsupported_document`.
  - A second upload of the same kind leaves exactly one `stored` row. The old row is `deleted`/`replaced`, and its object is gone.
  - `deleteDocumentContent` removes the object, nulls `storage_key` and `sealed_key`, and keeps `kind`, `reviewed_by` and `review_outcome`. `readDocument` then gives `'deleted'`.
  - `pruneDocuments` deletes content past `delete_after` and a `pending` row older than 1 hour, and leaves a fresh row alone.
  - Unwrapping with a different `DATA_KEYS` key fails.
- [ ] **Step 2: Run them and see them fail.** `pnpm db:up && pnpm --filter @oregano/api test -- vault`
- [ ] **Step 3: Install and implement.** Install `sharp`, `@aws-sdk/client-s3` and `@fastify/multipart` after reading their docs, and approve sharp's build script in `allowBuilds` after reading what it runs.
- [ ] **Step 4: Run the tests.** `pnpm --filter @oregano/api test`. Expected: PASS. Also run `pnpm audit --audit-level high`, which must stay clean.
- [ ] **Step 5: Commit.** `feat(media): encrypted, metadata-stripped identity document vault on private object storage`

### Task 12: Restaurant applications (applicant side)

**Files:**

- Create: `apps/api/src/onboarding/schema.ts`, `restaurant-applications.ts`, `routes.ts`, `restaurant-applications.test.ts`, `packages/contracts/src/onboarding.ts`, a migration
- Modify: `apps/api/src/catalog/schema.ts`, `apps/api/src/catalog/repo.ts`, `apps/api/src/catalog/catalog.test.ts`, `apps/api/src/ordering/service.ts`, `apps/api/src/dev/seed-demo.ts`, `apps/api/src/app.ts`, `apps/api/src/db/schema.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/errors.ts`

**Interfaces:**

- `restaurants.status text NOT NULL CHECK IN ('approved','suspended')`, with no default. A custom migration backfills existing rows to `approved`, and the seed sets it explicitly. The list and detail queries, and the restaurant lookup in `placeOrder`, filter `status = 'approved'`; a suspended restaurant gives 422 `restaurant_closed` at placement.
- Table `restaurant_applications`:
  - columns: `id uuid, applicant_user_id → users, created_by_user_id uuid NULL (a team member for door 1), status text CHECK IN ACCOUNT_STATUSES except 'suspended', restaurant_name, cuisine, address_line, restaurant_phone text NULL, owner_name, payout_method text CHECK IN ('bkash','nagad','bank'), payout_account_sealed text, payout_account_last4 text, no_trade_licence boolean DEFAULT false, licence_waived boolean DEFAULT false, rejection_reason text NULL, reviewed_by uuid NULL, reviewed_at NULL, submitted_at NULL, restaurant_id uuid NULL, last_activity_at, created_at`;
  - a partial unique index on `(applicant_user_id) WHERE status IN ('applied','under_review','rejected')`: one open application per user (a rejected one stays open for resubmission).
- Contracts:

```ts
export const RestaurantApplicationBody = z.object({
  restaurantName: z.string().trim().min(2).max(80),
  cuisine: z.string().trim().min(2).max(60),
  addressLine: z.string().trim().min(5).max(200),
  restaurantPhone: z.string().trim().max(30).nullable(),
  ownerName: z.string().trim().min(2).max(80),
  payoutMethod: z.enum(['bkash', 'nagad', 'bank']),
  payoutAccount: z
    .string()
    .trim()
    .regex(/^[0-9 -]{6,34}$/),
});
export const RestaurantApplicationView = z.object({
  id: z.uuid(),
  status: z.enum(ACCOUNT_STATUSES),
  details: RestaurantApplicationBody.omit({ payoutAccount: true }).extend({ payoutAccountLast4: z.string() }),
  documents: z.array(DocumentSummary),
  missing: z.array(z.enum(DOCUMENT_KINDS)),
  rejectionReason: z.string().nullable(),
  noTradeLicence: z.boolean(),
  restaurantId: z.uuid().nullable(),
});
export const DocumentSummary = z.object({
  id: z.uuid(),
  kind: z.enum(DOCUMENT_KINDS),
  uploadedAt: z.iso.datetime(),
  outcome: z.enum(['accepted', 'rejected']).nullable(),
});
```

- `restaurantPhone`, if given, must pass `normalizeBdPhone`. The payout account is stored with `sealString` (AAD = the application id) and is never returned; only the last 4 digits are.
- Required documents: `owner_nid_front` and `owner_nid_back`, plus `trade_licence` unless the applicant submits with `noTradeLicence: true`.
- `PUT` and the uploads are allowed only in `applied` or `rejected`; otherwise 409 `application_not_editable`. Submit uses `accountTransition`: `submit` from `applied`, `resubmit` from `rejected`. Every change sets `last_activity_at` and audits (`application.created`, `application.submitted`, `document.uploaded`).
- Exports for later tasks: `restaurantApplicationAbandoned(db, id): Promise<boolean>` (not approved and `last_activity_at` older than 30 days) and `pruneRestaurantApplicationDetails(db, now)` (clears the payout fields of rejected or abandoned applications after 30 days). Register both with the sweeper and vault.
- New error codes: `application_not_editable`, `application_incomplete`, `application_exists`.

- [ ] **Step 1: Write the failing tests in `restaurant-applications.test.ts`.**
  - Create, then `GET` returns `status: 'applied'` and `missing: ['owner_nid_front','owner_nid_back','trade_licence']`.
  - The database `payout_account_sealed` does not contain the number, and the view shows only `payoutAccountLast4`.
  - Submit with documents missing gives 422 `application_incomplete`.
  - Upload all three, submit, and get `under_review`. `PUT` then gives 409 `application_not_editable`.
  - With `noTradeLicence: true`, only the two NID documents are required.
  - A second user cannot see or upload to the first user's application: each user only has `/mine`. Add a test for the absence of any id-addressed applicant route.
  - The catalog list hides a `suspended` restaurant and shows `approved` ones; ordering from a suspended one gives 422 `restaurant_closed`.
- [ ] **Step 2: Run them and see them fail.** `pnpm --filter @oregano/api test -- restaurant-applications catalog place-order`
- [ ] **Step 3: Implement.** The routes call `storeDocument` from media with `subject: { type: 'restaurant_application', id }`.
- [ ] **Step 4: Run the tests.** `pnpm --filter @oregano/api test`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(onboarding): Partner with Oregano application with documents; restaurants gain a status`

### Task 13: Rider applications (applicant side), agencies and zones

**Files:**

- Create: `apps/api/src/onboarding/rider-applications.ts`, `apps/api/src/onboarding/rider-applications.test.ts`, `apps/api/src/zones/routes.ts`, a migration
- Modify: `apps/api/src/onboarding/schema.ts`, `apps/api/src/onboarding/routes.ts`, `apps/api/src/identity/schema.ts`, `apps/api/src/identity/sessions.ts`, `apps/api/src/identity/auth.ts`, `packages/contracts/src/onboarding.ts`, `packages/contracts/src/auth.ts`, `packages/contracts/src/errors.ts`, `apps/api/src/app.ts`

**Interfaces:**

- `riders` gains:
  - columns: `vehicle_type text NULL CHECK IN VEHICLE_TYPES, vehicle_registration text NULL, guarantor_name text NULL, guarantor_phone text NULL, guarantor_relation text NULL, agency_id uuid NULL → agencies, restaurant_id uuid NULL → restaurants, rejection_reason text NULL, suspended_reason text NULL, reviewed_by uuid NULL, reviewed_at NULL, submitted_at NULL, last_activity_at`;
  - CHECKs: `type = 'agency'` ⇔ `agency_id IS NOT NULL`, and `type = 'restaurant_staff'` ⇔ `restaurant_id IS NOT NULL`;
  - the backfill gives the demo riders `vehicle_type = 'motorcycle'` and `last_activity_at = now()`.
- New tables:
  - `agencies(id uuid, name text, contact_phone text, code text UNIQUE, status text CHECK IN ('approved','suspended'), created_at)`;
  - `rider_invites(restaurant_id → restaurants ON DELETE CASCADE, phone text, invited_by uuid, created_at, PRIMARY KEY (restaurant_id, phone))`. The owner routes arrive in Task 16; this task only reads it.
- Contracts:

```ts
export const ZoneSummary = z.object({ id: z.uuid(), name: z.string() });
export const RiderApplicationBody = z.object({
  type: z.enum(RIDER_TYPES),
  zoneId: z.uuid(),
  name: z.string().trim().min(2).max(80),
  agencyCode: z.string().trim().toUpperCase().length(8).optional(),
  vehicleType: z.enum(VEHICLE_TYPES),
  vehicleRegistration: z.string().trim().max(30).nullable(),
  guarantor: z.object({
    name: z.string().trim().min(2).max(80),
    phone: z.string().trim().max(30),
    relation: z.string().trim().min(2).max(40),
  }),
});
export const RiderApplicationView = z.object({
  status: z.enum(ACCOUNT_STATUSES),
  type: z.enum(RIDER_TYPES),
  zoneId: z.uuid(),
  agencyName: z.string().nullable(),
  restaurantName: z.string().nullable(),
  details: RiderApplicationBody.omit({ agencyCode: true }),
  documents: z.array(DocumentSummary),
  missing: z.array(z.enum(DOCUMENT_KINDS)),
  rejectionReason: z.string().nullable(),
  suspendedReason: z.string().nullable(),
});
// Me.rider becomes { zoneId, isOnline, status: AccountStatus, type: RiderType } | null
```

- The first `PUT /onboarding/rider` creates the `riders` row (`applied`) and sets `users.name`. The type needs:
  - `agency`: an `approved` agency with that code, else 422 `agency_code_invalid`;
  - `restaurant_staff`: a `rider_invites` row for the user's phone, else 422 `rider_invite_missing`, and that restaurant is bound;
  - `vehicleRegistration` when `vehicleNeedsRegistration`, else `validation_failed`.
- The guarantor phone must pass `normalizeBdPhone` and must differ from the rider's own phone.
- Required documents: `nid_front`, `nid_back`, `photo`.
- Editing and submitting follow the same rules as Task 12. A change to type or agency after `approved` is refused (409 `application_not_editable`).
- Exports: `riderApplicationAbandoned`, and `pruneRiderApplicationDetails`, which clears the guarantor and vehicle fields of rejected or abandoned riders after 30 days. Register both.
- `GET /v1/zones` lists active zones.
- `AuthUser.rider` gains `type`, `agencyActive: boolean` and `restaurantId: string | null`, all loaded in the same `loadUser` query.

- [ ] **Step 1: Write the failing tests in `rider-applications.test.ts`.**
  - An independent rider fills the details, uploads the 3 documents, submits, and gets `under_review`. `/v1/me` shows `rider.status: 'under_review'`, and `POST /v1/rider/online` gives 403.
  - `motorcycle` without a registration gives 400.
  - A wrong agency code gives `agency_code_invalid`, as does a suspended agency's code. The right code binds the agency, and `agencyName` is shown.
  - `restaurant_staff` with no invite gives `rider_invite_missing`. With an invite, the restaurant is bound.
  - A guarantor phone equal to the rider's own gives 400.
  - A missing document gives `application_incomplete`.
  - `GET /v1/zones` returns Chapainawabganj.
- [ ] **Step 2: Run them and see them fail.** `pnpm --filter @oregano/api test -- rider-applications`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** `pnpm --filter @oregano/api test`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(onboarding): rider joining with type, vehicle, guarantor and documents; agencies by code; staff riders by invite`

### Task 14: Admin review: queue, document links, approve and reject

**Files:**

- Create: `apps/api/src/onboarding/review.ts`, `apps/api/src/onboarding/review.test.ts`, `apps/api/src/media/tickets.ts`, `apps/api/src/admin/document-routes.ts`
- Modify: `apps/api/src/admin/routes.ts`, `apps/api/src/onboarding/routes.ts`, `apps/api/src/catalog/repo.ts` (an exported `createApprovedRestaurant`), `apps/api/src/identity/team.ts` or `identity/staff.ts` (an exported `addRestaurantOwner`), `packages/contracts/src/onboarding.ts`, `packages/contracts/src/admin.ts`

**Interfaces:**

- Produces:

```ts
// media/tickets.ts
export function issueDocumentTicket(key: Buffer, t: { documentId: string; adminId: string; expiresAt: Date }): string; // base64url(payload).base64url(hmac)
export function checkDocumentTicket(
  key: Buffer,
  ticket: string,
  documentId: string,
  adminId: string,
  now: Date,
): boolean; // timing-safe

// contracts
export const ApplicationQueueItem = z.object({
  kind: z.enum(['restaurant', 'rider']),
  id: z.uuid(),
  name: z.string(),
  submittedAt: z.iso.datetime(),
  status: z.enum(ACCOUNT_STATUSES),
  riderType: z.enum(RIDER_TYPES).nullable(),
});
export const ApproveRestaurantBody = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  waiveLicence: z.boolean().default(false),
});
export const RejectBody = z.object({ reason: z.string().trim().min(10).max(500) });
export const AdminCreateRestaurantApplicationBody = RestaurantApplicationBody.extend({
  ownerPhone: z.string().trim().max(30),
});
```

- `POST /admin/documents/:id/link` writes the `document.link_issued` audit row and returns `{ url: '/v1/admin/documents/<id>/content', ticket, expiresAt }` (300 s).
  - The ticket travels in the `X-Document-Ticket` header, never in the query string, because Fastify logs `req.url`.
  - Add `X-Document-Ticket` to CORS `allowedHeaders`, and add `req.headers["x-document-ticket"]` to the logger's `redact` list.
- `GET …/content`:
  - needs `documents.view`, a ticket that checks against this admin and document and has not expired (else 403 `link_expired`), and a stored document (else 410 `document_deleted`);
  - writes the `document.opened` audit row before it streams;
  - sends the headers `Content-Type: image/jpeg`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Content-Disposition: inline; filename="document.jpg"`, `Cross-Origin-Resource-Policy: same-site` and `Referrer-Policy: no-referrer`.
- **Approve restaurant**, in one transaction:
  1. `accountTransition('under_review','approve')`;
  2. the licence must be present, or `waiveLicence` must be true (this writes the `application.licence_waived` audit row); else 422 `application_incomplete`;
  3. `findZoneForPoint` must find a zone, else 422 `outside_zone`;
  4. `createApprovedRestaurant`: a slug from the name (lowercase ASCII, hyphens, `-2`, `-3` and so on until unique), `name_bn = name_en`, `cuisine_bn = cuisine_en`, `is_open = false`, `status = 'approved'`;
  5. `addRestaurantOwner`;
  6. `recordDecision(…, 'accepted', …, now + 7 days)`;
  7. the `application.approved` audit row, and `user.access_changed` for the applicant.
- **Reject**, for either kind: store the reason, `recordDecision(…, 'rejected', …, now + 7 days)`, write the audit row, and emit `user.access_changed`. A resubmission's new uploads replace the files (Task 11).
- **Approve rider:** all three documents are present; set `approved`, record the decision, write the audit row, and emit `access_changed`.
- **Door 1** (`POST /admin/restaurant-applications`): find or create the owner user by phone; create the application with `created_by_user_id`; write the audit row. Owner phones and payout numbers are personal data: the queue shows names only.

- [ ] **Step 1: Write the failing tests in `review.test.ts`.**
  - The queue lists submitted applications oldest first, and hides `applied` drafts unless `status=applied` is asked for. A support-only member gets 403.
  - **Links:** an onboarding member gets a link, and the content is a JPEG with every header listed above. Then:
    - the same ticket used by another admin gives 403 `link_expired`;
    - the ticket after 301 s (an injectable clock or `now` override) gives 403;
    - a support-only member gives 403;
    - the link for a deleted document gives 410;
    - `audit_log` has one `document.link_issued` and one `document.opened` row per successful opening, and none for refusals.
  - **Approve restaurant:**
    - it creates a restaurant with `status: 'approved'` and `is_open: false`, and the owner's `/v1/me` has its id in `restaurantIds`;
    - the documents get `delete_after` about 7 days out;
    - the restaurant appears in the catalog list as closed;
    - a point outside the zone gives 422 `outside_zone` with nothing created;
    - approving twice gives 200 with the same view, and creates no second restaurant or audit row;
    - rejecting an approved application gives 409 `invalid_transition`;
    - a request log line for the content route contains neither the ticket nor `ticket=`;
    - without a licence and without `waiveLicence` it gives 422.
  - **Reject:** the applicant's view shows `rejected` and the reason, and they can edit and resubmit, which puts it back to `under_review`.
  - **Approve rider:** the rider's `/me` shows `approved`, and `POST /rider/online` gives 200.
  - **Door 1:** a team member applies for a new phone. That user signs in and sees the application, and can upload documents.
- [ ] **Step 2: Run them and see them fail.** `pnpm --filter @oregano/api test -- review`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** `pnpm --filter @oregano/api test`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(admin): approval queue, audited expiring document links, approve and reject for restaurants and riders`

### Task 15: Account management: suspend and reinstate riders, restaurants and agencies

**Files:**

- Create: `apps/api/src/onboarding/accounts.ts`, `apps/api/src/onboarding/accounts.test.ts`
- Modify: `apps/api/src/admin/routes.ts`, `apps/api/src/dispatch/repo.ts` (an exported `releaseRiderOrders`), `apps/api/src/dispatch/routes.ts`, `apps/api/src/identity/auth.ts`, `packages/domain/src/order.ts` (event name `rider_released`, if events are listed there), `packages/contracts/src/admin.ts`

**Interfaces:**

- Produces:

```ts
export function riderCanWork(rider: AuthUser['rider']): boolean; // status 'approved' and (type !== 'agency' || agencyActive)
export function requireWorkingRider(request: FastifyRequest): AuthUser; // replaces requireRole(request, 'rider') for online, offers, claim, pick-up
export function requireRiderAccount(request: FastifyRequest): AuthUser; // any rider row; used by GET /rider/orders and POST /rider/orders/:id/deliver (the holder check still applies)
export function releaseRiderOrders(tx: Tx, riderId: string): Promise<string[]>; // rider_id = NULL where status IN ('preparing','ready'); an order_events row 'rider_released' and an order.changed outbox row for each; returns order ids
export const CreateAgencyBody = z.object({
  name: z.string().trim().min(2).max(80),
  contactPhone: z.string().trim().max(30),
});
export const Agency = z.object({
  id: z.uuid(),
  name: z.string(),
  code: z.string(),
  status: z.enum(['approved', 'suspended']),
  riderCount: z.number().int(),
});
export const ReasonBody = RejectBody;
```

- **Suspend rider**, in one transaction:
  1. `accountTransition('approved','suspend')`;
  2. `is_online = false` and `suspended_reason`;
  3. `releaseRiderOrders`;
  4. the audit row and `user.access_changed`.
- **Reinstate** reverses the status and clears the reason.
- **Suspending a restaurant** hides it (Task 12 filters). It writes the audit row and emits `access_changed` for its staff. Open orders continue.
- **Suspending an agency** blocks its riders through `riderCanWork`. It sets their `is_online = false`, releases their un-picked orders, and writes the audit row.
- `GET /admin/agencies` lists agencies with their codes. `POST` generates a unique code (retry on conflict) from `crypto.randomInt` over the alphabet.

- [ ] **Step 1: Write the failing tests in `accounts.test.ts`.**
  - A rider holds order A (`ready`) and order B (`on_the_way`), then is suspended. A has `rider_id` null and is back in another rider's `GET /rider/offers`. B still belongs to the rider, and `POST /rider/orders/B/deliver` gives 200. `POST /rider/online` and claiming give 403.
  - A rider's open WebSocket is closed with 4401 on suspension.
  - Reinstate lets the rider go online again. Suspending an already suspended rider gives 200 and no second audit row. Suspending a rider who is `under_review` gives 409.
  - A suspended restaurant disappears from the list. Its staff still see existing orders, and reinstating it brings it back.
  - A suspended agency's rider gets 403 on `/rider/online`. Reinstating the agency allows it again.
  - Every action writes exactly one audit row with the acting admin's id. Support-only members get 403.
- [ ] **Step 2: Run them and see them fail.** `pnpm --filter @oregano/api test -- accounts dispatch`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** `pnpm --filter @oregano/api test`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(admin): suspend and reinstate riders, restaurants and agencies; suspension releases orders not yet picked up`

### Task 16: Restaurant staff and staff riders

**Files:**

- Create: `apps/api/src/identity/staff.ts`, `apps/api/src/identity/staff.test.ts`, `apps/api/src/onboarding/rider-invites.ts`
- Modify: `apps/api/src/ordering/restaurant-routes.ts` (or a new `apps/api/src/identity/staff-routes.ts`), `apps/api/src/dispatch/repo.ts`, `apps/api/src/dispatch/dispatch.test.ts`, `apps/api/src/events/realtime.ts`, `apps/api/src/events/realtime.test.ts`, `packages/contracts/src/restaurant.ts` (create), `packages/contracts/src/index.ts`, `packages/contracts/src/errors.ts`

**Interfaces:**

- Produces:

```ts
export const AddStaffBody = z.object({ phone: z.string().trim().max(30) }); // role is always 'staff'; owners come only from approval
export const StaffMember = z.object({
  userId: z.uuid(),
  phone: z.string(),
  name: z.string().nullable(),
  role: z.enum(['owner', 'staff']),
  addedAt: z.iso.datetime(),
});
export const RiderInviteBody = z.object({ phone: z.string().trim().max(30) });
export const RiderInvite = z.object({
  phone: z.string(),
  createdAt: z.iso.datetime(),
  riderStatus: z.enum(ACCOUNT_STATUSES).nullable(),
});
export function requireOwner(request: FastifyRequest, restaurantId: string): AuthUser; // 403 unless restaurant_staff.role = 'owner'
```

- **Add staff:** find or create the user by phone, then insert `staff`. At the limit of 20 it gives 409 `staff_limit_reached`. Adding an existing member returns 200 and no duplicate.
- **Remove staff:** removing an owner when they are the last owner gives 409 `cannot_remove_last_owner`. Every removal emits `user.access_changed`. Both actions write audit rows with actor = the owner.
- **Rider invites:** create and delete, with audit rows. Deleting an invite does not affect a rider already bound.
- **Dispatch (book 4.6):**
  - a `restaurant_staff` rider's `GET /rider/offers` lists only orders of `restaurant_id = rider.restaurant_id`;
  - `claimOrder` refuses any other restaurant's order, the same as `not_claimable`, which gives 404, so nothing is revealed;
  - `audienceIncludes` sends offer hints to a staff rider only for their restaurant.
  - Other riders keep zone-wide offers, including staff restaurants' orders. Who delivers for those is decided in Plan 06.

- [ ] **Step 1: Write the failing tests.**
  - `staff.test.ts`:
    - the owner adds a staff phone, that user signs in and has the restaurant in `restaurantIds`;
    - the owner removes them, and their next request has empty `restaurantIds` and their socket closes with 4401;
    - a staff member (not the owner) gets 403 on every staff and invite route;
    - an owner of restaurant X gets 403 on restaurant Y's routes;
    - the 21st member gives 409;
    - removing the only owner gives 409.
  - `dispatch.test.ts`: an approved staff rider of Burger Lane sees only Burger Lane offers, while a second restaurant's ready order is absent from their offers, gives 404 on claim, and is never hinted to them (realtime test).
- [ ] **Step 2: Run them and see them fail.** `pnpm --filter @oregano/api test -- staff dispatch realtime`
- [ ] **Step 3: Implement.** Seed a second demo restaurant if the dispatch test needs one, with slug `rice-house` and a minimal menu. CLAUDE.md is updated in Task 20.
- [ ] **Step 4: Run the tests.** `pnpm --filter @oregano/api test`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(restaurant): owners manage staff and invite staff riders, who see only their restaurant's orders`

### Task 17: Restaurant app: apply, status and staff screens

**Files:**

- Create: `apps/restaurant/src/apply.tsx`, `apps/restaurant/src/staff.tsx`, `packages/ui-native/src/DocumentPicker.tsx`, `packages/ui-native/src/Choice.tsx`
- Modify: `apps/restaurant/src/app/index.tsx`, `apps/restaurant/src/components.tsx`, `apps/restaurant/package.json`, `packages/ui-native/src/index.ts`, `packages/api-client/src/client.ts`, `packages/app-core/src/queries.ts`, `apps/customer/src/app/index.tsx`, `apps/customer/src/config.ts`, `packages/i18n/src/en.ts`, `packages/i18n/src/bn.ts`

**Interfaces:**

- `ApiClient` gains:
  - `restaurantApplication(): Promise<RestaurantApplicationView | null>` (a 404 becomes null);
  - `saveRestaurantApplication(body)` and `uploadRestaurantDocument(kind, file: UploadFile)`;
  - `submitRestaurantApplication(noTradeLicence)`;
  - `staff(restaurantId)`, `addStaff`, `removeStaff`, `riderInvites`, `addRiderInvite`, `removeRiderInvite`;
  - and the rider and admin methods used in Tasks 18 and 19.
- `export type UploadFile = Blob | { uri: string; name: string; type: string }` is sent as `FormData` with no JSON content type.
- `DocumentPicker`:
  - props `{ label: string; uploaded: boolean; onPick(file: UploadFile): Promise<void> }`;
  - uses `expo-image-picker` (read the SDK 58 docs). On web it hands over the picked `File`; on native, the asset `uri`.
  - It shows the states picking, uploading, uploaded and failed, the last with the error copy from `errorMessageKey`.
  - Tap target ≥ 48 px; colours from `@oregano/ui`.
- Restaurant app routing (`index.tsx`) for a signed-in user:
  - `restaurantIds` not empty: the orders screen (Plan 02), with a "Staff" tab for owners;
  - otherwise, by application status:
    - none: "Partner with Oregano" intro, then the form;
    - `applied`: the form and documents, then "Submit";
    - `under_review`: "We are checking your details. This usually takes one to two days.";
    - `rejected`: the reason, then edit and "Submit again".
  - Labels are English only (field labels, buttons). The Bangla entries repeat the English text.
- Customer home gets two small links: "Partner with Oregano" (restaurant app URL) and "Ride with Oregano" (rider app URL), from `EXPO_PUBLIC_RESTAURANT_APP_URL` and `EXPO_PUBLIC_RIDER_APP_URL`, with the dev defaults 8082 and 8083.
- New plain-sentence keys (en and bn), at least:
  - `apply.intro`: "Bring your restaurant to Oregano. Fill in your details and add photos of your documents."
  - `apply.underReview`: as above.
  - `apply.rejected`: "We could not approve your application: {reason}"
  - `apply.noLicenceHint`: "No trade licence yet? Tick the box and our team will talk to you."
  - `apply.photoHint`: "Take a clear photo in good light. All four corners must show."
  - `staff.empty`: "No staff yet. Add them by phone number."
  - `staff.riderInviteHint`: "Your delivery staff join in the rider app with this phone number."
  - an error key for each new error code.

- [ ] **Step 1: Write the failing tests.**
  - `packages/i18n/src/i18n.test.ts` already fails when a key is missing in either language; add the keys there first.
  - An `apps/api/src/clients/client.test.ts` case uploads a PNG through `uploadRestaurantDocument` against the real API.
- [ ] **Step 2: Run them and see them fail.** `pnpm --filter @oregano/i18n test && pnpm --filter @oregano/api test -- clients`
- [ ] **Step 3: Implement the screens and client methods.** Check the screens in a browser: `pnpm --filter @oregano/restaurant dev:web`, sign in as a new phone (dev peek), fill the form, pick three images, and submit.
- [ ] **Step 4: Run the gate.** `pnpm verify`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(restaurant-app): Partner with Oregano application, status, staff and staff-rider screens`

### Task 18: Rider app: joining and verification screens

**Files:**

- Create: `apps/rider/src/join.tsx`
- Modify: `apps/rider/src/app/index.tsx`, `apps/rider/src/rider.tsx`, `apps/rider/src/components.tsx`, `apps/rider/package.json`, `packages/i18n/src/en.ts`, `packages/i18n/src/bn.ts`

**Interfaces:**

- Consumes: `DocumentPicker` and `Choice` (Task 17); `riderApplication()`, `saveRiderApplication(body)`, `uploadRiderDocument(kind, file)`, `submitRiderApplication()` and `zones()` on `ApiClient`.
- Routing for a signed-in user, by `me.rider`:
  - null: the join flow;
  - `applied`: continue the flow;
  - `under_review`: the "checking" screen;
  - `rejected`: the reason and edit;
  - `suspended`: `rider.suspended` ("Your account is paused: {reason}. Call Oregano support."), and any order already `on_the_way` stays deliverable;
  - `approved`: the Plan 02 rider screen.
- Join flow, one main action per screen (book principle "Simple first"):
  1. type (independent, agency with a code field, restaurant staff);
  2. zone, skipped when there is exactly one;
  3. name and vehicle (registration shown only when needed);
  4. guarantor;
  5. three documents, with photo hints;
  6. "Submit".

  Progress is saved on each step with `PUT`.
- New keys (en and bn), at least:
  - `join.agencyHint`: "Ask your agency for its 8-letter code."
  - `join.staffHint`: "Your restaurant must add your phone number first."
  - `join.guarantorHint`: "Someone who knows you and can vouch for you."
  - `join.selfieHint`: "A clear photo of your face, no sunglasses."
  - `rider.underReview`, `rider.rejected`, `rider.suspended`
  - an error key for each new error code.

- [ ] **Step 1: Write the failing tests.** Add the i18n keys to `i18n.test.ts` coverage. Add an api-client unit test for `saveRiderApplication`'s request shape, using a fake fetch.
- [ ] **Step 2: Run them and see them fail.** `pnpm --filter @oregano/i18n test && pnpm --filter @oregano/api-client test`
- [ ] **Step 3: Implement.** Check the flow in a browser (rider app on 8083) with a new phone.
- [ ] **Step 4: Run the gate.** `pnpm verify`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(rider-app): join flow with type, vehicle, guarantor and documents; review, rejected and suspended states`

### Task 19: Admin app: queue, document viewer, decisions and accounts

**Files:**

- Create: `apps/admin/src/Applications.tsx`, `apps/admin/src/ApplicationDetail.tsx`, `apps/admin/src/DocumentViewer.tsx`, `apps/admin/src/Accounts.tsx`, `apps/admin/src/Team.tsx`, `apps/admin/src/Nav.tsx`
- Modify: `apps/admin/src/App.tsx`, `apps/admin/index.html`, `apps/admin/vite.config.ts`, `apps/admin/src/styles.css`, `packages/i18n/src/en.ts`, `packages/i18n/src/bn.ts`

**Interfaces:**

- Navigation tabs (English labels): Orders, Applications, Riders, Restaurants, Agencies, Team. A tab shows only when the user's team roles have its permission: use `teamCan` from `@oregano/domain`.
- `DocumentViewer` props `{ documentId: string }`:
  - calls `api.documentLink(id)`, then fetches `url` with the Bearer token and the `X-Document-Ticket` header;
  - turns the blob into an object URL and shows it in `<img>`;
  - revokes the URL on close, on unmount, and at `expiresAt`;
  - shows `document.deleted` copy for a 410, and "Link expired, open it again" for a 403.
  - It never puts the ticket URL into `<img src>`, history or the clipboard.
- **Decisions:**
  - approve restaurant: lat and lng inputs plus a "Waive trade licence" checkbox, shown only when `noTradeLicence`;
  - reject: a required reason of 10 to 500 characters;
  - every decision asks for confirmation.
- **Accounts:** suspend and reinstate with a required reason; create an agency and show its code with a copy button.
- **Team:** a read-only list, with the line "Team roles are changed by an operator." (en and bn).
- **CSP:** `index.html` gets a meta CSP that `vite.config.ts` builds from `VITE_API_URL`: `default-src 'self'; img-src 'self' blob: data:; connect-src 'self' <api origin> <ws origin>; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'`. Check that the existing font loading still works.

- [ ] **Step 1: Write the failing tests.** Add the i18n keys. An api-client test checks that `documentLink` returns `{ url, expiresAt }` parsed by its contract.
- [ ] **Step 2: Run them and see them fail.** `pnpm --filter @oregano/i18n test && pnpm --filter @oregano/api-client test`
- [ ] **Step 3: Implement.** Check in a browser on 8084 as admin 01711000004: open an application, view a document, approve it. Then sign in as support 01711000007 and see only Orders.
- [ ] **Step 4: Run the gate.** `pnpm verify`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(admin): approval queue with audited document viewer, decisions, accounts, agencies and team list`

### Task 20: The onboarding journey, docs and the gate

**Files:**

- Create: `e2e/tests/onboarding.spec.ts`, `e2e/fixtures/document.png`
- Modify: `e2e/playwright.config.ts`, `e2e/global-setup.ts`, `e2e/journey.ts`, `CLAUDE.md`, `README.md`, `docs/superpowers/plans/2026-11-16-oregano-roadmap.md`, `docs/blueprint/measurements.md`

**Interfaces:**

- The e2e API and worker environment already has `DATA_KEYS` (Task 3), `SMS_PROVIDERS=log` (Task 5) and `LIMITS_PROFILE=relaxed` (Task 6). It gains the S3 settings, with bucket `oregano-e2e`. Global setup empties the bucket (it refuses unless the bucket name ends in `-e2e`).
- Journey helpers gain `uploadDocument(page, label, file)`, which uses `page.waitForEvent('filechooser')`.

- [ ] **Step 1: Write the failing browser tests in `onboarding.spec.ts`.**
  - **Restaurant, application to approved.** A new phone signs in on the restaurant app, fills the form, uploads three documents and submits; the screen says it is being checked. The admin signs in, opens Applications, opens it, views a document (the `<img>` has loaded: `naturalWidth > 0`), enters the zone's coordinates and approves. The restaurant tab reloads into the orders screen. The customer app lists the restaurant as closed.
  - **Rider, application to approved.** A new phone signs in on the rider app, joins as independent, uploads three documents and submits. The admin approves. The rider's screen shows the Online switch, and going online works.
  - **Rejection and resubmission.** The admin rejects with a reason. The rider sees the reason, replaces one document and submits again; the queue shows it again.
- [ ] **Step 2: Run them and see them fail.** `pnpm test:e2e -- onboarding`. Expected: FAIL until the helpers and environment exist, then PASS. Run the whole browser suite twice; it must pass both times.
- [ ] **Step 3: Update the docs.**
  - `CLAUDE.md`: the S3 service and its port, the new env vars, `LIMITS_PROFILE`, `pnpm --filter @oregano/api team -- …`, the demo phones 01711000006 (onboarding) and 01711000007 (support), the `rice-house` demo restaurant if added, and the onboarding test.
  - `README.md`: setup.
  - Roadmap: Plan 03 marked done except Task 21.
  - `measurements.md`: the new web bundle sizes of the restaurant and rider apps.
- [ ] **Step 4: Run the gate.** `pnpm verify`, then the clean-container recipe from CLAUDE.md, with the S3 URL pointing at `host.docker.internal:9000`. Expected: PASS on both.
- [ ] **Step 5: Commit.** `test(e2e): restaurant and rider go from application to approved; docs for Plan 03`

---

## Part C: Real SMS

### Task 21: Two SMS providers and the delivery test (blocked until the founder names the providers)

**Blocked on:** the founder choosing two providers and opening accounts. Prefer a local Bangladeshi gateway as primary and an independent second route (another gateway, or an international provider) as failover, so one outage does not take down sign-in. Sender-ID registration is the founder's step. Do not name or build against a provider from memory.

**Files:**

- Create: `apps/api/src/notifications/sms/<provider-a>.ts`, `<provider-b>.ts`, `<provider>.test.ts` for each, and `apps/api/src/notifications/sms/delivery-test-cli.ts`
- Modify: `apps/api/src/notifications/sms/providers.ts`, `apps/api/src/config.ts`, `apps/api/.env.example`, `docs/blueprint/2026-11-16-oregano-blueprint.md` (section 4 SMS row: the chosen providers and why)

**Interfaces:**

- Each adapter `implements SmsProvider`, built from the provider's current official API documentation:
  - HTTPS only, with credentials from env (`SMS_<NAME>_*`), never logged;
  - a 4xx error is `SmsSendError(retryable: false)`, and a 5xx, network error or timeout is `retryable: true`;
  - Unicode encoding for Bangla text.
- `createProviders` accepts the two names, and the production refusal now passes with `SMS_PROVIDERS=<a>,<b>`.
- `pnpm --filter @oregano/api sms:test -- --phone 01XXXXXXXXX --provider <name>` sends "Oregano delivery test {time}" through one provider and prints the provider message id. The operator runs it to phones on Grameenphone, Robi, Banglalink and Teletalk and records the results in `docs/blueprint/measurements.md`.

- [ ] **Step 1: Write the failing adapter tests.** Use a local HTTP server built with `node:http` that stands in for the provider and asserts the request shape from the docs: auth, number format, Unicode flag. A 500 maps to retryable, a 401 to not retryable, and a hang to the timeout.
- [ ] **Step 2: Run them and see them fail.** `pnpm --filter @oregano/api test -- sms`
- [ ] **Step 3: Implement both adapters and the CLI.**
- [ ] **Step 4: Run the gate.** `pnpm verify`. Expected: PASS. Then run the delivery test on all four operators.
- [ ] **Step 5: Commit.** `feat(notifications): <a> and <b> SMS adapters with failover; delivery test`

**Plan 03 is done when:** Tasks 1 to 21 are merged; `pnpm verify` passes; the onboarding browser test shows a restaurant and a rider each going from application to approved without database access; `otp-limits.test.ts` proves every OTP limit; and the delivery test has reached all four operators.
