import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.use({ actionTimeout: 10000 });
test('3.0 双版本独立入口、默认偏好、设置切换与需求上下文保持', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '欢迎使用 CoFlow 汇流', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: '进入企业版', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '版本入口' })).toHaveCount(
    0,
  );
  const origin = 'http://localhost:5174',
    email = `editions-${randomUUID()}@example.com`,
    password = 'Edition-v3-test-2026!';
  const registered = await page.request.post('/api/v1/auth/register', {
    headers: { Origin: origin },
    data: {
      kind: 'creator',
      name: '版本测试',
      email,
      password,
      teamName: '版本测试团队',
    },
  });
  expect(registered.status()).toBe(201);
  const team = await registered.json();
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录工作空间', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '工作台', exact: true }),
  ).toBeVisible();
  const auth = await (await page.request.get('/api/v1/auth/me')).json();
  const headers = { Origin: origin, 'X-CSRF-Token': auth.csrf };
  const project = await (
    await page.request.post(`/api/v1/workspaces/${team.workspaceId}/projects`, {
      headers,
      data: { name: '版本共享项目', workflow: 'STANDARD' },
    })
  ).json();
  const task = await (
    await page.request.post(`/api/v1/projects/${project.id}/tasks`, {
      headers,
      data: { title: '版本切换保留的需求', productId: auth.user.id },
    })
  ).json();
  await page.goto(
    `/enterprise/?app=work&workspace=${team.workspaceId}&project=${project.id}`,
  );
  await page.getByRole('button', { name: '个人菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '偏好设置', exact: true }).click();
  await page
    .locator('.ant-form-item')
    .filter({ hasText: '默认产品版本' })
    .locator('.ant-select-selector')
    .click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByTitle('学生版', { exact: true })
    .click();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByText('设置已保存', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: '切换到所选版本', exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/student/.*workspace=${team.workspaceId}`),
  );
  await expect(
    page.getByText('版本切换保留的需求', { exact: true }),
  ).toBeVisible();
  await page.goto(`/student/?app=work&task=${task.id}`);
  await expect(
    page.getByRole('heading', { name: /版本切换保留的需求/ }),
  ).toBeVisible();
  await page.goto('/');
  await expect(page).toHaveURL(/\/student\/$/);
  const second = await browser.newContext({ baseURL: origin });
  try {
    await second.request.post('/api/v1/auth/login', {
      headers: { Origin: origin },
      data: { email, password },
    });
    const next = await second.newPage();
    await next.goto('/');
    await expect(next).toHaveURL(/\/student\/$/);
    await next.goto('/enterprise/');
    await expect(next).toHaveURL(/\/enterprise\/$/);
  } finally {
    await second.close();
  }
  await page.goto('/student/?section=settings&settingsTab=preferences');
  await page
    .locator('.ant-form-item')
    .filter({ hasText: '默认产品版本' })
    .locator('.ant-select-selector')
    .click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByTitle('企业版', { exact: true })
    .click();
  await page
    .getByRole('button', { name: '切换到所选版本', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: '有未保存的设置', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /取\s*消/, exact: true }).click();
  await expect(page).toHaveURL(/\/student\//);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'artifacts/v3-settings-mobile.png',
    animations: 'disabled',
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
