import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/agent/src/**', 'apps/erp-mock/src/**', 'apps/api/src/**', 'eval/**'],
      exclude: ['**/main.ts', '**/types.ts', '**/index.ts'],
      thresholds: { lines: 85, functions: 85, statements: 85, branches: 80 },
    },
  },
});
