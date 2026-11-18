import { type Permission, type TeamRole, teamCan } from '@oregano/domain';
import { t } from '@oregano/i18n';

export const TABS = [
  { id: 'orders', label: 'admin.tabOrders', permission: 'orders.read' },
  { id: 'applications', label: 'admin.tabApplications', permission: 'applications.review' },
  { id: 'riders', label: 'admin.tabRiders', permission: 'accounts.manage' },
  { id: 'restaurants', label: 'admin.tabRestaurants', permission: 'accounts.manage' },
  { id: 'agencies', label: 'admin.tabAgencies', permission: 'accounts.manage' },
  { id: 'zones', label: 'admin.tabZones', permission: 'zones.manage' },
  { id: 'team', label: 'admin.tabTeam', permission: 'team.read' },
] as const satisfies ReadonlyArray<{ id: string; label: Parameters<typeof t>[1]; permission: Permission }>;

export type TabId = (typeof TABS)[number]['id'];

/** The tabs this person's team roles allow. A support member sees Orders only. */
export function allowedTabs(roles: readonly TeamRole[]): (typeof TABS)[number][] {
  return TABS.filter((tab) => teamCan(roles, tab.permission));
}

export function Nav(props: {
  tabs: ReadonlyArray<(typeof TABS)[number]>;
  current: TabId;
  onChange: (id: TabId) => void;
}) {
  return (
    <nav aria-label="Sections" className="nav">
      {props.tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={tab.id === props.current ? '' : 'secondary'}
          aria-current={tab.id === props.current ? 'page' : undefined}
          onClick={() => props.onChange(tab.id)}
        >
          {t('en', tab.label)}
        </button>
      ))}
    </nav>
  );
}
