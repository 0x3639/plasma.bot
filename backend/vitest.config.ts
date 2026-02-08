import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: 'src',
    include: ['__tests__/**/*.test.ts'],
    globalSetup: ['__tests__/setup/globalSetup.ts'],
    setupFiles: ['__tests__/setup/setupEach.ts'],
    pool: 'forks',
    testTimeout: 15000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: [
        'services/**',
        'middleware/**',
        'routes/**',
        'utils/**',
        'cron/**',
      ],
    },
  },
});
