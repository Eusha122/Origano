# Oregano First Order, End to End: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One cash-on-delivery order travels from a customer on the website, through the restaurant app and the rider app, to "Delivered", while the admin dashboard watches it live, and a retried "Place order" never creates a second order.

**Architecture:** The API gains modules for identity, catalog, ordering, dispatch and admin, over PostgreSQL. Every order change happens in one transaction that also writes an `order_events` row and an `outbox` row. A worker relays outbox rows to Redis pub/sub; the API fans them out over WebSocket as "order X changed" hints, and clients refetch over HTTPS. Shared packages carry the API contract (`contracts`), a typed client (`api-client`), React session and data glue (`app-core`) and React Native components (`ui-native`). Three Expo apps (customer, restaurant, rider) and one Vite app (admin) use them.

**Tech Stack:** Everything from Plan 01, plus `@fastify/websocket`, `@fastify/cors`, `@tanstack/react-query`, Vite with `@vitejs/plugin-react` for admin, and Playwright for the cross-app journey.

**Spec:** `docs/blueprint/2026-11-16-oregano-blueprint.md` (sections 3, 5, 6, 7, 8) and `Oregano-Product-and-Brand-Book.pdf` (sections 3.1, 3.5, 3.7, 3.8, 4.3, 5.2, 6, 7, 12). Read both before starting. Read `CLAUDE.md` for project rules, and `docs/superpowers/plans/2026-11-16-plan-01-followups.md` for the items this plan picks up.

## Global Constraints

- Every rule in `CLAUDE.md` applies: strict TypeScript, Money as integer poisha, English and Bangla for every string, colours and sizes from `@oregano/ui`, test first, real PostgreSQL in tests, `pnpm verify` is the gate.
- Before pushing, run the full CI in a clean `node:24` container (see `CLAUDE.md`).
- Payment is cash on delivery only. No bKash, Nagad or card fields anywhere.
- Order type is `delivery` only in this plan. Pickup arrives in Plan 05.
- Phone numbers: accepted as `01XXXXXXXXX`, `8801XXXXXXXXX` or `+8801XXXXXXXXX` (spaces and dashes ignored), stored and returned as `+8801[3-9]XXXXXXXX`. Anything else is `invalid_phone`.
- OTP: 6 digits, stored only as an HMAC-SHA256 with `OTP_SECRET`, valid 5 minutes, at most 5 wrong attempts per code. (Per-phone and per-IP send limits arrive in Plan 03.)
- Session token: 32 random bytes, base64url, stored only as SHA-256, valid 60 days, sent as `Authorization: Bearer <token>`. (Rotation and short access tokens arrive in Plan 03; see blueprint section 7.)
- Prices always come from the database. The client never sends a price.
- A rider sees a customer's phone number only while that rider holds the order and it is `ready` or `on_the_way` (book section 12).
- All money in JSON is integer poisha. All timestamps are ISO 8601 UTC strings.
- Delivery fee: `max(zone minimum fee, ceil_to_whole_taka(straight-line km × road factor × fee per km))` (blueprint section 6).
- Restaurant ready-time choices are exactly 10, 20 or 30 minutes (book section 4.3).
- Reject reasons are exactly `item_out_of_stock`, `too_busy`, `closing_soon` (book section 4.3; `REJECT_REASONS` in `@oregano/domain`).
- Realtime messages are hints only. Every client also refetches open orders every 15 seconds, so a lost hint is never visible for longer than that.
- Local ports: API 4000. Dev servers: customer 8081, restaurant 8082, rider 8083, admin 8084. Journey test servers: API 4100, customer 8191, restaurant 8192, rider 8193, admin 8194. Never reuse a running server in tests.
- Demo data (Task 3) uses these phone numbers. They exist only in development and test databases:

| Who                           | Phone       |
| ----------------------------- | ----------- |
| Customer                      | 01711000001 |
| Burger Lane owner             | 01711000002 |
| Rider (independent, approved) | 01711000003 |
| Oregano admin                 | 01711000004 |
| Second rider (for race tests) | 01711000005 |

## Review Focus

1. A customer double-taps "Place order", or a slow 3G connection retries the request. Exactly one order exists, and both responses describe it. Pinned in Task 6 and Task 16.
2. Two riders tap "Accept" on the same offer at the same moment. Exactly one holds the order; the other is told it is taken. Pinned in Task 8.
3. A modified client sends a lower price, an item from another restaurant, a sold-out item, a zero quantity, or a delivery point outside the zone. The server ignores sent prices and rejects the rest with a clear code. Pinned in Task 6.
4. Staff of one restaurant try to act on another restaurant's order, or a rider tries to read the customer's phone before holding the order. Both fail without revealing the order. Pinned in Tasks 7 and 8.
5. A WebSocket connection drops, or a hint is lost. The screen is still correct within 15 seconds, and a connection that never authenticates receives nothing. Pinned in Tasks 10 and 11.

---

## API surface

Every route is under `/v1`, takes and returns JSON, and uses the error envelope from Plan 01. Request bodies are validated with the `@oregano/contracts` schema named in the table; a failure is `400 validation_failed` with message `Some details are missing or wrong.`

| Method and path                         | Who                                                            | Body schema                                 | Success                                                                                        | Errors                                                                                                                                          |
| --------------------------------------- | -------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/auth/otp/request`             | anyone                                                         | `OtpRequestBody`                            | 202 `OtpRequestResponse`                                                                       | 400 `invalid_phone`                                                                                                                             |
| `POST /v1/auth/otp/verify`              | anyone                                                         | `OtpVerifyBody`                             | 200 `SessionResponse`                                                                          | 400 `invalid_phone`; 401 `otp_invalid`, `otp_expired`, `otp_attempts_exceeded`                                                                  |
| `POST /v1/auth/logout`                  | signed in                                                      | none                                        | 204                                                                                            | 401 `unauthenticated`                                                                                                                           |
| `GET /v1/me`                            | signed in                                                      | none                                        | 200 `Me`                                                                                       | 401                                                                                                                                             |
| `GET /v1/dev/otp/:phone`                | anyone, only when `DEV_OTP_PEEK=true`                          | none                                        | 200 `{ code }`                                                                                 | 404                                                                                                                                             |
| `GET /v1/restaurants?lat=&lng=`         | anyone                                                         | query `LocationQuery`                       | 200 `RestaurantListResponse`                                                                   | 400 `invalid_location`                                                                                                                          |
| `GET /v1/restaurants/:slug`             | anyone                                                         | none                                        | 200 `RestaurantDetail`                                                                         | 404                                                                                                                                             |
| `POST /v1/orders`                       | customer                                                       | `PlaceOrderBody` + header `Idempotency-Key` | 201 `Order` (replay: same status and body)                                                     | 400 `idempotency_key_required`; 422 `idempotency_key_reused`, `item_unavailable`, `item_not_in_restaurant`, `restaurant_closed`, `outside_zone` |
| `GET /v1/orders`                        | customer                                                       | none                                        | 200 `{ orders: Order[] }` (own, newest first, max 50)                                          | 401                                                                                                                                             |
| `GET /v1/orders/:id`                    | the customer, the restaurant's staff, the holding rider, admin | none                                        | 200 `Order`                                                                                    | 404 for everyone else                                                                                                                           |
| `POST /v1/orders/:id/cancel`            | the customer                                                   | none                                        | 200 `Order`                                                                                    | 404; 409 `invalid_transition`; 403 `actor_not_allowed`                                                                                          |
| `GET /v1/restaurant/orders`             | restaurant staff                                               | none                                        | 200 `{ orders: Order[] }` (their restaurants, status placed, preparing or ready, oldest first) | 403 `forbidden`                                                                                                                                 |
| `POST /v1/restaurant/orders/:id/accept` | that restaurant's staff                                        | `AcceptBody`                                | 200 `Order`                                                                                    | 404; 409 `invalid_transition`                                                                                                                   |
| `POST /v1/restaurant/orders/:id/reject` | that restaurant's staff                                        | `RejectBody`                                | 200 `Order`                                                                                    | 404; 409                                                                                                                                        |
| `POST /v1/restaurant/orders/:id/ready`  | that restaurant's staff                                        | none                                        | 200 `Order`                                                                                    | 404; 409                                                                                                                                        |
| `POST /v1/rider/online`                 | approved rider                                                 | `OnlineBody`                                | 200 `Me`                                                                                       | 403 `forbidden`                                                                                                                                 |
| `GET /v1/rider/offers`                  | approved rider                                                 | none                                        | 200 `{ offers: RiderOffer[] }` (empty when offline)                                            | 403                                                                                                                                             |
| `GET /v1/rider/orders`                  | approved rider                                                 | none                                        | 200 `{ orders: Order[] }` (held, not terminal)                                                 | 403                                                                                                                                             |
| `POST /v1/rider/orders/:id/claim`       | approved, online rider                                         | none                                        | 200 `Order`                                                                                    | 409 `already_claimed`, `rider_offline`; 404                                                                                                     |
| `POST /v1/rider/orders/:id/pick-up`     | the holding rider                                              | none                                        | 200 `Order`                                                                                    | 404; 409                                                                                                                                        |
| `POST /v1/rider/orders/:id/deliver`     | the holding rider                                              | none                                        | 200 `Order`                                                                                    | 404; 409                                                                                                                                        |
| `GET /v1/admin/orders`                  | admin                                                          | none                                        | 200 `{ orders: AdminOrderRow[] }` (last 24 hours, newest first)                                | 403                                                                                                                                             |
| `GET /v1/realtime`                      | WebSocket; first message must authenticate                     | see Task 10                                 |                                                                                                | close 4401                                                                                                                                      |

Repeating an action that already happened (`already_applied` from `transition()`) returns 200 with the current order, never an error: a double tap is not a mistake.

---

### Task 1: Domain rules for phones, fees and totals

**Files:**

- Create: `packages/domain/src/phone.ts`, `packages/domain/src/pricing.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/src/phone.test.ts`, `packages/domain/src/pricing.test.ts`

**Interfaces:**

- Consumes: `Money`, `taka`, `poisha`, `addMoney`, `multiplyMoney`, `maxMoney` from `money.ts`.
- Produces, from `@oregano/domain`:

```ts
export type BdPhone = string & { readonly __brand: 'BdPhone' };
export function normalizeBdPhone(input: string): BdPhone | null;
export function deliveryFee(
  distanceMeters: number,
  zone: { feePerKm: Money; minFee: Money; roadFactor: number },
): Money;
export type PricedLine = { unitPrice: Money; quantity: number };
export function lineTotal(line: PricedLine): Money;
export function orderTotals(lines: PricedLine[], fee: Money): { subtotal: Money; deliveryFee: Money; total: Money };
export const READY_MINUTES = [10, 20, 30] as const;
export type ReadyMinutes = (typeof READY_MINUTES)[number];
```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/domain/src/phone.test.ts
import { describe, expect, it } from 'vitest';
import { normalizeBdPhone } from './phone';

describe('normalizeBdPhone', () => {
  it('accepts the ways people write a Bangladeshi mobile number', () => {
    for (const input of ['01711000001', '8801711000001', '+8801711000001', '017-1100 0001', ' +880 1711-000001 ']) {
      expect(normalizeBdPhone(input)).toBe('+8801711000001');
    }
  });

  it('accepts every operator prefix from 013 to 019', () => {
    for (const p of ['3', '4', '5', '6', '7', '8', '9']) {
      expect(normalizeBdPhone(`01${p}11000001`)).toBe(`+8801${p}11000001`);
    }
  });

  it('rejects anything else, including foreign numbers', () => {
    for (const input of [
      '',
      '0171100000',
      '017110000011',
      '01211000001',
      '+447911123456',
      '+1 415 555 0100',
      '01711OOOOO1',
      '০১৭১১০০০০০১',
    ]) {
      expect(normalizeBdPhone(input), input).toBeNull();
    }
  });
});
```

