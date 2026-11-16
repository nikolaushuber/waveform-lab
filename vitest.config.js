import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'jsdom',
    // The tap/clustering pipelines on synthetic recordings take a few seconds.
    testTimeout: 30_000,
  },
});
