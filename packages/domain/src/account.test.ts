import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_ACTIONS,
  ACCOUNT_STATUSES,
  type AccountAction,
  type AccountStatus,
  accountTransition,
} from './account';

const ALLOWED: [AccountStatus, AccountAction, AccountStatus][] = [
  ['applied', 'submit', 'under_review'],
  ['under_review', 'approve', 'approved'],
  ['under_review', 'reject', 'rejected'],
  ['rejected', 'resubmit', 'under_review'],
  ['approved', 'suspend', 'suspended'],
  ['suspended', 'reinstate', 'approved'],
];

describe('accountTransition', () => {
  it('allows exactly the six moves and no others', () => {
    for (const from of ACCOUNT_STATUSES) {
      for (const action of ACCOUNT_ACTIONS) {
        const expected = ALLOWED.find(([f, a]) => f === from && a === action)?.[2] ?? null;
        expect(accountTransition(from, action), `${from} + ${action}`).toBe(expected);
      }
    }
  });
});