```ts
// packages/domain/src/pricing.test.ts
import { describe, expect, it } from 'vitest';
import { taka } from './money';
import { deliveryFee, lineTotal, orderTotals } from './pricing';

const zone = { feePerKm: taka(10), minFee: taka(20), roadFactor: 1.3 };

describe('deliveryFee', () => {
  it('never charges less than the zone minimum', () => {
    expect(deliveryFee(0, zone)).toBe(taka(20));
    expect(deliveryFee(670, zone)).toBe(taka(20)); // 0.871 km -> Tk 8.71 -> minimum
  });

  it('charges straight-line distance times road factor times fee per km', () => {
    expect(deliveryFee(5000, zone)).toBe(taka(65)); // 6.5 km
  });

  it('rounds up to the next whole taka', () => {
    expect(deliveryFee(2310, zone)).toBe(taka(31)); // 3.003 km -> Tk 30.03 -> Tk 31
  });

  it('rejects a negative or non-finite distance', () => {
    expect(() => deliveryFee(-1, zone)).toThrow(RangeError);
    expect(() => deliveryFee(Number.NaN, zone)).toThrow(RangeError);
  });
});

describe('order totals', () => {
  it('multiplies each line and adds the delivery fee', () => {
    const lines = [
      { unitPrice: taka(380), quantity: 2 },
      { unitPrice: taka(180), quantity: 1 },
    ];
    expect(lineTotal(lines[0]!)).toBe(taka(760));
    expect(orderTotals(lines, taka(20))).toEqual({ subtotal: taka(940), deliveryFee: taka(20), total: taka(960) });
  });

  it('refuses an empty order or a quantity outside 1 to 20', () => {
    expect(() => orderTotals([], taka(20))).toThrow(RangeError);
    expect(() => lineTotal({ unitPrice: taka(380), quantity: 0 })).toThrow(RangeError);
    expect(() => lineTotal({ unitPrice: taka(380), quantity: 21 })).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @oregano/domain test`
Expected: FAIL, cannot resolve `./phone` and `./pricing`.

- [ ] **Step 3: Implement**

`normalizeBdPhone` removes spaces and dashes, then matches `^(?:\+?880|0)?(1[3-9]\d{8})$` on ASCII digits only. `deliveryFee` works in integers: round meters to a whole number, express the road factor in hundredths, compute poisha as `feePerKm × meters × factorHundredths / 100000`, round up to a multiple of 100, then take the maximum with the minimum fee.

- [ ] **Step 4: Run the checks**

Run: `pnpm --filter @oregano/domain test` then `pnpm lint` then `pnpm typecheck`
Expected: all domain tests pass; lint and typecheck exit 0.

- [ ] **Step 5: Commit** `feat: phone normalisation, delivery fee and order totals`

---

### Task 2: The API contract package

**Files:**

- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/auth.ts`, `catalog.ts`, `orders.ts`, `rider.ts`, `admin.ts`, `realtime.ts`, `errors.ts`
- Test: `packages/contracts/src/contracts.test.ts`

**Interfaces:**

- Consumes: `REJECT_REASONS`, `READY_MINUTES`, `ORDER_STATUSES` from `@oregano/domain`.
- Produces, from `@oregano/contracts` (Zod schemas, each with `export type X = z.infer<typeof X>`):

| Schema                   | Shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OtpRequestBody`         | `{ phone: string }` (1–30 chars; normalised by the server)                                                                                                                                                                                                                                                                                                                                                                                                              |
| `OtpRequestResponse`     | `{ expiresInSeconds: number; resendInSeconds: number }`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `OtpVerifyBody`          | `{ phone: string; code: string }`, code exactly 6 ASCII digits                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Role`                   | `'customer' \| 'restaurant' \| 'rider' \| 'admin'`                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Me`                     | `{ id: uuid; phone: string; name: string \| null; roles: Role[]; restaurantIds: uuid[]; rider: { zoneId: uuid; isOnline: boolean } \| null }`                                                                                                                                                                                                                                                                                                                           |
| `SessionResponse`        | `{ token: string; user: Me }`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `LocationQuery`          | `{ lat: number (-90..90); lng: number (-180..180) }`, coerced from query strings                                                                                                                                                                                                                                                                                                                                                                                        |
| `ZoneSummary`            | `{ id; slug; nameEn; nameBn }`                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `RestaurantSummary`      | `{ id; slug; nameEn; nameBn; cuisineEn; cuisineBn; isOpen: boolean; prepMinutes: number; deliveryFee: number \| null }`                                                                                                                                                                                                                                                                                                                                                 |
| `RestaurantListResponse` | `{ zone: ZoneSummary \| null; restaurants: RestaurantSummary[] }`                                                                                                                                                                                                                                                                                                                                                                                                       |
| `MenuItem`               | `{ id; nameEn; nameBn; descriptionEn: string \| null; descriptionBn: string \| null; price: number; isAvailable: boolean }`                                                                                                                                                                                                                                                                                                                                             |
| `RestaurantDetail`       | `RestaurantSummary & { addressLine: string; categories: { id; nameEn; nameBn; items: MenuItem[] }[] }`                                                                                                                                                                                                                                                                                                                                                                  |
| `PlaceOrderBody`         | `{ restaurantId: uuid; items: { menuItemId: uuid; quantity: int 1..20 }[] (1..30, no duplicate menuItemId); delivery: { lat; lng; addressLine: string 1..200; landmark: string 1..200; phone: string }; note?: string 0..200 }`, all strings trimmed                                                                                                                                                                                                                    |
| `OrderItem`              | `{ menuItemId; nameEn; nameBn; unitPrice: number; quantity: number; lineTotal: number }`                                                                                                                                                                                                                                                                                                                                                                                |
| `TimelineEntry`          | `{ event: string; at: string }`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `Order`                  | `{ id; number: number; status: OrderStatus; type: 'delivery'; restaurant: { id; nameEn; nameBn; phone: string \| null }; items: OrderItem[]; subtotal; deliveryFee; total; paymentMethod: 'cash'; delivery: { addressLine; landmark; lat; lng }; customerPhone: string \| null; rider: { id; name: string \| null; phone: string \| null } \| null; readyInMinutes: number \| null; rejectReason: RejectReason \| null; timeline: TimelineEntry[]; createdAt: string }` |
| `AcceptBody`             | `{ readyInMinutes: 10 \| 20 \| 30 }`                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `RejectBody`             | `{ reason: RejectReason }`                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `OnlineBody`             | `{ online: boolean }`                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `RiderOffer`             | `{ orderId; number; status: 'preparing' \| 'ready'; restaurant: { nameEn; nameBn; addressLine }; landmark: string; distanceKm: number (one decimal); deliveryFee: number }`                                                                                                                                                                                                                                                                                             |
| `AdminOrderRow`          | `{ id; number; status; restaurantNameEn; customerPhone; riderName: string \| null; riderPhone: string \| null; total; createdAt }`                                                                                                                                                                                                                                                                                                                                      |
| `RealtimeClientMessage`  | `{ type: 'auth'; token: string }`                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `RealtimeServerMessage`  | `{ type: 'ready' } \| { type: 'order.changed'; orderId: uuid }`                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ErrorCode`              | union of every error code in the API surface table, plus `bad_request`, `payload_too_large`, `unsupported_media_type`, `not_found`, `internal`, `unauthenticated`, `forbidden`, `validation_failed`, `invalid_location`, `invalid_phone`                                                                                                                                                                                                                                |
| `ApiErrorBody`           | `{ error: { code: ErrorCode; message: string; requestId: string } }`                                                                                                                                                                                                                                                                                                                                                                                                    |

`Order` fields that a caller may not see are `null`, never absent, so every client handles one shape.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contracts/src/contracts.test.ts
import { describe, expect, it } from 'vitest';
import { AcceptBody, OtpVerifyBody, PlaceOrderBody, RejectBody, RealtimeServerMessage } from './index';

const item = '7f0c6d3e-1b2a-4c5d-8e9f-0a1b2c3d4e5f';
const restaurant = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const delivery = {
  lat: 24.5965,
  lng: 88.2775,
  addressLine: ' Court Road ',
  landmark: 'Behind the college gate',
  phone: '01711000001',
};

describe('contracts', () => {
  it('accepts a normal order and trims text', () => {
    const parsed = PlaceOrderBody.parse({
      restaurantId: restaurant,
      items: [{ menuItemId: item, quantity: 2 }],
      delivery,
    });
    expect(parsed.delivery.addressLine).toBe('Court Road');
  });

  it('never accepts a price from the client', () => {
    const parsed = PlaceOrderBody.parse({
      restaurantId: restaurant,
      items: [{ menuItemId: item, quantity: 1, price: 1 }],
      delivery,
    });
    expect(parsed.items[0]).not.toHaveProperty('price');
  });

  it('rejects empty orders, bad quantities and duplicate lines', () => {
    expect(PlaceOrderBody.safeParse({ restaurantId: restaurant, items: [], delivery }).success).toBe(false);
    expect(
      PlaceOrderBody.safeParse({ restaurantId: restaurant, items: [{ menuItemId: item, quantity: 0 }], delivery })
        .success,
    ).toBe(false);
    expect(
      PlaceOrderBody.safeParse({ restaurantId: restaurant, items: [{ menuItemId: item, quantity: 21 }], delivery })
        .success,
    ).toBe(false);
    expect(
      PlaceOrderBody.safeParse({
        restaurantId: restaurant,
        items: [
          { menuItemId: item, quantity: 1 },
          { menuItemId: item, quantity: 1 },
        ],
        delivery,
      }).success,
    ).toBe(false);
  });

  it('rejects a blank landmark and impossible coordinates', () => {
    expect(
      PlaceOrderBody.safeParse({
        restaurantId: restaurant,
        items: [{ menuItemId: item, quantity: 1 }],
        delivery: { ...delivery, landmark: '   ' },
      }).success,
    ).toBe(false);
    expect(
      PlaceOrderBody.safeParse({
        restaurantId: restaurant,
        items: [{ menuItemId: item, quantity: 1 }],
        delivery: { ...delivery, lat: 91 },
      }).success,
    ).toBe(false);
  });

  it('accepts only the ready times and reject reasons the book lists', () => {
    expect(AcceptBody.safeParse({ readyInMinutes: 20 }).success).toBe(true);
    expect(AcceptBody.safeParse({ readyInMinutes: 15 }).success).toBe(false);
    expect(RejectBody.safeParse({ reason: 'too_busy' }).success).toBe(true);
    expect(RejectBody.safeParse({ reason: 'bored' }).success).toBe(false);
  });

  it('accepts only six ASCII digits as a code', () => {
    expect(OtpVerifyBody.safeParse({ phone: '01711000001', code: '123456' }).success).toBe(true);
    expect(OtpVerifyBody.safeParse({ phone: '01711000001', code: '12345' }).success).toBe(false);
    expect(OtpVerifyBody.safeParse({ phone: '01711000001', code: '১২৩৪৫৬' }).success).toBe(false);
  });

  it('describes the realtime hint', () => {
    expect(RealtimeServerMessage.parse({ type: 'order.changed', orderId: item })).toEqual({
      type: 'order.changed',
      orderId: item,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm install` then `pnpm --filter @oregano/contracts test`
Expected: FAIL, cannot resolve `./index`.

- [ ] **Step 3: Implement the schemas**

Use Zod objects in strip mode (unknown keys dropped) so a sent `price` is discarded. The package depends on `zod` and `@oregano/domain`.

- [ ] **Step 4: Run the checks** — `pnpm --filter @oregano/contracts test`, `pnpm lint`, `pnpm typecheck`; all pass.

- [ ] **Step 5: Commit** `feat: API contract schemas`

---

### Task 3: Database tables and demo data

**Files:**

- Create: `apps/api/src/identity/schema.ts`, `apps/api/src/catalog/schema.ts`, `apps/api/src/ordering/schema.ts`, `apps/api/src/events/schema.ts`
- Modify: `apps/api/src/db/schema.ts` (export the new schemas), `apps/api/src/db/geography.ts` (add a `geographyPoint` type)
- Create: `apps/api/drizzle/0001_first_order.sql` (generated, then reviewed by hand as in Plan 01)
- Create: `apps/api/src/dev/seed-demo.ts`, `apps/api/src/dev/seed-cli.ts` (replaces `zones/seed-cli.ts`)
- Modify: `apps/api/package.json` (`db:seed` runs the new CLI), `infra/postgres-init/01-test-db.sql` (also creates `oregano_e2e_test`)
- Test: `apps/api/src/dev/seed-demo.test.ts`

**Interfaces:**

- Consumes: `zones` table and `seedZones` from Plan 01.
- Produces: the tables below, and `seedDemo(db: Db): Promise<DemoIds>` (calls `seedZones`, safe to run repeatedly, upserting on natural keys), where `DemoIds = { zoneId; restaurantId; customerId; ownerId; riderId; secondRiderId; adminId; menuItemIds: Record<'beefCheeseBurger' | 'chickenPizza' | 'crispyChickenBurger' | 'coldCoffee', string> }`.

Tables (all `id uuid primary key default gen_random_uuid()` unless stated; `created_at timestamptz not null default now()` on every table):

