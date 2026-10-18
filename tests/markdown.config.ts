import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  testDir: '.',
  testMatch: 'markdown.spec.ts',
  use: {
    baseURL: 'http://127.0.0.1:5175',
    channel: 'chromium',
    headless: true,
  },
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command:
      'node apps/web/node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175',
  },
});
