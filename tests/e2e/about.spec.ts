import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
const version = JSON.parse(fs.readFileSync('version.json', 'utf8'));
test('关于汇流：双版设置、当前版本、历史详情与手机布局', async ({ page }) => {
  const origin = 'http://localhost:5174';
  const email = 'about-' + randomUUID() + '@example.com';
  const password = 'About-CoFlow-test-2026!';
  const result = await page.request.post('/api/v1/auth/register', {
    headers: { Origin: origin },
    data: {
      kind: 'creator',
      name: '关于测试',
      email,
      password,
      teamName: '关于测试团队',
    },
  });
  expect(result.status()).toBe(201);
  expect(
    (
      await page.request.post('/api/v1/auth/login', {
        headers: { Origin: origin },
        data: { email, password },
      })
    ).ok(),
  ).toBe(true);
  for (const edition of ['student', 'enterprise']) {
    await page.goto('/' + edition + '/?section=settings&settingsTab=about');
    await expect(
      page.getByRole('tab', { name: '关于汇流', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    const about = page.getByRole('region', { name: '关于汇流' });
    await expect(
      about.getByRole('heading', { name: '关于汇流', exact: true }),
    ).toBeVisible();
    await expect(about).toContainText('v' + version.product);
    await expect(about).toContainText('更新详情');
    await expect(about).not.toContainText('10.16.7.124');
    await expect(
      page.getByRole('button', { name: '保存设置', exact: true }),
    ).toBeHidden();
    await expect(
      page.getByText('账号安全 · 修改密码', { exact: true }),
    ).toBeHidden();
    await about.getByRole('button').filter({ hasText: 'v3.1.1' }).click();
    await expect(about.getByText(/项目空间左侧统一为浅绿色/)).toBeVisible();
    if (edition === 'student')
      await page.screenshot({
        path: 'artifacts/v3.3.0-about-desktop.png',
        fullPage: true,
        animations: 'disabled',
      });
    await page.reload();
    await expect(
      page.getByRole('tab', { name: '关于汇流', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (edition === 'student')
      await page.screenshot({
        path: 'artifacts/v3.3.0-about-mobile.png',
        fullPage: true,
        animations: 'disabled',
      });
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.getByRole('tab', { name: '个人资料', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '保存设置', exact: true }),
    ).toBeVisible();
  }
  await page.goto('/student/');
  await page.getByRole('button', { name: '个人菜单', exact: true }).click();
  await page.getByRole('link', { name: '关于汇流', exact: true }).click();
  await expect(
    page.getByRole('tab', { name: '关于汇流', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
});
