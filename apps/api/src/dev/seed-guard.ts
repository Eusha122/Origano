/**
 * The demo seed makes an admin with a known phone number. It may run only on the local development database
 * (`oregano`) or a test database (`*_test`), and never in production.
 */
export function assertDemoSeedAllowed(input: { databaseUrl: string; nodeEnv: string | undefined }): void {
  if (input.nodeEnv === 'production') {
    throw new Error('Refusing to seed demo data: NODE_ENV is production.');
  }
  const name = URL.canParse(input.databaseUrl) ? new URL(input.databaseUrl).pathname.replace(/^\//, '') : '';
  if (name !== 'oregano' && !name.endsWith('_test')) {
    throw new Error(
      `Refusing to seed demo data: the database must be "oregano" or end in _test (got "${name || 'unknown'}").`,
    );
  }
}
