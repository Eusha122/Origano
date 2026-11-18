# Oregano Platform Blueprint

Version 1.0, 16 November 2026. Source of product truth: `Oregano-Product-and-Brand-Book.pdf` (called "the book" below). This document says how the book gets built. Where the two disagree, the book wins on what the product does, and this document wins on how it is built.

## 1. Confirmed intent

Confirmed by the founder on 16 November 2026.

- **Outcome:** one codebase that ships the customer website, the Android and iOS apps, the restaurant app, the rider app and the admin dashboard.
- **Users:** customers, restaurants and riders in Chapainawabganj first. The Oregano team uses the admin dashboard.
- **Success:** the website and the native apps launch together with every feature in the book working. Opening a new town is a settings change, not a rebuild.
- **Constraints:** Claude builds it, with no deadline. It must work on low-end phones and 3G, in Bangla and English. 1M+ users is the design target, so running costs start small and grow with usage.
- **Payments:** cash on delivery only at launch. A payment gateway comes after launch.
- **Out of scope for launch:** any online payment (bKash, Nagad, cards or a gateway), carts spanning several restaurants, Oregano employing riders or cooking food.
- **Build order:** shared foundation, then one cash-on-delivery order end to end across all four surfaces, then the remaining features.

## 2. How big "1M users" really is

These are planning estimates, not measurements.

| Quantity              | Estimate             | Basis                               |
| --------------------- | -------------------- | ----------------------------------- |
| Registered users      | 1,000,000            | Design target                       |
| Daily active users    | 100,000              | 10% of registered                   |
| Orders per day        | 30,000               | 0.3 per daily active user           |
| Peak orders           | about 2 per second   | 20% of the day's orders in one hour |
| Peak API requests     | about 300 per second | 50 requests per session             |
| Riders online at peak | about 3,000          | 10 orders per rider per day         |

This load fits comfortably on a few ordinary servers and one well-indexed PostgreSQL database. The design goal is therefore correctness and operability, not exotic scale machinery. The system is one deployable backend with strict internal module boundaries (a "modular monolith"), so that a module can be split into its own service later only if measurements demand it.

## 3. Architecture at a glance

```
 Customer app      Restaurant app     Rider app        Admin dashboard
 (web/Android/iOS) (web/Android/iOS)  (web/Android/iOS) (web only)
        \                |                 |                /
         \---------------+--- HTTPS /v1 ---+---------------/
                         |    WebSocket (hints only)
                 +-------v--------+
   CDN + WAF --> |   API server   |  stateless, runs as N copies
                 +---+-------+----+
                     |       |
            +--------v-+   +-v--------+      +------------------+
            | Postgres |   |  Redis   | <--> |  Worker process  |
            | +PostGIS |   | cache,   |      | timers, SMS, push|
            | (truth)  |   | queue,   |      | statements,      |
            +----------+   | pub/sub  |      | outbox relay     |
                           +----------+      +------------------+
                     |
            Object storage (menu photos public via CDN, ID documents private)
```

Rules that hold everywhere:

1. **PostgreSQL is the only source of truth.** Redis holds nothing that cannot be rebuilt.
2. **Real-time messages are hints.** A WebSocket or push message only says "order X changed". The client then fetches the order over HTTPS. A missed message can never leave a screen wrong after the next fetch.
3. **Every state change is a transaction that also writes an event row** (the "outbox"). The worker reads the outbox and sends pushes, SMS and WebSocket hints. Nothing is sent from inside a request, so a crash cannot lose or double-apply a change.
4. **Every write endpoint accepts an idempotency key.** A retry on a bad 3G connection returns the first result instead of creating a second order.
5. **Business rules live in pure code** (`packages/domain`) with no database or network access, so they are tested exhaustively and shared by server and clients.

## 4. Technology decisions

Exact versions are not pinned here. The executor installs the latest stable release and checks the official documentation before each install.

