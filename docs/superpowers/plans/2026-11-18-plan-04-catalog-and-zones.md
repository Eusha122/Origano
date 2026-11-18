# Plan 04: Catalog and Zones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restaurant owners run their own menu, hours, busy mode, sold-out items, discounts and photos; customers can search; the admin draws zones and sets fees. Every item in book sections 3.4 to 3.6, 4.2, 4.4 and 4.5 works against the API.

**Architecture:** Pure rules (opening hours, discounts, option pricing) go in `packages/domain` with full branch coverage. The `catalog` module grows owner-facing write routes (split into small files by concern) and an image pipeline in `media`. The server prices every order line from options and discounts; the client never sends a price. Opening state is computed at read time from the switch plus the weekly hours, so there is no timer to miss. Owner screens in the restaurant app and the zone screens in the admin are functional, not polished (Plan 05 owns the design pass).

**Tech Stack:** Fastify, Drizzle, PostgreSQL with PostGIS and `pg_trgm`, `sharp`, SeaweedFS (S3), Expo (restaurant app), Vite (admin), Leaflet for the zone map (check its current official docs before installing).

**Spec:** `Oregano-Product-and-Brand-Book.pdf` sections 3.4 to 3.6, 4.2, 4.4, 4.5 and 6 ("Zones and fees"); `docs/blueprint/2026-11-16-oregano-blueprint.md` sections 5, 6, 11 and 13; `docs/superpowers/plans/2026-11-18-plan-04-handoff.md`.

## Global Constraints

- TypeScript strict with `noUncheckedIndexedAccess`; no `any`, no `@ts-ignore`.
- Money is integer poisha, typed `Money`. Percentages of money round half up to the nearest whole taka. Display `Tk 280` with Western digits via `formatMoney`.
- Plain-language text exists in English and Bangla; buttons, labels, prices and restaurant data (names, dishes, options, addresses) stay English in both. UI copy is sentence case.
- Colours, fonts, sizes and radii come from `@oregano/ui`; no literal hex or pixel sizes in screens.
- A new error code goes into `ERROR_CODES` (contracts), the exhaustive map in `packages/app-core/src/errors.ts`, and English and Bangla text in `packages/i18n`, in the same commit.
- A repeated action is not an error: answer 200 with the current state and write nothing.
- A module never reads another module's tables; call its exported function.
- Every owner or admin write writes an `audit_log` row in the same transaction (`writeAudit`); data holds ids and kinds only, never free text from users.
- Tests first, against real PostgreSQL and the real S3 server. No mocks of either.
- Order status changes only through `transition()`.
- Before installing a library, read its current official documentation.
- Done only when `pnpm verify` passes.

## Decisions made for the blanks (recorded in blueprint section 13 by Task 15)

These are engineering and default choices the founder delegated; each is one setting or one line to change.

- **Who edits what.** Any staff member (owner or staff): the Open/Closed switch, busy mode, the "Available" switch on items. Owner only: item, category, option and photo changes, opening hours, prep time, discounts. Why: staff handle the rush; the menu and prices are the owner's. Cost if wrong: an owner who wants staff to edit the menu must do it themselves until one line (`requireOwner` to `requireStaff`) changes.
- **Admin entry.** Team members with `accounts.manage` may call the same menu routes for any restaurant (the book says the Oregano team can enter a menu from a photo). The admin screen for it is Plan 09; only the API allows it now.
- **Default hours** for a newly approved restaurant: 11:00 to 22:00, every day, zone time. The owner edits them. A restaurant with no hours rows is never auto-closed (switch only).
- **Open now** = the switch is on AND the time is inside an interval. The switch is not flipped by the clock, so a restaurant left on opens by itself at its next opening time.
- **Busy mode** adds 0, 10 or 20 minutes (stored `busy_extra_minutes`) to the prep time shown to customers.
- **Discounts do not stack.** On each item the single discount that takes off the most applies. Percent or taka off applies to the whole unit price (size and add-ons included), rounds half up to whole taka, and never takes a unit below Tk 1.
- **Images** are public content: re-encoded to WebP at 960 and 320 pixels wide, metadata stripped, stored under random keys, served by the API at `GET /v1/media/public/:key` with a one-year immutable cache. A CDN in front is Plan 11.
- **Search** is trigram and prefix matching in PostgreSQL over English names (Bangla text repeats English by rule). "Popular right now" is the top cuisines and dishes by orders in the last 14 days in the zone, falling back to cuisines.
- **Zones** may not overlap another active zone (it would make `findZoneForPoint` ambiguous). Only `superadmin` edits zones.

