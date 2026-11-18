import { defineConfig, devices } from '@playwright/test';
import { API_URL, APP_URLS, E2E_DATABASE_URL, E2E_REDIS_URL } from './journey';

const OTP_SECRET = 'e2e-only-otp-secret-0123456789abcdef';

/** What both the API and the worker read: the e2e database, local Redis, a throwaway OTP secret. */
const serverEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: E2E_DATABASE_URL,
  REDIS_URL: E2E_REDIS_URL,
  OTP_SECRET,
  LOG_LEVEL: 'warn',
};

/** An Expo app on its journey port, pointed at the journey API. CI=1 keeps Expo non-interactive. */
function expoApp(name: 'customer' | 'restaurant' | 'rider') {
  const url = APP_URLS[name];
  return {
    command: `pnpm --filter @oregano/${name} exec expo start --web --port ${new URL(url).port}`,
    url,
    env: { EXPO_PUBLIC_API_URL: API_URL, CI: '1' },
    reuseExistingServer: false,
    timeout: 180_000,
  };
}

export default defineConfig({
  testDir: './tests',
  // The tests share one database and one set of demo users, so they run one at a time, in order.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  expect: { timeout: 10_000 },
  globalSetup: './global-setup.ts',
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: APP_URLS.customer,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } }],
  // Six servers, none of them reused: the gate must test this checkout, never a dev server left running.
  webServer: [
    {
      command: 'pnpm --filter @oregano/api start',
      url: `${API_URL}/healthz`,
      env: {
        ...serverEnv,
        PORT: new URL(API_URL).port,
        CORS_ORIGINS: Object.values(APP_URLS).join(','),
        DEV_OTP_PEEK: 'true',
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // The worker has no port; it relays outbox rows to Redis. Its readiness is the API's.
      command: 'pnpm --filter @oregano/api worker',
      env: serverEnv,
      wait: { stdout: /worker started/ },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    expoApp('customer'),
    expoApp('restaurant'),
    expoApp('rider'),
    {
      command: `pnpm --filter @oregano/admin exec vite --port ${new URL(APP_URLS.admin).port} --strictPort`,
      url: APP_URLS.admin,
      env: { VITE_API_URL: API_URL },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