| Area                             | Decision                                                                                      | Why                                                                                                               | Revisit when                           |
| -------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Language                         | TypeScript, strict mode, everywhere                                                           | One language across four apps and the server; shared types                                                        | Never                                  |
| Runtime                          | Node.js 24 LTS                                                                                | Already installed; long-term support                                                                              | Next LTS                               |
| Repo                             | pnpm workspaces + Turborepo                                                                   | Standard for Expo monorepos; cached builds                                                                        | Never                                  |
| Lint and format                  | Biome                                                                                         | One tool instead of two                                                                                           | It lacks a rule we need                |
| Customer, restaurant, rider apps | Expo (React Native) with Expo Router, built for web, Android and iOS                          | The founder requires one codebase for site and apps                                                               | Web bundle exceeds budget (section 10) |
| Admin dashboard                  | React + Vite, web only                                                                        | Dense tables and forms are poor in React Native                                                                   | Never                                  |
| API                              | Fastify, REST under `/v1`, Zod-validated                                                      | Old app versions stay in the wild for months; a versioned REST contract tolerates that                            | Never                                  |
| Contracts                        | Zod schemas in `packages/contracts`, used by server and clients                               | One definition of every request and response                                                                      | Never                                  |
| Database                         | PostgreSQL with PostGIS                                                                       | Transactions for money and orders; PostGIS for delivery zones                                                     | Never                                  |
| Data access                      | Drizzle ORM with SQL migrations                                                               | Thin, typed, explicit SQL                                                                                         | Never                                  |
| Cache, queue, pub/sub            | Redis with BullMQ                                                                             | One dependency covers rate limits, timers, fan-out                                                                | Queue depth needs a dedicated broker   |
| Real-time                        | WebSocket from the API, fanned out through Redis pub/sub                                      | Built into React Native; hints only                                                                               | Never                                  |
| Push                             | Firebase Cloud Messaging and Apple Push, through Expo Notifications                           | Standard path for Expo                                                                                            | Never                                  |
| SMS                              | Local Bangladeshi gateway behind an `SmsSender` interface, with a second provider as failover | Local routes are far cheaper than international ones; provider chosen after a delivery test on all four operators | Delivery rate drops                    |
| Maps                             | MapLibre with OpenStreetMap-based tiles behind a `MapProvider` interface                      | No per-load fees at scale; Barikoi is a candidate for Bangladeshi addresses                                       | Tile quality in a town is poor         |
| Media                            | S3-compatible object storage + CDN; images resized to WebP at upload                          | Works on 3G; cheap                                                                                                | Never                                  |
| Hosting                          | Docker containers; managed PostgreSQL and Redis; Cloudflare in front                          | Portable; managed backups                                                                                         | See section 9                          |
| Server tests                     | Vitest; integration tests against real PostgreSQL                                             | No mocked database                                                                                                | Never                                  |
| Web end-to-end tests             | Playwright                                                                                    | Standard                                                                                                          | Never                                  |
| Native end-to-end tests          | Maestro (from Plan 10)                                                                        | Works with Expo                                                                                                   | Never                                  |
| Errors and tracing               | Sentry + OpenTelemetry, structured JSON logs                                                  | Find the failing order from a support call                                                                        | Never                                  |

## 5. Repository layout

```
oregano/
  apps/
    api/         Fastify backend. Two entry points: server.ts (HTTP + WebSocket) and worker.ts (jobs).
    customer/    Expo app: web, Android, iOS.
    restaurant/  Expo app: web, Android, iOS.
    rider/       Expo app: web, Android, iOS.
    admin/       React + Vite dashboard.
  packages/
    domain/      Pure business rules: money, order state machine, pricing, fees, referral rules.
    contracts/   Zod schemas for every request, response and event.
    api-client/  Typed fetch client and data hooks used by all four apps.
    ui/          Brand tokens and shared components.
    i18n/        English and Bangla strings, number and money formatting.
  infra/         docker-compose for local work; deployment definitions later.
  docs/          This blueprint, the roadmap and the plans.
```

Three separate Expo apps, not one app with roles. Each has its own store listing, its own permissions (the rider app needs location, the restaurant app needs alarm-style notifications) and stays small on low-end phones.

### Backend modules

Each module lives in `apps/api/src/<module>/` with `routes.ts`, `service.ts`, `repo.ts` and `events.ts`. A module may call another module's service. It may never read or write another module's tables.