## Review Focus

1. A restaurant open 18:00 to 02:00 (interval past midnight): open at 01:00 Tuesday because of Monday's interval; closed at 03:00; `opensAt` is today's 18:00.
2. A menu item or option that changes price or disappears after a customer saw it: the order uses the current server price and refuses an unavailable item or option, and order lines keep the snapshot.
3. Two near-duplicate discounts or one that expires mid-checkout: no stacking, expiry decided by the server clock at placement.
4. An uploaded "image" that is a polyglot, a bomb, an 8 MB+ file or an animated file: rejected or flattened to one still WebP, never stored raw.
5. A zone polygon that is self-intersecting, has too many points, covers the planet, or overlaps another zone: refused with a clear error, nothing written. Plus: a staff member (not owner) trying an owner-only action gets 403 and nothing is written.

---

## File Structure

- `packages/domain/src/hours.ts` (+ test): `isOpenAt`, `nextOpening`, types `OpeningInterval`.
- `packages/domain/src/menu-pricing.ts` (+ test): `bestDiscount`, `priceLine`, `checkSelections`.
- `apps/api/src/catalog/schema.ts`: new tables and columns. `apps/api/drizzle/0012_*.sql`: migration with backfill.
- `apps/api/src/catalog/`: `hours-repo.ts`, `options-repo.ts`, `discounts-repo.ts`, `search-repo.ts`, `menu-repo.ts` (writes), `access.ts` (`requireCatalogActor`), routes split into `staff-routes.ts`, `menu-routes.ts`, `hours-routes.ts`, `discount-routes.ts`, `search-routes.ts`. Existing `repo.ts` and `routes.ts` keep the public reads.
- `apps/api/src/media/public-image.ts` (+ test), `public-store.ts`, `public-routes.ts`.
- `apps/api/src/zones/admin-routes.ts`, `geometry.ts`.
- `packages/contracts/src/catalog.ts`, `restaurant.ts` (owner contracts), `orders.ts`, `admin.ts`.
- `apps/restaurant/src/app/` new screens; `apps/admin/src/Zones.tsx`, `ZoneMap.tsx`.

---

### Task 1: Schema and migration

**Files:** Modify `apps/api/src/catalog/schema.ts`, `apps/api/src/ordering/schema.ts`. Create `apps/api/drizzle/0012_*.sql` (generate, then read the SQL; backfill before NOT NULL or CHECK). Test: `apps/api/src/catalog/schema.test.ts`.

**Interfaces:** Produces tables `restaurant_hours(restaurant_id, day_of_week 0..6 with 0 = Sunday, open_minute 0..1439, close_minute open_minute+1..1739)`, unique `(restaurant_id, day_of_week, open_minute)`; columns `restaurants.busy_extra_minutes` (0, 10 or 20, default 0), `restaurants.cover_image_key text null`; `menu_items.image_key text null`; `option_groups(id, menu_item_id, name_en, name_bn, required bool, min_select int, max_select int, position)` with `min_select <= max_select`, `required = (min_select >= 1)`; `options(id, group_id, name_en, name_bn, price_delta_poisha >= 0, is_available bool, position)`; `restaurant_discounts(id, restaurant_id, kind 'percent'|'amount', value int, scope 'item'|'category'|'menu', menu_item_id null, category_id null, starts_at, ends_at, is_active bool, created_at)` with scope/target consistency, percent 1..90, amount > 0, `ends_at > starts_at`; `order_items.options jsonb not null default '[]'`, `order_items.note text null`, `order_items.discount_poisha int not null default 0`. Indexes: GIN `gin_trgm_ops` on `restaurants.name_en`, `restaurants.cuisine_en`, `menu_items.name_en`; `CREATE EXTENSION IF NOT EXISTS pg_trgm`. Backfill: default hours 11:00 to 22:00 every day for every existing restaurant.

