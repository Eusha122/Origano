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
