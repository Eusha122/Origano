import { ORDER_STATUSES, taka } from '@oregano/domain';
import { describe, expect, it } from 'vitest';
import { formatMoney, messages, orderStatusKey, t } from './index';

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

  it('every placeholder in English appears in Bangla, and the reverse', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(messages.en) as (keyof typeof messages.en)[]) {
      expect(placeholders(messages.bn[key]), key).toEqual(placeholders(messages.en[key]));
    }
  });

  it('has the Plan 02 strings with their placeholders', () => {
    expect(t('en', 'cart.viewCart', { count: 2, total: 'Tk 560' })).toBe('2 items · Tk 560 — View cart');
    expect(t('bn', 'order.number', { number: 12 })).toBe('Order #12');
    expect(t('bn', 'rider.collectCash', { amount: 'Tk 960' })).toBe('Collect Tk 960');
  });

  it('has the fix-wave strings', () => {
    expect(t('en', 'cart.viewCartOne', { total: 'Tk 180' })).toBe('1 item · Tk 180 — View cart');
    expect(t('en', 'cart.maxReached', { max: 20 })).toBe('You can order up to 20 of one item');
    expect(t('en', 'checkout.mayBePlaced')).toBe('This order may already be placed.');
    expect(t('en', 'checkout.seeOrder')).toBe('See your order');
    expect(t('en', 'error.restaurantClosed')).toBe('This restaurant is closed right now. Try again later.');
    expect(t('en', 'error.itemNotInRestaurant')).toBe(
      'Something in your cart is no longer on the menu. Remove it and try again.',
    );
    expect(t('en', 'error.validationFailed')).toBe('Some details are missing or wrong. Check them and try again.');
  });

  it('has the restaurant application and staff strings, with labels staying English in Bangla', () => {
    expect(t('en', 'apply.rejected', { reason: 'Photo is blurry' })).toBe(
      'We could not approve your application: Photo is blurry',
    );
    expect(t('bn', 'apply.rejected', { reason: 'Photo is blurry' })).toContain('Photo is blurry');
    expect(t('en', 'apply.underReview')).toBe('We are checking your details. This usually takes one to two days.');
    expect(t('en', 'staff.empty')).toBe('No staff yet. Add them by phone number.');
    // Buttons and field labels are English in both languages.
    for (const key of ['apply.submit', 'apply.restaurantName', 'staff.add', 'doc.choose', 'payout.bkash'] as const) {
      expect(messages.bn[key], key).toBe(messages.en[key]);
    }
    // Plain sentences are translated.
    expect(messages.bn['apply.intro']).not.toBe(messages.en['apply.intro']);
  });

  it('has the rider joining strings, with labels staying English in Bangla', () => {
    expect(t('en', 'rider.suspended', { reason: 'Complaints' })).toBe(
      'Your account is paused: Complaints. Call Oregano support.',
    );
    expect(t('bn', 'rider.rejected', { reason: 'Blurry photo' })).toContain('Blurry photo');
    expect(t('en', 'join.agencyHint')).toBe('Ask your agency for its 8-letter code.');
    expect(t('en', 'join.staffHint')).toBe('Your restaurant must add your phone number first.');
    expect(t('en', 'join.selfieHint')).toBe('A clear photo of your face, no sunglasses.');
    for (const key of ['join.independent', 'join.next', 'vehicle.motorcycle', 'doc.nidFront', 'join.submit'] as const) {
      expect(messages.bn[key], key).toBe(messages.en[key]);
    }
    expect(messages.bn['join.intro']).not.toBe(messages.en['join.intro']);
  });

  it('has the admin dashboard strings, with labels staying English in Bangla', () => {
    expect(t('en', 'admin.teamNote')).toBe('Team roles are changed by an operator.');
    expect(messages.bn['admin.teamNote']).not.toBe(messages.en['admin.teamNote']);
    for (const key of ['admin.tabApplications', 'admin.approve', 'admin.waiveLicence', 'admin.createAgency'] as const) {
      expect(messages.bn[key], key).toBe(messages.en[key]);
    }
  });

  describe('order status words', () => {
    it('tells the customer a ready order is waiting for a rider until one claims it', () => {
      expect(t('en', orderStatusKey('ready', 'customer', false))).toBe('Ready. Waiting for a rider.');
      expect(t('en', orderStatusKey('ready', 'customer', true))).toBe('Ready. Your rider is collecting it.');
      expect(t('en', orderStatusKey('placed', 'customer', false))).toBe('Order placed. Waiting for the restaurant.');
    });

    it('speaks to the rider in a rider voice, never the customer one', () => {
      expect(t('en', orderStatusKey('preparing', 'rider', true))).toBe('The restaurant is preparing it');
      expect(t('en', orderStatusKey('ready', 'rider', true))).toBe('Ready. Collect it from the restaurant.');
      expect(t('en', orderStatusKey('on_the_way', 'rider', true))).toBe('On the way to the customer');
      for (const status of ORDER_STATUSES) {
        const rider = orderStatusKey(status, 'rider', true);
        expect(rider.startsWith('riderStatus.'), status).toBe(true);
      }
    });
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

  it('keeps buttons and labels English in Bangla mode, and plain sentences Bangla', () => {
    for (const key of ['action.placeOrder', 'auth.signOut', 'cart.add', 'checkout.total', 'rider.title'] as const) {
      expect(t('bn', key), key).toBe(t('en', key));
    }
    expect(t('bn', 'cart.empty')).not.toBe(t('en', 'cart.empty'));
    expect(t('bn', 'error.generic')).not.toBe(t('en', 'error.generic'));
  });

  it('formats money as Tk in every language', () => {
    expect(formatMoney(taka(280))).toBe('Tk 280');
    expect(formatMoney(taka(0))).toBe('Tk 0');
  });

  it('groups large amounts and shows poisha only when present', () => {
    expect(formatMoney(taka(20000))).toBe('Tk 20,000');
    expect(formatMoney(taka(150000))).toBe('Tk 1,50,000');
    expect(formatMoney(taka(15.5))).toBe('Tk 15.50');
  });
});
