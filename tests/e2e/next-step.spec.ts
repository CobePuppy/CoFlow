import { test, expect } from '@playwright/test';
test('下一步缺项提示、正文优先及确认后阶段推进', async ({ page }) => {
  const origin = 'http://localhost:5174',
    pid = '10000000-0000-4000-8000-000000000001';
  const login = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: {
      email: 'product@coflow.local',
      password: process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!',
    },
  });
  const session = await login.json();
  expect(login.ok()).toBeTruthy();
  const headers = { Origin: origin, 'X-CSRF-Token': session.csrf };
  const people = await (
    await page.request.get('/api/v1/projects/' + pid + '/members')
  ).json();
  const engineer = people.find((m: any) => m.email === 'engineer@coflow.local');
  const qa = people.find((m: any) => m.email === 'qa@coflow.local');
  const created = await page.request.post(
    '/api/v1/projects/' + pid + '/tasks',
    {
      headers,
      data: {
        title: '校园竞赛成果协作工作台',
        productId: session.user.id,
        engineerId: engineer.id,
        productReviewerId: session.user.id,
        qaReviewerId: qa.id,
        testerId: qa.id,
      },
    },
  );
  expect(created.ok()).toBeTruthy();
  const task = await created.json();
  await page.goto('/student/?app=work&task=' + task.id);
  await expect(
    page.getByRole('tab', { name: '需求正文', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  const next = page.locator('.next-step-card');
  await expect(next).toContainText(/提交前.*补齐/);
  await expect(next).toContainText('验收标准');
  await next.getByRole('button', { name: '提交需求', exact: true }).click();
  const confirmation = page.getByRole('dialog', {
    name: '提交需求',
    exact: true,
  });
  await expect(confirmation).toContainText('请先补齐提交资料');
  await expect(
    confirmation.getByRole('button', { name: '确认提交需求', exact: true }),
  ).toBeDisabled();
  await confirmation
    .getByRole('button', { name: '编辑并补全需求', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: '编辑需求草稿', exact: true }),
  ).toBeVisible();
  const update = await page.request.patch('/api/v1/tasks/' + task.id, {
    headers,
    data: {
      expectedVersion: task.version,
      background: '竞赛资料散落在多个工具中，团队难以确认当前交付状态。',
      goal: '让团队在一个项目中完成需求、研发和成果验收。',
      description:
        '支持统一需求正文、成员分工与阶段推进。正文可就地修改，提交前明确提示缺项。',
      criteria: [
        '缺项时说明待补资料',
        '成员可以查看当前处理人',
        '完成确认后阶段正确更新',
      ],
    },
  });
  expect(update.ok()).toBeTruthy();
  await page.reload();
  await expect(next).toContainText('提交资料已齐备');
  await page.getByRole('tab', { name: '验收项', exact: true }).click();
  await expect(
    page
      .getByRole('tabpanel', { name: '验收项', exact: true })
      .getByText('缺项时说明待补资料', { exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: '需求正文', exact: true }).click();
  await expect(
    page
      .locator('.requirement-content')
      .getByRole('button', { name: '编辑内容', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: 'artifacts/browser/requirement-design-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(next).toBeVisible();
  await page.screenshot({
    path: 'artifacts/browser/requirement-design-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await next.getByRole('button', { name: '提交需求', exact: true }).click();
  await confirmation
    .getByRole('button', { name: '确认提交需求', exact: true })
    .click();
  await expect(confirmation).not.toBeVisible();
  expect(
    (await (await page.request.get('/api/v1/tasks/' + task.id)).json()).status,
  ).toBe('SOLUTION_PENDING');
});
