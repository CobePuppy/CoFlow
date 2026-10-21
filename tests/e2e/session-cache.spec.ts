import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
const runtimePath =
  '/@fs/' +
  resolve('packages/web-core/src/shared/api/runtime.ts').replaceAll('\\', '/');

test('会话失效返回登录页，换账号后不保留旧业务缓存', async ({ page }) => {
  const origin = 'http://localhost:5174';
  const password = process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!';
  const login = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: { email: 'product@coflow.local', password },
  });
  expect(login.ok()).toBeTruthy();
  const session = await login.json();
  await page.goto('/student/?app=work&view=dashboard');
  await expect(page.locator('.work-stat-grid')).toBeVisible();
  const oldUser = await page.evaluate(async (modulePath) => {
    const { client } = await import(modulePath);
    client.setQueryData(['private-old-account'], { secret: 'old' });
    return client.getQueryData(['me']).user.id;
  }, runtimePath);
  const logout = await page.request.post('/api/v1/auth/logout', {
    headers: { Origin: origin, 'X-CSRF-Token': session.csrf },
    data: {},
  });
  expect(logout.ok()).toBeTruthy();
  await page.evaluate(async (modulePath) => {
    const { client } = await import(modulePath);
    await client.invalidateQueries({ queryKey: ['me'] });
  }, runtimePath);
  await expect(
    page.getByRole('button', { name: '登录工作空间' }),
  ).toBeVisible();
  expect(
    await page.evaluate(async (modulePath) => {
      const { client } = await import(modulePath);
      return client.getQueryData(['private-old-account']) === undefined;
    }, runtimePath),
  ).toBe(true);
  await page.getByLabel('邮箱', { exact: true }).fill('engineer@coflow.local');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await expect(page.locator('.work-stat-grid')).toBeVisible();
  expect(
    await page.evaluate(async (modulePath) => {
      const { client } = await import(modulePath);
      return client.getQueryData(['me']).user.id;
    }, runtimePath),
  ).not.toBe(oldUser);
});
