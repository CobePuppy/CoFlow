import { test, expect } from '@playwright/test';

test('工作概览分类、研发资料与手机布局', async ({ page }) => {
  const response = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://localhost:5174' },
    data: {
      email: 'product@coflow.local',
      password: process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!',
    },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto('/student/?app=work&view=dashboard');
  await expect(page.locator('.work-stat-grid')).toBeVisible();
  await page.locator('.work-stat').filter({ hasText: '阻塞' }).click();
  await expect(
    page.locator('.work-stat').filter({ hasText: '阻塞' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.work-stat').filter({ hasText: '待我处理总数' }).click();
  await page.screenshot({
    path: 'artifacts/browser/work-overview-desktop.png',
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.work-stat-grid')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBeTruthy();
  await page.screenshot({
    path: 'artifacts/browser/work-overview-mobile.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.locator('.work-stat').filter({ hasText: '待我处理总数' }).click();
  if (await page.locator('.work-task-card').count()) {
    await page.locator('.work-task-card').first().click();
    await page.getByRole('tab', { name: '方案与评审', exact: true }).click();
    await expect(page.locator('.delivery-materials:visible')).toContainText(
      '技术方案',
    );
    await page.getByRole('tab', { name: '开发交付', exact: true }).click();
    await expect(page.locator('.delivery-materials:visible')).toContainText(
      '开发交付与自测',
    );
    await page.screenshot({
      path: 'artifacts/browser/delivery-materials.png',
      fullPage: false,
    });
  }
});
