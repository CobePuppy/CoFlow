import 'dotenv/config';
import { defineConfig } from '@playwright/test';
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !new URL(url).pathname.endsWith('/coflow_test') ||
  url === process.env.DATABASE_URL
)
  throw new Error('E2E 必须显式指定隔离的 TEST_DATABASE_URL（coflow_test）');
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  use: {
    baseURL: 'http://localhost:5174',
    headless: true,
    channel: 'chromium',
    viewport: { width: 1440, height: 980 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node --import tsx apps/api/src/main.ts',
      url: 'http://127.0.0.1:3102/api/v1/health',
      env: {
        DATABASE_URL: url,
        SETTINGS_ENCRYPTION_KEY: '1'.repeat(64),
        APP_ORIGIN: 'http://localhost:5174',
        STORAGE_DIR: './storage-test',
        PORT: '3102',
      },
      reuseExistingServer: false,
    },
    {
      command:
        'node apps/web/node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 5174 --strictPort',
      url: 'http://localhost:5174',
      env: { COFLOW_API_URL: 'http://127.0.0.1:3102' },
      reuseExistingServer: false,
    },
  ],
  timeout: 90000,
});
