import { newIdempotencyKey } from '@oregano/app-core';
import { MAX_LINE_QUANTITY } from '@oregano/contracts';
import { addMoney, type Money, multiplyMoney, poisha } from '@oregano/domain';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

export type CartRestaurant = { id: string; slug: string; nameEn: string; nameBn: string };
export type CartItem = { menuItemId: string; nameEn: string; nameBn: string; price: number };
export type CartLine = CartItem & { quantity: number };

/** `key` is the Idempotency-Key of the order this cart would place: it changes only when the lines change. */
type CartState = { restaurant: CartRestaurant | null; lines: CartLine[]; key: string };

type CartValue = {
  restaurant: CartRestaurant | null;
  lines: CartLine[];
  count: number;
  /** The key every attempt to place this exact cart reuses, so a retry can never make a second order. */
  idempotencyKey: string;
  /** True when this item already has the most one order may hold. */
  isAtMax(menuItemId: string): boolean;
  subtotal: Money;
  /** Adds one. Returns false, changing nothing, when the cart holds another restaurant's food. */
  add(restaurant: CartRestaurant, item: CartItem): boolean;
  /** Empties the cart, then adds one: used after the customer confirms switching restaurants. */
  replaceWith(restaurant: CartRestaurant, item: CartItem): void;
  remove(menuItemId: string): void;
  clear(): void;
};

const empty = (): CartState => ({ restaurant: null, lines: [], key: newIdempotencyKey() });
const CartContext = createContext<CartValue | null>(null);

function withOne(lines: CartLine[], item: CartItem): CartLine[] {
  return lines.some((l) => l.menuItemId === item.menuItemId)
    ? lines.map((l) => (l.menuItemId === item.menuItemId ? { ...l, quantity: l.quantity + 1 } : l))
    : [...lines, { ...item, quantity: 1 }];
}

const atMax = (lines: CartLine[], menuItemId: string) =>
  lines.some((l) => l.menuItemId === menuItemId && l.quantity >= MAX_LINE_QUANTITY);

/** The cart: one restaurant at a time, kept in memory only. */
export function CartProvider(props: { children: ReactNode }) {
  const [state, setState] = useState<CartState>(empty);

  const add = useCallback(
    (restaurant: CartRestaurant, item: CartItem) => {
      if (state.restaurant !== null && state.restaurant.id !== restaurant.id && state.lines.length > 0) return false;
      setState((s) =>
        atMax(s.lines, item.menuItemId) ? s : { restaurant, lines: withOne(s.lines, item), key: newIdempotencyKey() },
      );
      return true;
    },
    [state],
  );
  const replaceWith = useCallback((restaurant: CartRestaurant, item: CartItem) => {
    setState({ restaurant, lines: withOne([], item), key: newIdempotencyKey() });
  }, []);
  const remove = useCallback((menuItemId: string) => {
    setState((s) => {
      const lines = s.lines
        .map((l) => (l.menuItemId === menuItemId ? { ...l, quantity: l.quantity - 1 } : l))
        .filter((l) => l.quantity > 0);
      return lines.length === 0 ? empty() : { ...s, lines, key: newIdempotencyKey() };
    });
  }, []);
  const clear = useCallback(() => setState(empty()), []);

  const value = useMemo<CartValue>(
    () => ({
      restaurant: state.restaurant,
      lines: state.lines,
      idempotencyKey: state.key,
      isAtMax: (menuItemId) => atMax(state.lines, menuItemId),
      count: state.lines.reduce((sum, l) => sum + l.quantity, 0),
      subtotal: addMoney(poisha(0), ...state.lines.map((l) => multiplyMoney(poisha(l.price), l.quantity))),
      add,
      replaceWith,
      remove,
      clear,
    }),
    [state, add, replaceWith, remove, clear],
  );
  return <CartContext.Provider value={value}>{props.children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart must be used inside CartProvider');
  return value;
}
