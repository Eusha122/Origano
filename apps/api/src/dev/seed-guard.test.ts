import { describe, expect, it } from 'vitest';
import { assertDemoSeedAllowed } from './seed-guard';

const url = (name: string) => `postgres://u:hunter2@localhost:5432/${name}`;

describe('demo seed guard', () => {
  it('allows the local development database and any test database', () => {
    for (const name of ['oregano', 'oregano_test', 'oregano_e2e_test']) {
      expect(() => assertDemoSeedAllowed({ databaseUrl: url(name), nodeEnv: 'development' }), name).not.toThrow();
    }
    expect(() => assertDemoSeedAllowed({ databaseUrl: url('oregano'), nodeEnv: undefined })).not.toThrow();
  });

  it('refuses in production, whatever the database', () => {
    expect(() => assertDemoSeedAllowed({ databaseUrl: url('oregano'), nodeEnv: 'production' })).toThrow(/production/);
    expect(() => assertDemoSeedAllowed({ databaseUrl: url('oregano_test'), nodeEnv: 'production' })).toThrow(
      /production/,
    );
  });

  it('refuses any other database, so demo users and an admin never land in real data', () => {
    for (const name of ['orders', 'oregano_prod', 'oregano_test_backup', 'oregano2', '']) {
      expect(() => assertDemoSeedAllowed({ databaseUrl: url(name), nodeEnv: 'development' }), name).toThrow(/oregano/);
    }
    expect(() => assertDemoSeedAllowed({ databaseUrl: 'not a url', nodeEnv: 'development' })).toThrow(/oregano/);
  });

  it('never echoes the password', () => {
    expect(() => assertDemoSeedAllowed({ databaseUrl: url('orders'), nodeEnv: 'development' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('hunter2') }),
    );
  });
});
