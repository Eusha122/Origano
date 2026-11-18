import { ApiError } from '@oregano/api-client';
import { ERROR_CODES, type ErrorCode } from '@oregano/contracts';
import { messages } from '@oregano/i18n';
import { describe, expect, it } from 'vitest';
import { errorMessageKey } from './errors';

describe('errorMessageKey', () => {
  it('has words, in English and Bangla, for every error code the API can send', () => {
    for (const code of ERROR_CODES) {
      const key = errorMessageKey(new ApiError(400, code, 'x', 'r'));
      expect(messages.en[key], `${code} en`).toBeTruthy();
      expect(messages.bn[key], `${code} bn`).toBeTruthy();
    }
  });

  it('says offline for status 0, and generic for anything that is not an API error', () => {
    expect(errorMessageKey(new ApiError(0, 'internal', 'x', ''))).toBe('status.offline');
    expect(errorMessageKey(new Error('boom'))).toBe('error.generic');
    expect(errorMessageKey(undefined)).toBe('error.generic');
  });

  it('keeps the specific words the apps already used', () => {
    const key = (code: ErrorCode) => errorMessageKey(new ApiError(422, code, 'x', 'r'));
    expect(key('invalid_phone')).toBe('auth.invalidPhone');
    expect(key('otp_invalid')).toBe('auth.wrongCode');
    expect(key('outside_zone')).toBe('zone.outside');
    expect(key('restaurant_closed')).toBe('error.restaurantClosed');
    expect(key('otp_locked')).toBe('error.otpLocked');
    expect(key('otp_resend_too_soon')).toBe('error.otpResendTooSoon');
  });
});
