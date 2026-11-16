import { describe, expect, it } from 'vitest';
import { assertTestDatabaseUrl } from './guard';

describe('test database guard', () => {
  it('accepts a database whose name ends in _test', () => {
    expect(() => assertTestDatabaseUrl('postgres://u:p@localhost:5432/oregano_test')).not.toThrow();
  });

  it('refuses any other database, so tests can never empty real data', () => {
    expect(() => assertTestDatabaseUrl('postgres://u:p@localhost:5432/oregano')).toThrow(/_test/);
    expect(() => assertTestDatabaseUrl('postgres://u:p@prod.example.com/orders')).toThrow(/_test/);
    expect(() => assertTestDatabaseUrl('postgres://u:p@localhost/oregano_test_backup')).toThrow(/_test/);
  });

  it('never echoes the password', () => {
    expect(() => assertTestDatabaseUrl('postgres://u:hunter2@localhost/oregano')).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('hunter2') }),
    );
  });
});
