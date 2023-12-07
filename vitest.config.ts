import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // We can't run tests in parallel because we're using a database
    pool: 'forks',
    coverage: {
      provider: 'v8',
    },
  },
});
