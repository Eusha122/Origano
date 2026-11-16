import { describe, expect, it } from 'vitest';
import { isTerminal, type ORDER_STATUSES, transition } from './order';

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
