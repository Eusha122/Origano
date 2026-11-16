# Oregano Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Oregano monorepo with tested money rules, the order state machine, language and brand packages, an API skeleton with health checks, a PostGIS database holding the Chapainawabganj zone, and a customer app shell that runs in a browser.

**Architecture:** A pnpm + Turborepo monorepo. Pure business rules live in `packages/domain` with no I/O. `apps/api` is a Fastify server over PostgreSQL (PostGIS) and Redis. `apps/customer` is an Expo app built for web, Android and iOS that consumes the shared packages.

**Tech Stack:** TypeScript (strict), Node.js 24, pnpm, Turborepo, Biome, Vitest, Fastify, Zod, Drizzle ORM, PostgreSQL + PostGIS, Redis, Docker Compose, Expo + Expo Router, Playwright.

**Spec:** `docs/blueprint/2026-11-16-oregano-blueprint.md` (the blueprint) and `Oregano-Product-and-Brand-Book.pdf` (the book). Read both before starting.

## Global Constraints

- Node.js `>=24`. Package manager is pnpm, enabled through `corepack enable`. No npm or yarn lockfiles.
- TypeScript `strict: true` and `noUncheckedIndexedAccess: true` in every package. No `any`, no `@ts-ignore`.
- Install the latest stable release of each library, and read its current official documentation before installing. Do not pin versions from memory.
- Package names are `@oregano/<name>`.
- Money is an integer number of poisha (1 Tk = 100 poisha). Never a float, never a string.
- Percentages of money round half up to the nearest whole taka.
- Prices display as `Tk 280` in English and `৳২৮০` in Bangla (book section 15).
- UI copy is sentence case: "Place order", not "PLACE ORDER" (book section 15).
- Brand colours, exactly: Plum `#3D1A33`, Champagne `#EBC9A0`, Cream `#F8EDE6`, White `#FFFFFF`, Coral `#E8846B`, Muted plum `#6B5A63`, Line `#EEE6E9` (book section 17).
- Fonts: Fraunces for headings, Plus Jakarta Sans for interface text, Hind Siliguri for Bangla (book section 18).
- Do not render the word "Oregano" as a logo in any typeface. Use the supplied artwork in `Oregano-Logo-Kit/Oregano-Logo-Kit/`.
- Tests are written before the code they test. Database tests run against real PostgreSQL, never a mock.
- The repository already exists with one commit. Do not run `git init`. Work on a branch named `plan-01-foundation`.
- Docker is installed. Local PostgreSQL and Redis run only through `infra/docker-compose.yml`.

## Review Focus

Each line names an input the book implies but does not spell out. The test that pins it is in the task named.

1. A percentage discount that lands on half a taka (5% of Tk 310 is Tk 15.50) must round to Tk 16, not truncate. Pinned in Task 1.
2. A restaurant taps "Accept order" twice on a slow connection. The second tap must be recognised as already applied, not reported as an error. Pinned in Task 2.
3. A Bangla string is missing for a key that exists in English. The build must fail, not ship a blank label. Pinned in Task 3.
4. The API starts with a missing or malformed setting. It must refuse to start and name every bad setting, not crash later on first use. Pinned in Task 5.
5. A location outside every zone, or impossible coordinates (latitude 91). The first returns "no zone" so the app can say "We don't deliver here yet"; the second is rejected as invalid. Pinned in Task 6.

---

### Task 1: Workspace and money rules

**Files:**

- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `biome.json`, `tsconfig.base.json`, `.nvmrc`, `.gitignore`
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/src/index.ts`
- Create: `packages/domain/src/money.ts`
- Test: `packages/domain/src/money.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces, from `@oregano/domain`:

```ts
export type Money = number & { readonly __unit: 'poisha' };
export function taka(amount: number): Money; // taka(280) is 28000 poisha
export function toTaka(amount: Money): number; // 28000 -> 280
export function addMoney(...amounts: Money[]): Money; // addMoney() is 0
export function subtractMoney(a: Money, b: Money): Money;
export function multiplyMoney(amount: Money, quantity: number): Money;
export function percentOf(amount: Money, percent: number): Money;
export function maxMoney(a: Money, b: Money): Money;
```

- Root scripts every later task relies on: `pnpm lint`, `pnpm typecheck`, `pnpm test`.

- [ ] **Step 1: Create the branch and workspace files**

Run `git checkout -b plan-01-foundation` and `corepack enable`. Create the root files:

- `pnpm-workspace.yaml` lists `apps/*` and `packages/*`.
- `.nvmrc` contains `24`.
- `package.json` is private, sets `"engines": {"node": ">=24"}`, sets `packageManager` to the pnpm version corepack installed, and defines scripts `lint` (`biome check .`), `typecheck` (`turbo run typecheck`), `test` (`turbo run test`).
- `turbo.json` defines tasks `typecheck`, `test` and `build`, each depending on `^build`.
- `tsconfig.base.json` sets `strict`, `noUncheckedIndexedAccess`, `module` and `moduleResolution` to `NodeNext`, `target` `ES2023`.
- `.gitignore` covers `node_modules`, `dist`, `.turbo`, `.expo`, `.env`, `coverage`, `test-results`.

`packages/domain/package.json` is named `@oregano/domain`, with scripts `typecheck` (`tsc --noEmit`) and `test` (`vitest run`).

- [ ] **Step 2: Write the failing test**