- [ ] **Step 1: Write failing tests** in `schema.test.ts`: inserting a discount with `percent` 95 fails; scope `item` without `menu_item_id` fails; hours with `close_minute <= open_minute` fails; a second identical hours row fails; option with negative delta fails; after migration every seeded restaurant has 7 hours rows.
- [ ] **Step 2: Run** `pnpm --filter @oregano/api test catalog/schema` — expect FAIL.
- [ ] **Step 3: Implement** the schema; run `pnpm --filter @oregano/api exec drizzle-kit generate`, read the SQL, add the extension and the backfill by hand.
- [ ] **Step 4: Run** `pnpm db:migrate` then the test — expect PASS.
- [ ] **Step 5: Commit** `feat(catalog): schema for hours, options, discounts, images`.

### Task 2: Domain rules (pure)

**Files:** Create `packages/domain/src/hours.ts`, `menu-pricing.ts`, tests beside them; export from `index.ts`.

**Interfaces:** Produces
`type OpeningInterval = { day: number; openMinute: number; closeMinute: number }` (day 0 = Sunday, `closeMinute` up to 1739 meaning the next day);
`isOpenAt(intervals: readonly OpeningInterval[], localDay: number, localMinute: number): boolean`;
`nextOpening(intervals, localDay, localMinute): { day: number; minute: number } | null` (the next start strictly after now, wrapping the week; `null` when there are no intervals);
`type Discount = { kind: 'percent' | 'amount'; value: number; scope: 'item' | 'category' | 'menu'; menuItemId: string | null; categoryId: string | null }`;
`bestDiscount(unit: Money, applicable: readonly Discount[]): { discount: Discount | null; off: Money }`;
`type OptionGroupRule = { id: string; minSelect: number; maxSelect: number; options: { id: string; priceDelta: Money; isAvailable: boolean }[] }`;
`checkSelections(groups: readonly OptionGroupRule[], optionIds: readonly string[]): { ok: true; delta: Money } | { ok: false; reason: 'unknown_option' | 'option_unavailable' | 'required_choice_missing' | 'too_many_choices' | 'duplicate_option' }`;
`priceLine(base: Money, delta: Money, off: Money): Money`.

- [ ] **Step 1: Write failing tests**: `isOpenAt` — 11:00 to 22:00 is open at 11:00 and closed at 22:00 (end exclusive); interval `{day:1, 1080, 1560}` (18:00 to 02:00) is open Tuesday 01:00 (`localDay 2, 60`), closed Tuesday 03:00; no intervals returns false. `nextOpening` — wraps from Saturday night to Sunday; `null` for no intervals. `bestDiscount` — 10% of Tk 305 gives Tk 31 (30.5 rounds half up); Tk 50 off beats 10% of Tk 300; off is capped so the unit stays at least Tk 1; no applicable discount gives `off` 0. `checkSelections` — each failure reason once, a valid pick returns the summed delta, required group with `minSelect` 1 and no pick fails. `priceLine(Tk 280, Tk 30, Tk 31)` is Tk 279.
- [ ] **Step 2: Run** `pnpm --filter @oregano/domain test` — expect FAIL.
- [ ] **Step 3: Implement** the functions above (integer arithmetic only; percent uses the existing half-up taka helper in `money.ts`).
- [ ] **Step 4: Run** the domain tests with coverage; every branch of the two new files must be covered. Expect PASS.
- [ ] **Step 5: Commit** `feat(domain): opening hours, discount and option pricing rules`.

### Task 3: Public reads: effective state, options, discounts, popular

**Files:** Modify `apps/api/src/catalog/repo.ts`, `routes.ts`, `packages/contracts/src/catalog.ts`, `apps/api/src/catalog/catalog.test.ts`. Create `hours-repo.ts`, `options-repo.ts`, `discounts-repo.ts`.

**Interfaces:** Consumes Task 2. Produces `RestaurantSummary` gains `isOpen` (effective), `opensAt: string | null` ("16:00" zone-local, null when open now or no hours), `prepMinutes` (including busy), `coverImageUrl: string | null`. `RestaurantDetail` gains `hours: { day: number; open: string; close: string }[]`, `popularItemIds: string[]` (top 4 by quantity ordered in 30 days), and each `MenuItem` gains `imageUrl: string | null`, `price` (effective, after the best active discount), `originalPrice: number | null` (set only when discounted), `discountLabel: { kind: 'percent' | 'amount'; value: number } | null`, `optionGroups: { id; nameEn; nameBn; required; minSelect; maxSelect; options: { id; nameEn; nameBn; priceDelta; isAvailable }[] }[]`. `getRestaurantForOrder` returns `isOpen` as the effective value. Time uses the zone's `timezone` and an injectable clock (`withTestApp` already takes `clock`).

