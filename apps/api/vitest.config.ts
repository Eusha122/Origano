import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Database tests share one real PostgreSQL database, so test files run one at a time.
    fileParallelism: false,
  },
});
