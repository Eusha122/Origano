import { ACCOUNT_STATUSES, ORDER_STATUSES, RIDER_TYPES, TEAM_ROLES } from '@oregano/domain';
import { z } from 'zod';

export const AdminOrderRow = z.object({
  id: z.uuid(),
  number: z.number().int(),
  status: z.enum(ORDER_STATUSES),
  restaurantNameEn: z.string(),
  customerPhone: z.string(),
  riderName: z.string().nullable(),
  riderPhone: z.string().nullable(),
  total: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type AdminOrderRow = z.infer<typeof AdminOrderRow>;

/** Why an account is suspended, in words the team will read back later. */
export const ReasonBody = z.object({ reason: z.string().trim().min(10).max(500) });
export type ReasonBody = z.infer<typeof ReasonBody>;

export const CreateAgencyBody = z.object({
  name: z.string().trim().min(2).max(80),
  contactPhone: z.string().trim().max(30),
});
export type CreateAgencyBody = z.infer<typeof CreateAgencyBody>;

export const Agency = z.object({
  id: z.uuid(),
  name: z.string(),
  code: z.string(),
  status: z.enum(['approved', 'suspended']),
  riderCount: z.number().int(),
});
export type Agency = z.infer<typeof Agency>;

/** The answer to a suspend or reinstate: the account and where it stands now. */
export const AccountSummary = z.object({ id: z.uuid(), status: z.enum(['approved', 'suspended']) });
export type AccountSummary = z.infer<typeof AccountSummary>;

export const TeamMember = z.object({
  userId: z.uuid(),
  phone: z.string(),
  name: z.string().nullable(),
  role: z.enum(TEAM_ROLES),
  grantedAt: z.iso.datetime(),
});
export type TeamMember = z.infer<typeof TeamMember>;

/** An approved or suspended rider, for the accounts tab. Names only: no phone numbers. */
export const AdminRiderRow = z.object({
  userId: z.uuid(),
  name: z.string(),
  type: z.enum(RIDER_TYPES),
  status: z.enum(ACCOUNT_STATUSES),
  agencyName: z.string().nullable(),
});
export type AdminRiderRow = z.infer<typeof AdminRiderRow>;

export const AdminRestaurantRow = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(['approved', 'suspended']),
  isOpen: z.boolean(),
});
export type AdminRestaurantRow = z.infer<typeof AdminRestaurantRow>;
