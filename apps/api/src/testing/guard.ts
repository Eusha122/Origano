/** Tests empty every table before each run. Refuse to touch any database not explicitly named *_test. */
export function assertTestDatabaseUrl(url: string): void {
  const name = URL.canParse(url) ? new URL(url).pathname.replace(/^\//, '') : '';
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run tests: the test database name must end in _test (got "${name || 'unknown'}").`);
  }
}
