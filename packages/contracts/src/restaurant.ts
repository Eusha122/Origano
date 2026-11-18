import { ACCOUNT_STATUSES } from '@oregano/domain';
import { z } from 'zod';

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
