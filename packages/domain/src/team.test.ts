import { describe, expect, it } from 'vitest';
import { PERMISSIONS, teamCan, VEHICLE_TYPES, vehicleNeedsRegistration } from './team';

describe('teamCan', () => {
  it('gives superadmin every permission', () => {
    for (const p of PERMISSIONS) expect(teamCan(['superadmin'], p)).toBe(true);
  });

  it('gives onboarding the review permissions but not team.read', () => {
    for (const p of ['orders.read', 'applications.review', 'documents.view', 'accounts.manage'] as const) {
      expect(teamCan(['onboarding'], p)).toBe(true);
    }
    expect(teamCan(['onboarding'], 'team.read')).toBe(false);
  });

  it('gives support only orders.read', () => {
    for (const p of PERMISSIONS) expect(teamCan(['support'], p)).toBe(p === 'orders.read');
  });

  it('gives nobody with no role anything', () => {
    for (const p of PERMISSIONS) expect(teamCan([], p)).toBe(false);
  });

  it('combines several roles', () => {
    expect(teamCan(['support', 'onboarding'], 'documents.view')).toBe(true);
  });
});

describe('vehicleNeedsRegistration', () => {
  it('is true only for motorcycle and electric bike', () => {
    for (const v of VEHICLE_TYPES) {
      expect(vehicleNeedsRegistration(v)).toBe(v === 'motorcycle' || v === 'electric_bike');
    }
  });
});