| Module        | Owns                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| identity      | Phone OTP, sessions, roles, staff membership                               |
| zones         | Delivery areas, fee settings, per-zone business settings                   |
| catalog       | Restaurants, hours, menus, items, options, availability, discounts, search |
| onboarding    | Restaurant applications, rider verification, approval queue                |
| cart          | Carts and Hangout (group) carts                                            |
| ordering      | Orders, the order state machine, the order event log                       |
| dispatch      | Rider availability, offers, assignment, reassignment                       |
| ledger        | Double-entry money records, payments, transaction IDs                      |
| billing       | Commission, monthly statements, unpaid-listing pause                       |
| referrals     | Codes, unlock rules, abuse flags                                           |
| ratings       | Stars, tags, comments                                                      |
| notifications | Push, SMS, WhatsApp, in-app; per-user preferences                          |
| media         | Uploads, resizing, signed URLs                                             |
| growth        | QR links, install attribution, monthly restaurant report                   |
| admin         | Support lookup, notes, audit log                                           |

## 6. Core domain decisions

### Money

All amounts are stored as whole poisha (1 Tk = 100 poisha) in integer columns. Percentages round half up to the nearest whole taka. Formatting follows the book: `Tk 280` in English, `৳২৮০` in Bangla.

All money movement is recorded in a double-entry ledger (every entry debits one account and credits another). Commission, referral refunds and monthly statements are computed from ledger entries, never from order totals directly. This keeps the statement arithmetic in the book auditable line by line.

### Orders

Status is one explicit value. The tracking timeline is read from the event log, not from status.

| Status        | Meaning                                                  |
| ------------- | -------------------------------------------------------- |
| placed        | Customer confirmed; restaurant alerted                   |
| preparing     | Restaurant accepted and set a ready time                 |
| ready         | Food packed                                              |
| on_the_way    | Rider has the food (delivery orders only)                |
| delivered     | Handed over (or collected, for pickup)                   |
| rejected      | Restaurant declined with a reason                        |
| cancelled     | Customer cancelled before acceptance, or admin cancelled |
| expired       | Restaurant did not answer in time                        |
| undeliverable | Rider could not hand over; food returned                 |

The book's "Accepted" step is the event that moves an order from placed to preparing. The customer sees it in the timeline with its time.

Rider assignment is tracked separately from status (unassigned, offered, assigned), because a rider is offered the order while the kitchen is still cooking.

### Dispatch

An order is offered to online riders near the restaurant. The first rider to accept claims it in one atomic database update, so two riders can never both win. If nobody accepts, the offer widens in waves and the admin dashboard is alerted. A restaurant can instead assign its own staff rider or an agency rider directly. No rider scoring or batching: the book treats every rider the same.

The book does not ask for a live rider dot on a map, so rider location is kept only in Redis, updated every 30 seconds while online, and used to choose who gets offers.

### Delivery fee

`fee = max(zone minimum fee, distance in km x zone fee per km)`, rounded up to a whole taka. Distance is straight-line distance multiplied by a per-zone road factor (default 1.3). This replaces a paid routing service until a town shows it is unfair.

### Towns

Every restaurant belongs to a zone. A zone has a boundary polygon, fee settings and business settings. Launching a new town means drawing a zone and onboarding restaurants.

### Sign-up flows

Restaurants enter through two doors into one approval queue: the Oregano team creates the account and enters the menu from a photo (as the book describes), or the owner applies through a "Partner with Oregano" form. Required: trade licence, owner's national ID, and a bKash, Nagad or bank account. An admin can waive the licence.

Riders sign up by phone OTP, choose a type, and upload national ID, photo, vehicle details and guarantor, as the book lists. Agency riders are invited by their agency and staff riders by their restaurant. Every restaurant and rider account is one of: applied, under review, approved, rejected, suspended.

## 7. Security

Target: OWASP Application Security Verification Standard, level 2.