- [ ] **Step 1: Write failing tests**: with the clock at 23:00 a restaurant with a 11:00 to 22:00 interval and the switch on reports `isOpen: false`, `opensAt: "11:00"`; with the switch off at 12:00 it is closed and `opensAt` is null; busy 10 adds 10 to `prepMinutes`; a 20% item discount shows `price`, `originalPrice` and `discountLabel`; an expired discount does not apply; option groups appear in position order; closed restaurants still list their menu.
- [ ] **Step 2: Run** `pnpm --filter @oregano/api test catalog` — expect FAIL.
- [ ] **Step 3: Implement**: load hours, options and active discounts in three queries per menu (no N+1); compute effective values with the domain functions.
- [ ] **Step 4: Run** the catalog tests and `pnpm typecheck` (apps compile against the widened contracts; new fields are additive) — expect PASS.
- [ ] **Step 5: Commit** `feat(catalog): effective open state, options, discounts in public reads`.

### Task 4: Staff controls (switch, busy mode, sold out)

**Files:** Create `apps/api/src/catalog/access.ts`, `staff-routes.ts`, `staff-routes.test.ts`. Modify `apps/api/src/app.ts` (register), `apps/api/src/security/rate-limit.ts`, `packages/contracts/src/restaurant.ts`.

**Interfaces:** Produces `requireCatalogActor(db, user, restaurantId, level: 'staff' | 'owner'): Promise<{ kind: 'staff' | 'owner' | 'admin' }>` (admin when `teamCan(user.teamRoles, 'accounts.manage')`; owner level accepts owner or admin; unknown restaurant or non-member answers 404, member below level 403). Routes under `/v1/restaurants/:id`: `PUT /open` body `{ isOpen: boolean }`; `PUT /busy` body `{ extraMinutes: 0 | 10 | 20 }`; `PUT /items/:itemId/availability` body `{ isAvailable: boolean }`. Each returns the new state; unchanged state returns 200 and writes no audit row. New write-rate rule `catalogWritesPerUserHour` (default 600) in `LIMITS_PROFILE`.

- [ ] **Step 1: Write failing tests**: staff can toggle all three; a user of another restaurant gets 404; a customer gets 404; repeat call writes no second audit row; availability of another restaurant's item is 404; a 601st write in an hour is 429 under the default profile; an admin with `accounts.manage` succeeds.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** with `writeAudit` in the same transaction (kinds `restaurant.open_changed`, `restaurant.busy_changed`, `item.availability_changed`).
- [ ] **Step 4: Run** the tests — expect PASS.
- [ ] **Step 5: Commit** `feat(catalog): staff controls for open switch, busy mode and sold-out`.

### Task 5: Menu manager API (owner)

**Files:** Create `menu-repo.ts`, `options-repo.ts` writes, `menu-routes.ts`, `menu-routes.test.ts`. Modify contracts and error codes.

