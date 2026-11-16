import { addMoney, type Money, multiplyMoney, poisha } from '@oregano/domain';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

export type CartRestaurant = { id: string; slug: string; nameEn: string; nameBn: string };
export type CartItem = { menuItemId: string; nameEn: string; nameBn: string; price: number };
export type CartLine = CartItem & { quantity: number };

type CartState = { restaurant: CartRestaurant | null; lines: CartLine[] };

type CartValue = {
  restaurant: CartRestaurant | null;
  lines: CartLine[];
  count: number;
  subtotal: Money;
  /** Adds one. Returns false, changing nothing, when the cart holds another restaurant's food. */
  add(restaurant: CartRestaurant, item: CartItem): boolean;
  /** Empties the cart, then adds one: used after the customer confirms switching restaurants. */
  replaceWith(restaurant: CartRestaurant, item: CartItem): void;
  remove(menuItemId: string): void;
  clear(): void;
};

const EMPTY: CartState = { restaurant: null, lines: [] };
const CartContext = createContext<CartValue | null>(null);

function withOne(lines: CartLine[], item: CartItem): CartLine[] {
  return lines.some((l) => l.menuItemId === item.menuItemId)
    ? lines.map((l) => (l.menuItemId === item.menuItemId ? { ...l, quantity: l.quantity + 1 } : l))
    : [...lines, { ...item, quantity: 1 }];
}

/** The cart: one restaurant at a time, kept in memory only. */
export function CartProvider(props: { children: ReactNode }) {
  const [state, setState] = useState<CartState>(EMPTY);

  const add = useCallback(
    (restaurant: CartRestaurant, item: CartItem) => {
      if (state.restaurant !== null && state.restaurant.id !== restaurant.id && state.lines.length > 0) return false;
      setState((s) => ({ restaurant, lines: withOne(s.lines, item) }));
      return true;
    },
    [state],
  );
  const replaceWith = useCallback((restaurant: CartRestaurant, item: CartItem) => {
    setState({ restaurant, lines: withOne([], item) });
  }, []);
  const remove = useCallback((menuItemId: string) => {
    setState((s) => {
      const lines = s.lines
        .map((l) => (l.menuItemId === menuItemId ? { ...l, quantity: l.quantity - 1 } : l))
        .filter((l) => l.quantity > 0);
      return lines.length === 0 ? EMPTY : { ...s, lines };
    });
  }, []);
  const clear = useCallback(() => setState(EMPTY), []);

  const value = useMemo<CartValue>(
    () => ({
      restaurant: state.restaurant,
      lines: state.lines,
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