- **Sign-in:** 6-digit OTP, stored hashed, valid 5 minutes, 5 wrong tries per code. Only numbers matching `+8801[3-9]XXXXXXXX` are accepted, which blocks the common fraud of triggering paid SMS to foreign numbers. Limits (every value is configuration; defaults below):

  | Limit                                      | Default                                                                         |
  | ------------------------------------------ | ------------------------------------------------------------------------------- |
  | Resend gap per phone                       | 60 seconds                                                                      |
  | Sends per phone                            | 5 per hour, 10 per 24 hours                                                     |
  | Sends per IP address                       | 20 per hour, 100 per 24 hours                                                   |
  | Sends, whole platform                      | 1,000 per hour (then sign-in answers "unavailable" and an error is logged)      |
  | Wrong codes per phone, surviving new codes | 10 per rolling 24 hours, then the phone is locked for requests and verification |
  | Wrong codes per IP, across phones          | 30 per hour                                                                     |
  | Any route, per IP                          | 300 per minute                                                                  |
  | Any write, per signed-in user              | 60 per minute                                                                   |
  | Placing an order, per user                 | 5 per 10 minutes, and at most 3 open orders                                     |
  | Restaurant list, per IP                    | 120 per minute                                                                  |
  | WebSocket, per IP                          | 30 upgrades per minute, 20 open connections per API instance                    |

  OTP counters live in PostgreSQL, in the same transaction as the challenge, because they guard real SMS money and must not depend on Redis. General limits live in Redis and fail open, so a Redis outage never blocks ordering (section 8). Per-IP numbers are deliberately generous, because mobile carriers put many customers behind one address; watch the `otp_rate_limited` count after launch. The 24-hour per-phone lock stops code guessing but lets anyone lock a real owner or rider out for a day (ASVS asks for anti-automation that resists lockout abuse). It is mitigated by a warning log `otp_phone_locked` to alert on, and by an audited operator command `otp:unlock`. The client IP counts only when the request comes from a configured trusted proxy, and an IPv6 address counts as its whole /64 (one host controls that many addresses). A guess for a number with no live code is refused alike and costs nothing, so answers never reveal whether a number has an account.
- **Sessions:** an opaque 15-minute access token, checked in the database on every request so that suspension, staff removal and reuse detection take effect at once. A 60-day refresh token (sliding, 180-day absolute limit, 12 hours for Oregano team members) that is replaced on every use. A just-replaced token may be used again for 30 seconds, so a lost response on a weak connection or two tabs refreshing together do not sign the user out; only one of those answers may ever be redeemed (the others die when it is), so a thief who replays a copy inside the window cannot keep a second chain of tokens; reuse after the window, or of a token whose answer was already used, revokes the whole session family. On web the refresh token lives in an httpOnly, Secure, SameSite=Strict cookie scoped to `/v1/auth` (the web apps and the API must therefore be same-site); native apps receive it in the response body and keep it in the device keystore.
- **Access control:** every endpoint checks role and ownership on the server. Restaurant staff see only their restaurant. Staff riders see only their restaurant's orders. A rider receives the customer's phone number only while that delivery is active, and the server strips it otherwise.
- **Personal documents:** verify-then-delete, as set out in "Changes since the book". Images sit encrypted in a private bucket and are opened only through audited, expiring, admin-only links.
- **Admin actions:** every one is written to an audit log with who, what and when.
- **Abuse:** rate limits on all write endpoints; referral abuse flags for repeated devices and numbers.
- **Supply chain and secrets:** dependency audit in CI; secrets only in the host's secret store, never in the repository.
- **Data:** encrypted connections everywhere, encrypted disks, daily backups with point-in-time recovery, and a restore rehearsal before launch.

## 8. Reliability

- **Restaurant order alert.** The book asks for a full-screen alert with sound that repeats until answered, even in the background. Android 14 and later reserve true full-screen takeover for calling and alarm apps, and iOS reserves its strongest alerts for safety apps. The design is therefore layered:
  1. A high-priority push starts a looping alarm sound and a persistent heads-up notification on a dedicated channel.
  2. The restaurant app has a "kitchen mode" that keeps the screen on and shows the full-screen alert whenever the app is open.
  3. An SMS goes to the restaurant after 90 seconds unanswered.
  4. The admin dashboard is alerted after 3 minutes.
  5. The order expires after 5 minutes.
