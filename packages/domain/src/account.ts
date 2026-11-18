export const ACCOUNT_STATUSES = ['applied', 'under_review', 'approved', 'rejected', 'suspended'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_ACTIONS = ['submit', 'approve', 'reject', 'resubmit', 'suspend', 'reinstate'] as const;
export type AccountAction = (typeof ACCOUNT_ACTIONS)[number];

const NEXT: Record<AccountStatus, Partial<Record<AccountAction, AccountStatus>>> = {
  applied: { submit: 'under_review' },
  under_review: { approve: 'approved', reject: 'rejected' },
  approved: { suspend: 'suspended' },
  rejected: { resubmit: 'under_review' },
  suspended: { reinstate: 'approved' },
};

/** The next status, or null when the action is not allowed from `from`. */
export function accountTransition(from: AccountStatus, action: AccountAction): AccountStatus | null {
  return NEXT[from][action] ?? null;
}
