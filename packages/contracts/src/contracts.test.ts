// packages/contracts/src/contracts.test.ts
import { describe, expect, it } from 'vitest';
import { AcceptBody, OtpVerifyBody, PlaceOrderBody, RealtimeServerMessage, RejectBody } from './index';

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