- **Timers** (expiry, offer waves, statement runs) are durable jobs in the queue, not in-memory timeouts.
- **Targets:** 99.9% monthly availability for order placement; order placement answered within 500 ms at the 95th percentile on the server.
- **Degradation:** if Redis is down, ordering still works and real-time hints stop; clients fall back to polling every 15 seconds.

## 9. Growth stages

|                        | Stage 1: one town                                         | Stage 2: several districts         | Stage 3: national                                         |
| ---------------------- | --------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------- |
| Users                  | up to 10,000                                              | up to 100,000                      | 1M+                                                       |
| API                    | 2 small copies                                            | 3 to 4 copies, autoscaled          | autoscaled, worker pool separate                          |
| PostgreSQL             | 1 managed instance, daily backup + point-in-time recovery | larger instance + 1 read replica   | read replicas, partition order and ledger tables by month |
| Redis                  | 1 small managed instance                                  | same, larger                       | separate instances for queue and cache                    |
| Search                 | PostgreSQL full-text and trigram                          | same                               | dedicated search service if measured slow                 |
| What triggers the move | n/a                                                       | CPU or connection pressure at peak | replica lag or table size hurting queries                 |

No stage needs a rewrite. Region default is Singapore, to be confirmed by measuring latency from Chapainawabganj on Grameenphone, Robi and Banglalink against Mumbai before launch.

## 10. Quality bars

- **Web:** first load usable within 5 seconds on a throttled "slow 3G" profile for the customer home page. If the Expo web bundle cannot meet this, the public customer pages are rebuilt as a lighter web front end over the same API and packages.
- **Android app:** download size under 25 MB per app.
- **Accessibility:** tap targets at least 48 px, text contrast at least 4.5:1, no meaning carried by colour alone (from the book).
- **Languages:** every string exists in English and Bangla; CI fails if a key is missing in either.
- **Tests:** business rules in `packages/domain` have full branch coverage. Every API endpoint has an integration test against a real database.
- **Load test before launch:** 50 orders per second sustained for 10 minutes, about 25 times the estimated national peak.

## 11. Defaults chosen for blanks in the book

The book leaves these blank. Each is a per-zone setting the admin can change.

| Setting                          | Default                          |
| -------------------------------- | -------------------------------- |
| Restaurant no-answer auto-cancel | 5 minutes                        |
| No-rider admin alert             | 5 minutes                        |
| Unpaid statement pauses listing  | 14 days after the statement date |
| Referral discount cap            | Tk 50                            |
| Promotional pushes               | at most 2 per week               |
| Delivery fee per km              | Tk 10                            |
| Minimum delivery fee             | Tk 20                            |

## 12. Open questions for the founder

None of these block Plans 01 or 02.

Answered by the founder on 16 November 2026:

- **Payments at launch:** cash on delivery only. A payment gateway is added after launch. The bKash and Nagad transaction-ID flow in book section 3.7 is deferred to that later work, and the ledger (section 6) is designed so a gateway adds new entry types without changing existing ones.
- **Logo artwork:** supplied in `Oregano-Logo-Kit/Oregano-Logo-Kit/` (wordmark, O mark and app icons in SVG, PNG and PDF, in every brand colour). Use these files; never retype the logo.

Still open:

1. **Cash flow on delivery.** The rider collects cash from the customer. How does the food money reach the restaurant: does the rider pay the restaurant at pickup, or hand it over afterwards? Needed for Plan 07.
2. **Data protection law.** Bangladesh's current personal data rules may restrict storing personal data abroad. This needs a legal check before the hosting region is final. Needed for Plan 11.
3. **Bangla copy.** A native speaker should review all Bangla strings before launch.
4. **The defaults in section 11.**

## 14. Research notes

Bangladesh-specific public sources were thin, and most architecture sources found were secondary guides, not first-hand engineering posts. The decisions above follow widely used patterns (explicit order state machine, outbox, idempotent writes, layered OTP limits) and are sized from the estimates in section 2. Every library choice is re-checked against official documentation when it is installed.

