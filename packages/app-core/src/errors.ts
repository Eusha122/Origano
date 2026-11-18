import { ApiError } from '@oregano/api-client';
import type { ErrorCode } from '@oregano/contracts';
import type { MessageKey } from '@oregano/i18n';

/**
 * The words for every error code the API can send. A Record, so adding a code to the contract without
 * adding its words here fails the typecheck.
 */
const KEYS: Record<ErrorCode, MessageKey> = {
  invalid_phone: 'auth.invalidPhone',
  otp_invalid: 'auth.wrongCode',
  otp_expired: 'auth.wrongCode',
  otp_attempts_exceeded: 'auth.wrongCode',
  otp_resend_too_soon: 'error.otpResendTooSoon',
  otp_rate_limited: 'error.otpRateLimited',
  otp_locked: 'error.otpLocked',
  sms_unavailable: 'error.smsUnavailable',
  unauthenticated: 'error.generic',
  invalid_location: 'error.generic',
  idempotency_key_required: 'error.generic',
  idempotency_key_reused: 'checkout.mayBePlaced',
  item_unavailable: 'item.soldOut',
  item_not_in_restaurant: 'error.itemNotInRestaurant',
  restaurant_closed: 'error.restaurantClosed',
  outside_zone: 'zone.outside',
  invalid_transition: 'error.generic',
  actor_not_allowed: 'error.generic',
  forbidden: 'error.generic',
  already_claimed: 'error.generic',
  rider_offline: 'error.generic',
  not_found: 'error.generic',
  validation_failed: 'error.validationFailed',
  bad_request: 'error.generic',
  payload_too_large: 'error.generic',
  unsupported_media_type: 'error.generic',
  internal: 'error.generic',
};

/** The message key for a failure: offline, a refusal the user can act on, or the generic line. */
export function errorMessageKey(error: unknown): MessageKey {
  if (!(error instanceof ApiError)) return 'error.generic';
  if (error.status === 0) return 'status.offline';
  return KEYS[error.code];
}
