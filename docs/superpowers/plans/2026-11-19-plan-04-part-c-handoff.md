# Plan 04 handoff: backend done, apps next (Part C)

Written 19 November 2026. Read this first, then `docs/superpowers/plans/2026-11-18-plan-04-catalog-and-zones.md` Tasks 12 to 16. Branch: `plan-04-catalog-and-zones` (not merged, not pushed). Executing inline with the `executing-plans` skill; the ledger is `.superpowers/sdd/2026-11-18-plan-04-catalog-and-zones/progress.md` (git-ignored): tasks with a `Task N: complete` line are done, and its `Ruling:` lines are decisions to carry.

## Done (Tasks 1 to 11, all committed, API tests 418 passing, domain 55)

Schema and migrations `0012`, `0013`; pure rules in `packages/domain` (`isOpenAt`, `nextOpening`, `bestDiscount`, `checkSelections`, `priceLine`); public reads with effective open state, options, discounts and popular items; staff controls; menu manager; hours and prep; discounts; public photos; ordering with options, notes and discounts; search; zones admin API. Permission `zones.manage` is superadmin only.

## API surface the apps use (all under `/v1`, signed in unless noted)

- `GET /restaurants/:id/controls` (staff) returns `{ switchOn, isOpen, opensAt, busyExtraMinutes, prepMinutes }`. `PUT /restaurants/:id/open {isOpen}` and `PUT /restaurants/:id/busy {extraMinutes: 0|10|20}` (staff) return the same shape. `PUT /restaurants/:id/items/:itemId/availability {isAvailable}` (staff) returns `{id, isAvailable}`.
- `GET /restaurants/:id/menu` (staff) returns `{categories}` with base prices (owner view; `price` is the base price). Owner-only: `POST /categories`, `PATCH|DELETE /categories/:cid`, `PUT /categories/order {ids}`, `POST /categories/:cid/items`, `PUT /categories/:cid/items/order {ids}`, `PATCH|DELETE /items/:itemId`, `PUT /items/:itemId/options {groups}`, `PUT|DELETE /items/:itemId/photo` and `PUT|DELETE /photo` (multipart, one file), `GET|PUT /hours`, `PUT /prep {prepMinutes}`, `GET|POST /discounts`, `PATCH|DELETE /discounts/:did`.
- Prices in every body and response are integer poisha. New error codes are in `ERROR_CODES`, the app-core map and i18n (English and Bangla; the Bangla wording needs the native-speaker review that is already an open item).
- Image URLs are API-relative (`/v1/media/public/<key>?size=small|large`); the apps put the API URL in front.
- `GET /search?q=&lat=&lng=` and `GET /search/popular` (anonymous) are for Plan 05.
- `GET|POST /admin/zones`, `PATCH /admin/zones/:id` need `zones.manage`. Boundaries are GeoJSON Polygon, one ring of `[lng, lat]`, first point repeated at the end.
- Orders: `items[]` accept `optionIds` and `note`; order items return `options`, `note`, `discount`.

## Left: Tasks 12 to 16 (see the plan for steps)

12. Restaurant app today screen: Open/Closed switch, busy mode, optimistic updates with rollback (`packages/api-client` methods, `packages/app-core` queries and hook tests, i18n messages).
13. Restaurant app menu manager (items by category, Available switch for any staff, owner-only editing, photo via `expo-image-picker`, options editor, validation helpers with unit tests).
14. Restaurant app hours and discounts screens (form helpers with unit tests).
15. Admin Zones tab (permission `zones.manage`, Leaflet map after reading its current official docs, tile host and API origin in the CSP; the API origin is already in `img-src`), then update blueprint section 13 with the decisions recorded as `Ruling:` lines and the plan's "Decisions made for the blanks", and the roadmap status.
16. `e2e/tests/catalog.spec.ts` journey, `pnpm verify`, clean-container gate, whole-branch review (Opus, `review-package`), then the Plan 05 handoff.

## Notes for the next session

- Demo seed gives Burger Lane all-day hours so browser tests do not depend on the clock.
- `pnpm format` runs before every commit; the hook rejects unformatted files, and some edits get reformatted after a test run, so run `pnpm format` and `git commit` in one command.
- Large bash heredocs break the bash tool: write files with the Write tool, and run small Python edit scripts from the scratchpad.
- Two review points the plan names for the Opus pass: Task 8 (uploads), Task 9 (order pricing) and Task 11 (zone geometry), plus the whole branch.
- Open question for the founder, raised by this plan: who may edit what (default chosen: any staff change open/busy/sold-out; only the owner edits menu, hours, discounts, photos), and the default hours of a new restaurant (11:00 to 22:00).