Sources: foodpanda Bangladesh partner portal (partner.foodpanda.com.bd); Pathao help centre (help.pathao.com/?p=238); DoorDash Dasher signup process (help.doordash.com); Android full-screen intent changes (proandroiddev.com, "Full-Screen Intent notifications in Android 14 & 15"); Firebase message priority documentation (firebase.google.com/docs/cloud-messaging/android/message-priority); Expo monorepo guide (docs.expo.dev); Handoff's universal Expo production write-up (handoff.ai/tech); ClickSend guidance on SMS pumping (help.clicksend.com); Bangladesh SMS pricing comparison (sent.dm/resources/bangladesh-sms-pricing).

## 13. Changes since the book

The product book is the starting point. Where a later decision differs from it or fills a blank, it is recorded here with its date and reason. When this section and the book disagree, this section wins. The founder delegated these decisions on 18 November 2026.

**Cash flow (needed by Plan 07).** The rider pays the restaurant for the food at pickup, then collects the food price and delivery fee from the customer. The delivery fee stays 100% with the rider. Because riders front the restaurant's money, each rider has a float limit on unsettled cash: Tk 1,500 for a new rider, raised with a clean record. An offer is shown only if the food price fits under the rider's remaining limit. A customer's first cash orders are capped at Tk 800. If a customer refuses or cannot be reached after pickup, the rider keeps the food, Oregano repays the food cost, and the customer cannot order again until it is settled. Why: cash on delivery is the main fraud and trust risk, and these limits cap it without a payment gateway. Cost if wrong: the numbers are defaults; change them in one place.

**Delivery fee (Plans 05 to 07).** Distance fee as built (minimum Tk 20, Tk 10 per km). Add an automatic rush-hour extra: the system compares waiting orders with free online riders in each zone over the last few minutes and raises the extra in small steps (Tk 0, 10, 20, 30), only after the signal holds for a few minutes so the price does not flicker. The customer sees the fee before ordering, it is locked when the order is placed, and all of it goes to the rider. Admins set only an on/off switch and a maximum extra per zone. The rule is written in Plan 06, which has the dispatch data. Tips are optional and 100% to the rider. The rider sees the fee and tip before accepting. No service fee and no small-order fee. Rider bonuses wait until after launch, when real delivery data exists.

**Suspended rider (Plan 06).** If the rider has not picked up the food, the order goes to another rider through the normal offer waves. If the rider already has the food, they finish the delivery.

**Language and prices (all plans).** The app is English with a Bangla option. Plain-language text (status messages, errors, hints, greetings, empty states) is in English and Bangla. Buttons, field labels, prices, numbers and data from restaurants (restaurant, menu and street names, addresses) are English only. Prices read `Tk 280` in both languages. Why: the founder wants the app to read like the apps people already use here, and it halves the text a native speaker must review.

**Hosting and sensitive data (Plans 03 and 11).** The servers will be outside Bangladesh. The founder's lawyer said this is legal. Record the lawyer's answer in writing before launch. Identity documents and photos are verify-then-delete: a rider uploads, an admin checks and approves or rejects, and the file is deleted automatically within 7 days of the decision. Only the result is kept: who checked, when, and the document type, never the ID number. While a file exists it sits in private encrypted object storage, not in the main database, readable only by admins through links that expire in minutes, and every opening is logged. These files never appear in logs or long-lived backups. Cost if wrong: after deletion, a dispute can only show that a check happened, not the document. The 7 days is a default.

**Identity and onboarding details (Plan 03, 18 November 2026).** These fill blanks the founder delegated. Every number is a configurable default.

