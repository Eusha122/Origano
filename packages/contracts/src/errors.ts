import { z } from 'zod';

export const ERROR_CODES = [
  'invalid_phone',
  'otp_invalid',
  'otp_expired',
  'otp_attempts_exceeded',
  'otp_resend_too_soon',
  'otp_rate_limited',
  'otp_locked',
  'sms_unavailable',
  'unauthenticated',
  'invalid_location',
  'idempotency_key_required',
  'idempotency_key_reused',
  'item_unavailable',
  'item_not_in_restaurant',
  'restaurant_closed',
  'outside_zone',
  'invalid_transition',
  'actor_not_allowed',
  'forbidden',
  'already_claimed',
  'rider_offline',
  'not_found',
  'validation_failed',
  'bad_request',
  'payload_too_large',
  'unsupported_media_type',
  'internal',
] as const;

export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiErrorBody = z.object({
  error: z.object({ code: ErrorCode, message: z.string(), requestId: z.string() }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
