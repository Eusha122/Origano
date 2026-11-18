# Plan 05 handoff: Plan 04 done, Plan 05 next

Written 19 November 2026 at the end of Plan 04. Read this first in the next session, then the roadmap's Plan 05 entry, then write the Plan 05 plan with the writing-plans skill before any code.

## First thing in the new session

1. Check that `plan-04-catalog-and-zones` is merged to `main` (it was not when this was written). If not, ask the founder before merging; do not push without asking.
2. Run `/graphify .` (or `--update`), then answer "where does X live" from `graphify-out/` before reading raw files.
3. Read: `CLAUDE.md`, the roadmap (Plan 05), the blueprint (section 13 now carries the Plan 04 decisions), and book section 3 (all of it except 3.9).
4. Write `docs/superpowers/plans/<date>-plan-05-customer-experience.md` on a new branch `plan-05-customer-experience` off `main`.

## What Plan 04 left in place that Plan 05 builds on

- **Public reads** (`GET /v1/restaurants`, `GET /v1/restaurants/:slug`): `isOpen` is the effective state (owner's switch and the weekly hours); `opensAt` is "HH:MM" in zone time (it has no day, see deferred minors); `prepMinutes` includes busy mode; `coverImageUrl`; per item `price` (after the best live discount), `originalPrice`, `discountLabel`, `imageUrl`, `optionGroups`; per restaurant `hours`, `popularItemIds` (the "Popular" tab).
- **Image URLs are API-relative** (`/v1/media/public/<key>?size=small|large`): put the API address in front. The restaurant detail's menu photos use `small`, the cover uses `large`.
- **Search:** `GET /v1/search?q=&lat=&lng=` returns `{ restaurants, dishes }` (restaurants first open, then closed); `GET /v1/search/popular` returns `{ terms }` for the empty box. Recent searches are for the client to keep.
- **Ordering with options:** `PlaceOrderBody.items[]` takes `optionIds` and `note`; the server prices everything. Required choices missing is 400 `required_choice_missing`; a sold-out option is 422 `option_unavailable`; an option no longer offered is 400 `invalid_option`. Order items come back with `options`, `note` and `discount`. The customer app's cart does not use options yet: the item sheet (book 3.6) is Plan 05.
- **Restaurant app** now has Orders, Today (open switch, busy mode), Menu, Hours, Discounts and Staff tabs, functional and unpolished. The kitchen sees options and the note on each order line.
- **Admin** has a Zones tab (superadmin) with a Leaflet map on OpenStreetMap tiles.
- **API client** has typed methods for every owner and admin route (`packages/api-client`), with the form helpers in `packages/app-core` (`menu-forms`, `hours-form`, `discount-form`, `zone-ring`) and unit tests.

## Decisions and conventions to keep

- Same as the Plan 04 handoff, plus: a discount applies to the whole unit price (base plus options); the public menu shows it on the base price. Discounts never stack.
- Restaurant data (names, dishes, options, descriptions) is English in both languages: renaming an item copies the English text into the Bangla field on the server.
- New error codes in the same commit as their app-core map entry and English and Bangla text. The Bangla sentences added in Plans 03 and 04 still need a native speaker's review.
- Browser tests: `zz-catalog.spec.ts` runs last on purpose (its order stays in the admin list and other journeys count orders). A journey must leave no order, zone or sold-out item behind that another journey would trip over.
- Cold starts: after a change to a shared package, Metro rebuilds each app's bundle and the first browser test to open an app can take over a minute. A rerun is warm.

## Deferred minors from the Plan 04 review (not fixed; decide whether Plan 05 or 09 takes them)

- Removing an item photo hides a failure (no catch in `item-editor.tsx`).
- The owner's discount list shows the start date a day early (UTC slice of a +06:00 day start).
- `opensAt` has no day, so tomorrow's opening reads like today's. Plan 05 shows "Opens at 4 PM" on cards; give the contract a day first.
- Reactivating paused discounts skips the 20-live cap; discount create uses `Date.now()`, not the injected clock.
- Item reorder is audited as `menu.categories_reordered`.
- Staff can toggle availability of an archived item (a misleading audit row only).
- An order of the largest possible size overflows the integer total columns and answers 500 (predates Plan 04).
- `controls-repo`, `search-repo` and `getRestaurantForOrder` read `zones.timezone` and `is_active` directly, extending the existing catalog to zones compromise.
- Limits to watch: 600 catalog writes per user per hour (a 200-item menu with photos entered by the onboarding team may hit it), and the per-IP 120 per minute on `/v1/restaurants*` now also counts owner-app reads.

## On design

The owner screens and the customer app are still working scaffolding on the brand tokens. Plan 05 is the real design pass (Foodpanda and Uber Eats level, with the ui-ux-pro-max, design-taste-frontend and impeccable skills), starting with the customer app and the shared components in `packages/ui-native`. Nothing in the roadmap covers polishing the restaurant and rider apps; propose adding that plan.

## Open questions for the founder

- The two SMS providers (Plan 03 Task 21) and the lawyer's written answer on hosting outside Bangladesh, before launch.
- A native speaker's review of the Bangla text from Plans 03 and 04.
- Plan 04's defaults, if any should change: any staff change the open switch, busy mode and sold-out items while only the owner edits the menu, hours, discounts and photos; a new restaurant starts with 11:00 to 22:00 hours.
- Whether to merge `plan-04-catalog-and-zones` into `main` and push it.
