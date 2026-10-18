import { test, expect } from '@playwright/test';
const pid = '10000000-0000-4000-8000-000000000001';
const wid = '00000000-0000-4000-8000-000000000001';
test('学生版独立网址、竞赛登记、文书修订及版间入口', async ({
  page,
  context,
}) => {
  await page.goto('/student/');
  await expect(page.locator('.brand-image img').first()).toHaveAttribute(
    'alt',
    '汇流 CoFlow 学生版',
  );
  await page.getByLabel('邮箱', { exact: true }).fill('product@coflow.local');
  await page
    .getByLabel('密码', { exact: true })
    .fill(process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!');
  await page.getByRole('button', { name: '登录工作空间', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '工作台', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.portal-app-row')).toHaveCount(6);
  await page.screenshot({
    path: 'artifacts/browser/student-home.png',
    fullPage: true,
    animations: 'disabled',
  });
  const name = '校园创新赛-' + Date.now();
  await page.goto(
    `/student/?section=competitions&workspace=${wid}&project=${pid}`,
  );
  await page.getByRole('button', { name: '登记竞赛', exact: true }).click();
  const competition = page.getByRole('dialog', {
    name: '竞赛信息',
    exact: true,
  });
  await competition.getByLabel('竞赛名称', { exact: true }).fill(name);
  await competition.getByLabel('主办方', { exact: true }).fill('校园创新中心');
  await competition
    .getByLabel('竞赛通知网址', { exact: true })
    .fill('https://example.com/notice');
  await competition
    .getByLabel('提交截止日期', { exact: true })
    .fill('2026-12-01');
  await competition
    .getByRole('button', { name: '保存竞赛', exact: true })
    .click();
  await expect(competition).toHaveCount(0);
  const card = page
    .locator('.ant-card')
    .filter({ has: page.getByText(name, { exact: true }) });
  await expect(card).toContainText('备赛中');
  await page.screenshot({
    path: 'artifacts/browser/student-competitions.png',
    fullPage: true,
    animations: 'disabled',
  });
  await card.getByRole('button', { name: '准备参赛材料', exact: true }).click();
  expect(new URL(page.url()).pathname).toMatch(/^\/student\/?$/);
  await expect(
    page.getByRole('heading', { name: '文书中心', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '创建文书草稿', exact: true }).click();
  const document = page.getByRole('dialog', { name: '项目文档', exact: true });
  await expect(document.getByLabel('文档标题', { exact: true })).toHaveValue(
    name + ' · 项目计划书',
  );
  await expect(
    document.getByLabel('Markdown 内容', { exact: true }),
  ).toHaveValue(/结构草稿/);
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  const taskTitle = '学生需求-' + Date.now();
  const task = await page.request.post(`/api/v1/projects/${pid}/tasks`, {
    headers: { Origin: 'http://localhost:5174', 'X-CSRF-Token': me.csrf },
    data: {
      title: taskTitle,
      productId: me.user.id,
      engineerId: me.user.id,
      testerId: me.user.id,
      productReviewerId: me.user.id,
      qaReviewerId: me.user.id,
    },
  });
  expect(task.ok(), await task.text()).toBeTruthy();
  // Reload editor so its task options include the newly created requirement.
  await page.reload();
  await document
    .getByLabel('Markdown 内容', { exact: true })
    .fill('# 校园项目计划\n\n本团队将完成原型与验证。');
  await document.getByLabel('关联任务', { exact: true }).click();
  await document.getByLabel('关联任务', { exact: true }).fill(taskTitle);
  await page.getByTitle(taskTitle, { exact: true }).click();
  await document
    .getByRole('button', { name: '提交新版本', exact: true })
    .click();
  await expect(document).toHaveCount(0);
  const docCard = page
    .locator('.ant-card')
    .filter({ has: page.getByText(name + ' · 项目计划书', { exact: true }) });
  await docCard
    .getByRole('button', { name: '查看 / 编辑', exact: true })
    .click();
  await expect(
    document.getByLabel('Markdown 内容', { exact: true }),
  ).toHaveValue(/本团队将完成原型/);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://localhost:5174',
  });
  await document
    .getByRole('button', { name: '复制文档链接', exact: true })
    .click();
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(shared).pathname).toMatch(/^\/student\/?$/);
  await page.goto(shared);
  await expect(
    document.getByLabel('Markdown 内容', { exact: true }),
  ).toHaveValue(/本团队将完成原型/);
  await document
    .getByRole('region', { name: '文档关联需求' })
    .getByRole('link')
    .click();
  expect(new URL(page.url()).pathname).toMatch(/^\/student\/?$/);
  await expect(page.locator('.task-detail-drawer')).toBeVisible();
  await page.getByRole('button', { name: '返回需求列表', exact: true }).click();
  expect(new URL(page.url()).pathname).toMatch(/^\/student\/?$/);
  await page.goto('/enterprise/');
  await expect(
    page.getByRole('heading', { name: '工作台', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.brand-image img').first()).toHaveAttribute(
    'alt',
    '汇流 CoFlow 企业版',
  );
  await expect(page.locator('.portal-app-row')).toHaveCount(4);
  await expect(
    page
      .getByRole('navigation', { name: '首页导航' })
      .getByRole('button', { name: '竞赛管理', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('navigation', { name: '版本入口' })
    .getByRole('link', { name: '学生版', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: '工作台', exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await expect(
    page
      .getByRole('navigation', { name: '首页导航' })
      .getByRole('button', { name: '竞赛管理', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.getByRole('button', { name: '个人菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '登录工作空间', exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toMatch(/^\/student\/?$/);
});
