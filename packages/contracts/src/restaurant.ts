import { ACCOUNT_STATUSES } from '@oregano/domain';
import { z } from 'zod';
import { MenuCategory } from './catalog';

/** The role is always `staff`: owners come only from an approved application. */
export const AddStaffBody = z.object({ phone: z.string().trim().max(30) });
export type AddStaffBody = z.infer<typeof AddStaffBody>;

export const StaffMember = z.object({
  userId: z.uuid(),
  phone: z.string(),
  name: z.string().nullable(),
  role: z.enum(['owner', 'staff']),
  addedAt: z.iso.datetime(),
});
export type StaffMember = z.infer<typeof StaffMember>;

export const RiderInviteBody = z.object({ phone: z.string().trim().max(30) });
export type RiderInviteBody = z.infer<typeof RiderInviteBody>;

export const RiderInvite = z.object({
  phone: z.string(),
  createdAt: z.iso.datetime(),
  /** Where the invited person's rider application stands, once they have one. */
  riderStatus: z.enum(ACCOUNT_STATUSES).nullable(),
});
export type RiderInvite = z.infer<typeof RiderInvite>;

export const OpenBody = z.object({ isOpen: z.boolean() });
export type OpenBody = z.infer<typeof OpenBody>;

export const BusyBody = z.object({ extraMinutes: z.union([z.literal(0), z.literal(10), z.literal(20)]) });
export type BusyBody = z.infer<typeof BusyBody>;

export const ItemAvailabilityBody = z.object({ isAvailable: z.boolean() });
export type ItemAvailabilityBody = z.infer<typeof ItemAvailabilityBody>;

/** The owner's switch, busy mode, and what customers currently see because of them and the weekly hours. */
export const RestaurantControls = z.object({
  switchOn: z.boolean(),
  isOpen: z.boolean(),
  opensAt: z.string().nullable(),
  busyExtraMinutes: z.number().int(),
  prepMinutes: z.number().int(),
});
export type RestaurantControls = z.infer<typeof RestaurantControls>;

const menuName = (max: number) => z.string().trim().min(1).max(max);
const menuText = (max: number) => z.string().trim().max(max);

export const MIN_ITEM_PRICE_POISHA = 100;
export const MAX_ITEM_PRICE_POISHA = 5_000_000;
export const MAX_ITEMS_PER_RESTAURANT = 200;

export const CategoryBody = z.object({ nameEn: menuName(60), nameBn: menuName(60).optional() });
export type CategoryBody = z.infer<typeof CategoryBody>;

export const CategoryPatch = CategoryBody.partial().refine((v) => v.nameEn !== undefined || v.nameBn !== undefined, {
  error: 'Nothing to change',
});
export type CategoryPatch = z.infer<typeof CategoryPatch>;

export const ItemBody = z.object({
  nameEn: menuName(80),
  nameBn: menuName(80).optional(),
  descriptionEn: menuText(200).nullable().optional(),
  descriptionBn: menuText(200).nullable().optional(),
  /** The base price in poisha, Tk 1 to Tk 50,000. */
  price: z.number().int().min(MIN_ITEM_PRICE_POISHA).max(MAX_ITEM_PRICE_POISHA),
});
export type ItemBody = z.infer<typeof ItemBody>;

export const ItemPatch = ItemBody.partial()
  .extend({ categoryId: z.uuid().optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { error: 'Nothing to change' });
export type ItemPatch = z.infer<typeof ItemPatch>;

export const OrderIdsBody = z.object({ ids: z.array(z.uuid()).max(300) });
export type OrderIdsBody = z.infer<typeof OrderIdsBody>;

export const OptionsBody = z.object({
  groups: z
    .array(
      z
        .object({
          nameEn: menuName(40),
          nameBn: menuName(40).optional(),
          minSelect: z.number().int().min(0).max(10),
          maxSelect: z.number().int().min(1).max(10),
          options: z
            .array(
              z.object({
                nameEn: menuName(40),
                nameBn: menuName(40).optional(),
                priceDelta: z.number().int().min(0).max(500_000),
                isAvailable: z.boolean().optional(),
              }),
            )
            .min(1)
            .max(20),
        })
        .refine((g) => g.minSelect <= g.maxSelect && g.maxSelect <= g.options.length, {
          error: 'Select limits do not fit the options',
        }),
    )
    .max(6),
});
export type OptionsBody = z.infer<typeof OptionsBody>;

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const HoursInterval = z.object({ day: z.number().int().min(0).max(6), open: clock, close: clock });
export type HoursInterval = z.infer<typeof HoursInterval>;

/** Weekly opening hours in zone time. A close at or before the open means the next day (up to 04:00). */
export const HoursBody = z.object({ intervals: z.array(HoursInterval).max(21) });
export type HoursBody = z.infer<typeof HoursBody>;

export const PrepBody = z.object({ prepMinutes: z.number().int().min(5).max(120) });
export type PrepBody = z.infer<typeof PrepBody>;

export const DiscountBody = z
  .object({
    kind: z.enum(['percent', 'amount']),
    /** A whole percent (1 to 90) for `percent`; poisha for `amount`. */
    value: z.number().int().min(1).max(MAX_ITEM_PRICE_POISHA),
    scope: z.enum(['item', 'category', 'menu']),
    menuItemId: z.uuid().optional(),
    categoryId: z.uuid().optional(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
  })
  .refine((d) => d.kind !== 'percent' || d.value <= 90, { error: 'Percent is 1 to 90' })
  .refine(
    (d) =>
      (d.scope === 'item' && d.menuItemId !== undefined && d.categoryId === undefined) ||
      (d.scope === 'category' && d.categoryId !== undefined && d.menuItemId === undefined) ||
      (d.scope === 'menu' && d.menuItemId === undefined && d.categoryId === undefined),
    { error: 'The target does not match the scope' },
  )
  .refine((d) => new Date(d.endsAt).getTime() > new Date(d.startsAt).getTime(), {
    error: 'It must end after it starts',
  });
export type DiscountBody = z.infer<typeof DiscountBody>;

export const DiscountPatch = z
  .object({ isActive: z.boolean().optional(), endsAt: z.iso.datetime().optional() })
  .refine((v) => v.isActive !== undefined || v.endsAt !== undefined, { error: 'Nothing to change' });
export type DiscountPatch = z.infer<typeof DiscountPatch>;

export const Discount = z.object({
  id: z.uuid(),
  kind: z.enum(['percent', 'amount']),
  value: z.number().int(),
  scope: z.enum(['item', 'category', 'menu']),
  menuItemId: z.uuid().nullable(),
  categoryId: z.uuid().nullable(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  isActive: z.boolean(),
});
export type Discount = z.infer<typeof Discount>;

/** The owner's view of the whole menu: base prices, every item. */
export const OwnerMenu = z.object({ categories: z.array(MenuCategory) });
export type OwnerMenu = z.infer<typeof OwnerMenu>;

export const CategorySummary = z.object({ id: z.uuid(), nameEn: z.string(), nameBn: z.string() });
export type CategorySummary = z.infer<typeof CategorySummary>;

export const ItemAvailability = z.object({ id: z.uuid(), isAvailable: z.boolean() });
export type ItemAvailability = z.infer<typeof ItemAvailability>;

export const HoursResponse = z.object({ intervals: z.array(HoursInterval) });
export type HoursResponse = z.infer<typeof HoursResponse>;

export const DiscountList = z.object({ discounts: z.array(Discount) });
export type DiscountList = z.infer<typeof DiscountList>;

export const PhotoResponse = z.object({ imageUrl: z.string().nullable() });
export type PhotoResponse = z.infer<typeof PhotoResponse>;