```ts
// packages/domain/src/money.test.ts
import { describe, expect, it } from 'vitest';
import { addMoney, maxMoney, multiplyMoney, percentOf, subtractMoney, taka, toTaka } from './money';

describe('money', () => {
  it('stores taka as whole poisha', () => {
    expect(taka(280)).toBe(28000);
    expect(taka(15.5)).toBe(1550);
    expect(toTaka(taka(280))).toBe(280);
  });

  it('rejects amounts that are not valid money', () => {
    expect(() => taka(-1)).toThrow(RangeError);
    expect(() => taka(Number.NaN)).toThrow(RangeError);
    expect(() => taka(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => taka(10.005)).toThrow(RangeError); // finer than one poisha
  });

  it('adds, subtracts and multiplies', () => {
    expect(addMoney()).toBe(0);
    expect(addMoney(taka(380), taka(180))).toBe(taka(560));
    expect(subtractMoney(taka(560), taka(20))).toBe(taka(540));
    expect(multiplyMoney(taka(140), 3)).toBe(taka(420));
    expect(maxMoney(taka(20), taka(35))).toBe(taka(35));
  });

  it('never goes below zero or accepts a broken quantity', () => {
    expect(() => subtractMoney(taka(20), taka(21))).toThrow(RangeError);
    expect(() => multiplyMoney(taka(140), -1)).toThrow(RangeError);
    expect(() => multiplyMoney(taka(140), 1.5)).toThrow(RangeError);
  });

  it('takes the commission in the book example exactly', () => {
    expect(percentOf(taka(20000), 5)).toBe(taka(1000));
  });

  it('rounds a percentage half up to the nearest whole taka', () => {
    expect(percentOf(taka(310), 5)).toBe(taka(16)); // 15.50 -> 16
    expect(percentOf(taka(309), 5)).toBe(taka(15)); // 15.45 -> 15
    expect(percentOf(taka(0), 5)).toBe(taka(0));
  });

  it('rejects a percentage outside 0 to 100', () => {
    expect(() => percentOf(taka(100), -5)).toThrow(RangeError);
    expect(() => percentOf(taka(100), 101)).toThrow(RangeError);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm install` then `pnpm --filter @oregano/domain test`
Expected: FAIL, cannot resolve `./money`.

- [ ] **Step 4: Implement the functions in `packages/domain/src/money.ts`**

Use integer arithmetic throughout. `taka` multiplies by 100 and throws `RangeError` unless the result is a non-negative safe integer within `1e-9` of a whole number. `percentOf` computes in poisha, then rounds half up to a multiple of 100. Export everything from `src/index.ts`.

- [ ] **Step 5: Run the checks**

Run: `pnpm --filter @oregano/domain test` then `pnpm lint` then `pnpm typecheck`
Expected: 7 tests pass; lint and typecheck exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: workspace scaffold and money rules"
```

---

### Task 2: Order state machine

**Files:**

- Create: `packages/domain/src/order.ts`
- Modify: `packages/domain/src/index.ts` (export the new module)
- Test: `packages/domain/src/order.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces, from `@oregano/domain`:

```ts
export const ORDER_STATUSES = [
  'placed',
  'preparing',
  'ready',
  'on_the_way',
  'delivered',
  'rejected',
  'cancelled',
  'expired',
  'undeliverable',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type OrderType = 'delivery' | 'pickup';
export type OrderActor = 'customer' | 'restaurant' | 'rider' | 'system' | 'admin';
export type OrderEvent =
  | 'accept'
  | 'reject'
  | 'cancel'
  | 'expire'
  | 'mark_ready'
  | 'pick_up'
  | 'deliver'
  | 'collect'
  | 'report_undeliverable';
export const REJECT_REASONS = ['item_out_of_stock', 'too_busy', 'closing_soon'] as const;
export type TransitionResult =
  | { ok: true; status: OrderStatus }
  | { ok: false; reason: 'invalid_transition' | 'actor_not_allowed' | 'already_applied' };
export function transition(
  order: { status: OrderStatus; type: OrderType },
  event: OrderEvent,
  actor: OrderActor,
): TransitionResult;
export function isTerminal(status: OrderStatus): boolean;
```

The complete transition table. Anything not listed is `invalid_transition`.

| From                                 | Event                | Actor      | To            | Order type |
| ------------------------------------ | -------------------- | ---------- | ------------- | ---------- |
| placed                               | accept               | restaurant | preparing     | both       |
| placed                               | reject               | restaurant | rejected      | both       |
| placed                               | cancel               | customer   | cancelled     | both       |
| placed                               | expire               | system     | expired       | both       |
| preparing                            | mark_ready           | restaurant | ready         | both       |
| ready                                | pick_up              | rider      | on_the_way    | delivery   |
| ready                                | collect              | restaurant | delivered     | pickup     |
| on_the_way                           | deliver              | rider      | delivered     | delivery   |
| on_the_way                           | report_undeliverable | rider      | undeliverable | delivery   |
| placed, preparing, ready, on_the_way | cancel               | admin      | cancelled     | both       |

Resolution order inside `transition`:

1. If a row matches status, event, order type and actor, return `ok` with the new status.
2. Else if a row matches status, event and order type but not the actor, return `actor_not_allowed`.
3. Else if the event has any row whose "To" equals the current status and whose actor matches, return `already_applied`.
4. Else return `invalid_transition`.

Terminal statuses: delivered, rejected, cancelled, expired, undeliverable.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/order.test.ts
import { describe, expect, it } from 'vitest';
import { isTerminal, ORDER_STATUSES, transition } from './order';

const delivery = (status: (typeof ORDER_STATUSES)[number]) => ({ status, type: 'delivery' as const });
const pickup = (status: (typeof ORDER_STATUSES)[number]) => ({ status, type: 'pickup' as const });

