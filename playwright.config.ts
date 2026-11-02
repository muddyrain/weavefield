import { defineConfig } from '@playwright/test';
import { e2eOrigin, e2eApi, e2eWebPort, e2eApiPort, e2eCollabPort } from './tests/helpers/e2e-address';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: e2eOrigin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `pnpm dev:web --port ${e2eWebPort}`,
      url: e2eOrigin,
      env: {
        WEAVEFIELD_E2E_CACHE_DIR: 'node_modules/.vite-e2e',
        VITE_COLLAB_URL: `ws://127.0.0.1:${e2eCollabPort}`,
        API_PROXY_TARGET: e2eApi,
        VITE_COLLAB_DEV_TOKEN: 'm0-e2e-local-only-token',
      },
    },
    {
      command: 'node tests/helpers/start-e2e-api.cjs',
      url: `${e2eApi}/health`,
      env: { PORT: String(e2eApiPort), WEB_ORIGIN: e2eOrigin },
    },
  ],
});
