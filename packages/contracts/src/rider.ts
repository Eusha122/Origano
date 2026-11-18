import { READY_MINUTES, REJECT_REASONS } from '@oregano/domain';
import { z } from 'zod';

export const AcceptBody = z.object({ readyInMinutes: z.literal(READY_MINUTES) });
export type AcceptBody = z.infer<typeof AcceptBody>;

export const RejectBody = z.object({ reason: z.enum(REJECT_REASONS) });
export type RejectBody = z.infer<typeof RejectBody>;

export const OnlineBody = z.object({ online: z.boolean() });
export type OnlineBody = z.infer<typeof OnlineBody>;

export const RiderOffer = z.object({
  orderId: z.uuid(),
  number: z.number().int(),
  status: z.enum(['preparing', 'ready']),
  restaurant: z.object({ nameEn: z.string(), nameBn: z.string(), addressLine: z.string() }),
  landmark: z.string(),
  distanceKm: z.number(),
  deliveryFee: z.number().int(),
});
export type RiderOffer = z.infer<typeof RiderOffer>;
