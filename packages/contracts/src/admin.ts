import { ORDER_STATUSES } from '@oregano/domain';
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