- **SMS goes through an encrypted queue.** The sign-in request writes the code, sealed with AES-256-GCM, to a queue table in the same transaction as the challenge; the worker sends it through a chain of two providers and deletes the plain text once sent. Rule 3 (nothing is sent from inside a request) holds, and the code is never stored in plain text. Why: a lost SMS must not be lost silently, and a provider outage must fail over. Cost if wrong: sign-in code delivery is delayed by up to the worker's polling interval (about a quarter of a second).
- **Session and limit numbers** are the tables in section 7. Team members' sessions last 12 hours because their accounts can see identity documents. Why: a stolen laptop should not hold a long-lived admin session. Cost if wrong: team members sign in more often.
- **Identity documents.** Accepted: JPEG, PNG or WebP up to 8 MB. Every image is re-encoded to JPEG with all metadata (including GPS) removed, and encrypted with a per-file key. Files are deleted 7 days after the decision, 30 days after the last activity on an application nobody decided, 1 hour after an upload that never completed, and at once when replaced. Guarantor and payout details of a rejected or abandoned application are cleared after 30 days. No form asks for an ID number. Cost if wrong: a dispute after deletion can only show that a check happened.
- **Agencies are run by the Oregano team.** The team creates an agency and gives its code to the agency; riders choose "agency" and enter the code. Staff riders join by an invite from their restaurant's owner. No fifth app is needed. Cost if wrong: an agency manager cannot see its own riders until a later plan adds a view.
- **Team roles** are `superadmin`, `onboarding` and `support`. They are granted only by an operator command, never through the API. Cost if wrong: granting a role needs someone with server access.
- **A suspended rider** is taken off offers at once; orders they have not picked up return to the offer pool; an order they already hold they may still deliver (this is the rule above, now built).
- **At most 3 open orders per customer.** Why: a signed-in account could otherwise flood a restaurant with real cash orders. Cost if wrong: a group ordering for several people may hit the cap; raise it in one place.
- **Deployment constraint (Plan 11).** The web apps and the API must be same-site, for example `oregano.com.bd` and `api.oregano.com.bd`, or the Strict refresh cookie is never sent.

**Catalog and zones (Plan 04, 19 November 2026).** These fill blanks the founder delegated. Each is one setting or one line to change.

- **Who edits what.** Any staff member (owner or staff) uses the Open/Closed switch, busy mode and the "Available" switch on items. Only the owner changes items, categories, sizes and add-ons, photos, opening hours, prep time and discounts. Team members who manage accounts may use the same routes for any restaurant, because the Oregano team enters menus; the admin screen for that is Plan 09. Why: staff run the rush, the menu and prices are the owner's. Cost if wrong: an owner who wants staff to edit the menu must do it until one line (`'owner'` to `'staff'` in a route) changes.
- **Opening hours and "open now".** A new restaurant starts with 11:00 to 22:00 every day, in the zone's time. A restaurant is open for customers when the owner's switch is on and the clock is inside its hours; the switch is never flipped by the clock, so a restaurant left on opens by itself at its next opening time. A restaurant with no hours is never closed by the clock. An interval may run past midnight, to at most 04:00. The state is worked out when it is read, so there is no timer to miss. Cost if wrong: a restaurant that forgets to switch off at night stays "open" within hours, as the book describes.
- **Busy mode** adds 0, 10 or 20 minutes to the prep time customers see.
- **Options.** A size is one required choice; add-ons are optional and may be several. Each option adds a fixed amount to the item price. The server prices every order line from the database (base price, chosen options, then the best discount); the customer's app never sends a price. Order lines keep a snapshot of the chosen options, the kitchen note and the discount.
- **Discounts do not stack.** On each unit the single discount that takes off the most applies, whether it is percent or taka, on an item, a category or the whole menu. It applies to the whole unit price (size and add-ons included), percentages round half up to whole taka, and a unit never drops below Tk 1. The public menu shows the discount on the item's base price; the order uses the full unit price. A restaurant may have at most 20 live discounts. Oregano never sets discounts.
- **Deleting a menu item or category archives it**, because past orders point at it; its name becomes free to use again. A menu holds at most 200 items.
- **Photos** are public content, kept apart from identity documents: re-encoded to still WebP at 960 and 320 pixels wide, never enlarged, all metadata dropped, stored under random keys and served by the API with a one-year immutable cache. At most 5 MB each. A CDN in front of them is Plan 11.
- **Search** is trigram and prefix matching in PostgreSQL over English names (Bangla text repeats English by rule), so close misspellings still match. "Popular right now" is the dishes ordered most in the last 14 days in the zone, then cuisines. A restaurant page's "Popular" tab is its four most ordered items in 30 days.
- **Zones.** Only a superadmin draws zones and sets fees. An outline has 3 to 500 corners, must not cross itself, must lie in Bangladesh, may cover at most 5,000 km², and may not overlap another active zone. A zone with open orders cannot be switched off. Fee per km (up to Tk 200), minimum fee (up to Tk 500) and road factor (1.0 to 3.0) take effect at once.
