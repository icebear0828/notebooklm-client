import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e-*.test.ts'],
    exclude: ['.claude/**'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // Run e2e tests sequentially — they depend on shared state
    sequence: { concurrent: false },
  },
});
