import { defineConfig } from '@playwright/test';
import config from '../playwright.config.js';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../', import.meta.url));
const servers = config.webServer as any[];
export default defineConfig({
  ...config,
  testDir: './github-e2e',
  testMatch: 'github.spec.ts',
  webServer: [
    {
      ...servers[0],
      cwd,
      command: 'node --import tsx tests/fixtures/github-server.ts',
      env: {
        ...servers[0].env,
        GITHUB_APP_CLIENT_ID: 'test-app',
        GITHUB_APP_SLUG: 'test-app',
      },
    },
    { ...servers[1], cwd },
  ],
});