describe('order state machine', () => {
  it('walks a delivery order from placed to delivered', () => {
    expect(transition(delivery('placed'), 'accept', 'restaurant')).toEqual({ ok: true, status: 'preparing' });
    expect(transition(delivery('preparing'), 'mark_ready', 'restaurant')).toEqual({ ok: true, status: 'ready' });
    expect(transition(delivery('ready'), 'pick_up', 'rider')).toEqual({ ok: true, status: 'on_the_way' });
    expect(transition(delivery('on_the_way'), 'deliver', 'rider')).toEqual({ ok: true, status: 'delivered' });
  });

  it('lets the restaurant hand over a pickup order with no rider', () => {
    expect(transition(pickup('ready'), 'collect', 'restaurant')).toEqual({ ok: true, status: 'delivered' });
    expect(transition(pickup('ready'), 'pick_up', 'rider')).toEqual({ ok: false, reason: 'invalid_transition' });
    expect(transition(delivery('ready'), 'collect', 'restaurant')).toEqual({ ok: false, reason: 'invalid_transition' });
  });

  it('lets the customer cancel only until the restaurant accepts', () => {
    expect(transition(delivery('placed'), 'cancel', 'customer')).toEqual({ ok: true, status: 'cancelled' });
    expect(transition(delivery('preparing'), 'cancel', 'customer')).toEqual({ ok: false, reason: 'actor_not_allowed' });
  });

  it('lets an admin cancel any order that is still open', () => {
    for (const status of ['placed', 'preparing', 'ready', 'on_the_way'] as const) {
      expect(transition(delivery(status), 'cancel', 'admin')).toEqual({ ok: true, status: 'cancelled' });
    }
    expect(transition(delivery('delivered'), 'cancel', 'admin')).toEqual({ ok: false, reason: 'invalid_transition' });
  });

  it('handles rejection, expiry and failed delivery', () => {
    expect(transition(delivery('placed'), 'reject', 'restaurant')).toEqual({ ok: true, status: 'rejected' });
    expect(transition(delivery('placed'), 'expire', 'system')).toEqual({ ok: true, status: 'expired' });
    expect(transition(delivery('on_the_way'), 'report_undeliverable', 'rider')).toEqual({
      ok: true,
      status: 'undeliverable',
    });
  });

  it('refuses an actor who may not perform the event', () => {
    expect(transition(delivery('placed'), 'accept', 'customer')).toEqual({ ok: false, reason: 'actor_not_allowed' });
    expect(transition(delivery('on_the_way'), 'deliver', 'restaurant')).toEqual({
      ok: false,
      reason: 'actor_not_allowed',
    });
    expect(transition(delivery('placed'), 'expire', 'restaurant')).toEqual({ ok: false, reason: 'actor_not_allowed' });
  });

  it('recognises a repeated tap as already applied', () => {
    expect(transition(delivery('preparing'), 'accept', 'restaurant')).toEqual({ ok: false, reason: 'already_applied' });
    expect(transition(delivery('delivered'), 'deliver', 'rider')).toEqual({ ok: false, reason: 'already_applied' });
    expect(transition(delivery('cancelled'), 'cancel', 'customer')).toEqual({ ok: false, reason: 'already_applied' });
  });

  it('allows nothing out of a terminal status', () => {
    for (const status of ['delivered', 'rejected', 'cancelled', 'expired', 'undeliverable'] as const) {
      expect(isTerminal(status)).toBe(true);
      expect(transition(delivery(status), 'mark_ready', 'restaurant').ok).toBe(false);
    }
    expect(isTerminal('placed')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oregano/domain test`
Expected: FAIL, cannot resolve `./order`.

- [ ] **Step 3: Implement `packages/domain/src/order.ts`**

Hold the table above as one `const` array of rows and look transitions up in it. No `switch` over statuses, so the table stays the single definition.

- [ ] **Step 4: Run the checks**

Run: `pnpm --filter @oregano/domain test` then `pnpm lint` then `pnpm typecheck`
Expected: all domain tests pass; lint and typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: order state machine"
```

---

### Task 3: Languages and money formatting

**Files:**

- Create: `packages/i18n/package.json`, `packages/i18n/tsconfig.json`, `packages/i18n/src/index.ts`
- Create: `packages/i18n/src/en.ts`, `packages/i18n/src/bn.ts`, `packages/i18n/src/translate.ts`, `packages/i18n/src/format.ts`
- Test: `packages/i18n/src/i18n.test.ts`

**Interfaces:**

- Consumes: `Money`, `taka` from `@oregano/domain`.
- Produces, from `@oregano/i18n`:

```ts
export type Locale = 'en' | 'bn';
export type MessageKey = keyof typeof en;               // en.ts is the master list
export function t(locale: Locale, key: MessageKey, params?: Record<string, string | number>): string;
export function toBanglaDigits(input: string): string;  // '280' -> '২৮০'
export function formatMoney(amount: Money, locale: Locale): string;
export const messages: Record<Locale, Record<MessageKey, string>>;
```

The starting messages. `{name}` marks a parameter.

| Key                      | English                         | Bangla                          |
| ------------------------ | ------------------------------- | ------------------------------- |
| `brand.promise`          | Your town's food, in one place. | শহরের সব খাবার, এক ঠিকানায়।         |
| `action.placeOrder`      | Place order                     | অর্ডার করুন                        |
| `action.tryAgain`        | Try again                       | আবার চেষ্টা করুন                    |
| `action.continueAsGuest` | Continue as guest               | অতিথি হিসেবে দেখুন               |
| `status.offline`         | You're offline. Try again.      | আপনি অফলাইনে আছেন। আবার চেষ্টা করুন। |
| `zone.outside`           | We don't deliver here yet       | আমরা এখনো এখানে ডেলিভারি দিই না     |
| `item.soldOut`           | Sold out today                  | আজ শেষ                          |
| `restaurant.opensAt`     | Opens at {time}                 | {time}-এ খুলবে                   |
| `restaurant.samePrice`   | Same price as in store          | দোকানের দামেই                     |
| `language.switchTo`      | বাংলা                             | English                         |

`language.switchTo` is the label of the language toggle, so each locale shows the other language's name.

Money formatting rules: whole-taka amounts show no decimals; other amounts show two. Digits are grouped in the South Asian style used in Bangladesh (`1,50,000`). English prefix is `Tk ` and Bangla prefix is `৳` with Bangla digits.

- [ ] **Step 1: Write the failing test**

```ts
// packages/i18n/src/i18n.test.ts
import { taka } from '@oregano/domain';
import { describe, expect, it } from 'vitest';
import { formatMoney, messages, t, toBanglaDigits } from './index';

describe('i18n', () => {
  it('has exactly the same keys in English and Bangla', () => {
    expect(Object.keys(messages.bn).sort()).toEqual(Object.keys(messages.en).sort());
  });

  it('has no empty string in either language', () => {
    for (const locale of ['en', 'bn'] as const) {
      for (const [key, value] of Object.entries(messages[locale])) {
        expect(value.trim(), `${locale}:${key}`).not.toBe('');
      }
    }
  });

  it('translates the brand promise exactly as the book writes it', () => {
    expect(t('en', 'brand.promise')).toBe("Your town's food, in one place.");
    expect(t('bn', 'brand.promise')).toBe('শহরের সব খাবার, এক ঠিকানায়।');
  });

  it('fills parameters', () => {
    expect(t('en', 'restaurant.opensAt', { time: '4 PM' })).toBe('Opens at 4 PM');
  });

  it('throws when a parameter is missing', () => {
    expect(() => t('en', 'restaurant.opensAt')).toThrow(/time/);
  });

  it('converts digits to Bangla', () => {
    expect(toBanglaDigits('280')).toBe('২৮০');
    expect(toBanglaDigits('Tk 1,050')).toBe('Tk ১,০৫০');
  });

  it('formats money as the book specifies', () => {
    expect(formatMoney(taka(280), 'en')).toBe('Tk 280');
    expect(formatMoney(taka(280), 'bn')).toBe('৳২৮০');
    expect(formatMoney(taka(0), 'en')).toBe('Tk 0');
  });

  it('groups large amounts and shows poisha only when present', () => {
    expect(formatMoney(taka(20000), 'en')).toBe('Tk 20,000');
    expect(formatMoney(taka(20000), 'bn')).toBe('৳২০,০০০');
    expect(formatMoney(taka(150000), 'en')).toBe('Tk 1,50,000');
    expect(formatMoney(taka(15.5), 'en')).toBe('Tk 15.50');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm install` then `pnpm --filter @oregano/i18n test`
Expected: FAIL, cannot resolve `./index`.

- [ ] **Step 3: Implement the package**

`en.ts` exports the English table `as const`. `bn.ts` is typed `Record<MessageKey, string>`, so a missing Bangla key is also a compile error. `t` replaces every `{name}` and throws an `Error` naming the first parameter it cannot fill. `formatMoney` uses `Intl.NumberFormat('en-IN')` for grouping and `toBanglaDigits` for the Bangla form.

- [ ] **Step 4: Run the checks**

Run: `pnpm --filter @oregano/i18n test` then `pnpm lint` then `pnpm typecheck`
Expected: 8 tests pass; lint and typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: English and Bangla messages with money formatting"
```

---

### Task 4: Brand tokens

**Files:**

- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/src/index.ts`
- Create: `packages/ui/src/tokens.ts`, `packages/ui/src/contrast.ts`
- Test: `packages/ui/src/tokens.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces, from `@oregano/ui`:

```ts
export const colors: {
  plum: '#3D1A33'; champagne: '#EBC9A0'; cream: '#F8EDE6'; white: '#FFFFFF';
  coral: '#E8846B'; mutedPlum: '#6B5A63'; line: '#EEE6E9';
};
export const fonts: { heading: 'Fraunces'; body: 'Plus Jakarta Sans'; bangla: 'Hind Siliguri' };
export const typeScale: {
  display: { font: 'heading'; size: 34; weight: '400' };
  title: { font: 'heading'; size: 28; weight: '400' };
  sectionHeading: { font: 'body'; size: 18; weight: '600' };
  body: { font: 'body'; size: 15; weight: '400' };
  bodyStrong: { font: 'body'; size: 15; weight: '600' };
  caption: { font: 'body'; size: 13; weight: '400' };
  label: { font: 'body'; size: 11; weight: '400' };
};
export const layout: {
  screenMargin: 20; sectionGapMin: 32; sectionGapMax: 40; minTapTarget: 48;
  buttonRadius: 14; cardRadiusMin: 20; cardRadiusMax: 24; cartBarRadius: 20; iconStroke: 1.5;
};
export const textPairs: ReadonlyArray<{ text: keyof typeof colors; background: keyof typeof colors }>;
export function contrastRatio(foregroundHex: string, backgroundHex: string): number; // WCAG 2 formula
```

`textPairs` is the list of text-on-background combinations the book allows: plum on white, plum on cream, mutedPlum on white, mutedPlum on cream, cream on plum, champagne on plum. Components in later plans may only use pairs from this list.

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/src/tokens.test.ts
import { describe, expect, it } from 'vitest';
import { colors, contrastRatio, layout, textPairs, typeScale } from './index';

describe('brand tokens', () => {
  it('match the palette in the brand book exactly', () => {
    expect(colors).toEqual({
      plum: '#3D1A33',
      champagne: '#EBC9A0',
      cream: '#F8EDE6',
      white: '#FFFFFF',
      coral: '#E8846B',
      mutedPlum: '#6B5A63',
      line: '#EEE6E9',
    });
  });

  it('match the type scale and layout rules in the brand book', () => {
    expect(typeScale.display.size).toBe(34);
    expect(typeScale.title.size).toBe(28);
    expect(typeScale.body.size).toBe(15);
    expect(typeScale.caption.size).toBe(13);
    expect(layout.minTapTarget).toBe(48);
    expect(layout.screenMargin).toBe(20);
    expect(layout.buttonRadius).toBe(14);
  });

  it('computes contrast by the WCAG formula', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('gives every allowed text pair at least 4.5:1 contrast', () => {
    expect(textPairs).toHaveLength(6);
    for (const pair of textPairs) {
      const ratio = contrastRatio(colors[pair.text], colors[pair.background]);
      expect(ratio, `${pair.text} on ${pair.background}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('never allows the combinations the book forbids', () => {
    const forbidden = [
      ['white', 'cream'],
      ['champagne', 'cream'],
      ['coral', 'white'],
      ['coral', 'cream'],
      ['coral', 'plum'],
    ];
    for (const [text, background] of forbidden) {
      expect(textPairs.some((p) => p.text === text && p.background === background)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm install` then `pnpm --filter @oregano/ui test`
Expected: FAIL, cannot resolve `./index`.

- [ ] **Step 3: Implement `tokens.ts` and `contrast.ts`**

Declare every token object `as const`. `contrastRatio` implements WCAG 2 relative luminance. If any allowed pair fails the 4.5 check, stop and report it; do not change a brand colour or lower the threshold.

- [ ] **Step 4: Run the checks**

Run: `pnpm --filter @oregano/ui test` then `pnpm lint` then `pnpm typecheck`
Expected: 5 tests pass; lint and typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: brand tokens with contrast checks"
```

---

### Task 5: API skeleton

**Files:**

- Create: `apps/api/package.json`, `apps/api/tsconfig.json`
- Create: `apps/api/src/config.ts`, `apps/api/src/errors.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`
- Create: `apps/api/src/health/routes.ts`
- Create: `apps/api/.env.example`
- Test: `apps/api/src/config.test.ts`, `apps/api/src/app.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

```ts
// config.ts
export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number; // PORT, default 4000
  databaseUrl: string; // DATABASE_URL, must start with postgres:// or postgresql://
  redisUrl: string; // REDIS_URL, must start with redis:// or rediss://
  logLevel: 'debug' | 'info' | 'warn' | 'error'; // LOG_LEVEL, default info
};
export class ConfigError extends Error {
  readonly problems: string[];
}
export function loadConfig(env: Record<string, string | undefined>): Config;

// app.ts
export type ReadinessCheck = { name: string; check: () => Promise<void> };
export function buildApp(deps: { config: Config; checks: ReadinessCheck[] }): Promise<FastifyInstance>;

// errors.ts
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  );
}
```

HTTP behaviour:

- `GET /healthz` returns 200 `{"status":"ok"}`. It checks nothing, so the host can tell "process alive" from "dependencies ready".
- `GET /readyz` runs every check with a 2-second timeout each. All pass: 200 `{"status":"ready","checks":{"<name>":"ok"}}`. Any fail: 503 `{"status":"not_ready","checks":{"<name>":"fail"}}`.
- Every error response has the shape `{"error":{"code":string,"message":string,"requestId":string}}`.
- Unknown route: 404, code `not_found`. Thrown `AppError`: its own status and code. Anything else: 500, code `internal`, message `Something went wrong.`, with the real error logged and never sent.
- Every response carries an `x-request-id` header. An incoming `x-request-id` is reused only if it matches `^[A-Za-z0-9_-]{8,64}$`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/config.test.ts
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://u:p@localhost:5432/oregano',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(valid)).toEqual({
      nodeEnv: 'test',
      port: 4000,
      logLevel: 'info',
      databaseUrl: 'postgres://u:p@localhost:5432/oregano',
      redisUrl: 'redis://localhost:6379',
    });
  });

  it('names every bad setting at once', () => {
    try {
      loadConfig({ NODE_ENV: 'test', PORT: 'abc', REDIS_URL: 'http://wrong' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const text = (error as ConfigError).problems.join(' ');
      expect(text).toContain('DATABASE_URL');
      expect(text).toContain('PORT');
      expect(text).toContain('REDIS_URL');
    }
  });

  it('never puts a secret value in the error', () => {
    try {
      loadConfig({ ...valid, DATABASE_URL: 'mysql://user:hunter2@host/db' });
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('hunter2');
    }
  });
});
```

```ts
// apps/api/src/app.test.ts
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';
import { AppError } from './errors';

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://u:p@localhost/x',
  REDIS_URL: 'redis://localhost',
});
const pass = { name: 'postgres', check: async () => {} };
const fail = {
  name: 'redis',
  check: async () => {
    throw new Error('connection refused at 10.0.0.5');
  },
};

describe('api skeleton', () => {
  it('reports alive without touching dependencies', async () => {
    const app = await buildApp({ config, checks: [fail] });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('reports ready when every check passes', async () => {
    const app = await buildApp({ config, checks: [pass] });
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready', checks: { postgres: 'ok' } });
  });

  it('reports not ready, without leaking details, when a check fails', async () => {
    const app = await buildApp({ config, checks: [pass, fail] });
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'not_ready', checks: { postgres: 'ok', redis: 'fail' } });
    expect(res.body).not.toContain('10.0.0.5');
  });

  it('fails a check that hangs instead of hanging the request', async () => {
    const hang = { name: 'postgres', check: () => new Promise<void>(() => {}) };
    const app = await buildApp({ config, checks: [hang] });
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
  }, 5000);

  it('answers an unknown route with the error envelope', async () => {
    const app = await buildApp({ config, checks: [] });
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    expect(res.json().error.requestId).toBe(res.headers['x-request-id']);
  });

  it('maps AppError to its status and hides unexpected errors', async () => {
    const app = await buildApp({ config, checks: [] });
    app.get('/known', async () => {
      throw new AppError('zone_outside', 422, "We don't deliver here yet");
    });
    app.get('/boom', async () => {
      throw new Error('password=hunter2');
    });

    const known = await app.inject({ method: 'GET', url: '/known' });
    expect(known.statusCode).toBe(422);
    expect(known.json().error).toMatchObject({ code: 'zone_outside', message: "We don't deliver here yet" });

    const boom = await app.inject({ method: 'GET', url: '/boom' });
    expect(boom.statusCode).toBe(500);
    expect(boom.json().error).toMatchObject({ code: 'internal', message: 'Something went wrong.' });
    expect(boom.body).not.toContain('hunter2');
  });

  it('reuses a well-formed request id and replaces a malformed one', async () => {
    const app = await buildApp({ config, checks: [] });
    const good = await app.inject({ method: 'GET', url: '/healthz', headers: { 'x-request-id': 'abc12345-xyz' } });
    expect(good.headers['x-request-id']).toBe('abc12345-xyz');
    const bad = await app.inject({ method: 'GET', url: '/healthz', headers: { 'x-request-id': '<script>' } });
    expect(bad.headers['x-request-id']).not.toBe('<script>');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm install` then `pnpm --filter @oregano/api test`
Expected: FAIL, cannot resolve `./config` and `./app`.

- [ ] **Step 3: Implement the skeleton**

`loadConfig` validates with one Zod schema and collects every issue into `ConfigError.problems` as `"<VARIABLE>: <what is wrong>"`, never echoing the value. `buildApp` creates the Fastify instance with pino logging at `config.logLevel`, the request-id rule, the error handler, the not-found handler and the two health routes. `server.ts` calls `loadConfig(process.env)`, prints the problems and exits with code 1 on `ConfigError`, listens on `config.port`, and closes the app on `SIGTERM` and `SIGINT`. It passes an empty `checks` array for now; Task 6 fills it. `.env.example` lists the five variables with local values matching Task 6's compose file.

- [ ] **Step 4: Run the checks**

Run: `pnpm --filter @oregano/api test` then `pnpm lint` then `pnpm typecheck`
Expected: 10 tests pass; lint and typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: API skeleton with config validation and health checks"
```

---

### Task 6: Database and the Chapainawabganj zone

**Files:**

- Create: `infra/docker-compose.yml`
- Create: `apps/api/drizzle.config.ts`, `apps/api/drizzle/` (generated SQL migrations)
- Create: `apps/api/src/db/client.ts`, `apps/api/src/db/migrate.ts`, `apps/api/src/db/geography.ts`
- Create: `apps/api/src/zones/schema.ts`, `apps/api/src/zones/repo.ts`, `apps/api/src/zones/seed.ts`
- Create: `apps/api/src/testing/db.ts`
- Modify: `apps/api/src/server.ts` (pass real readiness checks), `apps/api/package.json` (scripts), root `package.json` (scripts)
- Test: `apps/api/src/zones/repo.test.ts`

**Interfaces:**

- Consumes: `Config`, `ReadinessCheck` from Task 5; `Money`, `taka` from `@oregano/domain`.
- Produces:

```ts
// db/client.ts
export type Db = /* the Drizzle database type for this schema */;
export function createDb(databaseUrl: string): { db: Db; close: () => Promise<void> };
export function postgresCheck(db: Db): ReadinessCheck;        // name 'postgres', runs SELECT 1
export function redisCheck(redisUrl: string): ReadinessCheck; // name 'redis', runs PING

// zones/repo.ts
export type Zone = {
  id: string; slug: string; nameEn: string; nameBn: string;
  feePerKm: Money; minFee: Money; roadFactor: number; timezone: string; isActive: boolean;
};
export function findZoneForPoint(db: Db, point: { lat: number; lng: number }): Promise<Zone | null>;

// zones/seed.ts
export function seedZones(db: Db): Promise<void>;  // safe to run repeatedly

// testing/db.ts
export function withTestDb(): { db: Db };  // migrates once, truncates all tables before each test
```

- Root scripts: `pnpm db:up` (start compose services), `pnpm db:migrate`, `pnpm db:seed`.

Local services in `infra/docker-compose.yml`: the official `postgis/postgis` image on port 5432 with user `oregano`, password `oregano`, databases `oregano` and `oregano_test`; the official `redis` image on port 6379. Both have health checks and named volumes.

The `zones` table:

| Column                                | Type                                | Notes                        |
| ------------------------------------- | ----------------------------------- | ---------------------------- |
| `id`                                  | `uuid` primary key                  | default `gen_random_uuid()`  |
| `slug`                                | `text` unique, not null             |                              |
| `name_en`, `name_bn`                  | `text` not null                     |                              |
| `boundary`                            | `geography(Polygon, 4326)` not null | GiST index                   |
| `fee_per_km_poisha`, `min_fee_poisha` | `integer` not null                  | check `>= 0`                 |
| `road_factor`                         | `numeric(3,2)` not null             | default `1.30`, check `>= 1` |
| `timezone`                            | `text` not null                     | default `Asia/Dhaka`         |
| `is_active`                           | `boolean` not null                  | default `true`               |
| `created_at`, `updated_at`            | `timestamptz` not null              | default `now()`              |

The first migration also runs `CREATE EXTENSION IF NOT EXISTS postgis`.

The seed zone: slug `chapainawabganj`, English name `Chapainawabganj`, Bangla name `চাঁপাইনবাবগঞ্জ`, fee per km Tk 10, minimum fee Tk 20, road factor 1.30, active. Its boundary is the rectangle from latitude 24.55 to 24.65 and longitude 88.22 to 88.33. This is a launch approximation of the town; the admin redraws it in Plan 04.

`findZoneForPoint` returns the active zone whose boundary covers the point, or `null`. It throws `RangeError` when latitude is outside -90 to 90, longitude is outside -180 to 180, or either is not finite. If zones overlap, it returns the one with the smallest area.

- [ ] **Step 1: Start the local services**

Write `infra/docker-compose.yml`, add the root scripts, run `pnpm db:up`.
Expected: `docker compose -f infra/docker-compose.yml ps` shows both services healthy.

- [ ] **Step 2: Write the failing test**

```ts
// apps/api/src/zones/repo.test.ts
import { taka } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTestDb } from '../testing/db';
import { findZoneForPoint } from './repo';
import { seedZones } from './seed';

const townCentre = { lat: 24.5965, lng: 88.2775 };
const dhaka = { lat: 23.8103, lng: 90.4125 };

describe('zones', () => {
  const { db } = withTestDb();

  it('finds Chapainawabganj for a point in the town', async () => {
    await seedZones(db);
    const zone = await findZoneForPoint(db, townCentre);
    expect(zone).toMatchObject({
      slug: 'chapainawabganj',
      nameEn: 'Chapainawabganj',
      nameBn: 'চাঁপাইনবাবগঞ্জ',
      feePerKm: taka(10),
      minFee: taka(20),
      roadFactor: 1.3,
      timezone: 'Asia/Dhaka',
      isActive: true,
    });
  });

  it('returns null outside every zone', async () => {
    await seedZones(db);
    expect(await findZoneForPoint(db, dhaka)).toBeNull();
  });

  it('ignores a zone that is switched off', async () => {
    await seedZones(db);
    await db.execute(sql`UPDATE zones SET is_active = false`);
    expect(await findZoneForPoint(db, townCentre)).toBeNull();
  });

  it('rejects impossible coordinates', async () => {
    await expect(findZoneForPoint(db, { lat: 91, lng: 88 })).rejects.toThrow(RangeError);
    await expect(findZoneForPoint(db, { lat: 24, lng: 181 })).rejects.toThrow(RangeError);
    await expect(findZoneForPoint(db, { lat: Number.NaN, lng: 88 })).rejects.toThrow(RangeError);
  });

  it('can be seeded twice without duplicating the zone', async () => {
    await seedZones(db);
    await seedZones(db);
    const rows = await db.execute(sql`SELECT count(*)::int AS n FROM zones`);
    expect(rows[0]?.n).toBe(1);
  });

  it('refuses a negative fee at the database level', async () => {
    await seedZones(db);
    await expect(db.execute(sql`UPDATE zones SET min_fee_poisha = -1`)).rejects.toThrow();
  });
});
```

The shape of `db.execute` results depends on the Postgres driver chosen. Adjust the two raw-result assertions to the driver's actual return shape after reading the Drizzle documentation; keep what they assert.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm install` then `pnpm --filter @oregano/api test`
Expected: FAIL, cannot resolve `../testing/db` and `./repo`.

- [ ] **Step 4: Implement the database layer**

- `db/geography.ts` defines a Drizzle custom column type for `geography(Polygon, 4326)`.
- `zones/schema.ts` defines the table above. Generate the migration with drizzle-kit, then add the `CREATE EXTENSION` line and the check constraints to the generated SQL if drizzle-kit did not emit them.
- `db/migrate.ts` applies migrations to `DATABASE_URL`.
- `testing/db.ts` connects to `oregano_test`, migrates once per test run, and truncates every table in `beforeEach`. Test files that use it run serially.
- `findZoneForPoint` uses `ST_Covers(boundary, ST_MakePoint(lng, lat)::geography)`. Longitude comes first in `ST_MakePoint`.
- `seedZones` upserts on `slug`.
- `server.ts` now builds the app with `[postgresCheck(db), redisCheck(config.redisUrl)]` and closes the database on shutdown.

- [ ] **Step 5: Run the checks**

Run: `pnpm --filter @oregano/api test` then `pnpm lint` then `pnpm typecheck`
Expected: 16 API tests pass; lint and typecheck exit 0.

- [ ] **Step 6: Verify the running server**

Run: `pnpm db:migrate`, `pnpm db:seed`, then start the API with the values from `.env.example` and request `http://localhost:4000/readyz`.
Expected: 200 `{"status":"ready","checks":{"postgres":"ok","redis":"ok"}}`. Then run `docker compose -f infra/docker-compose.yml stop redis` and request again. Expected: 503 with `"redis":"fail"`. Restart Redis afterwards.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: PostGIS database with the Chapainawabganj zone"
```

---

### Task 7: Customer app shell

**Files:**

- Create: `apps/customer/` (generated by the Expo project creator, default template with Expo Router and TypeScript)
- Modify: `apps/customer/package.json`, `apps/customer/metro.config.js`, `apps/customer/app.json`
- Create: `apps/customer/app/_layout.tsx`, `apps/customer/app/index.tsx`
- Create: `apps/customer/src/locale.tsx`
- Create: `apps/customer/playwright.config.ts`
- Test: `apps/customer/e2e/shell.spec.ts`

**Interfaces:**

- Consumes: `t`, `Locale`, `formatMoney` from `@oregano/i18n`; `colors`, `fonts`, `typeScale`, `layout` from `@oregano/ui`; `taka` from `@oregano/domain`.
- Produces:

```ts
// apps/customer/src/locale.tsx
export function LocaleProvider(props: { children: React.ReactNode }): JSX.Element;
export function useLocale(): { locale: Locale; setLocale: (locale: Locale) => void };
```

- Scripts in `apps/customer/package.json`: `dev:web` (start the web dev server on port 8081), `build:web` (static web export to `dist/`), `test:e2e` (Playwright).

The one screen, `app/index.tsx`, on a cream background with 20 px side margins:

- A heading showing `t(locale, 'brand.promise')`, in Fraunces for English and Hind Siliguri for Bangla, 28 px, plum. It has the accessibility role `header`.
- A line of body text showing `formatMoney(taka(280), locale)`, proving the shared money path works in the app.
- A full-width button at the bottom, plum with cream text, 14 px corners, at least 48 px tall, labelled `t(locale, 'language.switchTo')`. Pressing it switches the locale between `en` and `bn`.

The default locale is `en`. The chosen locale is kept in memory only; persistence arrives with the profile screen in Plan 05.

- [ ] **Step 1: Create the Expo app**

Read the current Expo documentation for creating a project and for monorepo setup before running anything. Create the app in `apps/customer` with the default template, remove the template's example screens and assets, name the package `@oregano/customer`, and add the three workspace packages as dependencies. Configure Metro for the pnpm monorepo only as far as the current Expo documentation says is needed. Set `app.json` name to `Oregano` and slug to `oregano-customer`. Install the three font families through the Expo Google Fonts packages and load them in `app/_layout.tsx`.

- [ ] **Step 2: Write the failing test**

```ts
// apps/customer/e2e/shell.spec.ts
import { expect, test } from '@playwright/test';

test('shows the brand promise and switches language', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: "Your town's food, in one place." })).toBeVisible();
  await expect(page.getByText('Tk 280')).toBeVisible();

  await page.getByRole('button', { name: 'বাংলা' }).click();

  await expect(page.getByRole('heading', { name: 'শহরের সব খাবার, এক ঠিকানায়।' })).toBeVisible();
  await expect(page.getByText('৳২৮০')).toBeVisible();

  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByText('Tk 280')).toBeVisible();
});

