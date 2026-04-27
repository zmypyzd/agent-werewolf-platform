import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // The Playwright e2e is opt-in and not part of the unit/integration run.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
});
