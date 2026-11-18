import { TEAM_ROLES } from '@oregano/domain';
import { z } from 'zod';

export const OtpRequestBody = z.object({ phone: z.string().trim().min(1).max(30) });
export type OtpRequestBody = z.infer<typeof OtpRequestBody>;

export const OtpRequestResponse = z.object({
  expiresInSeconds: z.number().int(),
  resendInSeconds: z.number().int(),
});
export type OtpRequestResponse = z.infer<typeof OtpRequestResponse>;

export const OtpVerifyBody = z.object({
  phone: z.string().trim().min(1).max(30),
  code: z.string().regex(/^[0-9]{6}$/),
});
export type OtpVerifyBody = z.infer<typeof OtpVerifyBody>;

export const Role = z.enum(['customer', 'restaurant', 'rider', 'admin']);
export type Role = z.infer<typeof Role>;

export const Me = z.object({
  id: z.uuid(),
  phone: z.string(),
  name: z.string().nullable(),
  roles: z.array(Role),
  teamRoles: z.array(z.enum(TEAM_ROLES)),
  restaurantIds: z.array(z.uuid()),
  rider: z.object({ zoneId: z.uuid(), isOnline: z.boolean() }).nullable(),
});
export type Me = z.infer<typeof Me>;

export const SessionResponse = z.object({ token: z.string(), user: Me });
export type SessionResponse = z.infer<typeof SessionResponse>;
