import { z } from 'zod';

export const RealtimeClientMessage = z.object({ type: z.literal('auth'), token: z.string() });
export type RealtimeClientMessage = z.infer<typeof RealtimeClientMessage>;

export const RealtimeServerMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('order.changed'), orderId: z.uuid() }),
]);
export type RealtimeServerMessage = z.infer<typeof RealtimeServerMessage>;
