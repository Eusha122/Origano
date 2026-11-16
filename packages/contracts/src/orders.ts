import { ORDER_STATUSES, REJECT_REASONS } from '@oregano/domain';
import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);

export const PlaceOrderBody = z.object({
  restaurantId: z.uuid(),
  items: z
    .array(z.object({ menuItemId: z.uuid(), quantity: z.number().int().min(1).max(20) }))
    .min(1)
    .max(30)
    .refine((items) => new Set(items.map((i) => i.menuItemId)).size === items.length, {
      error: 'Duplicate menu item',
    }),
  delivery: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    addressLine: text(200),
    landmark: text(200),
    phone: z.string().trim().min(1).max(30),
  }),
  note: z.string().trim().max(200).optional(),
});
export type PlaceOrderBody = z.infer<typeof PlaceOrderBody>;

export const OrderItem = z.object({
  menuItemId: z.uuid(),
  nameEn: z.string(),
  nameBn: z.string(),
  unitPrice: z.number().int(),
  quantity: z.number().int(),
  lineTotal: z.number().int(),
});
export type OrderItem = z.infer<typeof OrderItem>;

export const TimelineEntry = z.object({ event: z.string(), at: z.iso.datetime() });
export type TimelineEntry = z.infer<typeof TimelineEntry>;

export const Order = z.object({
  id: z.uuid(),
  number: z.number().int(),
  status: z.enum(ORDER_STATUSES),
  type: z.literal('delivery'),
  restaurant: z.object({
    id: z.uuid(),
    nameEn: z.string(),
    nameBn: z.string(),
    phone: z.string().nullable(),
  }),
  items: z.array(OrderItem),
  subtotal: z.number().int(),
  deliveryFee: z.number().int(),
  total: z.number().int(),
  paymentMethod: z.literal('cash'),
  delivery: z.object({
    addressLine: z.string(),
    landmark: z.string(),
    lat: z.number(),
    lng: z.number(),
  }),
  customerPhone: z.string().nullable(),
  rider: z.object({ id: z.uuid(), name: z.string().nullable(), phone: z.string().nullable() }).nullable(),
  readyInMinutes: z.number().int().nullable(),
  rejectReason: z.enum(REJECT_REASONS).nullable(),
  timeline: z.array(TimelineEntry),
  createdAt: z.iso.datetime(),
});
export type Order = z.infer<typeof Order>;
