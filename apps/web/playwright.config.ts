import { defineConfig, devices } from '@playwright/test';

const API_PORT = 3100;
const WEB_PORT = 5174;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      // Backend api on a fixed port; reads from a fresh :memory: SQLite each boot.
      command: 'pnpm --filter api run dev',
      cwd: '../..',
      env: { PORT: String(API_PORT), HOST: '127.0.0.1', NODE_ENV: 'test' },
      port: API_PORT,
      timeout: 60_000,
      reuseExistingServer: false,
    },
    {
      // Vite dev server on a fixed port; --port overrides vite.config.ts.
      command: `pnpm --filter web run dev -- --port ${WEB_PORT} --strictPort`,
      cwd: '../..',
      env: { API_TARGET: `http://127.0.0.1:${API_PORT}` },
      port: WEB_PORT,
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
