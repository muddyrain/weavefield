import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: 'http://127.0.0.1:15173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm dev:web --port 15173',
      url: 'http://127.0.0.1:15173',
      env: {
        VITE_COLLAB_URL: 'ws://127.0.0.1:11234',
        VITE_COLLAB_DEV_TOKEN: 'm0-e2e-local-only-token',
      },
    },
    {
      command: 'pnpm dev:api',
      url: 'http://127.0.0.1:13001/health',
      env: { PORT: '13001' },
    },
  ],
});
