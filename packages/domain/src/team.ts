export const TEAM_ROLES = ['superadmin', 'onboarding', 'support'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const PERMISSIONS = [
  'orders.read',
  'applications.review',
  'documents.view',
  'accounts.manage',
  'team.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const GRANTS: Record<TeamRole, readonly Permission[]> = {
  superadmin: PERMISSIONS,
  onboarding: ['orders.read', 'applications.review', 'documents.view', 'accounts.manage'],
  support: ['orders.read'],
};

export function teamCan(roles: readonly TeamRole[], permission: Permission): boolean {
  return roles.some((role) => GRANTS[role].includes(permission));
}

export const RIDER_TYPES = ['independent', 'agency', 'restaurant_staff'] as const;
export type RiderType = (typeof RIDER_TYPES)[number];

export const VEHICLE_TYPES = ['bicycle', 'motorcycle', 'electric_bike', 'on_foot'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

const NEEDS_REGISTRATION: Record<VehicleType, boolean> = {
  bicycle: false,
  motorcycle: true,
  electric_bike: true,
  on_foot: false,
};

export function vehicleNeedsRegistration(type: VehicleType): boolean {
  return NEEDS_REGISTRATION[type];
}
