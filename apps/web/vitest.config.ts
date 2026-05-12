import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // The Playwright e2e is opt-in and not part of the unit/integration run.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    // Browser-API stubs needed by jsdom-environment tests (interactive
    // popovers, ResizeObserver-using components). The setup file is
    // idempotent and only patches globals that are undefined, so the
    // default node-environment tests are unaffected.
    setupFiles: ['./src/test-setup-jsdom.ts'],
  },
});
