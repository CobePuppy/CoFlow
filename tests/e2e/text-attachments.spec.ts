import { test, expect } from '@playwright/test';

test('项目文件和需求附件支持TXT/MD上传及原文下载', async ({ page }) => {
  const origin = 'http://localhost:5174';
  const pid = '10000000-0000-4000-8000-000000000001';
  const login = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: {
      email: 'product@coflow.local',
      password: process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!',
    },
  });
  expect(login.ok()).toBeTruthy();
  const auth = await login.json();
  const headers = { Origin: origin, 'X-CSRF-Token': auth.csrf };
  const created = await page.request.post(`/api/v1/projects/${pid}/tasks`, {
    headers,
    data: {
      title: 'TXT-MD附件回归',
      productId: auth.user.id,
      engineerId: '',
      testerId: '',
      productReviewerId: '',
      qaReviewerId: '',
    },
  });
  expect(created.ok()).toBeTruthy();
  const task = await created.json();
  for (const target of [`projects/${pid}`, `tasks/${task.id}`]) {
    for (const [ext, mime] of [
      ['txt', 'text/plain'],
      ['md', 'application/octet-stream'],
    ]) {
      const name = `资料-${Date.now()}.${ext}`;
      const text = '# 中文资料\n\n正文与 **Markdown** 标记。\n';
      const uploaded = await page.request.post(
        `/api/v1/${target}/attachments`,
        {
          headers,
          multipart: {
            file: { name, mimeType: mime, buffer: Buffer.from(text) },
          },
        },
      );
      expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
      const attachment = await uploaded.json();
      const downloaded = await page.request.get(
        `/api/v1/attachments/${attachment.id}/download`,
      );
      expect(downloaded.ok()).toBeTruthy();
      expect(downloaded.headers()['content-disposition']).toContain(
        'attachment',
      );
      expect(await downloaded.text()).toBe(text);
    }
  }
});
