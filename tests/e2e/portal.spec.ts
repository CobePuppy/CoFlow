import { test, expect } from '@playwright/test';

test('中文首页、应用分类收藏、项目成员与独立文件库', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await page.getByLabel('邮箱', { exact: true }).fill('product@coflow.local');
  await page
    .getByLabel('密码', { exact: true })
    .fill(process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!');
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await expect(
    page.getByRole('heading', { name: '工作台', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('让协作发生，让成果汇流')).toBeVisible();
  await expect(page.locator('.portal-welcome b').nth(1)).toHaveText(/\d+/);
  await page.screenshot({
    path: 'artifacts/browser/portal-home.png',
    fullPage: true,
    animations: 'disabled',
  });
  const nav = page.getByRole('navigation', { name: '首页导航' });
  await nav.getByRole('button', { name: '应用', exact: true }).click();
  await page.getByRole('tab', { name: '管理', exact: true }).click();
  await expect(page.locator('.portal-app-row')).toHaveCount(2);
  await page.getByRole('tab', { name: '全部', exact: true }).click();
  await expect(page.locator('.portal-app-row')).toHaveCount(4);
  await page.getByLabel('搜索当前页面').fill('知识');
  await expect(page.locator('.portal-app-row')).toHaveCount(1);
  await page.getByLabel('搜索当前页面').clear();
  const star = page.getByRole('button', { name: '收藏知识库', exact: true });
  if (await star.isVisible()) await star.click();
  await page.reload();
  await expect(page.locator('.portal-app-row')).toHaveCount(4);
  await expect(
    page.locator('.portal-favorites').getByRole('button', { name: '知识库' }),
  ).toBeVisible();
  await page.screenshot({
    path: 'artifacts/browser/portal-apps.png',
    fullPage: true,
    animations: 'disabled',
  });
  await nav.getByRole('button', { name: '团队', exact: true }).click();
  await page.getByLabel('搜索当前页面').fill('product@coflow.local');
  await expect(
    page.getByRole('cell', { name: 'product@coflow.local', exact: true }),
  ).toBeVisible();
  await page.getByLabel('搜索当前页面').clear();
  await nav.getByRole('button', { name: '项目管理', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '创建项目', exact: true }),
  ).toBeVisible();
  await nav.getByRole('button', { name: '知识库', exact: true }).click();
  await page.getByRole('tab', { name: /文件库/ }).click();
  const filename = `知识库验证-${Date.now()}.txt`;
  await page.locator('input[type=file]').setInputFiles({
    name: filename,
    mimeType: 'text/plain',
    buffer: Buffer.from('汇流独立文件库验证'),
  });
  await expect(
    page.getByRole('cell', { name: filename, exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: /文件库/ }).click();
  const row = page.getByRole('row').filter({ hasText: filename });
  const download = row.getByRole('link', { name: '下载', exact: true });
  const href = await download.getAttribute('href');
  const response = await page.request.get(href!);
  expect(response.ok()).toBeTruthy();
  expect((await response.body()).toString()).toBe('汇流独立文件库验证');
  const other = await browser.newContext({ baseURL: 'http://localhost:5174' });
  try {
    await other.request.post('/api/v1/auth/login', {
      headers: { Origin: 'http://localhost:5174' },
      data: {
        email: 'other@coflow.local',
        password: process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!',
      },
    });
    expect((await other.request.get(href!)).status()).toBe(404);
  } finally {
    await other.close();
  }
  await page.screenshot({
    path: 'artifacts/browser/portal-library.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await nav.getByRole('button', { name: '应用', exact: true }).click();
  await expect(page.locator('.portal-brand')).not.toBeInViewport();
  await page.screenshot({
    path: 'artifacts/browser/portal-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
});
