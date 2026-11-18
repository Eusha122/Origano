import { ACCOUNT_STATUSES, RIDER_TYPES, TEAM_ROLES } from '@oregano/domain';
import { z } from 'zod';

export const OtpRequestBody = z.object({
  phone: z.string().trim().min(1).max(30),
  /** The language of the SMS. */
  locale: z.enum(['en', 'bn']).optional(),
});
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
  rider: z
    .object({
      zoneId: z.uuid(),
      isOnline: z.boolean(),
      status: z.enum(ACCOUNT_STATUSES),
      type: z.enum(RIDER_TYPES),
      /** False when the rider's agency is suspended: approved, but not allowed to work. */
      agencyActive: z.boolean(),
    })
    .nullable(),
});
export type Me = z.infer<typeof Me>;

/** A browser gets the refresh token in an httpOnly cookie, so `refreshToken` is null there. */
export const SessionResponse = z.object({
  accessToken: z.string(),
  accessExpiresAt: z.iso.datetime(),
  refreshToken: z.string().nullable(),
  user: Me,
});
export type SessionResponse = z.infer<typeof SessionResponse>;

/** Native apps send the refresh token in the body; browsers send it in the cookie and leave this empty. */
export const RefreshBody = z.object({ refreshToken: z.string().min(20).max(200).optional() });
export type RefreshBody = z.infer<typeof RefreshBody>;

export const RefreshResponse = SessionResponse.omit({ user: true });
export type RefreshResponse = z.infer<typeof RefreshResponse>;