test('language button meets the minimum tap target', async ({ page }) => {
  await page.goto('/');
  const box = await page.getByRole('button', { name: 'বাংলা' }).boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(48);
});

test('fits a small phone without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
```

`playwright.config.ts` uses base URL `http://localhost:8081`, starts `pnpm dev:web` as its web server, and runs Chromium with a 390 x 844 viewport (the book's mobile base).

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @oregano/customer test:e2e`
Expected: FAIL, heading not found.

- [ ] **Step 4: Implement `src/locale.tsx`, `app/_layout.tsx` and `app/index.tsx`**

Use only React Native primitives (`View`, `Text`, `Pressable`) so the same screen runs on Android and iOS. Take every colour, size and radius from `@oregano/ui`; no literal hex values or pixel sizes in the screen file.

- [ ] **Step 5: Run the checks**

Run: `pnpm --filter @oregano/customer test:e2e` then `pnpm --filter @oregano/customer build:web` then `pnpm lint` then `pnpm typecheck`
Expected: 3 Playwright tests pass; the web export completes into `apps/customer/dist`; lint and typecheck exit 0.

- [ ] **Step 6: Record the web bundle size**

Run the web export and note the total size of the JavaScript in `apps/customer/dist` (gzip). Write the number and the date into `docs/blueprint/measurements.md`. This is the baseline for the slow-3G budget in blueprint section 10.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: customer app shell on web with English and Bangla"
```

---

### Task 8: One verify command, CI and project guide

**Files:**

- Modify: root `package.json` (add `verify` and `test:e2e` scripts), `turbo.json`
- Create: `.github/workflows/ci.yml`
- Create: `CLAUDE.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: every script from Tasks 1 to 7.
- Produces: `pnpm verify`, the single command that later plans use as their completion gate. It runs, in order: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter @oregano/customer build:web`, `pnpm test:e2e`. It stops at the first failure.

`ci.yml` runs on every push and pull request, on Ubuntu with Node 24 and pnpm. It starts PostgreSQL (the `postgis/postgis` image) and Redis as service containers with the same credentials as the compose file, installs with `pnpm install --frozen-lockfile`, installs the Playwright Chromium browser, runs `pnpm db:migrate`, then `pnpm verify`. It also runs `pnpm audit --audit-level high` as a separate job.

`CLAUDE.md` is the guide a future session reads first. It contains, in this order:

1. One paragraph: what Oregano is, and that the book and the blueprint are the sources of truth, with their paths.
2. The commands: `pnpm db:up`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm verify`, and how to run one package's tests.
3. The repository layout from blueprint section 5, limited to what exists.
4. The rules from this plan's Global Constraints section.
5. Where plans live and the rule that each plan is written just before it is executed.

`README.md` gets a short human-facing version: what the project is, prerequisites (Node 24, Docker), and the five commands to get a working local setup.

- [ ] **Step 1: Add the scripts and run the gate**

Run: `pnpm verify`
Expected: exit code 0, with every stage reporting success.

- [ ] **Step 2: Prove the gate catches a failure**

Temporarily change `taka(1000)` to `taka(999)` in the commission test in `packages/domain/src/money.test.ts`, run `pnpm verify`, and confirm it exits non-zero at the test stage. Revert the change and confirm `git status` shows no modification to that file.

- [ ] **Step 3: Write `ci.yml`, `CLAUDE.md` and `README.md`**

- [ ] **Step 4: Verify from a clean copy**

Clone the repository into a temporary directory, run `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm db:migrate`, `pnpm verify`.
Expected: exit code 0. This proves nothing depends on files that were never committed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: verify gate, CI workflow and project guide"
```

---

## Completion

Plan 01 is complete when:

- `pnpm verify` exits 0 from a clean clone.
- The customer shell, opened in a browser, shows the brand promise and switches between English and Bangla.
- `GET /readyz` returns 200 with both checks `ok`, and 503 when Redis is stopped.
- `docs/blueprint/measurements.md` holds the web bundle baseline.

Then write Plan 02 ("First order, end to end") with the `writing-plans` skill, using the roadmap entry as its goal.
