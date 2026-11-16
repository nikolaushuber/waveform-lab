import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'jsdom',
    // The tap/clustering pipelines on synthetic recordings take a few seconds.
    testTimeout: 30_000,
    coverage: {
      // src/core is the analysis code (the part to port to Python); the UI is
      // covered by the Playwright smoke tests instead.
      include: ['src/core/**'],
      thresholds: { statements: 95, lines: 95, functions: 95, branches: 85 },
    },
  },
});