**Interfaces:** Owner-only routes: `POST /v1/restaurants/:id/categories` `{ nameEn, nameBn? }`; `PATCH /categories/:cid` (name); `DELETE /categories/:cid` (409 `category_not_empty` while it has items); `PUT /categories/order` `{ ids: string[] }` (must be exactly the restaurant's categories); `POST /categories/:cid/items` `{ nameEn, nameBn?, descriptionEn?, descriptionBn?, price }`; `PATCH /items/:itemId`; `DELETE /items/:itemId` (hides, see below); `PUT /items/:itemId/options` replaces all of an item's option groups in one transaction with `{ groups: { nameEn, nameBn?, minSelect, maxSelect, options: { nameEn, nameBn?, priceDelta, isAvailable? }[] }[] }` (max 6 groups, 20 options per group). Bangla fields default to the English text. Price range Tk 1 to Tk 50,000. New error codes: `category_not_empty`, `menu_limit_reached` (200 items per restaurant), `invalid_menu_data`.
An item that appears in any order is never hard-deleted (order lines reference it): `DELETE` sets `is_available = false` and `is_archived = true`; add `is_archived` to the Task 1 migration if absent, and exclude archived items from public reads.

- [ ] **Step 1: Write failing tests**: create category and item, names unique per restaurant (409 on duplicate), price 0 rejected, staff (non-owner) gets 403 on every route, reorder with a foreign id is 400 and writes nothing, deleting a category with items is 409, deleting an ordered item archives it and it disappears from `GET /restaurants/:slug`, replacing option groups is atomic (a bad second group leaves the first set intact), 201st item is `menu_limit_reached`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** routes and repos; audit rows `menu.category_created`, `menu.item_created`, `menu.item_updated`, `menu.item_archived`, `menu.options_replaced`, ids only.
- [ ] **Step 4: Run** tests and `pnpm typecheck` — expect PASS (error-code exhaustiveness forces the app-core map and i18n entries; add them in this commit).
- [ ] **Step 5: Commit** `feat(catalog): owner menu manager API`.

### Task 6: Opening hours and prep time (owner)

**Files:** Create `hours-routes.ts`, test. Modify contracts.

**Interfaces:** `GET /v1/restaurants/:id/hours` (any staff) and `PUT /v1/restaurants/:id/hours` (owner) body `{ intervals: { day: 0..6; open: "HH:MM"; close: "HH:MM" }[] }` replacing all (max 3 intervals per day, none overlapping on the same day; `close` earlier than or equal to `open` means "next day", up to 04:00; an empty array means "no auto-close"). `PUT /v1/restaurants/:id/prep` `{ prepMinutes: 5..120 }`. Error `invalid_hours`.

- [ ] **Step 1: Write failing tests**: round trip; overlapping intervals 400; 18:00 to 02:00 stored as `closeMinute` 1560 and reported back as "02:00"; a 05:00 next-day close is 400; empty array clears and the restaurant is then never auto-closed; staff 403; prep 4 and 121 are 400.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** with audit `restaurant.hours_replaced`, `restaurant.prep_changed`.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(catalog): opening hours and prep time`.

### Task 7: Discounts (owner)

**Files:** Create `discount-routes.ts`, test. Modify contracts.

**Interfaces:** `GET /v1/restaurants/:id/discounts` (owner), `POST` `{ kind, value, scope, menuItemId?, categoryId?, startsAt, endsAt }`, `PATCH /discounts/:did` `{ isActive?, endsAt? }`, `DELETE /discounts/:did`. The target must belong to the restaurant. At most 20 live discounts per restaurant. Error `invalid_discount`.

- [ ] **Step 1: Write failing tests**: scope `item` with another restaurant's item is 400; percent 95 is 400; `endsAt` before `startsAt` 400; paused discount does not show in public reads; deleting removes it; a discount that has not started yet is listed for the owner but not public; staff 403.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement**, audit `discount.created|updated|deleted`.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(catalog): restaurant discounts`.

### Task 8: Public images

**Files:** Create `apps/api/src/media/public-image.ts`, `public-store.ts`, `public-routes.ts`, tests. Modify `apps/api/src/app.ts`, `security/rate-limit.ts`, `apps/admin/index.html` CSP source (`vite` config builds the meta from `VITE_API_URL`; add the API origin to `img-src`).

**Interfaces:** `processPublicImage(bytes: Buffer): Promise<{ ok: true; large: Buffer; small: Buffer } | { ok: false; code: 'unsupported_image' | 'image_too_large' }>` (reuse the sniffing and concurrency slot from `image.ts` by exporting them; output WebP, 960 and 320 px wide, no upscaling, first frame only, metadata dropped, max 5 MB input, 40 MP). `putPublicImage(store, bytes): Promise<string>` returns a random key; objects are `public/<key>-960.webp` and `-320.webp` in the existing bucket. Routes: `PUT /v1/restaurants/:id/items/:itemId/photo` and `PUT /v1/restaurants/:id/photo` (owner, multipart one file), `DELETE` of either; `GET /v1/media/public/:key?size=large|small` streams with `Cache-Control: public, max-age=31536000, immutable`, `404` for any key not matching `^[0-9a-f-]{36}$`. New upload rate rule `publicUploadsPerUserHour` (default 60). Replacing a photo deletes the old objects after the row update commits. Error codes `unsupported_image`, `image_too_large`. Public reads from Task 3 build `imageUrl` as `${API_BASE}/v1/media/public/<key>?size=small` (large for the cover and the item sheet).

- [ ] **Step 1: Write failing tests**: a real PNG becomes two WebP files with widths 960 and 320; a polyglot, a renamed text file, the existing `bomb.png` fixture and a 6 MB file are refused; an animated WebP yields a still; the GET route serves with the immutable header and rejects `../x`; replacing deletes the old objects; the 61st upload in an hour is 429; staff (non-owner) 403.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** with `sharp` (check its current docs for `animated: false`, `limitInputPixels` and `withMetadata` defaults before using them).
- [ ] **Step 4: Run** tests and `pnpm --filter @oregano/admin build` — expect PASS.
- [ ] **Step 5: Commit** `feat(media): public menu and restaurant photos`.

### Task 9: Ordering with options, notes, discounts and hours

**Files:** Modify `packages/contracts/src/orders.ts`, `apps/api/src/ordering/*` (service, repo, present), `apps/api/src/ordering/place-order.test.ts`, `apps/api/src/catalog/repo.ts` (`getMenuItems` returns what pricing needs, via an exported `getPricingContext(db, restaurantId, itemIds)`), seed demo.

**Interfaces:** `PlaceOrderBody.items[]` becomes `{ menuItemId, quantity, optionIds?: string[] (max 10), note?: string (max 120) }`; the "Duplicate menu item" rule is replaced by: no two lines with the same `menuItemId` and the same sorted `optionIds` and note. `OrderItem` gains `options: { nameEn: string; nameBn: string; priceDelta: number }[]`, `note: string | null`, `discount: number` (per unit). `unitPrice` is the price paid per unit. The server computes `priceLine(base, delta, off)` from current rows using `checkSelections` and `bestDiscount` (discount valid at the server clock), stores a snapshot in `order_items` (`options`, `note`, `discount_poisha`), keeps `line_total = unit * quantity`. Errors: `option_unavailable`, `required_choice_missing`, `invalid_option` (mapped from the domain reasons), existing `item_unavailable`, and `restaurant_closed` now uses the effective open state (switch and hours).

- [ ] **Step 1: Write failing tests**: size (required) and add-on priced correctly (Tk 280 base, size +Tk 30, add-on +Tk 20 gives Tk 330); missing required size is 400 `required_choice_missing`; sold-out add-on is `option_unavailable`; a 10% item discount lowers the unit price and the snapshot keeps `discount`; an expired discount does not apply; placing at 23:00 for a 22:00-close restaurant is `restaurant_closed`; same item with different options is two lines; option from another item is `invalid_option`; old requests without `optionIds` still work; the idempotent retry still returns the same order.
- [ ] **Step 2: Run** `pnpm --filter @oregano/api test ordering` — expect FAIL.
- [ ] **Step 3: Implement**; existing apps keep compiling because the new body fields are optional and `OrderItem` additions are read-only for them (update the customer cart display only as far as typecheck needs).
- [ ] **Step 4: Run** `pnpm test` and `pnpm typecheck` — expect PASS.
- [ ] **Step 5: Commit** `feat(ordering): price options, notes and discounts on the server`.

### Task 10: Search

**Files:** Create `search-repo.ts`, `search-routes.ts`, tests. Modify contracts.

**Interfaces:** `GET /v1/search?q=<2..60 chars>&lat&lng` returns `{ restaurants: RestaurantSummary[]; dishes: { item: { id; nameEn; nameBn; price; originalPrice; imageUrl; isAvailable }; restaurant: RestaurantSummary }[] }` (max 10 restaurants and 20 dishes). Matching: prefix `ILIKE` or `similarity() > 0.3` on restaurant name, cuisine and dish name; approved restaurants only, in the customer's zone when a point is given, otherwise all active zones; archived and unavailable dishes excluded; open restaurants rank first, then by similarity. `GET /v1/search/popular?lat&lng` returns `{ terms: string[] }` (up to 8 cuisines and dish names by order count in 14 days; fallback cuisines). Per-IP rate rule `searchPerIpMinute` (default 60). Anonymous.

- [ ] **Step 1: Write failing tests**: "bur" finds "Burger Lane" (restaurant) and "Burger" dishes; cuisine "biryani" finds restaurants; a typo "birayni" still matches (trigram); LIKE metacharacters in `q` (`%`, `_`, `\`) are matched literally; 1-character `q` is 400; a suspended restaurant never appears; another zone's restaurants are excluded when a point is given; closed restaurants come after open; popular falls back to cuisines on an empty order history; the 61st request in a minute is 429.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** with parameterised SQL (escape `%`, `_`, `\` before `ILIKE`).
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(catalog): search across restaurants, dishes and cuisines`.

### Task 11: Zones admin API

**Files:** Create `apps/api/src/zones/geometry.ts`, `admin-routes.ts`, tests. Modify `packages/domain/src/team.ts` (new permission `zones.manage`, `superadmin` only), contracts, `apps/api/src/zones/repo.ts`.

**Interfaces:** `GET /v1/admin/zones` (any team member with `zones.manage`) returns zones with boundary as GeoJSON; `POST /v1/admin/zones` `{ slug, nameEn, nameBn, boundary: GeoJSON Polygon, feePerKm, minFee, roadFactor, timezone? }`; `PATCH /v1/admin/zones/:id` (any subset, including `boundary` and `isActive`). `validateBoundary(db, ring, exceptZoneId?): Promise<{ ok: true } | { ok: false; reason: 'too_few_points' | 'too_many_points' | 'not_closed' | 'self_intersecting' | 'too_large' | 'overlaps_zone' | 'outside_bangladesh' }>` (3 to 500 vertices, ring closed, `ST_IsValid`, area at most 5,000 km², inside Bangladesh's bounding box, no overlap with another active zone). Fee bounds: per km Tk 0 to Tk 200, minimum fee Tk 0 to Tk 500, road factor 1.0 to 3.0. Error `invalid_zone`. A zone cannot be deactivated while it has open orders (409 `zone_has_open_orders`). Audit `zone.created|updated`.

- [ ] **Step 1: Write failing tests**: valid polygon created and `findZoneForPoint` finds a point inside it; each `validateBoundary` reason once (bow-tie for self-intersecting, a world-size polygon for too large, a polygon overlapping the seeded Chapainawabganj zone); fee out of range 400; support and onboarding roles get 403; slug unique 409; deactivating a zone with an open order is 409; updating fees changes `deliveryFee` in the public list immediately.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** with PostGIS (`ST_GeomFromGeoJSON`, `ST_IsValid`, `ST_Intersects`, `ST_Area(geography)`).
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(zones): admin zone drawing and fee settings API`.

### Task 12: Restaurant app, today screen

**Files:** Modify `apps/restaurant/src/app/index.tsx`; create `apps/restaurant/src/app/today-controls.tsx`; modify `packages/api-client` (typed methods for Tasks 4 to 7), `packages/app-core` (queries), `packages/i18n` (messages).

**Interfaces:** Large Open/Closed switch (shows "Closed by hours until 11:00" when the switch is on but outside hours), busy mode selector (Off, +10 min, +20 min), all with optimistic UI that rolls back on error; staff and owner both see it.

- [ ] **Step 1: Write failing tests**: `packages/app-core` hook tests for the optimistic rollback; a Playwright case in the e2e journey file (Task 16) covers the screen.
- [ ] **Step 2: Run** `pnpm --filter @oregano/app-core test` — expect FAIL.
- [ ] **Step 3: Implement** the client methods, hooks and screen from tokens only.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm lint` and open the app on port 8082 (restart Metro with `--clear`) — expect the controls to work against the dev API.
- [ ] **Step 5: Commit** `feat(restaurant-app): open switch and busy mode`.

### Task 13: Restaurant app, menu manager

**Files:** Create `apps/restaurant/src/app/menu/index.tsx`, `menu/item.tsx`, `menu/option-editor.tsx`; modify i18n, api-client, app-core.

**Interfaces:** Items grouped by category with photo, name, price and an Available switch (any staff); owner-only controls (add category, add or edit item, photo via `expo-image-picker`, sizes and add-ons editor, reorder by up/down buttons, archive) hidden for staff but still enforced by the API. Photo upload sends the picked file as multipart and shows the processed result.

- [ ] **Step 1: Write failing tests**: pure form-validation functions in `apps/restaurant/src/app/menu/validate.ts` (price in taka to poisha, required name, option limits) with unit tests.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the screens; "Sold out today" is one tap on the switch.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm lint && pnpm --filter @oregano/restaurant test` — expect PASS.
- [ ] **Step 5: Commit** `feat(restaurant-app): menu manager`.

### Task 14: Restaurant app, hours and discounts

**Files:** Create `apps/restaurant/src/app/hours.tsx`, `discounts.tsx`; modify i18n, api-client.

**Interfaces:** Weekly hours editor (per day up to three intervals, copy-to-all-days button, "closes next day" shown when close is before open); discounts list and form (percent or taka, scope item, category or whole menu, start and end dates, pause and delete). Owner only.

- [ ] **Step 1: Write failing tests**: `hours-form.ts` converts between form rows and the API body; tests cover next-day close and the copy-to-all helper.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** screens.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm lint && pnpm --filter @oregano/restaurant test` — expect PASS.
- [ ] **Step 5: Commit** `feat(restaurant-app): opening hours and discounts`.

### Task 15: Admin zones screen and docs

**Files:** Create `apps/admin/src/Zones.tsx`, `ZoneMap.tsx`; modify `Nav.tsx` (tab `zones`, permission `zones.manage`), `App.tsx`, `styles.css`, CSP source (tile host in `img-src`). Modify `docs/blueprint/2026-11-16-oregano-blueprint.md` section 13 (decisions above) and `docs/superpowers/plans/2026-11-16-oregano-roadmap.md` (Plan 04 status).

**Interfaces:** Zones list with fee form; map view where the admin clicks to add vertices, drags to move them, undoes the last one, and sees the validation message from the API. Install Leaflet only after reading its current official documentation; tiles come from OpenStreetMap with attribution and the host added to the CSP.

- [ ] **Step 1: Write failing tests**: unit tests for `ring-edit.ts` (add, move, undo, auto-close, GeoJSON output) and a `Nav` test that support and onboarding roles do not see the Zones tab.
- [ ] **Step 2: Run** `pnpm --filter @oregano/admin test` — expect FAIL.
- [ ] **Step 3: Implement** screen, map and docs.
- [ ] **Step 4: Run** `pnpm --filter @oregano/admin build` — expect PASS.
- [ ] **Step 5: Commit** `feat(admin): zone drawing and fee settings; docs for Plan 04 decisions`.

### Task 16: End-to-end journey and gate

**Files:** Create `e2e/tests/catalog.spec.ts`; modify `e2e` fixtures if needed.

**Journey:** the demo owner opens the restaurant app, sets hours, marks one item sold out, adds an item with a required size and an add-on and a photo, creates a 10% item discount; the customer web app (calls the API through the existing client) sees the discounted price, "Sold out today", and finds the dish by search; an order with options is placed and the restaurant app shows the line with its options and note; the superadmin creates a second zone and changes the fee, and the public list reflects it.

- [ ] **Step 1: Write the failing spec** `catalog.spec.ts` as above.
- [ ] **Step 2: Run** `pnpm test:e2e` — expect FAIL.
- [ ] **Step 3: Fix** whatever the journey exposes in the earlier tasks (each fix gets its own commit).
- [ ] **Step 4: Run** `pnpm verify` — expect PASS; run the clean-container gate from `CLAUDE.md` on the branch.
- [ ] **Step 5: Commit** `test(e2e): catalog and zones journey`. Then write the Plan 05 handoff file.

---

## Review and execution notes

- Independent Opus review only on Task 8 (uploads accept untrusted files), Task 9 (money and pricing in the order path) and Task 11 (geometry input), plus one whole-branch review at the end. Everything else is checked by `pnpm verify`.
- Suggested sessions: A = Tasks 1 to 7 (rules and owner API), B = Tasks 8 to 11 (images, ordering, search, zones), C = Tasks 12 to 16 (apps, admin, e2e).
- Dependency order is the task order; Tasks 12 to 14 only need Tasks 4 to 8, so the apps can start once those land.

## Self-review

- Spec coverage: 3.4 search (Task 10), 3.5 restaurant page items (open state, sold out, discounts, hours, popular tab: Task 3), 3.6 options with live price and kitchen note (Tasks 3 and 9), 4.2 switch, hours, auto-close, busy mode (Tasks 4, 6, 12, 14), 4.4 menu manager (Tasks 4, 5, 8, 13), 4.5 discounts (Tasks 7, 14), book section 6 zones and fees (Tasks 11, 15). The customer-side screens for these are Plan 05; the "Share" button and recent searches are client-side and belong there.
- Not in this plan, by design: admin menu-entry screen and pausing listings (Plan 09), the restaurant's own delivery staff (book 4.6, with Plan 06 dispatch), polish of the owner screens (Plan 05 and a proposed restaurant and rider design pass).
- Names checked across tasks: `checkSelections`, `bestDiscount`, `priceLine`, `isOpenAt`, `nextOpening`, `requireCatalogActor`, `getPricingContext`, `validateBoundary`, permission `zones.manage`.