| Table              | Columns and rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`            | `phone text unique not null`, `name text`, `is_admin boolean not null default false`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `otp_challenges`   | `phone text not null`, `code_hash text not null`, `expires_at timestamptz not null`, `attempts integer not null default 0` (check 0..5), `consumed_at timestamptz`; index on `(phone, created_at desc)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `sessions`         | `user_id uuid not null references users on delete cascade`, `token_hash text unique not null`, `expires_at timestamptz not null`, `revoked_at timestamptz`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `restaurants`      | `zone_id uuid not null references zones`, `slug text unique not null`, `name_en`, `name_bn`, `cuisine_en`, `cuisine_bn`, `address_line text not null`, `phone text`, `location geography(Point, 4326) not null`, `is_open boolean not null default true`, `prep_minutes integer not null default 20` (check 5..120)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `restaurant_staff` | primary key `(restaurant_id, user_id)`, `role text not null` (check `owner` or `staff`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `menu_categories`  | `restaurant_id not null references restaurants on delete cascade`, `name_en`, `name_bn`, `position integer not null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `menu_items`       | `restaurant_id`, `category_id` (both not null, cascade), `name_en`, `name_bn`, `description_en`, `description_bn`, `price_poisha integer not null` (check > 0), `is_available boolean not null default true`, `position integer not null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `riders`           | `user_id uuid primary key references users`, `zone_id not null references zones`, `type text not null` (check `agency`, `independent`, `restaurant_staff`), `status text not null` (check `applied`, `under_review`, `approved`, `rejected`, `suspended`), `is_online boolean not null default false`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `orders`           | `number integer unique not null` (from sequence `order_number_seq` starting 1001), `customer_id`, `restaurant_id`, `zone_id` (not null, references), `rider_id uuid references users`, `type text not null` (check `delivery`), `status text not null` (check: the nine statuses), `subtotal_poisha`, `delivery_fee_poisha`, `total_poisha` (integer not null, check ≥ 0, check total = subtotal + fee), `payment_method text not null` (check `cash`), `address_line`, `landmark`, `delivery_phone` (text not null), `delivery_location geography(Point, 4326) not null`, `note text`, `ready_in_minutes integer` (check 10, 20, 30), `reject_reason text`, `updated_at timestamptz not null default now()`; indexes on `(restaurant_id, status)`, `(customer_id, created_at desc)`, `(zone_id, status) where rider_id is null` |
| `order_items`      | `order_id not null references orders on delete cascade`, `menu_item_id not null references menu_items`, `name_en`, `name_bn`, `unit_price_poisha` (> 0), `quantity` (1..20), `line_total_poisha` (check = unit × quantity)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `order_events`     | `id bigserial primary key`, `order_id not null references orders`, `event text not null`, `from_status text`, `to_status text not null`, `actor_type text not null`, `actor_id uuid`, `data jsonb not null default '{}'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `outbox`           | `id bigserial primary key`, `topic text not null`, `payload jsonb not null`, `published_at timestamptz`; partial index on `id where published_at is null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `idempotency_keys` | primary key `(user_id, key)`, `request_hash text not null`, `response_status integer`, `response_body jsonb`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Demo data (the book's mock-ups): restaurant `burger-lane`, "Burger Lane" / "বার্গার লেন", cuisine "Burgers, pizza" / "বার্গার, পিৎজা", address "Court Road, Chapainawabganj", location latitude 24.5960, longitude 88.2710, open, prep 20 minutes. Categories and items:

| Category       | Item                                       | Price  |
| -------------- | ------------------------------------------ | ------ |
| Burgers / বার্গার | Beef Cheese Burger / বিফ চিজ বার্গার          | Tk 380 |
| Burgers / বার্গার | Crispy Chicken Burger / ক্রিস্পি চিকেন বার্গার  | Tk 220 |
| Pizza / পিৎজা   | Chicken Pizza, 8 inch / চিকেন পিৎজা, ৮ ইঞ্চি | Tk 350 |
| Drinks / পানীয়  | Cold Coffee / কোল্ড কফি                     | Tk 180 |

Users: the five phones from Global Constraints. The owner is `owner` of Burger Lane. Both riders are `independent`, `approved`, offline, in the Chapainawabganj zone. The admin has `is_admin = true`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/dev/seed-demo.test.ts
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestDb } from '../testing/db';
import { seedDemo } from './seed-demo';

describe('demo seed', () => {
  const { db } = withTestDb();

  it('creates Burger Lane with its menu, staff, riders and admin', async () => {
    const ids = await seedDemo(db);
    const items = await db.execute<{ name_en: string; price_poisha: number }>(
      sql`SELECT name_en, price_poisha FROM menu_items WHERE restaurant_id = ${ids.restaurantId} ORDER BY name_en`,
    );
    expect(items.map((i) => [i.name_en, i.price_poisha])).toEqual([
      ['Beef Cheese Burger', 38000],
      ['Chicken Pizza, 8 inch', 35000],
      ['Cold Coffee', 18000],
      ['Crispy Chicken Burger', 22000],
    ]);
    const roles = await db.execute<{ phone: string; is_admin: boolean }>(
      sql`SELECT phone, is_admin FROM users ORDER BY phone`,
    );
    expect(roles.map((r) => r.phone)).toEqual([
      '+8801711000001',
      '+8801711000002',
      '+8801711000003',
      '+8801711000004',
      '+8801711000005',
    ]);
  });

  it('is safe to run twice', async () => {
    const first = await seedDemo(db);
    const second = await seedDemo(db);
    expect(second).toEqual(first);
    const count = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM menu_items`);
    expect(count[0]?.n).toBe(4);
  });

  it('refuses an order whose total does not add up', async () => {
    const ids = await seedDemo(db);
    await expect(
      db.execute(sql`
        INSERT INTO orders (number, customer_id, restaurant_id, zone_id, type, status, subtotal_poisha, delivery_fee_poisha,
          total_poisha, payment_method, address_line, landmark, delivery_phone, delivery_location)
        VALUES (nextval('order_number_seq'), ${ids.customerId}, ${ids.restaurantId}, ${ids.zoneId}, 'delivery', 'placed',
          38000, 2000, 1, 'cash', 'x', 'y', '+8801711000001', ST_GeogFromText('SRID=4326;POINT(88.2775 24.5965)'))
      `),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @oregano/api test src/dev`; FAIL, cannot resolve `./seed-demo`.

- [ ] **Step 3: Implement the schemas, generate the migration, implement `seedDemo`**

After `pnpm --filter @oregano/api db:generate`, read the SQL: unquote geography types, confirm every check constraint is present, and add `CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1001` before `orders`. Add `CREATE DATABASE oregano_e2e_test OWNER oregano;` to the init script; on an existing local volume, create it once by hand with `psql`.

- [ ] **Step 4: Run the checks** — all API tests pass (Plan 01's 21 plus these 3); lint and typecheck exit 0. Then `pnpm db:migrate && pnpm db:seed` succeeds twice in a row.

- [ ] **Step 5: Commit** `feat: tables for identity, catalog and orders, with demo data`

---

### Task 4: Sign-in by OTP and sessions

**Files:**

- Modify: `apps/api/src/config.ts` (new settings), `apps/api/src/app.ts` (`buildApp` takes services and registers `/v1` routes), `apps/api/src/server.ts`
- Create: `apps/api/src/identity/otp.ts`, `sessions.ts`, `auth.ts` (Fastify hooks), `routes.ts`, `dev-routes.ts`
- Create: `apps/api/src/testing/app.ts`
- Modify: `apps/api/src/app.test.ts`, `apps/api/src/config.test.ts` (new settings; also fix the vacuous secret test and close apps, from the Plan 01 follow-ups)
- Test: `apps/api/src/identity/identity.test.ts`

**Interfaces:**

- Consumes: `normalizeBdPhone` (Task 1), contracts `OtpRequestBody`, `OtpVerifyBody`, `SessionResponse`, `Me` (Task 2), tables (Task 3).
- Produces:

```ts
// config.ts adds to Config
otpSecret: string;          // OTP_SECRET, at least 32 characters, never echoed
sessionTtlDays: number;     // SESSION_TTL_DAYS, default 60
corsOrigins: string[];      // CORS_ORIGINS, comma separated URLs, default []
devOtpPeek: boolean;        // DEV_OTP_PEEK, default false; loadConfig throws if true when NODE_ENV=production

// identity/otp.ts
export interface OtpSender { send(phone: BdPhone, code: string): Promise<void> }
export class LoggingOtpSender implements OtpSender {}           // logs "OTP for +8801… is 123456" at info
export class CapturingOtpSender implements OtpSender { last(phone: BdPhone): string | undefined }

// app.ts
export type Services = { db: Db; otpSender: OtpSender }; // Task 10 adds `realtime?: RealtimeHub`
export function buildApp(deps: { config: Config; checks: ReadinessCheck[]; services?: Services }): Promise<FastifyInstance>;

// identity/auth.ts: Fastify decorators used by every later route
export type AuthUser = { id: string; phone: BdPhone; isAdmin: boolean; restaurantIds: string[]; rider: { zoneId: string; status: string; isOnline: boolean } | null };
// request.user: AuthUser | null, set by an onRequest hook from the Bearer token
export function requireUser(request): AuthUser;                  // throws AppError('unauthenticated', 401)
export function requireRole(request, role: 'restaurant' | 'rider' | 'admin'): AuthUser; // throws AppError('forbidden', 403)
export function toMe(user: AuthUser): Me;                        // roles: 'customer' always; others from data

// testing/app.ts
export function withTestApp(): {
  app: () => FastifyInstance;               // built after migrations; closed after all tests
  db: Db;
  otp: CapturingOtpSender;
  demo: () => DemoIds;                      // seedDemo runs before each test
  signIn: (phone: string) => Promise<string>; // full OTP flow through the API; returns the token
  as: (token: string) => { authorization: string };
};
```

Rules: requesting a code when an unexpired, unconsumed challenge exists replaces it. Verifying uses the newest unconsumed challenge for the phone; a wrong code increments `attempts`, and the fifth wrong code consumes the challenge (`otp_attempts_exceeded`). A correct code consumes the challenge, creates the user on first sign-in, and returns a new session. Codes are compared with `timingSafeEqual` on the HMACs. Error messages never say whether a phone has an account.

- [ ] **Step 1: Write the failing tests** in `identity/identity.test.ts`, using `withTestApp()`:
  - `signs a new customer in with the code that was sent`: request for `017 1100 0099`, read the code from `otp.last('+8801711000099')`, verify, expect 200, `user.phone === '+8801711000099'`, `user.roles` equal `['customer']`, and a token of at least 43 characters; then `GET /v1/me` with it returns the same user.
  - `gives the seeded owner, rider and admin their roles`: `roles` contains `restaurant` for `01711000002` (with `restaurantIds` = `[demo().restaurantId]`), `rider` for `01711000003` (with `rider.isOnline === false`), `admin` for `01711000004`.
  - `rejects a wrong code, then locks the code after five wrong tries`: four wrong codes give 401 `otp_invalid`; the fifth gives 401 `otp_attempts_exceeded`; the correct code afterwards also gives `otp_attempts_exceeded`.
  - `rejects an expired code`: set `expires_at` to the past with SQL; correct code gives 401 `otp_expired`.
  - `a code works once`: verifying the same correct code twice gives 200 then 401.
  - `stores neither codes nor tokens in plain text`: no `otp_challenges.code_hash` equals the code; no `sessions.token_hash` equals the token.
  - `rejects foreign and malformed phone numbers`: `+447911123456` and `12345` give 400 `invalid_phone`, and nothing is sent.
  - `logs out`: after `POST /v1/auth/logout`, the token gets 401 on `/v1/me`.
  - `an expired or unknown token is unauthenticated`.
  - `dev peek exists only when enabled`: with `devOtpPeek: false`, `GET /v1/dev/otp/+8801711000001` is 404; with true, it returns the last code.
  - In `config.test.ts`: `refuses DEV_OTP_PEEK in production`; `requires OTP_SECRET of at least 32 characters and never echoes it`; `parses CORS_ORIGINS`.

- [ ] **Step 2: Run to verify they fail** — FAIL on missing modules.

- [ ] **Step 3: Implement.** Register `@fastify/cors` with `config.corsOrigins` (no wildcard). Add `OTP_SECRET`, `CORS_ORIGINS` and `DEV_OTP_PEEK=true` to `.env.example`; `server.ts` uses `LoggingOtpSender`.

- [ ] **Step 4: Run the checks** — all API tests pass; lint and typecheck exit 0.

- [ ] **Step 5: Commit** `feat: sign-in by OTP with sessions and roles`

---

### Task 5: Restaurants and menus to read

**Files:**

- Create: `apps/api/src/catalog/repo.ts`, `apps/api/src/catalog/routes.ts`
- Modify: `apps/api/src/zones/repo.ts` (export `findZoneForPoint` unchanged), `apps/api/src/app.ts`
- Test: `apps/api/src/catalog/catalog.test.ts`

**Interfaces:**

- Consumes: `findZoneForPoint` (Plan 01), `deliveryFee` (Task 1), contracts `LocationQuery`, `RestaurantListResponse`, `RestaurantDetail`.
- Produces: `GET /v1/restaurants` and `GET /v1/restaurants/:slug`; and for ordering:

```ts
export type RestaurantForOrder = {
  id: string;
  zoneId: string;
  isOpen: boolean;
  nameEn: string;
  nameBn: string;
  location: { lat: number; lng: number };
};
export function getRestaurantForOrder(db: Db, id: string): Promise<RestaurantForOrder | null>;
export function getMenuItems(
  db: Db,
  restaurantId: string,
  ids: string[],
): Promise<{ id: string; restaurantId: string; nameEn: string; nameBn: string; price: Money; isAvailable: boolean }[]>;
export function distanceMeters(
  db: Db,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<number>; // PostGIS ST_Distance on geography
```

Rules: the list returns open restaurants first, then closed, each ordered by name; `deliveryFee` is filled when `lat` and `lng` are given and the point is in the restaurant's zone, otherwise `null`. A point outside every zone returns `{ zone: null, restaurants: [] }` (the app then shows "We don't deliver here yet"). Impossible coordinates are 400 `invalid_location` (this maps the `RangeError` from `findZoneForPoint`, closing the Plan 01 follow-up). Unavailable items are listed with `isAvailable: false`.

- [ ] **Step 1: Write the failing tests:** `lists Burger Lane with a delivery fee for a town-centre pin` (lat 24.5965, lng 88.2775: fee 2000); `returns no zone for Dhaka`; `rejects latitude 91 with invalid_location`; `returns the menu grouped by category in position order`; `shows a sold-out item as unavailable`; `returns 404 for an unknown slug`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the checks.**
- [ ] **Step 5: Commit** `feat: restaurant list and menu`

---

### Task 6: Placing an order, safely

**Files:**

- Create: `apps/api/src/ordering/idempotency.ts`, `apps/api/src/ordering/repo.ts`, `apps/api/src/ordering/service.ts`, `apps/api/src/ordering/present.ts`, `apps/api/src/ordering/routes.ts`
- Create: `apps/api/src/events/outbox.ts`
- Test: `apps/api/src/ordering/place-order.test.ts`

**Interfaces:**

- Consumes: Tasks 1–5.
- Produces:

```ts
// db/client.ts adds the transaction handle type used by every service
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

// events/outbox.ts
export type OrderChangedPayload = {
  orderId: string;
  customerId: string;
  restaurantId: string;
  riderId: string | null;
  zoneId: string;
  status: OrderStatus;
};
export function writeOrderChanged(tx: Tx, payload: OrderChangedPayload): Promise<void>; // topic 'order.changed'

// ordering/service.ts — every function runs in one transaction that writes the order, an order_events row and an outbox row
export function placeOrder(db: Db, customer: AuthUser, body: PlaceOrderBody): Promise<{ orderId: string }>;
export function applyTransition(
  db: Db,
  input: {
    orderId: string;
    event: OrderEvent;
    actor: OrderActor;
    actorId: string;
    data?: { readyInMinutes?: ReadyMinutes; reason?: RejectReason };
  },
): Promise<{ orderId: string; changed: boolean }>;
// locks the row FOR UPDATE, calls transition() from @oregano/domain;
// ok -> update status (and ready_in_minutes / reject_reason), write event + outbox, changed: true
// already_applied -> changed: false, nothing written
// invalid_transition -> AppError('invalid_transition', 409); actor_not_allowed -> AppError('actor_not_allowed', 403)

// ordering/present.ts
export type Viewer = { kind: 'customer' | 'restaurant' | 'rider' | 'admin'; userId: string };
export function loadOrder(db: Db, orderId: string, viewer: Viewer): Promise<Order>; // applies the phone visibility rules

// ordering/idempotency.ts
export function withIdempotency<T>(
  db: Db,
  input: { userId: string; key: string | undefined; requestBody: unknown },
  run: (tx: Tx) => Promise<{ status: number; body: T }>,
): Promise<{ status: number; body: T }>;
```

`withIdempotency` algorithm (the order insert and the key share one transaction):

```
key missing or not 8–64 of [A-Za-z0-9_-]  -> AppError('idempotency_key_required', 400)
hash = sha256 of the canonical JSON of requestBody
BEGIN
  INSERT INTO idempotency_keys (user_id, key, request_hash) VALUES (...) ON CONFLICT DO NOTHING RETURNING key
  -- a concurrent duplicate blocks here until the first transaction commits
  if a row was inserted: result = run(tx); UPDATE idempotency_keys SET response_status, response_body; COMMIT; return result
  else: SELECT request_hash, response_status, response_body
        if request_hash differs -> AppError('idempotency_key_reused', 422)
        COMMIT; return the stored response
```

`placeOrder` rules, in order: restaurant exists (else 404) and is open (`restaurant_closed`); every item belongs to that restaurant (`item_not_in_restaurant`) and is available (`item_unavailable`); the delivery point's zone is the restaurant's zone (`outside_zone`); prices come from `menu_items`; fee from `distanceMeters` and `deliveryFee`; `delivery.phone` passes `normalizeBdPhone` (`invalid_phone`). It writes the order with status `placed`, its items, event `placed` (actor customer), and an outbox row.

Phone visibility in `loadOrder`: `customerPhone` is shown to admin, to the restaurant's staff, and to the holding rider only while status is `ready` or `on_the_way`; otherwise `null`. `rider.phone` is shown to the customer and the restaurant once a rider holds the order. Timeline: one entry per `order_events` row, oldest first, `event` names: `placed`, `accepted`, `rejected`, `cancelled`, `expired`, `ready`, `picked_up`, `delivered`, `undeliverable`, `rider_assigned`.

- [ ] **Step 1: Write the failing tests** (`withTestApp`, signed in as the demo customer, town-centre delivery point):
  - `places an order priced from the menu, not the request`: two Beef Cheese Burgers and one Cold Coffee with a forged `price: 1` in each line; 201; `subtotal` 94000, `deliveryFee` 2000, `total` 96000; `status` `placed`; one `order_events` row `placed`; one unpublished `outbox` row with topic `order.changed`.
  - `a retried request returns the same order`: same `Idempotency-Key` twice; both 201 with the same `id`; exactly one row in `orders`.
  - `two simultaneous requests with one key create one order`: `Promise.all` of two injects; both succeed with the same `id`; one order.
  - `a different body under the same key is refused`: 422 `idempotency_key_reused`.
  - `a missing or malformed key is refused`: 400 `idempotency_key_required`; no order.
  - `the same key from two customers makes two orders` (keys are per user).
  - `refuses a sold-out item, another restaurant's item, a closed restaurant, and a Dhaka delivery point` with the matching codes and no order rows.
  - `refuses a zero quantity and an empty order` with 400 `validation_failed`.
  - `only the customer, the restaurant, a holding rider and admin can read an order`: a second customer gets 404 on `GET /v1/orders/:id`.
  - `a customer can cancel until the restaurant accepts`: cancel gives `cancelled`; cancelling again gives 200 with the same state; a timeline entry `cancelled` exists once.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the checks.**
- [ ] **Step 5: Commit** `feat: place and cancel orders with idempotency and an outbox`

---

### Task 7: The restaurant's side of an order

**Files:**

- Create: `apps/api/src/ordering/restaurant-routes.ts`
- Test: `apps/api/src/ordering/restaurant.test.ts`

**Interfaces:**

- Consumes: `applyTransition`, `loadOrder` (Task 6), `requireRole` (Task 4).
- Produces: the four `/v1/restaurant/...` routes. Each action first loads the order's `restaurant_id`; if the caller is not staff there, the answer is 404 (never 403), so other restaurants' orders stay invisible.

- [ ] **Step 1: Write the failing tests:** `lists new orders for the owner's restaurant`; `accepts with a ready time and records the accepted event` (status `preparing`, `readyInMinutes` 20, timeline contains `accepted`); `a second accept tap returns the same order, not an error` (200, one `accepted` event); `rejects with a reason` (status `rejected`, `rejectReason` `too_busy`); `marks an accepted order ready`; `cannot mark a placed order ready` (409 `invalid_transition`); `staff of another restaurant get 404` (seed a second restaurant and owner in the test); `a customer cannot use restaurant routes` (403 `forbidden`); `every change writes one outbox row`.
- [ ] **Step 2: Run to verify they fail.** **Step 3: Implement.** **Step 4: Run the checks.**
- [ ] **Step 5: Commit** `feat: restaurant accepts, rejects and readies orders`

---

### Task 8: Riders: going online, offers, claiming and delivering

**Files:**

- Create: `apps/api/src/dispatch/repo.ts`, `apps/api/src/dispatch/routes.ts`
- Test: `apps/api/src/dispatch/dispatch.test.ts`

**Interfaces:**

- Consumes: `applyTransition`, `loadOrder`, `writeOrderChanged` (Task 6), `distanceMeters`, `deliveryFee`.
- Produces: the `/v1/rider/...` routes and:

```ts
export function claimOrder(
  db: Db,
  riderId: string,
  orderId: string,
): Promise<'claimed' | 'already_mine' | 'taken' | 'not_claimable'>;
```

`claimOrder` runs one statement, so two riders can never both win:

```sql
UPDATE orders SET rider_id = $rider, updated_at = now()
WHERE id = $order AND rider_id IS NULL AND status IN ('preparing', 'ready') AND zone_id = $riderZone
RETURNING id
```

No row: re-read the order; if `rider_id = $rider` return `already_mine`, if another rider holds it `taken` (409 `already_claimed`), else `not_claimable` (404). A successful claim writes event `rider_assigned` (status unchanged) and an outbox row in the same transaction.

Offers: orders in the rider's zone with status `preparing` or `ready`, no rider, newest first, only while the rider is online and approved; an offline rider gets an empty list, and claiming while offline is 409 `rider_offline`. `distanceKm` is restaurant to delivery point, one decimal. Pick-up and deliver use `applyTransition` with actor `rider`, and only the holding rider may call them (anyone else: 404).

- [ ] **Step 1: Write the failing tests:** `an online rider sees an accepted order as an offer, without the customer's phone or address line` (offer has `landmark`, no phone field); `an offline rider sees no offers and cannot claim`; `claiming gives the rider the order`; `two riders claiming at the same moment: exactly one wins` (two signed-in riders, `Promise.all` of both claims, run 20 times on fresh orders; each time exactly one 200 and one 409 `already_claimed`, and `rider_id` is the winner); `claiming twice is harmless` (200, one `rider_assigned` event); `the customer's phone appears for the holding rider only once the order is ready` (null while `preparing`, the phone at `ready` and `on_the_way`, null again after `delivered`); `pick up needs ready, deliver needs on the way` (409 otherwise); `another rider cannot pick up or deliver` (404); `the customer sees the rider's name and phone once assigned`.
- [ ] **Step 2: Run to verify they fail.** **Step 3: Implement.** **Step 4: Run the checks.**
- [ ] **Step 5: Commit** `feat: rider offers, atomic claim, pick-up and delivery`

---

### Task 9: The admin's live order list

**Files:**

- Create: `apps/api/src/admin/routes.ts`
- Test: `apps/api/src/admin/admin.test.ts`

**Interfaces:**

- Consumes: `requireRole(request, 'admin')`.
- Produces: `GET /v1/admin/orders` returning `AdminOrderRow[]` for orders created in the last 24 hours, newest first, at most 200.

- [ ] **Step 1: Write the failing tests:** `the admin sees every recent order with customer and rider details`; `orders older than 24 hours are left out`; `a customer, a restaurant owner and a rider all get 403`.
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5: Commit** `feat: admin live order list`

---

### Task 10: Worker, outbox relay and realtime hints

**Files:**

- Create: `apps/api/src/events/relay.ts`, `apps/api/src/events/realtime.ts`, `apps/api/src/worker.ts`
- Modify: `apps/api/src/server.ts` (start the realtime hub), `apps/api/src/app.ts` (add `realtime?: RealtimeHub` to `Services`; register the WebSocket route when it is given), `apps/api/package.json` (`worker` and `dev:worker` scripts)
- Test: `apps/api/src/events/relay.test.ts`, `apps/api/src/events/realtime.test.ts`

**Interfaces:**

- Consumes: `outbox` table, `OrderChangedPayload`, `AuthUser` and session lookup from Task 4.
- Produces:

```ts
// events/relay.ts
export const EVENTS_CHANNEL = 'oregano:events';
export function relayOnce(
  db: Db,
  publish: (channel: string, message: string) => Promise<unknown>,
  batchSize?: number,
): Promise<number>;
// SELECT ... FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT $batch FOR UPDATE SKIP LOCKED;
// publish each payload as JSON, then set published_at, all in one transaction; returns the count
export function startRelay(db: Db, redisUrl: string, opts?: { intervalMs?: number }): { stop: () => Promise<void> }; // default 250 ms

// events/realtime.ts
export function audienceIncludes(user: AuthUser, event: OrderChangedPayload): boolean;
export class RealtimeHub {
  constructor(redisUrl: string);
  start(): Promise<void>; // subscribe to EVENTS_CHANNEL
  stop(): Promise<void>;
  register(app: FastifyInstance, authenticate: (token: string) => Promise<AuthUser | null>): void; // GET /v1/realtime
}
```

Protocol: the client opens `/v1/realtime` and must send `{ "type": "auth", "token": "…" }` within 5 seconds, or the server closes with code 4401. After a valid token the server sends `{ "type": "ready" }`. Messages that fail `RealtimeClientMessage` close with 4400. The server pings every 25 seconds. On each event it sends `{ "type": "order.changed", "orderId" }` to every connection whose user passes `audienceIncludes`:

- admin: always;
- the order's customer;
- staff of the order's restaurant;
- the holding rider;
- any approved rider in the order's zone when the order has no rider and its status is `preparing` or `ready` (a new offer).

A connection's `AuthUser` is read once, at authentication. A rider who goes offline afterwards may still receive offer hints; a hint only triggers a refetch, and the offers endpoint returns nothing to an offline rider, so this is harmless.

- [ ] **Step 1: Write the failing tests:**
  - `relayOnce publishes unpublished rows once, in order` (three outbox rows; a fake `publish` collects messages; two calls to `relayOnce` publish three messages in total, in id order, and leave none unpublished).
  - `two relays running together never publish a row twice` (`Promise.all` of two `relayOnce` calls on ten rows: ten messages in total).
  - `audienceIncludes` table test covering every rule above and the negatives: another customer, another restaurant's staff, a rider in another zone, any rider once a rider holds the order.
  - `a WebSocket that authenticates receives hints for its own orders only` (real `app.listen` on port 0, real Redis, the `ws` client that ships with `@fastify/websocket`; customer A connects; publish events for A's order and B's order to `EVENTS_CHANNEL`; A receives exactly one hint, for its order).
  - `a WebSocket that never authenticates receives nothing and is closed with 4401`.
- [ ] **Step 2: Run to verify they fail.** **Step 3: Implement.** **Step 4: Run the checks.** Then run the API and worker locally, place an order through the API, and see the worker log one relayed event.
- [ ] **Step 5: Commit** `feat: outbox relay worker and realtime order hints`

---

### Task 11: Typed client, app core and native components

**Files:**

- Create: `packages/api-client/` (`src/client.ts`, `src/realtime.ts`, `src/index.ts`, tests)
- Create: `packages/app-core/` (`src/session.tsx`, `src/queries.ts`, `src/realtime.tsx`, `src/index.ts`, tests)
- Create: `packages/ui-native/` (`src/Screen.tsx`, `Heading.tsx`, `Body.tsx`, `Button.tsx`, `TextField.tsx`, `StatusLine.tsx`, `src/index.ts`)
- Modify: `packages/i18n/src/en.ts`, `bn.ts` (strings below)
- Test: `packages/api-client/src/client.test.ts`, `packages/api-client/src/realtime.test.ts`, `packages/app-core/src/queries.test.ts`, `packages/i18n/src/i18n.test.ts` (placeholder parity, from the Plan 01 follow-ups)

**Interfaces:**

- Consumes: `@oregano/contracts`.
- Produces:

```ts
// @oregano/api-client
export class ApiError extends Error { constructor(readonly status: number, readonly code: ErrorCode, message: string, readonly requestId: string) }
export type ApiClient = {
  requestOtp(phone: string): Promise<OtpRequestResponse>;
  verifyOtp(phone: string, code: string): Promise<SessionResponse>;
  logout(): Promise<void>;
  me(): Promise<Me>;
  restaurants(at?: { lat: number; lng: number }): Promise<RestaurantListResponse>;
  restaurant(slug: string): Promise<RestaurantDetail>;
  placeOrder(body: PlaceOrderBody, idempotencyKey: string): Promise<Order>;
  myOrders(): Promise<Order[]>;
  order(id: string): Promise<Order>;
  cancelOrder(id: string): Promise<Order>;
  restaurantOrders(): Promise<Order[]>;
  acceptOrder(id: string, readyInMinutes: ReadyMinutes): Promise<Order>;
  rejectOrder(id: string, reason: RejectReason): Promise<Order>;
  markReady(id: string): Promise<Order>;
  setOnline(online: boolean): Promise<Me>;
  offers(): Promise<RiderOffer[]>;
  riderOrders(): Promise<Order[]>;
  claimOrder(id: string): Promise<Order>;
  pickUp(id: string): Promise<Order>;
  deliver(id: string): Promise<Order>;
  adminOrders(): Promise<AdminOrderRow[]>;
};
export function createApiClient(opts: { baseUrl: string; getToken: () => string | null; fetch?: typeof fetch }): ApiClient;
  // every response is validated with its contract schema; error bodies become ApiError; network failure becomes ApiError(0, 'internal', …)
export function newIdempotencyKey(): string; // crypto.randomUUID()
export function connectRealtime(opts: { url: string; getToken: () => string | null; onHint: (orderId: string) => void; onStatus?: (s: 'connecting' | 'live' | 'offline') => void; WebSocketImpl?: typeof WebSocket }): { close: () => void };
  // reconnects with backoff 1, 2, 4, 8, 15 seconds (max 15), forever, until close()

// @oregano/app-core (React, no React Native)
export function ApiProvider(props: { baseUrl: string; realtimeUrl: string; storage: TokenStorage; children: ReactNode }): JSX.Element;
export type TokenStorage = { get(): string | null; set(token: string): void; clear(): void };
export const webTokenStorage: TokenStorage;   // localStorage, wrapped in try/catch; native persistence arrives in Plan 10 (until then native keeps the token in memory)
export function useApi(): ApiClient;
export function useSession(): { me: Me | null; isLoading: boolean; signIn(phone: string, code: string): Promise<void>; signOut(): Promise<void> };
export const queryKeys: { me: ['me']; order: (id: string) => ['order', string]; myOrders: ['orders','mine']; restaurantOrders: ['orders','restaurant']; offers: ['offers']; riderOrders: ['orders','rider']; adminOrders: ['orders','admin']; restaurants: ['restaurants']; restaurant: (slug: string) => ['restaurant', string] };
export const OPEN_ORDER_REFETCH_MS = 15_000;
export function useRealtimeHints(): 'connecting' | 'live' | 'offline'; // on a hint, invalidates order(id) and every list key

// @oregano/ui-native (React Native)
export function Screen(props: { children: ReactNode; scroll?: boolean }): JSX.Element;            // cream background, 20 px margins, safe area
export function Heading(props: { children: ReactNode; level?: 1 | 2 }): JSX.Element;             // role heading, font by locale
export function Body(props: { children: ReactNode; muted?: boolean; strong?: boolean }): JSX.Element;
export function Button(props: { label: string; onPress: () => void; variant?: 'primary' | 'secondary'; disabled?: boolean; busy?: boolean }): JSX.Element; // min 48 px tall
export function TextField(props: { label: string; value: string; onChangeText: (v: string) => void; keyboardType?: 'default' | 'phone-pad' | 'number-pad'; error?: string | null }): JSX.Element;
export function StatusLine(props: { status: OrderStatus; locale: Locale }): JSX.Element;         // dot plus label, never colour alone
```

`ui-native` moves `typography.ts` and the font-loading layout logic out of `apps/customer` so all three Expo apps share them, and uses the locale from a `LocaleProvider` that also moves here. The customer app's existing screen and test keep working.

New message keys (Bangla must be natural standard Bangla; every string here goes on the native-speaker review list in blueprint section 12):

| Key                        | English                                   | Bangla                               |
| -------------------------- | ----------------------------------------- | ------------------------------------ |
| `auth.phoneLabel`          | Phone number                              | ফোন নম্বর                             |
| `auth.sendCode`            | Send code                                 | কোড পাঠান                              |
| `auth.codeLabel`           | 6-digit code                              | ৬ সংখ্যার কোড                          |
| `auth.signIn`              | Sign in                                   | সাইন ইন                               |
| `auth.signOut`             | Log out                                   | লগ আউট                               |
| `auth.invalidPhone`        | Enter a Bangladeshi mobile number         | বাংলাদেশি মোবাইল নম্বর দিন               |
| `auth.wrongCode`           | That code is not right. Try again.        | কোডটি সঠিক নয়। আবার চেষ্টা করুন।         |
| `cart.viewCart`            | {count} items · {total} — View cart       | {count}টি আইটেম · {total} — কার্ট দেখুন |
| `cart.add`                 | Add                                       | যোগ করুন                              |
| `checkout.address`         | Address                                   | ঠিকানা                                 |
| `checkout.landmark`        | Landmark                                  | চেনা জায়গা                              |
| `checkout.landmarkHint`    | Behind the college gate                   | কলেজ গেটের পেছনে                     |
| `checkout.cash`            | Cash on delivery                          | ক্যাশ অন ডেলিভারি                       |
| `checkout.subtotal`        | Food                                      | খাবার                                  |
| `checkout.deliveryFee`     | Delivery fee                              | ডেলিভারি চার্জ                          |
| `checkout.total`           | Total                                     | মোট                                  |
| `checkout.placeOrder`      | Place order · {total}                     | অর্ডার করুন · {total}                   |
| `order.placed`             | Order placed. Waiting for the restaurant. | অর্ডার হয়েছে। রেস্টুরেন্টের অপেক্ষায়।       |
| `order.preparing`          | Preparing your food                       | খাবার তৈরি হচ্ছে                        |
| `order.ready`              | Ready. Your rider is collecting it.       | তৈরি। রাইডার নিতে আসছেন।               |
| `order.onTheWay`           | On the way                                | পথে আছে                              |
| `order.delivered`          | Delivered                                 | পৌঁছে গেছে                            |
| `order.rejected`           | The restaurant could not take this order  | রেস্টুরেন্ট অর্ডারটি নিতে পারেনি           |
| `order.cancelled`          | Order cancelled                           | অর্ডার বাতিল হয়েছে                      |
| `order.cancel`             | Cancel order                              | অর্ডার বাতিল করুন                        |
| `order.number`             | Order #{number}                           | অর্ডার #{number}                       |
| `restaurant.new`           | New                                       | নতুন                                  |
| `restaurant.preparing`     | Preparing                                 | তৈরি হচ্ছে                            |
| `restaurant.ready`         | Ready                                     | তৈরি                                 |
| `restaurant.accept`        | Accept order                              | অর্ডার নিন                             |
| `restaurant.reject`        | Decline                                   | ফিরিয়ে দিন                           |
| `restaurant.readyIn`       | Ready in {minutes} min                    | {minutes} মিনিটে তৈরি                |
| `restaurant.markReady`     | Mark as ready                             | তৈরি হয়েছে                           |
| `reject.item_out_of_stock` | Item out of stock                         | আইটেম শেষ                            |
| `reject.too_busy`          | Too busy                                  | খুব ব্যস্ত                              |
| `reject.closing_soon`      | Closing soon                              | শিগগিরই বন্ধ হবে                      |
| `rider.goOnline`           | Go online                                 | অনলাইনে যান                            |
| `rider.goOffline`          | Go offline                                | অফলাইনে যান                            |
| `rider.noOffers`           | No orders right now                       | এখন কোনো অর্ডার নেই                    |
| `rider.claim`              | Accept                                    | গ্রহণ করুন                             |
| `rider.taken`              | Another rider took this order             | অন্য রাইডার অর্ডারটি নিয়েছেন              |
| `rider.pickedUp`           | Picked up                                 | নিয়েছি                               |
| `rider.delivered`          | Delivered                                 | পৌঁছে দিয়েছি                          |
| `rider.collectCash`        | Collect {amount}                          | {amount} নিন                         |
| `rider.callCustomer`       | Call customer                             | গ্রাহককে কল করুন                        |

- [ ] **Step 1: Write the failing tests:**
  - `client.test.ts` against a real API (`buildApp` with `withTestApp` services, `listen` on port 0, global `fetch`): `signs in and reads me`; `turns an error body into ApiError with code and requestId`; `rejects a response that breaks the contract` (a fake fetch returning `{ id: 1 }` for `me()` throws); `a network failure becomes ApiError with status 0`; `placeOrder sends the Idempotency-Key header` (retrying with the same key returns the same order id).
  - `realtime.test.ts`: `authenticates, receives hints, and reconnects after the server drops the connection` (real server; terminate the socket server-side; within 3 seconds `onStatus` returns to `live` and a new hint arrives).
  - `queries.test.ts`: `a hint invalidates the order and every list` (a `QueryClient` with seeded data; call the hint handler; all those queries are marked stale).
  - i18n: `every placeholder in English appears in Bangla, and the reverse`.
- [ ] **Step 2: Run to verify they fail.** **Step 3: Implement.** **Step 4: Run the checks** (`pnpm verify`; the customer shell test still passes).
- [ ] **Step 5: Commit** `feat: typed API client, app core and shared native components`

---

### Task 12: Customer app: sign in, menu, cart, checkout, tracking

**Files:**

- Modify: `apps/customer/src/app/_layout.tsx` (wrap in `ApiProvider`, `QueryClientProvider`), `apps/customer/src/app/index.tsx` (home: restaurant list at the town-centre pin)
- Create: `apps/customer/src/app/sign-in.tsx`, `apps/customer/src/app/r/[slug].tsx`, `apps/customer/src/app/checkout.tsx`, `apps/customer/src/app/orders/[id].tsx`
- Create: `apps/customer/src/cart.tsx` (cart state: one restaurant at a time, in memory)
- Create: `apps/customer/src/config.ts` (`apiUrl` from `EXPO_PUBLIC_API_URL`, default `http://localhost:4000`; `realtimeUrl` derived with `ws`)

**Interfaces:**

- Consumes: Task 11 packages.
- Produces the screens; the journey test (Task 16) drives them by role and accessible name, so these names are fixed:
  - Home: a link per restaurant named by the restaurant's name ("Burger Lane").
  - Restaurant page: per item a button named `Add {item name}`; the floating cart bar is a button named by `cart.viewCart`.
  - Checkout: text fields labelled `Address`, `Landmark`, `Phone number`; the button `Place order · Tk {total}`.
  - Sign-in: fields `Phone number`, `6-digit code`; buttons `Send code`, `Sign in`. Checkout sends a signed-out customer here and returns afterwards (book section 3.1: sign-in only at checkout).
  - Tracking: a heading `Order #{number}` and a status line with the `order.*` label for the current status.

Rules: the delivery pin is the Chapainawabganj town centre (24.5965, 88.2775) until the map arrives in Plan 05. Adding an item from a different restaurant replaces the cart after the customer confirms. The checkout creates one idempotency key when the screen opens and reuses it for every tap and retry; the button is disabled while a request is in flight. After a successful order the cart empties and the app opens tracking. Tracking uses `useRealtimeHints` and refetches every `OPEN_ORDER_REFETCH_MS` while the order is not terminal.

- [ ] **Step 1: Implement the screens.** Their behaviour is tested by the journey test in Task 16, which needs all four apps; this task's gate is that they compile and build.
- [ ] **Step 2: Run the checks:** `pnpm --filter @oregano/customer typecheck` and `build:web` exit 0, and the existing customer shell test still passes.
- [ ] **Step 5: Commit** `feat: customer sign-in, menu, cart, checkout and tracking`

---

### Task 13: Restaurant app

**Files:**

- Create: `apps/restaurant/` from the same Expo SDK 58 template as `apps/customer`, cleaned the same way (no template screens, no template `.claude` or `.vscode` folders, brand icon from the logo kit, `web.output` static, package `@oregano/restaurant`, scripts `dev:web` on port 8082, `build:web`, `typecheck`).
- Create: `apps/restaurant/src/app/_layout.tsx`, `index.tsx` (orders), `sign-in.tsx`, `src/config.ts`

**Interfaces:**

- Consumes: Task 11 packages.
- Produces, with fixed accessible names for Task 16:
  - Tabs as buttons `New`, `Preparing`, `Ready`, each followed by its count (e.g. `New 1`).
  - Each order card shows `#{number}`, each line as `{quantity} × {item name}`, the total, `Cash on delivery`.
  - On a new order: three buttons `Ready in 10 min`, `Ready in 20 min`, `Ready in 30 min` (selecting one), then `Accept order`; and `Decline` (then one of the three reasons).
  - On a preparing order: `Mark as ready`.
  - Body text 17 px (book section 19).
  - A new order plays no sound yet (the alarm arrives in Plan 06); the list refreshes by hint and every 15 seconds.

- [ ] **Steps:** scaffold, implement, `typecheck` and `build:web` pass, commit `feat: restaurant app shows, accepts and readies orders`. Its behaviour is tested by the journey test in Task 16 (the same holds for Tasks 14 and 15).

---

### Task 14: Rider app

**Files:**

- Create: `apps/rider/` as in Task 13, package `@oregano/rider`, `dev:web` on port 8083.
- Create: `apps/rider/src/app/_layout.tsx`, `index.tsx`, `sign-in.tsx`, `src/config.ts`

**Interfaces:**

- Produces, with fixed names: a switch-like button `Go online` / `Go offline`; offers list with `No orders right now` when empty; each offer shows the restaurant, the landmark, distance and fee, and an `Accept` button; the held order shows `Picked up` (enabled when `ready`), then `Delivered` with `Collect Tk {total}` above it, and `Call customer` once the phone is visible. If a claim returns `already_claimed`, the offer disappears and the message `Another rider took this order` shows.

- [ ] **Steps:** scaffold, implement, `typecheck` and `build:web` pass, commit `feat: rider app goes online, claims and delivers`.

---

### Task 15: Admin dashboard

**Files:**

- Create: `apps/admin/` with Vite and React (`package.json` as `@oregano/admin`, scripts `dev` on port 8084, `build`, `typecheck`, `preview`), `index.html`, `src/main.tsx`, `src/App.tsx`, `src/SignIn.tsx`, `src/Orders.tsx`, `src/styles.css`

**Interfaces:**

- Consumes: `@oregano/app-core`, `@oregano/ui` tokens (as CSS variables in `styles.css`), `@oregano/i18n`.
- Produces: sign-in by OTP (same field names as the apps); a table with columns `Order`, `Status`, `Restaurant`, `Customer`, `Rider`, `Total`, `Placed`, one row per order, each row with the accessible name `Order #{number}`; the status cell uses the `order.*` English label. The page title is "Oregano admin". English only for now (the admin team works in English; Bangla for admin arrives with Plan 09 if needed).

- [ ] **Steps:** scaffold, implement, `typecheck` and `build` pass, commit `feat: admin dashboard with live orders`.

---

### Task 16: The journey test and the gate

**Files:**

- Create: `e2e/package.json` (`@oregano/e2e`, script `test:e2e`), `e2e/playwright.config.ts`, `e2e/global-setup.ts`, `e2e/tests/first-order.spec.ts`, `e2e/tests/customer-shell.spec.ts` (moved from `apps/customer/e2e`)
- Modify: `pnpm-workspace.yaml` (add `e2e`), root `package.json` (`verify` unchanged; `test:e2e` already runs every package's `test:e2e`), `.github/workflows/ci.yml` (create `oregano_e2e_test`), `CLAUDE.md` (commands, ports, demo phones)
- Delete: `apps/customer/e2e/`, `apps/customer/playwright.config.ts`, and the customer's `test:e2e` script (the journey package owns browser tests now)

**Interfaces:**

- Consumes: everything.
- Produces: the plan's completion gate.

`global-setup.ts` migrates `oregano_e2e_test`, truncates it (refusing any database not named `*_test`), and runs `seedDemo`. The config starts six servers, never reusing any: the API (port 4100, `DATABASE_URL` the e2e database, `DEV_OTP_PEEK=true`, `CORS_ORIGINS` the four app origins), the worker, and the four apps on 8191–8194 with `EXPO_PUBLIC_API_URL=http://localhost:4100` (admin: `VITE_API_URL`). Sign-in in tests reads the code from `GET http://localhost:4100/v1/dev/otp/:phone`.

- [ ] **Step 1: Write the failing test** `first-order.spec.ts`, one browser context per person:

```ts
test('an order goes from the customer to the rider and is delivered, live everywhere', async ({ browser, request }) => {
  // customer: Burger Lane, 2 × Beef Cheese Burger, checkout with "Court Road" / "Behind the college gate",
  //   sign in when asked, Place order · Tk 780 (760 + 20); sees "Order placed. Waiting for the restaurant."
  // restaurant (01711000002): New 1; card shows "2 × Beef Cheese Burger"; Ready in 20 min; Accept order
  // customer: sees "Preparing your food" within 5 seconds, without reloading
  // rider (01711000003): Go online; offer shows "Behind the college gate"; Accept
  // restaurant: Preparing tab; Mark as ready
  // rider: Picked up; customer sees "On the way" within 5 seconds; rider sees "Collect Tk 780"; Delivered
  // customer: "Delivered"; admin (01711000004): row "Order #{number}" shows "Delivered"
});

test('double-tapping Place order creates one order', async ({ browser, request }) => {
  // customer: one Cold Coffee; double-click "Place order · Tk 200"; tracking shows one order number;
  // admin list contains exactly one new row
});

test('a retried place-order request returns the same order', async ({ request }) => {
  // through the API directly: same Idempotency-Key twice -> same id, one admin row
});
```

The comments name every action and expectation; write them as Playwright steps using the fixed accessible names from Tasks 12–15. Every "within 5 seconds" is an `expect(...).toBeVisible({ timeout: 5000 })` with no page reload, proving the realtime path (the 15-second polling alone would fail it).

- [ ] **Step 2: Run to verify it fails** before the screens are wired (or by temporarily stopping the worker: hints never arrive, and the 5-second steps fail; restart it).
- [ ] **Step 3: Make it pass.** Fix bugs in the apps or API, not in the test.
- [ ] **Step 4: Run the gate.** `pnpm verify` exits 0. Then run the full CI in a clean `node:24` container, as `CLAUDE.md` describes, with the e2e database created.
- [ ] **Step 5: Commit** `test: first order journey across all four apps`

---

## Completion

Plan 02 is complete when:

- `pnpm verify` passes locally and in the clean container, and GitHub CI is green.
- The journey test drives one order from placed to delivered across the customer, restaurant, rider and admin web apps, with live updates under 5 seconds.
- A double tap and a retried request each produce exactly one order.
- The Plan 01 follow-ups this plan picks up are ticked in `docs/superpowers/plans/2026-11-16-plan-01-followups.md`: the location error mapping, API apps closed in tests, the vacuous secret test, shutdown handling, placeholder parity.
- The roadmap marks Plan 02 done, and `docs/blueprint/measurements.md` records the new customer web bundle size.

Then run graphify on the repository (suggested after Plan 02), and write Plan 03.
