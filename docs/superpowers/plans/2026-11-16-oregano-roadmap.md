# Oregano Roadmap

Spec: `docs/blueprint/2026-11-16-oregano-blueprint.md`. Product truth: `Oregano-Product-and-Brand-Book.pdf` ("the book").

The platform is too large for one plan. It is split into eleven plans, each ending in working, tested software. Only Plan 01 is written in full now. Each later plan is written with the `writing-plans` skill immediately before it is executed, because its exact file names and interfaces depend on what the previous plan produced.

## Order of work

| Plan | Name                               | Depends on     | Status                                       |
| ---- | ---------------------------------- | -------------- | -------------------------------------------- |
| 01   | Foundation                         | none           | Done, merged 16 Nov 2026                     |
| 02   | First order, end to end            | 01             | Written: `2026-11-16-plan-02-first-order.md` |
| 03   | Identity hardening and onboarding  | 02             | To write                                     |
| 04   | Catalog and zones, complete        | 02             | To write                                     |
| 05   | Customer experience, complete      | 03, 04         | To write                                     |
| 06   | Order operations and failure paths | 02             | To write                                     |
| 07   | Money                              | 06             | To write                                     |
| 08   | Hangout cart                       | 05             | To write                                     |
| 09   | Admin dashboard, complete          | 03, 04, 06, 07 | To write                                     |
| 10   | Native apps                        | 05, 06         | To write                                     |
| 11   | Production hardening and launch    | all            | To write                                     |

Plans 03 and 04 can run in either order. So can 06 and 08.

## What each plan delivers

### Plan 01: Foundation

Monorepo, tooling, money rules, order state machine, language and brand packages, API skeleton with health checks, database with the Chapainawabganj zone, customer app shell running on web.
**Done when:** `pnpm verify` passes and the customer shell switches between English and Bangla in a browser.

### Plan 02: First order, end to end

The thinnest complete order: sign in by OTP (code printed to the server log, no SMS yet), one seeded restaurant with a menu, place a cash-on-delivery order, restaurant accepts and marks ready, rider claims, picks up and delivers, admin sees it live. Creates the restaurant, rider and admin app shells, `packages/contracts`, `packages/api-client`, the outbox, the worker and WebSocket hints.
**Done when:** a Playwright test drives one order through all four web apps from placed to delivered, and a retried "place order" request does not create a second order.

### Plan 03: Identity hardening and onboarding

Real SMS through two providers, all OTP limits from blueprint section 7, session rotation with reuse detection, roles and staff management, the restaurant application form and approval queue, rider verification with document upload, agency accounts, account states.
**Done when:** a restaurant and a rider can each go from application to approved without database access, and the OTP limits are proven by tests.
**Must include (from the Plan 02 security review):** OTP requests capped per phone and per IP address per hour and per day, not only a 60-second resend gap; wrong-attempt counts that survive a new code request (today a new request resets them, which allows unbounded guessing); a production refusal to start with the logging OTP sender; and a unique constraint so one phone has at most one live challenge. The API must not be exposed to the internet before these land. Also from the Plan 02 final review: per-user and per-IP rate limits on every write endpoint, especially order placement (a signed-in account can otherwise flood a restaurant with real cash orders), per-IP limits on OTP verification across many phones and on the public restaurant list, and a per-IP cap on WebSocket connections.

### Plan 04: Catalog and zones, complete

Menu manager, item options (sizes, add-ons), opening hours and auto-close, busy mode, "sold out today", restaurant discounts, image upload and resizing, search across restaurants, dishes and cuisines, zone drawing and fee settings in admin.
**Done when:** every item in book sections 3.4 to 3.6, 4.2, 4.4 and 4.5 works against the API.

### Plan 05: Customer experience, complete

Map pin with landmark and saved addresses, home, search, restaurant page, item options sheet, one-page cart and checkout, pickup, order tracking, orders tab, reorder, ratings, profile, guest browsing, every screen state in book section 3.13, full Bangla, desktop web layout and the "Download the app" page.
**Done when:** every item in book section 3 except 3.9 passes an end-to-end test on web, and the home page meets the slow-3G budget in blueprint section 10.

### Plan 06: Order operations and failure paths

Every row of the book's "when something goes wrong" table: rejection with reason and similar restaurants, auto-cancel, item sold out after ordering, offer waves and no-rider alerts, rider delay, customer unreachable, manual reassignment. The full notification table in book section 11, including the layered restaurant alert from blueprint section 8.
**Done when:** each failure row has a test that triggers it and checks what each party sees.
**Must include (from the Plan 02 review):** before adding manual reassignment, move the "is this rider holding the order" check for pick-up and deliver inside `applyTransition`'s row lock, so a rider who lost an order can never act on it. Decide with the founder what happens to an order held by a rider who is suspended mid-delivery.

### Plan 07: Money

Ledger, cash-on-delivery collection, commission, the two-month free trial, the referral programme, monthly statements in the app and on WhatsApp, netting, unpaid-listing pause, rider earnings. Online payment (bKash, Nagad, a gateway) is a post-launch plan, not part of this one.
**Blocked on:** founder answer to open question 1 in the blueprint (how delivery cash reaches the restaurant).
**Done when:** the example statement in book section 8 (Tk 20,000 of orders, Tk 1,000 commission, Tk 300 referral refund, Tk 700 net) is reproduced from ledger entries by a test.

### Plan 08: Hangout cart

Shared cart by link, live updates for everyone in it, split-the-bill shares, one order placed by the host.
**Done when:** three browser sessions build one cart and the host places a single order with correct per-person shares.

### Plan 09: Admin dashboard, complete

Everything in book section 6 not already built: live order alerts, billing and payment status, referral abuse flags, growth figures from bottle QR codes, support lookup with notes and refunds, the monthly restaurant report in book section 10.
**Done when:** every bullet in book section 6 maps to a working screen.

### Plan 10: Native apps

Android and iOS builds of the customer, restaurant and rider apps, push notifications, the restaurant alarm, rider location while online, deep links, the smart QR link that picks the right store, store listings.
**Done when:** all three apps are installed from internal test tracks on real devices and complete an order, and the restaurant alarm sounds with the phone locked.

### Plan 11: Production hardening and launch

Production infrastructure, backups and a restore rehearsal, monitoring and alerts, the load test in blueprint section 10, a security review against blueprint section 7, runbooks, the latency measurement that fixes the hosting region, staged rollout to founding restaurants.
**Blocked on:** founder answer to open question 2 in the blueprint (data protection law).
**Done when:** the load test passes, a restore from backup is demonstrated, and the security review has no open high-severity finding.

## Rules for every plan

- Read the blueprint and the book before writing or executing a plan.
- Test first: write the failing test, then the code.
- Before installing any library, check its current official documentation. Do not rely on remembered APIs.
- A plan is finished only when `pnpm verify` passes and its "Done when" line is demonstrated.
- If execution contradicts the blueprint, stop and update the blueprint first, with the reason.
